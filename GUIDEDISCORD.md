# Grosso v2 — connexion Discord, équipes de 5, entreprises pré-créées

Tout se fait dans l'ordre. Comptez 15 minutes.

---

## 1. Créer l'application Discord

1. Allez sur **https://discord.com/developers/applications** → **New Application**
2. Nom : `Grosso` → **Create**
3. Menu de gauche → **OAuth2**
4. Section **Redirects** → **Add Redirect** → collez exactement :

```
https://desrvpughkngjlchjdxw.supabase.co/auth/v1/callback
```

5. **Save Changes**
6. Toujours dans **OAuth2**, notez :
   - **Client ID**
   - **Client Secret** → bouton **Reset Secret** puis **Copy** (il n'est visible qu'une fois)

> Le Client Secret est un vrai secret : il ne va **que** dans Supabase, jamais dans le site ni sur GitHub.

---

## 2. Activer Discord dans Supabase

1. Supabase → **Authentication** (🔒) → **Sign In / Providers**
2. Dans la liste des providers, cliquez sur **Discord**
3. Activez **Enable Sign in with Discord**
4. Collez le **Client ID** et le **Client Secret** de l'étape 1
5. **Save**

Vous pouvez maintenant **désactiver le provider Email** si vous ne voulez plus que Discord.

---

## 3. Exécuter les scripts SQL

Supabase → **SQL Editor**, dans cet ordre :

| Ordre | Fichier | Ce qu'il fait |
|---|---|---|
| 1 | `supabase/migration_v2_discord.sql` | Codes d'invitation, limite de 5 membres, rôles admin/membre, réglages Discord, file d'événements |
| 2 | `supabase/migration_v3_staff.sql` | Console staff : gestion de toutes les entreprises depuis le site |
| 3 | `supabase/entreprises.sql` | *(facultatif)* pré-remplir des entreprises directement en SQL |

Le fichier `entreprises.sql` n'est plus indispensable : depuis la **console staff**, vous créez les entreprises directement dans le site, avec un formulaire.

Les codes sont ce que vous distribuez. Une personne se connecte avec Discord, saisit le code, rejoint l'espace. Le **premier arrivé devient administrateur** de son entreprise.

---

## 3 bis. Vous nommer staff

1. Connectez-vous **une fois** sur le site avec Discord (vous verrez l'écran « Rejoindre votre entreprise » — c'est normal, ne saisissez rien)
2. Supabase → **SQL Editor** → exécutez, en remplaçant par **votre pseudo Discord** :

```sql
select public.make_staff('votre_pseudo_discord');
```

Vous devez voir : `✅ … est maintenant STAFF.`

3. Rafraîchissez le site : l'écran « Rejoindre » a laissé place à la **Console staff**.

### Ce que la console staff permet

- **Créer une entreprise** avec un formulaire (nom, ville, secteur, SIRET, nombre de places, IDs Discord) — son code d'invitation est généré et affiché immédiatement
- **Modifier** n'importe quelle entreprise, **régénérer** son code, la **désactiver** ou la **supprimer**
- Voir pour chacune : membres (n/max), articles, ventes, chiffre d'affaires
- **Détails** d'une entreprise : ses membres, ses articles, ses commandes — et détacher un membre
- Rattacher à la main les **comptes sans entreprise**, ou **nommer un autre staff**
- Le fil des **dernières commandes** de toute la plateforme

### Le staff ne consomme aucune place

Votre compte staff reste **non rattaché** : les 5 places de chaque entreprise restent intégralement disponibles pour ses vrais membres. Même si vous vous rattachez à une entreprise pour tester, vous n'êtes pas décompté du quota.

Pour retirer les droits à quelqu'un : `select public.make_staff('un_pseudo', false);`

---

## 4. Mettre le site à jour

Déposez les fichiers du dossier `grosso` sur GitHub (*Add file → Upload files*, ils écrasent les anciens), puis **Commit changes**. Le site se met à jour en 1 à 2 minutes.

---

## 5. Vérifier

1. Ouvrez https://thomasryspert62-code.github.io/grosso/ en navigation privée
2. **Se connecter avec Discord** → autorisez
3. Écran « Rejoindre votre entreprise » → saisissez un code
4. Vous arrivez dans l'espace, onglet **Mon équipe** visible avec le code et les 5 places

---

# Le futur bot Discord

Rien n'est à héberger pour l'instant. La base **enregistre déjà tous les événements** dans la table `notifications` ; votre bot n'aura qu'à les lire.

## Contrat de la table `notifications`

| Colonne | Type | Contenu |
|---|---|---|
| `id` | bigint | identifiant croissant |
| `company_id` | uuid | l'entreprise **destinataire** du message |
| `kind` | text | `nouvelle_commande` ou `changement_statut` |
| `order_id` | uuid | la commande concernée |
| `payload` | jsonb | tout ce qu'il faut pour composer le message |
| `delivered` | bool | `false` tant que le bot n'a pas posté |
| `delivered_at` | timestamptz | à remplir après l'envoi |

### Exemple de `payload` — nouvelle commande

```json
{
  "reference": "CMD-7B2066D9",
  "acheteur": "Beta Import",
  "vendeur": "Oil Roxwood",
  "total_ht": 768.00,
  "devise": "EUR",
  "note": "Livraison lundi",
  "lignes": [
    { "article": "Fût bière blonde 30L", "quantite": 8, "unite": "unité", "total_ht": 768.00 }
  ],
  "discord_guild_id": "123456789",
  "discord_channel_id": "987654321",
  "discord_webhook_url": null
}
```

### Exemple de `payload` — changement de statut

```json
{
  "reference": "CMD-7B2066D9",
  "statut": "confirmee",
  "ancien_statut": "en_attente",
  "total_ht": 768.00,
  "acheteur": "Beta Import",
  "vendeur": "Oil Roxwood",
  "discord_channel_id": "888777666"
}
```

Le salon de destination est déjà dans le payload : chaque entreprise le renseigne elle-même dans **Mon entreprise → Notifications Discord**.

## Boucle du bot (pseudo-code)

```js
// clé service_role — côté serveur UNIQUEMENT, jamais dans le navigateur
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const { data } = await sb.from('notifications')
  .select('*').eq('delivered', false).order('id').limit(20);

for (const n of data) {
  const salon = n.payload.discord_channel_id;
  if (salon) await discord.channels.get(salon).send(composerMessage(n));
  await sb.from('notifications')
    .update({ delivered: true, delivered_at: new Date().toISOString() })
    .eq('id', n.id);
}
```

Deux façons de déclencher cette boucle :

- **Polling** toutes les 10–30 secondes (le plus simple)
- **Temps réel** : abonnement Supabase Realtime sur `INSERT` de `notifications` (activez Realtime sur la table dans Supabase → Database → Replication)

---

## Rappel des rôles

| | Membre | Administrateur |
|---|---|---|
| Voir le catalogue, commander | ✅ | ✅ |
| Publier / modifier les articles | ✅ | ✅ |
| Traiter les commandes reçues | ✅ | ✅ |
| Voir et régénérer le code d'invitation | ❌ | ✅ |
| Modifier la fiche entreprise | ❌ | ✅ |
| Régler les notifications Discord | ❌ | ✅ |
| Promouvoir / retirer un membre | ❌ | ✅ |

Le premier membre à rejoindre une entreprise en devient automatiquement l'administrateur.

## Ajouter une entreprise plus tard

Rouvrez `supabase/entreprises.sql`, ajoutez la ligne, ré-exécutez le fichier entier : les entreprises existantes sont mises à jour, les nouvelles sont créées avec leur code.

## Changer la limite de membres d'une entreprise

```sql
update public.companies set max_members = 10 where name = 'Oil Roxwood';
```
