-- =====================================================================
--  GROSSO — Migration V2 : connexion Discord, entreprises pré-créées,
--  équipes de 5 membres, console staff, notifications pour le bot.
--
--  À exécuter APRÈS le schéma d'origine (déjà fait), dans SQL Editor.
--  Idempotent : peut être relancé sans danger.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. GÉNÉRATEUR DE CODE D'INVITATION (ex: 4C7K-R2AB)
-- ---------------------------------------------------------------------
create or replace function public._gen_invite_code()
returns text language sql volatile as $$
  select upper(
    substr(md5(random()::text || clock_timestamp()::text), 1, 4) || '-' ||
    substr(md5(random()::text || clock_timestamp()::text), 1, 4)
  );
$$;

-- ---------------------------------------------------------------------
-- 1. COLONNES — companies
-- ---------------------------------------------------------------------
alter table public.companies drop column if exists siret;
alter table public.companies add column if not exists invite_code text unique;
alter table public.companies add column if not exists max_members int not null default 5;
alter table public.companies add column if not exists is_active boolean not null default true;
alter table public.companies add column if not exists discord_channel_id text;

-- Backfill : génère un code pour les entreprises qui n'en ont pas encore
do $$
declare r record; v_code text;
begin
  for r in select id from public.companies where invite_code is null loop
    loop
      v_code := public._gen_invite_code();
      begin
        update public.companies set invite_code = v_code where id = r.id;
        exit;
      exception when unique_violation then end;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. COLONNES — profiles
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists is_staff boolean not null default false;
alter table public.profiles add column if not exists discord_username text;
alter table public.profiles add column if not exists avatar_url text;

-- ---------------------------------------------------------------------
-- 3. INSCRIPTION — un profil "en attente" est créé, sans entreprise
--    (les entreprises ne sont plus créées automatiquement)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, discord_username, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'preferred_username'),
    new.raw_user_meta_data->>'preferred_username',
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 4. STAFF — fonction de vérification
-- ---------------------------------------------------------------------
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_staff from public.profiles where id = auth.uid()), false);
$$;
grant execute on function public.is_staff() to authenticated;

-- Activation du 1er staff : à exécuter TOI-MÊME dans SQL Editor, jamais
-- exposée au site (pas de "grant" à authenticated).
create or replace function public.make_staff(p_username text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.profiles
  where discord_username = p_username or full_name = p_username
  limit 1;
  if v_id is null then
    raise exception 'Utilisateur introuvable : %. Connectez-vous une première fois au site avec Discord, puis réessayez.', p_username;
  end if;
  update public.profiles set is_staff = true where id = v_id;
  return '✅ ' || p_username || ' est maintenant STAFF.';
end; $$;

-- ---------------------------------------------------------------------
-- 5. REJOINDRE UNE ENTREPRISE PAR CODE (5 membres max)
-- ---------------------------------------------------------------------
create or replace function public.join_company(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare v_company record; v_count int;
begin
  if exists (select 1 from public.profiles where id = auth.uid() and company_id is not null) then
    raise exception 'Vous êtes déjà rattaché à une entreprise.';
  end if;

  select * into v_company from public.companies
  where invite_code = upper(trim(p_code)) and is_active limit 1;
  if not found then
    raise exception 'Code d''invitation invalide.';
  end if;

  select count(*) into v_count from public.profiles where company_id = v_company.id;
  if v_count >= v_company.max_members then
    raise exception 'Cette entreprise a atteint son nombre maximum de membres (%).', v_company.max_members;
  end if;

  update public.profiles
  set company_id = v_company.id, role = case when v_count = 0 then 'admin' else 'membre' end
  where id = auth.uid();
end; $$;
grant execute on function public.join_company(text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. GESTION D'ÉQUIPE (réservée à l'admin de l'entreprise)
-- ---------------------------------------------------------------------
create or replace function public.regenerate_invite_code()
returns text language plpgsql security definer set search_path = public as $$
declare v_cid uuid := public.my_company_id(); v_role text; v_code text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_cid is null or v_role <> 'admin' then
    raise exception 'Seul l''administrateur de l''entreprise peut régénérer le code.';
  end if;
  loop
    v_code := public._gen_invite_code();
    begin
      update public.companies set invite_code = v_code where id = v_cid;
      exit;
    exception when unique_violation then end;
  end loop;
  return v_code;
end; $$;
grant execute on function public.regenerate_invite_code() to authenticated;

create or replace function public.promote_member(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_cid uuid := public.my_company_id(); v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_cid is null or v_role <> 'admin' then
    raise exception 'Accès réservé à l''administrateur.';
  end if;
  update public.profiles set role = 'admin' where id = p_profile_id and company_id = v_cid;
  if not found then raise exception 'Membre introuvable.'; end if;
end; $$;
grant execute on function public.promote_member(uuid) to authenticated;

create or replace function public.remove_member(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_cid uuid := public.my_company_id(); v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_cid is null or v_role <> 'admin' then
    raise exception 'Accès réservé à l''administrateur.';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Utilisez "Quitter l''entreprise" pour vous retirer vous-même.';
  end if;
  update public.profiles set company_id = null, role = 'membre' where id = p_profile_id and company_id = v_cid;
  if not found then raise exception 'Membre introuvable.'; end if;
end; $$;
grant execute on function public.remove_member(uuid) to authenticated;

create or replace function public.leave_company()
returns void language plpgsql security definer set search_path = public as $$
declare v_cid uuid := public.my_company_id(); v_role text; v_others int;
begin
  if v_cid is null then raise exception 'Vous n''êtes rattaché à aucune entreprise.'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role = 'admin' then
    select count(*) into v_others from public.profiles where company_id = v_cid and id <> auth.uid();
    if v_others > 0 then
      raise exception 'Promouvez un autre membre administrateur avant de quitter.';
    end if;
  end if;
  update public.profiles set company_id = null, role = 'membre' where id = auth.uid();
end; $$;
grant execute on function public.leave_company() to authenticated;

-- ---------------------------------------------------------------------
-- 7. CONSOLE STAFF — gestion de toutes les entreprises sans y adhérer
-- ---------------------------------------------------------------------
create or replace function public.admin_create_company(
  p_name text, p_sector text default null, p_city text default null, p_country text default 'France',
  p_phone text default null, p_description text default null, p_max_members int default 5,
  p_discord_channel_id text default null
) returns public.companies language plpgsql security definer set search_path = public as $$
declare v_code text; v_row public.companies;
begin
  if not public.is_staff() then raise exception 'Accès réservé au staff.'; end if;
  loop
    v_code := public._gen_invite_code();
    begin
      insert into public.companies (name, sector, city, country, phone, description, max_members, discord_channel_id, invite_code)
      values (p_name, p_sector, p_city, coalesce(p_country, 'France'), p_phone, p_description,
              greatest(coalesce(p_max_members, 5), 1), p_discord_channel_id, v_code)
      returning * into v_row;
      exit;
    exception when unique_violation then end;
  end loop;
  return v_row;
end; $$;
grant execute on function public.admin_create_company(text,text,text,text,text,text,int,text) to authenticated;

create or replace function public.admin_update_company(
  p_id uuid, p_name text, p_sector text default null, p_city text default null, p_country text default 'France',
  p_phone text default null, p_description text default null, p_max_members int default 5,
  p_discord_channel_id text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Accès réservé au staff.'; end if;
  update public.companies set
    name = p_name, sector = p_sector, city = p_city, country = coalesce(p_country, 'France'),
    phone = p_phone, description = p_description, max_members = greatest(coalesce(p_max_members, 5), 1),
    discord_channel_id = p_discord_channel_id
  where id = p_id;
end; $$;
grant execute on function public.admin_update_company(uuid,text,text,text,text,text,text,int,text) to authenticated;

create or replace function public.admin_regenerate_code(p_company_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not public.is_staff() then raise exception 'Accès réservé au staff.'; end if;
  loop
    v_code := public._gen_invite_code();
    begin
      update public.companies set invite_code = v_code where id = p_company_id;
      exit;
    exception when unique_violation then end;
  end loop;
  return v_code;
end; $$;
grant execute on function public.admin_regenerate_code(uuid) to authenticated;

create or replace function public.admin_set_active(p_company_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Accès réservé au staff.'; end if;
  update public.companies set is_active = p_active where id = p_company_id;
end; $$;
grant execute on function public.admin_set_active(uuid,boolean) to authenticated;

create or replace function public.admin_delete_company(p_company_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Accès réservé au staff.'; end if;
  if exists (select 1 from public.orders where buyer_company_id = p_company_id or seller_company_id = p_company_id) then
    raise exception 'Impossible de supprimer : des commandes existent pour cette entreprise. Désactivez-la à la place.';
  end if;
  delete from public.companies where id = p_company_id;
end; $$;
grant execute on function public.admin_delete_company(uuid) to authenticated;

create or replace function public.admin_attach_profile(p_profile_id uuid, p_company_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_count int; v_max int;
begin
  if not public.is_staff() then raise exception 'Accès réservé au staff.'; end if;
  select max_members into v_max from public.companies where id = p_company_id;
  if v_max is null then raise exception 'Entreprise introuvable.'; end if;
  select count(*) into v_count from public.profiles where company_id = p_company_id;
  if v_count >= v_max then raise exception 'Cette entreprise a atteint son nombre maximum de membres.'; end if;
  update public.profiles
  set company_id = p_company_id, role = case when v_count = 0 then 'admin' else 'membre' end
  where id = p_profile_id;
end; $$;
grant execute on function public.admin_attach_profile(uuid,uuid) to authenticated;

create or replace function public.admin_grant_staff(p_profile_id uuid, p_staff boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Accès réservé au staff.'; end if;
  update public.profiles set is_staff = p_staff where id = p_profile_id;
end; $$;
grant execute on function public.admin_grant_staff(uuid,boolean) to authenticated;

create or replace function public.admin_list_all_profiles()
returns table(id uuid, full_name text, discord_username text, company_id uuid, company_name text,
              role text, is_staff boolean, created_at timestamptz)
language sql security definer set search_path = public as $$
  select p.id, p.full_name, p.discord_username, p.company_id, c.name, p.role, p.is_staff, p.created_at
  from public.profiles p
  left join public.companies c on c.id = p.company_id
  where public.is_staff()
  order by p.created_at desc;
$$;
grant execute on function public.admin_list_all_profiles() to authenticated;

create or replace function public.admin_company_counts()
returns table(company_id uuid, member_count bigint, product_count bigint, order_count bigint)
language sql security definer set search_path = public as $$
  select c.id,
    (select count(*) from public.profiles p where p.company_id = c.id),
    (select count(*) from public.products pr where pr.company_id = c.id),
    (select count(*) from public.orders o where o.buyer_company_id = c.id or o.seller_company_id = c.id)
  from public.companies c
  where public.is_staff();
$$;
grant execute on function public.admin_company_counts() to authenticated;

-- ---------------------------------------------------------------------
-- 8. RLS — seul l'admin de l'entreprise modifie sa fiche
-- ---------------------------------------------------------------------
drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies
  for update to authenticated
  using (
    id = public.my_company_id()
    and exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'admin')
  )
  with check (id = public.my_company_id());

-- ---------------------------------------------------------------------
-- 9. NOTIFICATIONS — file d'événements pour le futur bot Discord
--    Aucune policy "authenticated" : table invisible depuis le site,
--    seul le bot (clé service_role) pourra la lire/écrire.
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid references public.orders(id) on delete cascade,
  event              text not null,               -- 'new_order' | 'status_change'
  company_id         uuid not null references public.companies(id) on delete cascade,
  discord_channel_id text,
  payload            jsonb not null default '{}'::jsonb,
  delivered          boolean not null default false,
  created_at         timestamptz not null default now()
);
alter table public.notifications enable row level security;

create or replace function public.notify_new_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_channel text;
begin
  select discord_channel_id into v_channel from public.companies where id = new.seller_company_id;
  insert into public.notifications (order_id, event, company_id, discord_channel_id, payload)
  values (new.id, 'new_order', new.seller_company_id, v_channel,
          jsonb_build_object('reference', new.reference, 'total_ht', new.total_ht));
  return new;
end; $$;
drop trigger if exists trg_notify_new_order on public.orders;
create trigger trg_notify_new_order after insert on public.orders
  for each row execute function public.notify_new_order();

create or replace function public.notify_order_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_channel text;
begin
  if new.status is distinct from old.status then
    select discord_channel_id into v_channel from public.companies where id = new.buyer_company_id;
    insert into public.notifications (order_id, event, company_id, discord_channel_id, payload)
    values (new.id, 'status_change', new.buyer_company_id, v_channel,
            jsonb_build_object('reference', new.reference, 'status', new.status));
  end if;
  return new;
end; $$;
drop trigger if exists trg_notify_order_status on public.orders;
create trigger trg_notify_order_status after update on public.orders
  for each row execute function public.notify_order_status();

-- =====================================================================
--  FIN — étapes suivantes : voir GUIDE.md
-- =====================================================================
