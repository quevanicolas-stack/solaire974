'use strict';
// Implementation minimale mais complete d'un serveur WebSocket (RFC 6455).
// Ecrite a la main pour que JARVIS ne depende d'aucun paquet externe : le serveur
// doit pouvoir demarrer sur une machine hors ligne, sans installation prealable.

const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OPCODE = {
  SUITE: 0x0,
  TEXTE: 0x1,
  BINAIRE: 0x2,
  FERMETURE: 0x8,
  PING: 0x9,
  PONG: 0xa
};

// Au-dela, on coupe la connexion : aucune commande vocale legitime ne pese autant.
const TAILLE_MAX_MESSAGE = 8 * 1024 * 1024;

class Connexion extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.tampon = Buffer.alloc(0);
    this.fragments = [];
    this.opcodeFragment = null;
    this.fermee = false;
    this.contexte = {}; // espace libre pour l'application (compte, appareil...)

    socket.on('data', (donnees) => this._recevoir(donnees));
    socket.on('close', () => this._terminer());
    socket.on('error', (e) => {
      this.emit('erreur', e);
      this._terminer();
    });

    // Ping regulier : detecte les telephones qui se sont endormis.
    this.battement = setInterval(() => {
      if (this.fermee) return;
      this._envoyerTrame(OPCODE.PING, Buffer.alloc(0));
    }, 30000);
  }

  _recevoir(donnees) {
    this.tampon = Buffer.concat([this.tampon, donnees]);
    let continuer = true;
    while (continuer && !this.fermee) {
      continuer = this._lireTrame();
    }
  }

  // Renvoie true si une trame complete a ete consommee.
  _lireTrame() {
    const t = this.tampon;
    if (t.length < 2) return false;

    const premier = t[0];
    const second = t[1];
    const fin = (premier & 0x80) !== 0;
    const opcode = premier & 0x0f;
    const masque = (second & 0x80) !== 0;
    let longueur = second & 0x7f;
    let decalage = 2;

    if (longueur === 126) {
      if (t.length < decalage + 2) return false;
      longueur = t.readUInt16BE(decalage);
      decalage += 2;
    } else if (longueur === 127) {
      if (t.length < decalage + 8) return false;
      const grand = t.readBigUInt64BE(decalage);
      if (grand > BigInt(TAILLE_MAX_MESSAGE)) {
        this.fermer(1009, 'Message trop volumineux');
        return false;
      }
      longueur = Number(grand);
      decalage += 8;
    }

    // Le client doit toujours masquer ses trames.
    if (!masque) {
      this.fermer(1002, 'Trame non masquee');
      return false;
    }
    if (t.length < decalage + 4) return false;
    const cleMasque = t.slice(decalage, decalage + 4);
    decalage += 4;

    if (t.length < decalage + longueur) return false;
    const charge = Buffer.allocUnsafe(longueur);
    for (let i = 0; i < longueur; i++) {
      charge[i] = t[decalage + i] ^ cleMasque[i % 4];
    }
    this.tampon = t.slice(decalage + longueur);

    // Trames de controle : jamais fragmentees.
    if (opcode === OPCODE.FERMETURE) {
      const code = charge.length >= 2 ? charge.readUInt16BE(0) : 1005;
      this.fermer(code === 1005 ? 1000 : code, '');
      return false;
    }
    if (opcode === OPCODE.PING) {
      this._envoyerTrame(OPCODE.PONG, charge);
      return true;
    }
    if (opcode === OPCODE.PONG) {
      this.emit('pong');
      return true;
    }

    if (opcode === OPCODE.SUITE) {
      if (this.opcodeFragment === null) {
        this.fermer(1002, 'Fragment sans debut');
        return false;
      }
      this.fragments.push(charge);
    } else {
      this.fragments = [charge];
      this.opcodeFragment = opcode;
    }

    const cumul = this.fragments.reduce((somme, f) => somme + f.length, 0);
    if (cumul > TAILLE_MAX_MESSAGE) {
      this.fermer(1009, 'Message trop volumineux');
      return false;
    }

    if (fin) {
      const complet = Buffer.concat(this.fragments);
      const type = this.opcodeFragment;
      this.fragments = [];
      this.opcodeFragment = null;
      if (type === OPCODE.TEXTE) {
        this.emit('message', complet.toString('utf8'));
      } else {
        this.emit('binaire', complet);
      }
    }
    return true;
  }

  _envoyerTrame(opcode, charge) {
    if (this.fermee || this.socket.destroyed) return;
    const corps = Buffer.isBuffer(charge) ? charge : Buffer.from(String(charge), 'utf8');
    const longueur = corps.length;
    let entete;
    if (longueur < 126) {
      entete = Buffer.allocUnsafe(2);
      entete[1] = longueur;
    } else if (longueur < 65536) {
      entete = Buffer.allocUnsafe(4);
      entete[1] = 126;
      entete.writeUInt16BE(longueur, 2);
    } else {
      entete = Buffer.allocUnsafe(10);
      entete[1] = 127;
      entete.writeBigUInt64BE(BigInt(longueur), 2);
    }
    entete[0] = 0x80 | opcode; // trame finale
    try {
      this.socket.write(Buffer.concat([entete, corps]));
    } catch (e) {
      this._terminer();
    }
  }

  envoyer(message) {
    const texte = typeof message === 'string' ? message : JSON.stringify(message);
    this._envoyerTrame(OPCODE.TEXTE, Buffer.from(texte, 'utf8'));
  }

  fermer(code, raison) {
    if (this.fermee) return;
    const motif = Buffer.from(String(raison || ''), 'utf8');
    const charge = Buffer.allocUnsafe(2 + motif.length);
    charge.writeUInt16BE(code || 1000, 0);
    motif.copy(charge, 2);
    this._envoyerTrame(OPCODE.FERMETURE, charge);
    this._terminer();
    try { this.socket.end(); } catch (e) { /* deja ferme */ }
  }

  _terminer() {
    if (this.fermee) return;
    this.fermee = true;
    clearInterval(this.battement);
    this.emit('fermeture');
  }
}

// Branche la gestion des mises a niveau WebSocket sur un serveur HTTP existant.
function attacher(serveurHttp, surConnexion) {
  serveurHttp.on('upgrade', (requete, socket, entete) => {
    const cle = requete.headers['sec-websocket-key'];
    if (requete.headers.upgrade !== 'websocket' || !cle) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accepte = crypto.createHash('sha1').update(cle + GUID).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Accept: ' + accepte,
      '', ''
    ].join('\r\n'));
    socket.setNoDelay(true);

    const connexion = new Connexion(socket);
    if (entete && entete.length) connexion._recevoir(entete);
    surConnexion(connexion, requete);
  });
}

module.exports = { attacher, Connexion, OPCODE };
