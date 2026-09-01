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

# Page de capture du guide gratuit. Elle est désormais servie par le
# site lui-même, sous /guide/ : une seule mise en ligne, un seul domaine.
#
# IMPORTANT : ce lien vise la page de capture, jamais le PDF. Le guide
# n'est remis qu'après le formulaire, qui recueille les coordonnées du
# prospect. Un lien direct vers le PDF ferait perdre le contact.
GUIDE = '/guide/'

# Les visuels sont des fichiers à part, et non plus des data:URI noyés
# dans la page. Trois raisons :
#   — un robot qui lit la page (moteur, aperçu de partage, assistant)
#     tronque les gros fichiers : la photo d'Aurélie, à 544 Ko dans le
#     document, n'était jamais atteinte et passait pour absente ;
#   — une image en data:URI ne se met pas en cache séparément : elle est
#     retéléchargée à chaque visite, avec toute la page ;
#   — le document tombe de 734 Ko à une quarantaine, donc le texte
#     s'affiche presque aussitôt, les images se posant ensuite.
REMPLACEMENTS = {
    '__CALENDLY__': CALENDLY,
    '__GUIDE__':    GUIDE,
    '__PORTES__':   'assets/visuels/portes.jpg',
    '__NEXTSTEP__': 'assets/visuels/next-step.jpg',
    '__AURELIE__':  'assets/visuels/aurelie.jpg',
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
