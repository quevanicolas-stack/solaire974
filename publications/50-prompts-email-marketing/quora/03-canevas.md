# Canevas Quora 03 — 50-prompts-email-marketing

**Question visée :** Comment construire une séquence de relance efficace après un premier email sans réponse ?
**Langue :** fr — **registre :** tutoiement
**Longueur cible :** 250 à 400 mots
**Lien autorisé :** un seul, en fin de réponse — https://medium.com/@nqueva4/boost-your-conversions-in-2026-04b444f36d88

## Structure à respecter

1. Une accroche de deux phrases qui répond directement à la question.
2. Trois points concrets, un chiffre ou un exemple par point.
3. Une phrase de conclusion, puis le lien.

## Matière issue de l'article (à reformuler, jamais à coller)

### Exemple complet : la relance à 48h

Prenons le prompt 22, le plus utilisé en prospection.

Contexte. Tu vends un outil de facturation à des cabinets comptables. Premier email lundi, aucune réponse mercredi. La tentation : « je me permets de revenir vers vous ». Le meilleur moyen d'être archivé.

Le prompt :

> Écris une relance envoyée 48h après un premier email sans réponse. Cible : associé de cabinet comptable, 12 collaborateurs. Produit : outil de facturation automatisée. Le premier email portait sur le temps de saisie manuelle. Apporte un élément nouveau (un chiffre sectoriel), ne répète pas l'argument précédent, 70 mots maximum, termine par une question fermée.

Le résultat :

> **Objet : 4 heures par semaine, par collaborateur**
> Bonjour [Prénom],
> Une étude sectorielle chiffre à 4 heures hebdomadaires par collaborateur le temps de saisie de facturation. Sur 12 personnes, cela représente près d'un équivalent temps plein annuel.
> Nous ramenons ce volume sous une heure.
> Est-ce un sujet que vous avez déjà chiffré de votre côté ?

Ce qui fonctionne. La contrainte de 70 mots empêche le remplissage. L'élément nouveau force un angle inédit. La question fermée abaisse le coût de réponse.

Comment l'adapter. Change la cible, le produit et surtout le rappel du premier email : c'est cette ligne qui empêche ChatGPT de recycler les mêmes arguments. Pour une relance à J+7, remplace la question fermée par une proposition de créneau. Et vérifie le chiffre avancé, ChatGPT en invente régulièrement.

### Catégorie 3 : Prospection à froid et relances

C'est là que ChatGPT dérape le plus : des cold emails polis et vides. La parade tient en deux règles, un signal externe vérifiable et une demande unique.

21. Rédige un cold email de 90 mots à [POSTE] chez [ENTREPRISE], accroché à ce signal : [ACTUALITÉ]. Une seule demande : 15 minutes.
22. Écris une relance 48h après un premier email sans réponse au sujet de [SOLUTION SaaS]. Apporte un élément nouveau, ne répète rien.
23. Génère 4 relances sur 14 jours pour [OFFRE] : preuve chiffrée, cas client, objection levée, clôture.
24. Rédige un email de rupture après 4 relances sans réponse chez [PROSPECT]. Ton neutre, porte ouverte, aucun reproche.
25. Écris à un prospect ayant vu 3 fois la page tarifs de [SITE] sans convertir. Mentionne l'intention sans être intrusif.
26. Transforme ce pitch en cold email de 80 mots : [PITCH]. Aucune mention de mon entreprise avant la ligne 3.
27. Écris 5 accroches de cold email pour [SECTEUR], chacune basée sur une information publique vérifiable : levée, recrutement, réglementation, avis client.
28. Rédige la relance après un rendez-vous découverte avec [ENTREPRISE] : les 3 points bloquants, puis une étape suivante datée.
29. Anticipe les 5 objections de [PERSONA] face à [OFFRE] et écris une relance dédiée à chacune, 70 mots maximum.
30. Rédige une reprise de contact avec un prospect perdu il y a [X MOIS] face à [CONCURRENT]. Angle : ce qui a changé depuis.

## Réponse rédigée

Écrire la réponse dans `03-final.md` (même dossier), puis lancer
`node outils/build.mjs --verifier` pour contrôler qu'elle ne duplique pas
l'article. Ce fichier-ci est régénéré à chaque build : ne rien y rédiger.
