#!/usr/bin/env python3
"""Compare l'encodeur QR de jarvis/ui/qr.js a l'implementation de reference.

Prerequis : pip install qrcode
Usage     : python3 jarvis/verification/verifier-qr.py
"""
import json
import os
import subprocess
import sys

try:
    import qrcode
    from qrcode.util import QRData, MODE_8BIT_BYTE
except ImportError:
    print("Le paquet 'qrcode' est requis : pip install qrcode")
    sys.exit(2)

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHEMIN_QR = os.path.join(RACINE, 'ui', 'qr.js')

CODE_JS = r'''
let src = require('fs').readFileSync(process.argv[1], 'utf8');
src = src.replace("global.CodeQR = { encoder, dessiner };",
  "global.CodeQR = { encoder, _i: { appliquerMasque, poserFormat, poserVersion, creerMatrice, placerDonnees, construireDonnees, entrelacer, encoderTexte, choisirVersion } };");
new Function('global', src)(globalThis);
const q = globalThis.CodeQR;
const texte = process.argv[2];
const masqueImpose = process.argv[3];
let resultat = q.encoder(texte);
let matrice = resultat.modules;
if (masqueImpose !== undefined) {
  const I = q._i;
  const octets = I.encoderTexte(texte);
  const version = I.choisirVersion(octets.length);
  const m = I.creerMatrice(version);
  I.placerDonnees(m, I.entrelacer(I.construireDonnees(octets, version), version));
  const c = I.appliquerMasque(m, parseInt(masqueImpose, 10));
  I.poserFormat(c, parseInt(masqueImpose, 10));
  I.poserVersion(c, version);
  matrice = c;
}
console.log(JSON.stringify({ v: resultat.version, masque: resultat.masque, mat: matrice.map((l) => l.join('')) }));
'''

CAS = [
    "JARVIS",
    "http://192.168.1.20:4790/#code=658056",
    "http://10.0.0.7:4790",
    "http://192.168.1.100:4790/#code=123456&nom=iPhone",
    "a" * 40, "b" * 70, "c" * 100, "d" * 140, "e" * 180, "x" * 200,
    "http://192.168.1.20:4790/#code=999999&hôte=Salon",
]


def matrice_js(texte, masque=None):
    args = ["node", "-e", CODE_JS, CHEMIN_QR, texte]
    if masque is not None:
        args.append(str(masque))
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr[:500])
    return json.loads(r.stdout)


def matrice_reference(texte, masque=None):
    parametres = dict(error_correction=qrcode.constants.ERROR_CORRECT_M, border=0)
    if masque is not None:
        parametres['mask_pattern'] = masque
    qr = qrcode.QRCode(**parametres)
    qr.add_data(QRData(texte.encode('utf-8'), mode=MODE_8BIT_BYTE))
    qr.make(fit=True)
    return [''.join('1' if c else '0' for c in ligne) for ligne in qr.modules]


def main():
    total = 0
    for texte in CAS:
        etiquette = (texte[:28] + '...') if len(texte) > 28 else texte
        js = matrice_js(texte)
        if matrice_reference(texte) == js['mat']:
            print("  IDENTIQUE      v%d masque %d  %r" % (js['v'], js['masque'], etiquette))
            continue
        # Le choix du masque peut differer sans que l'encodage soit faux : on verifie
        # alors l'egalite pour chacun des huit masques imposes.
        conforme = all(matrice_reference(texte, m) == matrice_js(texte, m)['mat'] for m in range(8))
        if conforme:
            print("  IDENTIQUE(*)   v%d — conforme aux 8 masques imposes  %r" % (js['v'], etiquette))
        else:
            print("  DIFFERENT      v%d  %r" % (js['v'], etiquette))
            total += 1
    print()
    if total:
        print("RESULTAT : %d cas non conformes" % total)
        sys.exit(1)
    print("RESULTAT : encodeur conforme a la reference sur %d cas" % len(CAS))


if __name__ == '__main__':
    main()
