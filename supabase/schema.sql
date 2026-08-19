-- =====================================================================
--  GROSSO — Plateforme B2B de commerce en gros
--  Schéma Supabase (PostgreSQL) — à exécuter dans SQL Editor
--  Copier/coller TOUT ce fichier, puis cliquer sur "Run".
--  Le script est ré-exécutable sans danger (idempotent).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

-- Une entreprise = un espace vendeur/acheteur
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  siret       text,
  sector      text,
  city        text,
  country     text default 'France',
  phone       text,
  description text,
  logo_url    text,
  created_at  timestamptz not null default now()
);

-- Un utilisateur rattaché à une entreprise
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  full_name  text,
  email      text,
  role       text not null default 'admin',   -- admin | membre
  created_at timestamptz not null default now()
);

-- Les articles proposés par une entreprise
create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  sku           text,
  name          text not null,
  description   text,
  category      text,
  unit          text default 'unité',        -- unité | carton | palette | kg ...
  price_ht      numeric(12,2) not null default 0,
  currency      text not null default 'EUR',
  min_qty       integer not null default 1,   -- quantité minimale de commande
  stock         integer not null default 0,
  image_url     text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Les commandes passées d'une entreprise vers une autre
create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null default ('CMD-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  buyer_company_id  uuid not null references public.companies(id) on delete cascade,
  seller_company_id uuid not null references public.companies(id) on delete cascade,
  status            text not null default 'en_attente', -- en_attente | confirmee | expediee | livree | annulee
  total_ht          numeric(12,2) not null default 0,
  currency          text not null default 'EUR',
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  product_id   uuid references public.products(id) on delete set null,
  product_name text not null,
  unit         text,
  unit_price_ht numeric(12,2) not null default 0,
  quantity     integer not null default 1,
  line_total   numeric(12,2) not null default 0
);

create index if not exists idx_products_company on public.products(company_id);
create index if not exists idx_products_active  on public.products(is_active);
create index if not exists idx_orders_buyer     on public.orders(buyer_company_id);
create index if not exists idx_orders_seller    on public.orders(seller_company_id);
create index if not exists idx_items_order      on public.order_items(order_id);

-- ---------------------------------------------------------------------
-- 2. FONCTION UTILITAIRE — l'entreprise de l'utilisateur connecté
--    (SECURITY DEFINER pour éviter la récursion dans les policies RLS)
-- ---------------------------------------------------------------------
create or replace function public.my_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- 3. INSCRIPTION — création automatique de l'entreprise + du profil
--    Les métadonnées company_name / full_name sont envoyées par le site.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_company_id uuid;
  cname text;
begin
  cname := coalesce(nullif(new.raw_user_meta_data->>'company_name',''), 'Mon entreprise');

  insert into public.companies (name, siret, city, sector)
  values (
    cname,
    nullif(new.raw_user_meta_data->>'siret',''),
    nullif(new.raw_user_meta_data->>'city',''),
    nullif(new.raw_user_meta_data->>'sector','')
  )
  returning id into new_company_id;

  insert into public.profiles (id, company_id, full_name, email)
  values (
    new.id,
    new_company_id,
    nullif(new.raw_user_meta_data->>'full_name',''),
    new.email
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.companies   enable row level security;
alter table public.profiles    enable row level security;
alter table public.products    enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- --- companies : tout le monde (connecté) voit l'annuaire ; on ne modifie que la sienne
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies
  for select to authenticated using (true);

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies
  for update to authenticated
  using (id = public.my_company_id())
  with check (id = public.my_company_id());

-- --- profiles : je vois/modifie mon profil, et je vois mes collègues
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or company_id = public.my_company_id());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- --- products : catalogue global en lecture, écriture réservée au propriétaire
drop policy if exists products_select on public.products;
create policy products_select on public.products
  for select to authenticated
  using (is_active = true or company_id = public.my_company_id());

drop policy if exists products_insert on public.products;
create policy products_insert on public.products
  for insert to authenticated
  with check (company_id = public.my_company_id());

drop policy if exists products_update on public.products;
create policy products_update on public.products
  for update to authenticated
  using (company_id = public.my_company_id())
  with check (company_id = public.my_company_id());

drop policy if exists products_delete on public.products;
create policy products_delete on public.products
  for delete to authenticated
  using (company_id = public.my_company_id());

-- --- orders : visibles par l'acheteur et le vendeur
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select to authenticated
  using (buyer_company_id = public.my_company_id()
      or seller_company_id = public.my_company_id());

drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders
  for insert to authenticated
  with check (buyer_company_id = public.my_company_id()
          and seller_company_id <> public.my_company_id());

-- le vendeur fait évoluer le statut ; l'acheteur peut annuler
drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update to authenticated
  using (seller_company_id = public.my_company_id()
      or buyer_company_id = public.my_company_id())
  with check (seller_company_id = public.my_company_id()
          or buyer_company_id = public.my_company_id());

-- --- order_items : suivent les droits de la commande parente
drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_id
      and (o.buyer_company_id = public.my_company_id()
        or o.seller_company_id = public.my_company_id())
  ));

drop policy if exists order_items_insert on public.order_items;
create policy order_items_insert on public.order_items
  for insert to authenticated
  with check (exists (
    select 1 from public.orders o
    where o.id = order_id and o.buyer_company_id = public.my_company_id()
  ));

-- ---------------------------------------------------------------------
-- 5. PASSAGE DE COMMANDE ATOMIQUE
--    Appelée par le site : supabase.rpc('place_order', {...})
--    items = [{product_id, quantity}, ...]  — les prix sont relus en base
--    (impossible de falsifier un prix depuis le navigateur)
-- ---------------------------------------------------------------------
create or replace function public.place_order(
  p_seller uuid,
  p_items  jsonb,
  p_note   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer uuid := public.my_company_id();
  v_order uuid;
  v_total numeric(12,2) := 0;
  it       jsonb;
  prod     public.products%rowtype;
  qty      integer;
  line     numeric(12,2);
begin
  if v_buyer is null then
    raise exception 'Aucune entreprise rattachée à ce compte.';
  end if;
  if p_seller = v_buyer then
    raise exception 'Impossible de commander auprès de sa propre entreprise.';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Le panier est vide.';
  end if;

  insert into public.orders (buyer_company_id, seller_company_id, note)
  values (v_buyer, p_seller, p_note)
  returning id into v_order;

  for it in select * from jsonb_array_elements(p_items) loop
    select * into prod from public.products
      where id = (it->>'product_id')::uuid and company_id = p_seller and is_active;
    if not found then
      raise exception 'Article introuvable ou indisponible.';
    end if;

    qty := greatest(coalesce((it->>'quantity')::int, 1), prod.min_qty);
    line := round(prod.price_ht * qty, 2);
    v_total := v_total + line;

    insert into public.order_items (order_id, product_id, product_name, unit, unit_price_ht, quantity, line_total)
    values (v_order, prod.id, prod.name, prod.unit, prod.price_ht, qty, line);

    update public.products set stock = greatest(stock - qty, 0) where id = prod.id;
  end loop;

  update public.orders set total_ht = v_total where id = v_order;
  return v_order;
end;
$$;

grant execute on function public.place_order(uuid, jsonb, text) to authenticated;
grant execute on function public.my_company_id() to authenticated;

-- ---------------------------------------------------------------------
-- 6. VUE PRATIQUE — catalogue enrichi du nom de l'entreprise
-- ---------------------------------------------------------------------
create or replace view public.catalog with (security_invoker = true) as
select p.*, c.name as company_name, c.city as company_city
from public.products p
join public.companies c on c.id = p.company_id;

-- ---------------------------------------------------------------------
-- 7. DROITS (par sécurité — Supabase les pose en général tout seul)
--    Les RLS ci-dessus restent la vraie barrière.
-- ---------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.companies, public.profiles, public.products,
  public.orders, public.order_items to authenticated;
grant select on public.catalog to authenticated;

-- =====================================================================
--  FIN
-- =====================================================================
