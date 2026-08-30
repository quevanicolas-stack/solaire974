# Site Fluent & Forward — comment il est fabriqué

Le site en ligne est **un seul fichier**, `site-a-deposer/index.html`,
qui embarque ses images et son script. Aucune dépendance réseau, hors
les polices Google et la vérification anti-robots Cloudflare.

Ce fichier ne s'édite pas à la main : il est **produit** à partir du
modèle. Toute modification directe de `index.html` serait perdue à la
prochaine construction.

## Les trois fichiers de ce dossier

| Fichier | Rôle |
|---|---|
| `maquette.tpl.html` | Le modèle : c'est **ici** qu'on modifie le site. Les images y sont des marqueurs (`__PORTES__`, `__AURELIE__`…). |
| `data-uris.json` | Les images, encodées pour être embarquées dans la page. |
| `construire.py` | Remplace les marqueurs et écrit `site-a-deposer/index.html`. |

## Reconstruire

```
python3 source/construire.py
```

Le script s'arrête net si un marqueur n'a pas été remplacé : une page
incomplète ne peut pas partir en ligne par distraction.

## Les réglages qu'on change le plus souvent

Tous dans `maquette.tpl.html`, en haut du `<script>` :

| Variable | Ce qu'elle règle |
|---|---|
| `PRIX_STANDARD` | Le tarif plein, affiché barré. |
| `PRIX_LANCEMENT` | Le prix cohorte fondatrice. |
| `FIN_OFFRE` | La date de fin de l'offre. Les mois comptent **à partir de 0** : `new Date(2026,8,10,…)` est bien septembre. |
| `ADRESSE_SESSIONS` | Le script Google qui publie les sessions. |
| `ADRESSE_COLLECTEUR` | Le même script, qui reçoit les demandes d'accès. |
| `CLE_TURNSTILE` | La clé **publique** de la vérification anti-robots. |

La remise affichée (`−56 %`) n'est écrite nulle part : elle est calculée
à partir des deux prix. Changer un prix suffit.

Et dans `construire.py` :

| Constante | Ce qu'elle règle |
|---|---|
| `CALENDLY` | Le lien de prise de rendez-vous, partout sur le site. |
| `GUIDE` | L'adresse de la page de capture du guide gratuit. |

## Ce qui se passe une fois l'offre terminée

Passée la date de `FIN_OFFRE`, la page se réajuste toute seule au premier
chargement : le prix barré, la pastille de remise, le compte à rebours et
la fenêtre d'accueil disparaissent, et il ne reste que le tarif standard.
Il n'y a rien à faire, et surtout pas de décompte figé sur zéro.

## Les sessions

Elles ne sont pas dans le code : elles viennent de l'onglet « Sessions »
du classeur d'Aurélie, lu par le script Google. Les valeurs inscrites
dans `SESSIONS_SECOURS` ne servent que si le classeur est injoignable —
le site reste juste plutôt que vide.

La ligne « Prochaines sessions disponibles » du bloc tarif est tirée du
**même** tableau que la grille des mois : les deux ne peuvent pas se
contredire. Elle reprend les colonnes **après la première**, celle de la
cohorte en cours, dont la date de démarrage est annoncée juste au-dessus.
