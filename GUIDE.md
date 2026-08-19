# Grosso V2 — Discord, équipes de 5, console staff

## Déjà fait ✅
- Application Discord créée, Client ID/Secret configurés
- Discord activé dans Supabase (Authentication → Providers)
- URL de callback ajoutée côté Discord

## À faire, dans l'ordre

### 1. Exécuter la migration SQL
Dans Supabase → SQL Editor → New query :
1. Ouvrez `supabase/migration_discord.sql`, copiez tout, collez, **Run**.
2. (Optionnel) Si vous avez beaucoup d'entreprises à créer d'un coup,
   utilisez `supabase/entreprises.sql`. Sinon, la console staff du site
   suffit pour en créer une par une.

### 2. Déposer les fichiers sur GitHub
Remplacez sur la branche `main` :
- `index.html`
- `app.html`
- `assets/js/auth.js` **(nouveau — remplace `index.js`, supprimez l'ancien si présent)**
- `assets/js/app.js`
- `assets/js/common.js`
- `assets/js/config.js`

Ne touchez pas à `assets/css/style.css` (inchangé).

### 3. Devenir staff
1. Ouvrez le site, connectez-vous une première fois avec **Discord**.
2. Dans Supabase → SQL Editor, exécutez :
   ```sql
   select public.make_staff('votre_pseudo_discord');
   ```
   (le pseudo Discord, pas le nom d'affichage — utilisez votre @handle)
3. Rafraîchissez le site → l'onglet **🛡️ Console staff** apparaît.

### 4. Créer vos entreprises
Depuis la Console staff : **+ Nouvelle entreprise** → un code d'invitation
est généré automatiquement. Distribuez ce code à l'entreprise concernée
(5 membres max, modifiable par entreprise).

### 5. Test
- Un collègue se connecte avec Discord → écran "Rejoindre votre entreprise"
  → il saisit le code → il devient automatiquement **admin** (1er arrivé)
  ou **membre** (suivants).
- Seul l'admin de l'entreprise voit/régénère le code, modifie la fiche,
  promeut ou retire des membres.
- Un 6ᵉ membre (ou plus si vous avez changé la limite) reçoit un message
  d'erreur clair.

## Pour le futur bot
Chaque nouvelle commande et chaque changement de statut écrit une ligne
dans la table `notifications` (order_id, event, company_id,
discord_channel_id, payload, delivered). Le bot n'aura qu'à lire les
lignes `delivered = false`, poster dans le salon Discord correspondant,
puis les marquer traitées. Renseignez `discord_channel_id` sur chaque
entreprise (formulaire de la console staff) pour que ça fonctionne.

## Sécurité — à faire dès que possible
Le Client Secret Discord a été tapé dans ce chat. Par précaution,
régénérez-le une fois (Discord → OAuth2 → Réinitialiser la clé secrète)
et remettez à jour la nouvelle valeur dans Supabase.
