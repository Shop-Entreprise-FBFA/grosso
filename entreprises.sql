-- =====================================================================
--  Import en masse d'entreprises (optionnel)
--  À utiliser SEULEMENT si vous avez beaucoup d'entreprises à créer
--  d'un coup — sinon, la Console staff du site suffit largement.
--
--  ⚠️ Exécutez d'abord migration_discord.sql. Puis remplacez les
--  lignes ci-dessous par vos vraies entreprises et cliquez Run.
-- =====================================================================

insert into public.companies (name, sector, city, country, phone, description, max_members, invite_code)
values
  ('Nom de l''entreprise 1', 'Secteur', 'Ville', 'France', null, null, 5, public._gen_invite_code()),
  ('Nom de l''entreprise 2', 'Secteur', 'Ville', 'France', null, null, 5, public._gen_invite_code());

-- Récupérez les codes générés à distribuer à chaque entreprise :
select name, invite_code from public.companies order by created_at desc limit 20;
