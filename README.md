# Grosso — place de marché B2B pour grossistes

Site statique (HTML / CSS / JavaScript, aucun framework, aucune compilation) hébergé sur **GitHub Pages**, avec **Supabase** pour les comptes et la base de données.

Chaque entreprise crée son espace, publie ses articles, consulte le catalogue des autres membres et passe commande.

| Fonction | Détail |
|---|---|
| Comptes entreprise | Inscription / connexion par e-mail + mot de passe |
| Mes articles | Ajouter, modifier, masquer, supprimer — prix HT, unité, quantité mini, stock, photo |
| Catalogue général | Tous les articles des autres entreprises, avec recherche, filtres et tri |
| Panier | Multi-fournisseurs — une commande distincte par fournisseur |
| Mes commandes | Ce que vous avez commandé, avec possibilité d'annuler tant que c'est en attente |
| Commandes reçues | Ce qu'on vous a commandé : confirmer → expédier → livrer, ou refuser |
| Tableau de bord | Nombre d'articles, commandes, chiffre d'affaires, achats, dernière activité |
| Ma fiche entreprise | Nom, SIRET, secteur, ville, téléphone, présentation |

---

## Installation — 20 minutes, sans ligne de commande obligatoire

### Étape 1 — Créer la base Supabase (gratuit)

1. Allez sur **https://supabase.com** → *Start your project* → connectez-vous avec GitHub.
2. **New project** : donnez un nom (`grosso`), choisissez une région proche (*Europe (Paris)* ou *Frankfurt*), définissez un mot de passe de base de données (gardez-le de côté), puis **Create new project**. Comptez 1 à 2 minutes.
3. Menu de gauche → **SQL Editor** → *New query*.
4. Ouvrez le fichier `supabase/schema.sql` de ce dépôt, **copiez tout son contenu**, collez-le dans l'éditeur, puis cliquez sur **Run**.
   Vous devez voir `Success. No rows returned`.
5. Menu de gauche → **Project Settings** (roue dentée) → **API**. Notez :
   - **Project URL** → ressemble à `https://abcdefgh.supabase.co`
   - **anon / public** → une longue clé commençant par `eyJ...`

> La clé `anon` est faite pour être publique : elle vit dans le navigateur. La sécurité repose sur les règles *Row Level Security* posées par le script SQL. **Ne mettez jamais la clé `service_role` dans le site.**

### Étape 2 — Renseigner les clés

Ouvrez `assets/js/config.js` et remplacez les deux valeurs :

```js
window.CONFIG = {
  SUPABASE_URL: "https://abcdefgh.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
  APP_NAME: "Grosso",
  APP_TAGLINE: "La place de marché B2B des grossistes",
  CURRENCY: "EUR",
};
```

### Étape 3 — Créer le dépôt GitHub

**Option A — tout dans le navigateur (le plus simple)**

1. Sur **https://github.com/new** : nom du dépôt `grosso`, visibilité **Public** (nécessaire pour GitHub Pages en offre gratuite), **Create repository**.
2. Sur la page du dépôt vide → *uploading an existing file*.
3. Glissez-déposez **tout le contenu** du dossier (`index.html`, `app.html`, `assets/`, `supabase/`, `.nojekyll`, `README.md`) puis **Commit changes**.

**Option B — en ligne de commande**

```bash
cd grosso
git init
git add .
git commit -m "Grosso : place de marché B2B"
git branch -M main
git remote add origin https://github.com/VOTRE-PSEUDO/grosso.git
git push -u origin main
```

### Étape 4 — Activer GitHub Pages

1. Dépôt → **Settings** → **Pages**.
2. *Source* : **Deploy from a branch**. *Branch* : `main`, dossier `/ (root)`. **Save**.
3. Après 1 à 2 minutes, votre site est en ligne :
   `https://VOTRE-PSEUDO.github.io/grosso/`

### Étape 5 — Autoriser l'adresse du site dans Supabase

Supabase → **Authentication** → **URL Configuration** :

- **Site URL** : `https://VOTRE-PSEUDO.github.io/grosso/`
- **Redirect URLs** : ajoutez `https://VOTRE-PSEUDO.github.io/grosso/**`

### Étape 6 — Premier test

1. Ouvrez le site, onglet **Créer un compte**, renseignez le nom de l'entreprise et un e-mail.
2. Par défaut Supabase envoie un e-mail de confirmation. Pour tester plus vite :
   **Authentication → Sign In / Providers → Email** → décochez *Confirm email* → *Save*.
3. Créez un deuxième compte avec une autre entreprise : chacune verra les articles de l'autre dans le **Catalogue général** et pourra lui passer commande.

---

## Développer en local

Les fichiers utilisent des modules JavaScript : ouvrir `index.html` par double-clic ne fonctionne pas (restriction `file://`). Lancez un petit serveur :

```bash
cd grosso
python3 -m http.server 8000
# puis http://localhost:8000
```

Pensez à ajouter `http://localhost:8000` dans les *Redirect URLs* de Supabase.

---

## Structure du dépôt

```
grosso/
├── index.html              page publique : présentation + connexion / inscription
├── app.html                espace entreprise (application)
├── assets/
│   ├── css/style.css       toute la mise en forme
│   └── js/
│       ├── config.js       ← LE SEUL FICHIER À MODIFIER (clés Supabase)
│       ├── common.js       client Supabase + fonctions utilitaires
│       ├── auth.js         connexion / inscription
│       └── app.js          tableau de bord, catalogue, articles, panier, commandes
├── supabase/schema.sql     tables, sécurité RLS, fonction de commande
├── .nojekyll               empêche GitHub Pages d'ignorer certains fichiers
└── README.md
```

## Modèle de données

- **companies** — une entreprise (nom, SIRET, secteur, ville, présentation)
- **profiles** — un utilisateur, rattaché à une entreprise
- **products** — un article publié par une entreprise
- **orders** / **order_items** — une commande d'une entreprise acheteuse vers une entreprise vendeuse

Sécurité : le catalogue est lisible par tous les membres connectés, mais une entreprise ne peut modifier **que** ses propres articles, et ne voit **que** les commandes où elle est acheteuse ou vendeuse. Les prix sont relus côté serveur au moment de la commande (fonction `place_order`), donc impossible de les falsifier depuis le navigateur.

## Personnalisation rapide

| Envie | Où |
|---|---|
| Nom du site | `assets/js/config.js` → `APP_NAME` |
| Couleurs | `assets/css/style.css` → bloc `:root` (`--brand`, `--sidebar`…) |
| Devise | `assets/js/config.js` → `CURRENCY` (`"EUR"`, `"CHF"`, `"USD"`…) |
| Unités de vente | `assets/js/app.js` → constante `UNITS` |
| Statuts de commande | `assets/js/app.js` → constante `STATUS` + contrainte côté SQL |

## Pistes pour la suite

- Upload d'images via **Supabase Storage** (au lieu d'une URL à coller)
- Génération d'un bon de commande PDF
- Tarifs négociés par client, remises par palier
- Plusieurs utilisateurs par entreprise (invitation par e-mail)
- Notification e-mail à la réception d'une commande (Supabase Edge Function)
- Nom de domaine personnalisé sur GitHub Pages
