'use strict';
// Genere les icones de l'application : un reacteur arc bleu sur fond sombre.
// Ecrit des PNG directement, sans bibliotheque graphique, pour que la generation
// fonctionne sur n'importe quelle machine disposant de Node.
//
// Usage : node jarvis/outils/generer-icones.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DESTINATION = path.join(__dirname, '..', 'ui', 'icones');

// --- Encodage PNG ---------------------------------------------------------
function bloc(type, donnees) {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(donnees.length, 0);
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), donnees]);
  const controle = Buffer.alloc(4);
  controle.writeUInt32BE(crc32(corps) >>> 0, 0);
  return Buffer.concat([longueur, corps, controle]);
}

const TABLE_CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(donnees) {
  let c = 0xffffffff;
  for (let i = 0; i < donnees.length; i++) c = TABLE_CRC[(c ^ donnees[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

function ecrirePng(chemin, largeur, hauteur, pixels) {
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(largeur, 0);
  entete.writeUInt32BE(hauteur, 4);
  entete[8] = 8;   // 8 bits par canal
  entete[9] = 6;   // RVB avec canal alpha
  entete[10] = 0;  // compression standard
  entete[11] = 0;  // filtrage standard
  entete[12] = 0;  // pas d'entrelacement

  // Chaque ligne est prefixee par son type de filtre (0 : aucun).
  const brut = Buffer.alloc(hauteur * (largeur * 4 + 1));
  for (let y = 0; y < hauteur; y++) {
    brut[y * (largeur * 4 + 1)] = 0;
    pixels.copy(brut, y * (largeur * 4 + 1) + 1, y * largeur * 4, (y + 1) * largeur * 4);
  }

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', entete),
    bloc('IDAT', zlib.deflateSync(brut, { level: 9 })),
    bloc('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(chemin, png);
  return png.length;
}

// --- Dessin du reacteur ---------------------------------------------------
function melanger(fond, teinte, alpha) {
  return [
    Math.round(fond[0] + (teinte[0] - fond[0]) * alpha),
    Math.round(fond[1] + (teinte[1] - fond[1]) * alpha),
    Math.round(fond[2] + (teinte[2] - fond[2]) * alpha)
  ];
}

function dessinerIcone(cote, options) {
  const opts = options || {};
  const pixels = Buffer.alloc(cote * cote * 4);
  const centre = (cote - 1) / 2;
  const rayon = cote / 2;
  // Suréchantillonnage : quatre points par pixel pour des bords nets.
  const sousPoints = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]];

  const FOND = [2, 10, 20];
  const BLEU = [56, 189, 248];
  const CLAIR = [186, 230, 253];

  for (let y = 0; y < cote; y++) {
    for (let x = 0; x < cote; x++) {
      let r = 0, v = 0, b = 0, a = 0;
      for (const [dx, dy] of sousPoints) {
        const ex = (x + dx - centre) / rayon;
        const ey = (y + dy - centre) / rayon;
        const distance = Math.sqrt(ex * ex + ey * ey);
        const angle = Math.atan2(ey, ex);
        const echantillon = couleurEn(distance, angle, opts.pleinBord, FOND, BLEU, CLAIR);
        r += echantillon[0]; v += echantillon[1]; b += echantillon[2]; a += echantillon[3];
      }
      const indice = (y * cote + x) * 4;
      pixels[indice] = Math.round(r / 4);
      pixels[indice + 1] = Math.round(v / 4);
      pixels[indice + 2] = Math.round(b / 4);
      pixels[indice + 3] = Math.round(a / 4);
    }
  }
  return pixels;
}

function couleurEn(distance, angle, pleinBord, FOND, BLEU, CLAIR) {
  // Hors du disque : transparent, ou fond plein pour les icones iOS qui n'aiment
  // pas la transparence.
  if (distance > 1) {
    return pleinBord ? [FOND[0], FOND[1], FOND[2], 255] : [0, 0, 0, 0];
  }

  let couleur = FOND;

  // Halo interne, de plus en plus present vers le centre.
  const halo = Math.max(0, 1 - distance / 0.95);
  couleur = melanger(couleur, BLEU, Math.pow(halo, 2.4) * 0.55);

  // Anneau exterieur.
  if (distance > 0.86 && distance < 0.94) {
    couleur = melanger(couleur, BLEU, 0.75);
  }

  // Dix bobines trapezoidales entre 0.42 et 0.74.
  if (distance > 0.42 && distance < 0.74) {
    const secteur = ((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 10;
    const position = Math.abs((secteur % 1) - 0.5);
    if (position < 0.33) {
      const intensite = 0.55 + (0.33 - position) * 0.9;
      couleur = melanger(couleur, BLEU, Math.min(0.95, intensite));
    }
  }

  // Anneau interieur.
  if (distance > 0.36 && distance < 0.41) {
    couleur = melanger(couleur, CLAIR, 0.7);
  }

  // Coeur lumineux.
  if (distance < 0.30) {
    const coeur = 1 - distance / 0.30;
    couleur = melanger(couleur, CLAIR, Math.min(1, coeur * 1.5));
    if (distance < 0.13) couleur = [255, 255, 255];
  }

  // Bord adouci du disque.
  const alpha = pleinBord ? 255 : Math.round(255 * Math.min(1, (1 - distance) / 0.02));
  return [couleur[0], couleur[1], couleur[2], alpha];
}

function main() {
  if (!fs.existsSync(DESTINATION)) fs.mkdirSync(DESTINATION, { recursive: true });
  const formats = [
    { nom: 'reacteur-192.png', cote: 192, pleinBord: false },
    { nom: 'reacteur-512.png', cote: 512, pleinBord: false },
    { nom: 'reacteur-apple-180.png', cote: 180, pleinBord: true },
    { nom: 'reacteur-64.png', cote: 64, pleinBord: false }
  ];
  for (const format of formats) {
    const pixels = dessinerIcone(format.cote, { pleinBord: format.pleinBord });
    const octets = ecrirePng(path.join(DESTINATION, format.nom), format.cote, format.cote, pixels);
    console.log('  ' + format.nom + ' — ' + format.cote + ' px, ' + Math.round(octets / 1024) + ' ko');
  }
}

if (require.main === module) main();

module.exports = { ecrirePng, dessinerIcone };
