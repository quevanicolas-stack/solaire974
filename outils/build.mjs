#!/usr/bin/env node
// Chaîne de publication Medium + Quora.
// Lit les articles source de contenus/ et génère, dans publications/<slug>/ :
//   - medium.html / medium.md : article prêt à publier (API ou copier-coller)
//   - quora/<n>-canevas.md    : canevas d'une réponse Quora, à rédiger à la main
//   - checklist.md            : ordre et cadence de publication
// Aucune dépendance externe : Node seul.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = join(RACINE, 'contenus');
const SORTIE = join(RACINE, 'publications');

// ---------------------------------------------------------------- lecture

// Les articles sont les .md de contenus/, hors modèle (`_`) et documentation.
function articles() {
  return readdirSync(SOURCES).filter(
    (f) => f.endsWith('.md') && !f.startsWith('_') && f !== 'README.md'
  );
}


// En-tête : clés plates `cle: valeur` et listes `cle:` suivie de lignes `  - item`.
// Le corps markdown commence après la première ligne `---` isolée.
function lireArticle(chemin) {
  const brut = readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n');
  const separateur = brut.indexOf('\n---\n');
  if (separateur === -1) {
    throw new Error(`${basename(chemin)} : séparateur "---" absent entre l'en-tête et le corps.`);
  }
  const meta = {};
  let listeEnCours = null;
  for (const ligne of brut.slice(0, separateur).split('\n')) {
    if (!ligne.trim() || ligne.trim().startsWith('#')) continue;
    const item = ligne.match(/^\s+-\s+(.*)$/);
    if (item && listeEnCours) {
      meta[listeEnCours].push(item[1].trim());
      continue;
    }
    const paire = ligne.match(/^([a-z_]+):\s*(.*)$/);
    if (!paire) continue;
    const [, cle, valeur] = paire;
    if (valeur === '') {
      listeEnCours = cle;
      meta[cle] = [];
    } else {
      listeEnCours = null;
      meta[cle] = valeur.trim();
    }
  }
  const requis = ['slug', 'titre', 'canonical', 'medium_titre', 'quora_questions'];
  const manquants = requis.filter((c) => !meta[c] || meta[c].length === 0);
  if (manquants.length) {
    throw new Error(`${basename(chemin)} : champs d'en-tête manquants — ${manquants.join(', ')}.`);
  }
  return { meta, corps: brut.slice(separateur + 5).trim() };
}

// ------------------------------------------------------------ markdown

function echapper(texte) {
  return texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function enLigne(texte) {
  return echapper(texte)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function versHtml(markdown) {
  const html = [];
  let liste = null; // 'ul' | 'ol'
  const fermerListe = () => {
    if (liste) {
      html.push(`</${liste}>`);
      liste = null;
    }
  };
  for (const ligne of markdown.split('\n')) {
    const t = ligne.trim();
    if (!t) {
      fermerListe();
      continue;
    }
    const titre = t.match(/^(#{2,4})\s+(.*)$/);
    if (titre) {
      fermerListe();
      const niveau = titre[1].length;
      html.push(`<h${niveau}>${enLigne(titre[2])}</h${niveau}>`);
      continue;
    }
    const puce = t.match(/^[-*]\s+(.*)$/);
    if (puce) {
      if (liste !== 'ul') {
        fermerListe();
        html.push('<ul>');
        liste = 'ul';
      }
      html.push(`<li>${enLigne(puce[1])}</li>`);
      continue;
    }
    const numero = t.match(/^(\d+)\.\s+(.*)$/);
    if (numero) {
      if (liste !== 'ol') {
        fermerListe();
        html.push(numero[1] === '1' ? '<ol>' : `<ol start="${numero[1]}">`);
        liste = 'ol';
      }
      html.push(`<li>${enLigne(numero[2])}</li>`);
      continue;
    }
    const citation = t.match(/^>\s*(.*)$/);
    if (citation) {
      fermerListe();
      html.push(`<blockquote>${enLigne(citation[1])}</blockquote>`);
      continue;
    }
    fermerListe();
    html.push(`<p>${enLigne(t)}</p>`);
  }
  fermerListe();
  return html.join('\n');
}

// Découpe le corps en sections `## titre` pour alimenter les canevas Quora.
function sections(markdown) {
  const blocs = [];
  let courant = { titre: 'Introduction', texte: [] };
  for (const ligne of markdown.split('\n')) {
    const titre = ligne.trim().match(/^##\s+(.*)$/);
    if (titre) {
      if (courant.texte.join('').trim()) blocs.push(courant);
      courant = { titre: titre[1], texte: [] };
    } else {
      courant.texte.push(ligne);
    }
  }
  if (courant.texte.join('').trim()) blocs.push(courant);
  return blocs.map((b) => ({ titre: b.titre, texte: b.texte.join('\n').trim() }));
}

const VIDES = new Set(
  ('le la les un une des de du au aux et ou en dans pour par sur avec sans que qui quoi dont ' +
   'est sont a ont ce cet cette ces mon ton son nos vos leurs il elle on nous vous ils elles ' +
   'plus moins tres comment pourquoi quel quelle quels quelles mes tes ses se ne pas y d l').split(' ')
);

function motsUtiles(texte) {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((m) => m.length > 2 && !VIDES.has(m));
}

// Classe les sections par recouvrement de vocabulaire avec la question posée.
function sectionsPertinentes(question, blocs, combien = 2) {
  const cible = new Set(motsUtiles(question));
  return blocs
    .map((b) => ({
      ...b,
      score: motsUtiles(`${b.titre} ${b.texte}`).filter((m) => cible.has(m)).length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, combien);
}

// -------------------------------------------------------------- écriture

function ecrire(chemin, contenu) {
  mkdirSync(dirname(chemin), { recursive: true });
  writeFileSync(chemin, contenu, 'utf8');
  return chemin.slice(RACINE.length + 1);
}

function genererMedium(meta, corps, dossier) {
  const titre = meta.medium_titre;
  const sousTitre = meta.medium_sous_titre || '';
  const langue = meta.medium_langue || 'fr';
  const traduire = langue !== (meta.langue_source || 'fr');

  const entete = traduire
    ? `<!-- Corps repris de la source ${meta.langue_source || 'fr'} : à traduire en "${langue}" avant publication. -->\n`
    : '';
  const html = `${entete}<h1>${enLigne(titre)}</h1>\n${
    sousTitre ? `<h2>${enLigne(sousTitre)}</h2>\n` : ''
  }${versHtml(corps)}\n<p><a href="${meta.canonical}">${enLigne(meta.titre)}</a></p>`;

  const md = [
    `# ${titre}`,
    sousTitre && `## ${sousTitre}`,
    traduire && `<!-- à traduire en ${langue} -->`,
    '',
    corps,
    '',
    `[${meta.titre}](${meta.canonical})`,
  ]
    .filter(Boolean)
    .join('\n');

  return [
    ecrire(join(dossier, 'medium.html'), html),
    ecrire(join(dossier, 'medium.md'), md),
  ];
}

function genererQuora(meta, corps, dossier) {
  const blocs = sections(corps);
  const registre = meta.quora_registre || 'vouvoiement';
  const langue = meta.quora_langue || 'fr';
  const ecrits = [];

  meta.quora_questions.forEach((question, i) => {
    const n = String(i + 1).padStart(2, '0');
    const retenues = sectionsPertinentes(question, blocs);
    const canevas = `# Canevas Quora ${n} — ${meta.slug}

**Question visée :** ${question}
**Langue :** ${langue} — **registre :** ${registre}
**Longueur cible :** 250 à 400 mots
**Lien autorisé :** un seul, en fin de réponse — ${meta.canonical}

## Structure à respecter

1. Une accroche de deux phrases qui répond directement à la question.
2. Trois points concrets, un chiffre ou un exemple par point.
3. Une phrase de conclusion, puis le lien.

## Matière issue de l'article (à reformuler, jamais à coller)

${retenues
  .map((s) => `### ${s.titre}\n\n${s.texte}`)
  .join('\n\n')}

## Réponse rédigée

Écrire la réponse dans \`${n}-final.md\` (même dossier), puis lancer
\`node outils/build.mjs --verifier\` pour contrôler qu'elle ne duplique pas
l'article. Ce fichier-ci est régénéré à chaque build : ne rien y rédiger.
`;
    ecrits.push(ecrire(join(dossier, 'quora', `${n}-canevas.md`), canevas));
  });

  return ecrits;
}

function genererChecklist(meta, dossier) {
  const questions = meta.quora_questions
    .map((q, i) => `- [ ] J+${3 + i * 2} — Quora ${String(i + 1).padStart(2, '0')} : ${q}`)
    .join('\n');

  const checklist = `# Checklist de publication — ${meta.titre}

Date cible : ${meta.date_publication || 'à définir'} · slug : \`${meta.slug}\`

## J+0 — source

- [ ] Page canonique en ligne : ${meta.canonical}
- [ ] Vérifier que la page répond avant de publier ailleurs (le canonical
      doit exister au moment où Medium importe).

## J+1 — Medium

- [ ] Si un jeton d'intégration existe : \`MEDIUM_TOKEN=… node outils/publier-medium.mjs ${meta.slug}\`
- [ ] Sinon : Medium › Write › Import a story, coller ${meta.canonical},
      puis remplacer le corps par \`publications/${meta.slug}/medium.md\`
- [ ] Contrôler que le canonical pointe bien vers la page source
- [ ] Tags : ${(meta.tags || []).join(', ') || 'à définir'}

## Quora — une réponse tous les deux jours, jamais deux le même jour

${questions}

Pour chaque réponse : rédiger le \`-final.md\`, lancer
\`node outils/build.mjs --verifier\`, publier à la main depuis le navigateur.
Aucune automatisation du clic : Quora n'a pas d'API d'écriture et bannit les
comptes qui publient par robot.

## J+14 — mesure

- [ ] Vues Medium, vues Quora, clics vers ${meta.canonical}
- [ ] Reporter le résultat dans l'en-tête de \`contenus/${meta.slug}.md\` (champ \`statut\`)
`;
  return ecrire(join(dossier, 'checklist.md'), checklist);
}

// ------------------------------------------------------- anti-duplication

function ngrammes(texte, taille = 8) {
  const mots = texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const grammes = new Set();
  for (let i = 0; i + taille <= mots.length; i++) {
    grammes.add(mots.slice(i, i + taille).join(' '));
  }
  return grammes;
}

function verifier() {
  if (!existsSync(SORTIE)) {
    console.log('Rien à vérifier : lancer d\'abord `node outils/build.mjs`.');
    return 0;
  }
  let alertes = 0;
  let controles = 0;
  for (const fichier of articles()) {
    const { meta, corps } = lireArticle(join(SOURCES, fichier));
    const dossierQuora = join(SORTIE, meta.slug, 'quora');
    if (!existsSync(dossierQuora)) continue;
    const source = ngrammes(corps);
    for (const f of readdirSync(dossierQuora).filter((f) => f.endsWith('-final.md'))) {
      controles++;
      const reponse = readFileSync(join(dossierQuora, f), 'utf8');
      const grammes = [...ngrammes(reponse)];
      const communs = grammes.filter((g) => source.has(g));
      const taux = grammes.length ? Math.round((communs.length / grammes.length) * 100) : 0;
      const etiquette = `${meta.slug}/quora/${f}`;
      if (communs.length === 0) {
        console.log(`  ok      ${etiquette} — aucune reprise littérale`);
      } else {
        alertes++;
        console.log(`  ALERTE  ${etiquette} — ${taux} % de reprise littérale de l'article`);
        console.log(`          exemple : « ${communs[0]} »`);
      }
    }
  }
  if (controles === 0) {
    console.log('Aucun fichier `-final.md` rédigé pour l\'instant.');
    return 0;
  }
  console.log(
    alertes
      ? `\n${alertes} réponse(s) à reformuler : Google déclasse le contenu dupliqué, et le canonical ne protège pas une reprise sur Quora.`
      : '\nAucune duplication détectée.'
  );
  return alertes ? 1 : 0;
}

// ------------------------------------------------------------------ main

function construire() {
  const fichiers = articles();
  if (!fichiers.length) {
    console.log('Aucun article dans contenus/ (le modèle `_modele.md` est ignoré).');
    return 0;
  }
  for (const fichier of fichiers) {
    const { meta, corps } = lireArticle(join(SOURCES, fichier));
    const dossier = join(SORTIE, meta.slug);
    const ecrits = [
      ...genererMedium(meta, corps, dossier),
      ...genererQuora(meta, corps, dossier),
      genererChecklist(meta, dossier),
    ];
    console.log(`${fichier} → ${meta.slug}`);
    for (const e of ecrits) console.log(`  ${e}`);
  }
  return 0;
}

// ------------------------------------------------------------- planning

// Corps de l'issue hebdomadaire : ce qui reste à publier, par ordre de date.
function planning() {
  const attente = [];
  for (const fichier of articles()) {
    const { meta } = lireArticle(join(SOURCES, fichier));
    if (meta.statut === 'publie') continue;
    attente.push(meta);
  }
  attente.sort((a, b) => String(a.date_publication).localeCompare(String(b.date_publication)));

  if (!attente.length) {
    console.log('Rien en attente de publication cette semaine.');
    console.log('');
    console.log('Tous les articles de `contenus/` sont marqués `statut: publie`.');
    console.log('Prochaine action : écrire le sujet suivant à partir de `contenus/_modele.md`.');
    return 0;
  }

  console.log(`${attente.length} article(s) en attente de publication.`);
  console.log('');
  for (const meta of attente) {
    console.log(`## ${meta.titre}`);
    console.log('');
    console.log(`- Date cible : **${meta.date_publication || 'à définir'}**`);
    console.log(`- Statut : \`${meta.statut || 'brouillon'}\``);
    console.log(`- Checklist complète : \`publications/${meta.slug}/checklist.md\``);
    console.log(`- Medium : \`publications/${meta.slug}/medium.md\``);
    console.log(`- Quora : ${meta.quora_questions.length} réponse(s) à rédiger dans \`publications/${meta.slug}/quora/\``);
    console.log('');
  }
  console.log('Rappel : une seule réponse Quora par jour, publication manuelle depuis le navigateur.');
  return 0;
}

// ------------------------------------------------------------------ main

const arg = process.argv[2];
try {
  if (arg === '--verifier') process.exit(verifier());
  if (arg === '--planning') process.exit(planning());
  process.exit(construire());
} catch (erreur) {
  console.error(`Erreur : ${erreur.message}`);
  process.exit(1);
}
