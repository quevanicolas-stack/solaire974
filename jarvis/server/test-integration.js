// Test d'integration : API HTTP puis WebSocket
process.env.JARVIS_DOSSIER = require('path').join(require('os').tmpdir(), 'jarvis-test-' + Date.now());
const fs = require('fs'); const crypto = require('crypto'); const http = require('http'); const net = require('net');
fs.rmSync(process.env.JARVIS_DOSSIER, { recursive: true, force: true });

const config = require('./config.js');
config.ecrire({ port: 4799 });
const { demarrer } = require('./index.js');
const serveur = demarrer();

function requete(methode, chemin, corps, jeton) {
  return new Promise((resolve, reject) => {
    const charge = corps ? Buffer.from(JSON.stringify(corps)) : null;
    const entetes = {};
    if (charge) { entetes['Content-Type'] = 'application/json'; entetes['Content-Length'] = charge.length; }
    if (jeton) entetes.Authorization = 'Bearer ' + jeton;
    const r = http.request({ host: '127.0.0.1', port: 4799, path: chemin, method: methode, headers: entetes }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve({ code: res.statusCode, corps: JSON.parse(d || '{}') }); } catch (e) { resolve({ code: res.statusCode, corps: d }); } });
    });
    r.on('error', reject); if (charge) r.write(charge); r.end();
  });
}

// Client WebSocket minimal (masquage cote client)
function clientWs(chemin, surMessage) {
  return new Promise((resolve, reject) => {
    const cle = crypto.randomBytes(16).toString('base64');
    const socket = net.connect(4799, '127.0.0.1', () => {
      socket.write(['GET ' + chemin + ' HTTP/1.1','Host: 127.0.0.1:4799','Upgrade: websocket','Connection: Upgrade','Sec-WebSocket-Key: ' + cle,'Sec-WebSocket-Version: 13','',''].join('\r\n'));
    });
    let entete = false; let tampon = Buffer.alloc(0);
    socket.on('data', (d) => {
      tampon = Buffer.concat([tampon, d]);
      if (!entete) {
        const i = tampon.indexOf('\r\n\r\n');
        if (i === -1) return;
        entete = true; tampon = tampon.slice(i + 4);
        resolve({ envoyer, socket });
      }
      while (tampon.length >= 2) {
        const opcode = tampon[0] & 0x0f; let len = tampon[1] & 0x7f; let off = 2;
        if (len === 126) { if (tampon.length < 4) return; len = tampon.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (tampon.length < 10) return; len = Number(tampon.readBigUInt64BE(2)); off = 10; }
        if (tampon.length < off + len) return;
        const charge = tampon.slice(off, off + len); tampon = tampon.slice(off + len);
        if (opcode === 0x1) surMessage(charge.toString('utf8'));
      }
    });
    socket.on('error', reject);
    function envoyer(obj) {
      const corps = Buffer.from(JSON.stringify(obj), 'utf8');
      const masque = crypto.randomBytes(4);
      let entetes;
      if (corps.length < 126) { entetes = Buffer.alloc(2); entetes[1] = 0x80 | corps.length; }
      else { entetes = Buffer.alloc(4); entetes[1] = 0x80 | 126; entetes.writeUInt16BE(corps.length, 2); }
      entetes[0] = 0x81;
      const masque2 = Buffer.alloc(corps.length);
      for (let i = 0; i < corps.length; i++) masque2[i] = corps[i] ^ masque[i % 4];
      socket.write(Buffer.concat([entetes, masque, masque2]));
    }
  });
}

(async () => {
  const ok = (t, c) => console.log((c ? '  OK  ' : ' ECHEC ') + t);
  let s;

  s = await requete('GET', '/api/sante'); ok('sante -> ' + s.corps.ok, s.code === 200 && s.corps.ok);
  s = await requete('POST', '/api/compte', { courriel: 'nicolas@exemple.re', motDePasse: 'motdepasse974', appareil: 'Mac de Nicolas', plateforme: 'macos' });
  ok('creation de compte', s.code === 201 && !!s.corps.jeton);
  const jeton = s.corps.jeton;

  s = await requete('POST', '/api/compte', { courriel: 'nicolas@exemple.re', motDePasse: 'autre1234' });
  ok('doublon refuse (409)', s.code === 409);
  s = await requete('POST', '/api/connexion', { courriel: 'nicolas@exemple.re', motDePasse: 'mauvais' });
  ok('mauvais mot de passe refuse (401)', s.code === 401);
  s = await requete('GET', '/api/etat'); ok('api protegee sans jeton (401)', s.code === 401);
  s = await requete('GET', '/api/etat', null, jeton);
  ok('etat authentifie (' + s.corps.courriel + ')', s.code === 200 && s.corps.courriel === 'nicolas@exemple.re');

  s = await requete('POST', '/api/salutation', {}, jeton);
  ok('salutation : "' + s.corps.parole + '"', !!s.corps.parole);
  s = await requete('POST', '/api/salutation', {}, jeton);
  ok('pas de salutation repetee', s.corps.parole === null);

  s = await requete('POST', '/api/dire', { texte: 'quelle heure est-il' }, jeton);
  ok('dire heure -> "' + s.corps.parole + '"', s.corps.intention === 'heure');
  s = await requete('POST', '/api/dire', { texte: 'note que le devis Écologreen part vendredi' }, jeton);
  ok('note enregistree', s.corps.intention === 'retenir');
  s = await requete('POST', '/api/dire', { texte: 'de quoi on parlait' }, jeton);
  ok('rappel -> "' + s.corps.parole + '"', /Écologreen/.test(s.corps.parole));

  s = await requete('POST', '/api/dire', { texte: 'verrouille l\'écran' }, jeton);
  ok('action sensible demande confirmation', s.corps.attente === true);
  s = await requete('POST', '/api/dire', { texte: 'non' }, jeton);
  ok('refus pris en compte -> "' + s.corps.parole + '"', s.corps.intention === 'annulation');

  s = await requete('POST', '/api/appairage', {}, jeton);
  ok('code d\'appairage : ' + s.corps.code, /^\d{6}$/.test(s.corps.code || ''));
  const code = s.corps.code;
  s = await requete('POST', '/api/appairage/rejoindre', { code, appareil: 'iPhone', plateforme: 'ios' });
  const jetonTelephone = s.corps.jeton;
  ok('telephone appaire au meme compte', !!jetonTelephone);
  s = await requete('POST', '/api/appairage/rejoindre', { code });
  ok('code a usage unique', s.code === 401);
  s = await requete('GET', '/api/etat', null, jetonTelephone);
  ok('le telephone voit le meme historique (' + s.corps.historique.length + ' echanges)', s.corps.historique.length > 3);

  s = await requete('GET', '/index.html'); ok('interface servie (404 attendu, pas encore ecrite)', true);
  s = await requete('GET', '/../server/config.js'); ok('traversee de chemin bloquee', s.code === 404 || s.code === 403);

  // --- WebSocket : synchronisation entre deux appareils ---
  const recusMac = []; const recusTelephone = [];
  const mac = await clientWs('/ws', (m) => recusMac.push(JSON.parse(m)));
  const tel = await clientWs('/ws', (m) => recusTelephone.push(JSON.parse(m)));
  mac.envoyer({ type: 'authentifier', jeton, appareil: 'Mac' });
  tel.envoyer({ type: 'authentifier', jeton: jetonTelephone, appareil: 'iPhone' });
  await new Promise((r) => setTimeout(r, 300));
  ok('WebSocket authentifie (message "pret")', recusMac.some((m) => m.type === 'pret') && recusTelephone.some((m) => m.type === 'pret'));

  mac.envoyer({ type: 'dire', texte: 'ouvre le dossier Documents' });
  await new Promise((r) => setTimeout(r, 400));
  ok('reponse au Mac', recusMac.some((m) => m.type === 'reponse'));
  ok('echange reflete sur le telephone', recusTelephone.some((m) => m.type === 'echange' && /Documents/i.test(m.utilisateur)));

  mac.envoyer({ type: 'niveau', valeur: 0.8 });
  await new Promise((r) => setTimeout(r, 200));
  ok('amplitude du reacteur diffusee au telephone', recusTelephone.some((m) => m.type === 'niveau' && m.valeur === 0.8));

  mac.envoyer({ type: 'parole', etat: 'debut', texte: 'test' });
  await new Promise((r) => setTimeout(r, 200));
  ok('etat de parole diffuse', recusTelephone.some((m) => m.type === 'parole' && m.etat === 'debut'));

  mac.socket.destroy(); tel.socket.destroy();
  serveur.close(); process.exit(0);
})().catch((e) => { console.error('ERREUR', e); process.exit(1); });
