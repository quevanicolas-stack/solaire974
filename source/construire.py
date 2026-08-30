# Assemble le site en un fichier unique, autonome, sans dépendance réseau
# autre que les polices et la vérification anti-robots.
#
#   maquette.tpl.html + data-uris.json  ->  site-a-deposer/index.html
#
# Les images sont embarquées en data-URI : le fichier se suffit à lui-même.

import json, pathlib

BASE = pathlib.Path(__file__).parent
SORTIE = BASE / 'site-a-deposer' / 'index.html'

# Lien de prise de rendez-vous, unique pour tout le site.
CALENDLY = 'https://calendly.com/aurelieameerpro/30min'

# Page de capture du guide gratuit, hébergée à part.
# C'est la seule adresse à changer si la landing déménage.
GUIDE = 'https://quevanicolas-stack.github.io/cours-d-anglais/landing/'

images = json.loads((BASE / 'data-uris.json').read_text(encoding='utf-8'))

REMPLACEMENTS = {
    '__CALENDLY__': CALENDLY,
    '__GUIDE__':    GUIDE,
    '__PORTES__':   images['portes'],
    '__NEXTSTEP__': images['nextstep'],
    '__AURELIE__':  images['aurelie'],
    '__MASCOTTE__': images['mascotte'],
}

page = (BASE / 'maquette.tpl.html').read_text(encoding='utf-8')
for cle, valeur in REMPLACEMENTS.items():
    page = page.replace(cle, valeur)

restants = [m for m in REMPLACEMENTS if m in page]
if restants:
    raise SystemExit('Marqueurs non remplacés : ' + ', '.join(restants))
if '__' in page.replace('data:image', '') and '__CALENDLY__' in page:
    raise SystemExit('Marqueur oublié dans la page.')

SORTIE.parent.mkdir(parents=True, exist_ok=True)
SORTIE.write_text(page, encoding='utf-8')
print('écrit :', SORTIE, '—', len(page) // 1024, 'Ko')
