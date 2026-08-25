#!/usr/bin/env node
// Publie sur Medium via l'API historique (api.medium.com).
//
// Prérequis : un jeton d'intégration. Medium n'en délivre plus de nouveaux
// depuis 2023 — le champ existe encore dans Réglages › Sécurité et
// applications › Integration tokens pour les comptes qui y ont droit.
// Sans jeton, passer par Medium › Write › Import a story avec l'URL
// canonique, puis coller publications/<slug>/medium.md.
//
// Usage :
//   MEDIUM_TOKEN=… node outils/publier-medium.mjs <slug>              (brouillon)
//   MEDIUM_TOKEN=… node outils/publier-medium.mjs <slug> --publier    (public)

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.medium.com/v1';

const slug = process.argv[2];
const publier = process.argv.includes('--publier');
const jeton = process.env.MEDIUM_TOKEN;

if (!slug || slug.startsWith('--')) {
  console.error('Usage : MEDIUM_TOKEN=… node outils/publier-medium.mjs <slug> [--publier]');
  process.exit(1);
}
if (!jeton) {
  console.error('Erreur : variable MEDIUM_TOKEN absente.');
  console.error('Sans jeton, utiliser l\'import manuel décrit dans contenus/README.md.');
  process.exit(1);
}

const source = join(RACINE, 'contenus', `${slug}.md`);
const html = join(RACINE, 'publications', slug, 'medium.html');
if (!existsSync(source) || !existsSync(html)) {
  console.error(`Erreur : ${slug} introuvable. Lancer d'abord \`node outils/build.mjs\`.`);
  process.exit(1);
}

// Relit l'en-tête de l'article source pour le titre, le canonical et les tags.
const entete = readFileSync(source, 'utf8').split('\n---\n')[0];
const champ = (cle) => (entete.match(new RegExp(`^${cle}:\\s*(.+)$`, 'm')) || [])[1]?.trim();
const liste = (cle) => {
  const bloc = entete.match(new RegExp(`^${cle}:\\s*\\n((?:\\s+-\\s+.*\\n?)+)`, 'm'));
  return bloc ? bloc[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean) : [];
};

const contenu = readFileSync(html, 'utf8').replace(/^<!--[\s\S]*?-->\n/, '');
const canonical = champ('canonical');
const urlMedium = champ('medium_url');

// Si l'article vit déjà sur Medium, le canonical ne doit pas pointer sur lui-même.
const canonicalUrl = canonical === urlMedium ? undefined : canonical;

async function appel(chemin, options = {}) {
  const reponse = await fetch(`${API}${chemin}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${jeton}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    },
  });
  const corps = await reponse.text();
  if (!reponse.ok) {
    throw new Error(`${reponse.status} ${reponse.statusText} — ${corps.slice(0, 400)}`);
  }
  return JSON.parse(corps).data;
}

try {
  const moi = await appel('/me');
  console.log(`Compte : ${moi.username} (${moi.id})`);

  const article = await appel(`/users/${moi.id}/posts`, {
    method: 'POST',
    body: JSON.stringify({
      title: champ('medium_titre'),
      contentFormat: 'html',
      content: contenu,
      tags: liste('tags').slice(0, 5),
      ...(canonicalUrl ? { canonicalUrl } : {}),
      publishStatus: publier ? 'public' : 'draft',
      notifyFollowers: publier,
    }),
  });

  console.log(`${publier ? 'Publié' : 'Brouillon créé'} : ${article.url}`);
  if (!publier) console.log('Relire dans Medium, puis relancer avec --publier.');
} catch (erreur) {
  console.error(`Échec de l'appel Medium : ${erreur.message}`);
  if (/401|403/.test(erreur.message)) {
    console.error('Jeton refusé : il est expiré, révoqué, ou le compte n\'a plus accès à l\'API.');
    console.error('Repli : import manuel depuis l\'URL canonique (voir contenus/README.md).');
  }
  process.exit(1);
}
