/* =====================================================================
   Grosso — application (espace entreprise) — V4 multi-entreprises
   ===================================================================== */
import { sb, configOK, $, $$, money, dateFR, esc, toast, humanError, showSetupScreen } from "./common.js";

if (!configOK) { showSetupScreen(); throw new Error("config"); }

const STATUS = {
  en_attente: { label: "En attente", cls: "badge-warn" },
  confirmee:  { label: "Confirmée",  cls: "badge-info" },
  attente_paiement: { label: "En attente de paiement", cls: "badge-warn" },
  expediee:   { label: "Expédiée",   cls: "badge-info" },
  livree:     { label: "Livrée",     cls: "badge-ok" },
  annulee:    { label: "Annulée",    cls: "badge-danger" },
};
const UNITS = ["unité", "carton", "palette", "kg", "litre", "lot"];
const MAX_COMPANIES_PER_USER = 3;

const state = { user: null, profile: null, memberships: [], activeCompany: null, activeRole: null, cart: [] };

/* ---------------------------------------------------------------- boot */
(async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.replace("index.html"); return; }
  state.user = session.user;

  const { data: profile, error } = await sb.from("profiles").select("*").eq("id", state.user.id).single();

  if (error || !profile) {
    document.body.innerHTML = `<div class="center-screen"><div class="setup card card-pad">
      <h1>Profil introuvable</h1>
      <p>Votre compte Discord est bien connecté, mais aucun profil n'a été créé côté base de données.
      Vérifiez que les migrations SQL ont bien été exécutées, puis reconnectez-vous.</p>
      <button class="btn btn-primary" onclick="location.href='index.html'">Retour</button>
    </div></div>`;
    await sb.auth.signOut();
    return;
  }
  state.profile = profile;

  const { data: memberships, error: e2 } = await sb
    .from("company_members")
    .select("role, created_at, companies(*)")
    .eq("profile_id", state.user.id);
  if (e2) throw e2;
  state.memberships = memberships || [];

  loadCart();

  $("#logout").onclick = async () => { await sb.auth.signOut(); location.replace("index.html"); };
  const discordName = state.user.user_metadata?.full_name
    || state.user.user_metadata?.name
    || state.user.user_metadata?.preferred_username
    || "Discord";
  $("#whoEmail").textContent = discordName;
  $("#modalClose").onclick = closeModal;
  $("#modalBg").onclick = (e) => { if (e.target.id === "modalBg") closeModal(); };
  $("#joinMoreBtn").onclick = openJoinMoreModal;

  const savedTheme = localStorage.getItem("grosso_theme") || "light";
  if (savedTheme === "dark") { document.body.classList.add("theme-dark"); $("#themeToggle").textContent = "☀️ Mode clair"; }
  $("#themeToggle").onclick = () => {
    const dark = document.body.classList.toggle("theme-dark");
    localStorage.setItem("grosso_theme", dark ? "dark" : "light");
    $("#themeToggle").textContent = dark ? "☀️ Mode clair" : "🌙 Mode sombre";
  };
  $("#globalSearchForm").onsubmit = (e) => {
    e.preventDefault();
    searchQuery = $("#globalSearch").value.trim();
    location.hash = "#recherche"; route();
  };

  if (profile.is_staff) { $("#navStaff").hidden = false; $("#navAuditLog").hidden = false; }

  if (!state.memberships.length) {
    if (profile.is_staff) {
      $$(".nav-co").forEach((a) => (a.hidden = true));
      $("#whoCompany").textContent = "Staff";
      $("#boot").hidden = true;
      $("#app").hidden = false;
      window.addEventListener("hashchange", route);
      location.hash = "#staff";
      route();
      return;
    }
    renderJoinScreen();
    return;
  }

  const savedId = localStorage.getItem("grosso_active_company_" + state.user.id);
  const found = state.memberships.find((m) => m.companies.id === savedId);
  setActiveCompany(found || state.memberships[0]);

  $("#boot").hidden = true;
  $("#app").hidden = false;

  window.addEventListener("hashchange", route);
  refreshCartBadge();
  route();
})();

/* ------------------------------------------------- sélecteur entreprise */
function setActiveCompany(membership) {
  state.activeCompany = membership.companies;
  state.activeRole = membership.role;
  localStorage.setItem("grosso_active_company_" + state.user.id, membership.companies.id);
  renderCompanyBox();
  const navD = $("#navDeliveries");
  if (navD) navD.hidden = !state.activeCompany.is_delivery;
}

function renderCompanyBox() {
  const box = $("#whoCompany");
  if (!box) return;
  const logo = state.activeCompany?.logo_url
    ? `<img src="${esc(state.activeCompany.logo_url)}" alt="" style="height:22px;border-radius:4px;vertical-align:middle;margin-right:.4rem">`
    : "";
  if (state.memberships.length > 1) {
    box.innerHTML = `<div style="display:flex;align-items:center;margin-bottom:.3rem">${logo}</div><select id="companySwitch" style="width:100%;background:#1a2233;color:#fff;border:1px solid #2c3650;border-radius:8px;padding:.35rem .5rem;font-weight:700">
      ${state.memberships.map((m) => `<option value="${m.companies.id}" ${m.companies.id === state.activeCompany.id ? "selected" : ""}>${esc(m.companies.name)}</option>`).join("")}
    </select>`;
    $("#companySwitch").onchange = (e) => {
      const m = state.memberships.find((x) => x.companies.id === e.target.value);
      setActiveCompany(m);
      location.hash = "#accueil";
      route();
    };
  } else {
    box.innerHTML = `${logo}<span>${esc(state.activeCompany?.name || "Entreprise")}</span>`;
  }
  const joinMore = $("#joinMoreBtn");
  if (joinMore) joinMore.hidden = state.memberships.length >= MAX_COMPANIES_PER_USER;
}

function openJoinMoreModal() {
  openModal("Rejoindre une autre entreprise", `
    <form id="joinMoreForm">
      <p class="hint">Vous êtes membre de ${state.memberships.length}/${MAX_COMPANIES_PER_USER} entreprises.</p>
      <div class="field"><label>Code d'invitation</label><input id="joinMoreCode" required placeholder="4C7K-R2AB" style="text-transform:uppercase;font-family:monospace"></div>
      <button class="btn btn-primary btn-block" type="submit">Rejoindre</button>
    </form>`);
  $("#joinMoreForm").onsubmit = async (e) => {
    e.preventDefault();
    const code = $("#joinMoreCode").value.trim().toUpperCase();
    const { error } = await sb.rpc("join_company", { p_code: code });
    if (error) return toast(humanError(error), "err");
    closeModal(); toast("Entreprise rejointe", "ok"); location.reload();
  };
}

/* --------------------------------------------------- écran "rejoindre" */
function renderJoinScreen() {
  document.body.innerHTML = `<div class="center-screen"><div class="setup card card-pad" style="max-width:480px">
    <h1>Rejoindre une entreprise</h1>
    <p class="hint">Votre compte Discord est connecté. Entrez le code d'invitation transmis par votre entreprise pour accéder à votre espace (5 membres maximum par entreprise, ${MAX_COMPANIES_PER_USER} entreprises maximum par personne).</p>
    <form id="joinForm">
      <div class="field"><label>Code d'invitation</label><input id="joinCode" required placeholder="4C7K-R2AB" style="text-transform:uppercase;font-family:monospace"></div>
      <button class="btn btn-primary btn-block" type="submit">Rejoindre</button>
    </form>
    <p id="joinMsg" class="hint" style="margin-top:1rem"></p>
    <button class="btn btn-ghost" id="joinLogout" style="margin-top:1rem;width:100%">Se déconnecter</button>
  </div></div>`;

  $("#joinLogout").onclick = async () => { await sb.auth.signOut(); location.replace("index.html"); };
  $("#joinForm").onsubmit = async (e) => {
    e.preventDefault();
    const code = $("#joinCode").value.trim().toUpperCase();
    const msg = $("#joinMsg");
    msg.textContent = "";
    const { error } = await sb.rpc("join_company", { p_code: code });
    if (error) { msg.textContent = humanError(error); return; }
    location.reload();
  };
}

/* --------------------------------------------------------------- panier */
const cartKey = () => "grosso_cart_" + state.user.id;
function loadCart() { try { state.cart = JSON.parse(localStorage.getItem(cartKey())) || []; } catch { state.cart = []; } }
function saveCart() { localStorage.setItem(cartKey(), JSON.stringify(state.cart)); refreshCartBadge(); }
function refreshCartBadge() {
  const n = state.cart.reduce((s, i) => s + i.qty, 0);
  const b = $("#cartCount");
  if (!b) return;
  b.textContent = n; b.hidden = n === 0;
}
function addToCart(p, qty) {
  const line = state.cart.find((i) => i.product_id === p.id);
  if (line) line.qty += qty;
  else state.cart.push({
    product_id: p.id, name: p.name,
    price: Number(p.price_ht) * (1 - (Number(p.discount_percent) || 0) / 100),
    unit: p.unit,
    min_qty: p.min_qty, seller_id: p.company_id, seller_name: p.company_name, qty,
    weight_kg: p.weight_kg != null ? Number(p.weight_kg) : null,
  });
  saveCart();
  toast(`${p.name} ajouté au panier`, "ok");
}

/* -------------------------------------------------------------- modale */
function openModal(title, html) {
  $("#modalTitle").textContent = title;
  $("#modalContent").innerHTML = html;
  $("#modalBg").classList.add("open");
}
function closeModal() { $("#modalBg").classList.remove("open"); }

/* -------------------------------------------------------------- router */
const VIEWS = {
  accueil: viewHome,
  catalogue: viewCatalog,
  "mes-articles": viewMyProducts,
  panier: viewCart,
  achats: viewPurchases,
  ventes: viewSales,
  entreprise: viewCompany,
  stats: viewStats,
  devis: viewDevis,
  actualites: viewAnnouncements,
  journal: viewAuditLog,
  recherche: viewSearch,
  staff: viewStaff,
  livraisons: viewDeliveries,
};
let searchQuery = "";

async function route() {
  const name = (location.hash.replace("#", "") || (state.activeCompany ? "accueil" : "staff"));
  const fn = VIEWS[name] || viewHome;
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === name));
  $("#view").innerHTML = `<p class="hint">Chargement…</p>`;
  try { await fn(); }
  catch (e) { $("#view").innerHTML = `<div class="empty"><div class="big">⚠️</div><p>${esc(humanError(e))}</p></div>`; }
}

const head = (title, sub, actions = "") =>
  `<div class="page-head"><div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div><div>${actions}</div></div>`;

const empty = (icon, text, sub = "") =>
  `<div class="empty card card-pad"><div class="big">${icon}</div><p><b>${esc(text)}</b></p><p class="hint">${esc(sub)}</p></div>`;

/* ============================================================ ACCUEIL */
async function viewHome() {
  const cid = state.activeCompany.id;
  const [prods, asSeller, asBuyer, companies] = await Promise.all([
    sb.from("products").select("id,is_active,stock").eq("company_id", cid),
    sb.from("orders").select("*").eq("seller_company_id", cid).order("created_at", { ascending: false }),
    sb.from("orders").select("*").eq("buyer_company_id", cid).order("created_at", { ascending: false }),
    sb.from("companies").select("id", { count: "exact", head: true }),
  ]);

  const P = prods.data || [], S = asSeller.data || [], B = asBuyer.data || [];
  const ca = S.filter((o) => o.status !== "annulee").reduce((s, o) => s + Number(o.total_ht), 0);
  const achats = B.filter((o) => o.status !== "annulee").reduce((s, o) => s + Number(o.total_ht), 0);
  const attente = S.filter((o) => o.status === "en_attente").length;

  const recent = [...S.map(o => ({ ...o, sens: "vente" })), ...B.map(o => ({ ...o, sens: "achat" }))]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);

  const names = await companyNames([...new Set(recent.flatMap(o => [o.buyer_company_id, o.seller_company_id]))]);

  const logoImg = state.activeCompany.logo_url
    ? `<img src="${esc(state.activeCompany.logo_url)}" alt="" style="height:36px;border-radius:6px;vertical-align:middle;margin-right:.6rem">`
    : "";
  $("#view").innerHTML =
    `<div class="page-head"><div><h1>${logoImg}Bonjour, ${esc(state.activeCompany.name)}</h1><p>Vue d'ensemble de votre activité sur la place de marché</p></div><div></div></div>` + `
    <div class="grid stats">
      <div class="stat"><div class="label">Mes articles</div><div class="value">${P.length}</div>
        <div class="sub">${P.filter(p => p.is_active).length} en ligne</div></div>
      <div class="stat"><div class="label">Commandes reçues</div><div class="value">${S.length}</div>
        <div class="sub">${attente} en attente de traitement</div></div>
      <div class="stat"><div class="label">Chiffre d'affaires HT</div><div class="value">${money(ca)}</div>
        <div class="sub">toutes commandes reçues</div></div>
      <div class="stat"><div class="label">Mes achats HT</div><div class="value">${money(achats)}</div>
        <div class="sub">${B.length} commande(s) passée(s)</div></div>
    </div>

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
      <div class="card card-pad">
        <h3>Démarrer</h3>
        <p class="hint">Trois gestes pour être opérationnel.</p>
        <div style="display:flex;flex-direction:column;gap:.5rem">
          <a class="btn btn-primary" href="#mes-articles">Publier un article</a>
          <a class="btn btn-ghost" href="#catalogue">Parcourir le catalogue (${companies.count ?? "…"} entreprises)</a>
          <a class="btn btn-ghost" href="#entreprise">Compléter ma fiche entreprise</a>
        </div>
      </div>
      <div class="card" style="grid-column:span 2;min-width:0">
        <div class="card-pad" style="padding-bottom:.4rem"><h3>Dernière activité</h3></div>
        ${recent.length ? `<table><thead><tr><th>Réf.</th><th>Type</th><th>Contrepartie</th><th>Statut</th><th class="num">Montant HT</th><th class="num">Date</th></tr></thead><tbody>
          ${recent.map(o => `<tr>
            <td><b>${esc(o.reference)}</b></td>
            <td>${o.sens === "vente" ? "📤 Vente" : "📥 Achat"}</td>
            <td>${esc(names[o.sens === "vente" ? o.buyer_company_id : o.seller_company_id] || "—")}</td>
            <td><span class="badge ${STATUS[o.status]?.cls || ""}">${STATUS[o.status]?.label || o.status}</span></td>
            <td class="num">${money(o.total_ht)}</td>
            <td class="num hint">${dateFR(o.created_at)}</td></tr>`).join("")}
        </tbody></table>` : `<div class="card-pad"><p class="hint">Aucune commande pour le moment.</p></div>`}
      </div>
    </div>`;
}

async function companyNames(ids) {
  const clean = ids.filter(Boolean);
  if (!clean.length) return {};
  const { data } = await sb.from("companies").select("id,name").in("id", clean);
  return Object.fromEntries((data || []).map((c) => [c.id, c.name]));
}

/* ========================================================== CATALOGUE */
let catalogCache = null;
async function viewCatalog() {
  const { data, error } = await sb
    .from("catalog")
    .select("*")
    .eq("is_active", true)
    .neq("company_id", state.activeCompany.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  catalogCache = data || [];

  const { data: favs } = await sb.from("company_favorites").select("seller_company_id").eq("buyer_company_id", state.activeCompany.id);
  const favSet = new Set((favs || []).map(f => f.seller_company_id));

  const cats = [...new Set(catalogCache.map((p) => p.category).filter(Boolean))].sort();
  const cos  = [...new Map(catalogCache.map((p) => [p.company_id, p.company_name])).entries()]
                 .sort((a, b) => a[1].localeCompare(b[1]));

  $("#view").innerHTML =
    head("Catalogue général", `${catalogCache.length} article(s) proposé(s) par ${cos.length} entreprise(s)`) + `
    <div class="toolbar">
      <input id="fSearch" type="search" placeholder="Rechercher un article, une référence…">
      <select id="fCat"><option value="">Toutes les catégories</option>${cats.map(c => `<option>${esc(c)}</option>`).join("")}</select>
      <select id="fCo"><option value="">Toutes les entreprises</option>${cos.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join("")}</select>
      <select id="fSort"><option value="recent">Plus récents</option><option value="price">Prix croissant</option><option value="name">Nom A→Z</option></select>
      <label style="display:flex;align-items:center;gap:.3rem;white-space:nowrap"><input type="checkbox" id="fFav" style="width:auto">⭐ Favoris uniquement</label>
    </div>
    <div id="catalogGrid" class="grid grid-products"></div>`;

  const render = () => {
    const q  = $("#fSearch").value.trim().toLowerCase();
    const c  = $("#fCat").value, co = $("#fCo").value, s = $("#fSort").value, favOnly = $("#fFav").checked;
    let list = catalogCache.filter((p) =>
      (!c || p.category === c) && (!co || p.company_id === co) &&
      (!favOnly || favSet.has(p.company_id)) &&
      (!q || [p.name, p.sku, p.description, p.company_name].join(" ").toLowerCase().includes(q)));
    if (s === "price") list.sort((a, b) => a.price_ht - b.price_ht);
    if (s === "name")  list.sort((a, b) => a.name.localeCompare(b.name));

    $("#catalogGrid").innerHTML = list.length
      ? list.map(p => productCard(p, favSet)).join("")
      : empty("🔍", "Aucun article ne correspond", "Essayez d'élargir votre recherche.");

    $$("#catalogGrid .add").forEach((btn) => {
      btn.onclick = () => {
        const p = catalogCache.find((x) => x.id === btn.dataset.id);
        const input = btn.parentElement.querySelector("input");
        addToCart(p, Math.max(parseInt(input.value, 10) || p.min_qty, p.min_qty));
      };
    });
    $$("#catalogGrid .fav").forEach((btn) => {
      btn.onclick = async () => {
        const sellerId = btn.dataset.seller;
        if (favSet.has(sellerId)) {
          await sb.from("company_favorites").delete().eq("buyer_company_id", state.activeCompany.id).eq("seller_company_id", sellerId);
          favSet.delete(sellerId);
        } else {
          await sb.from("company_favorites").insert({ buyer_company_id: state.activeCompany.id, seller_company_id: sellerId });
          favSet.add(sellerId);
        }
        render();
      };
    });
    $$("#catalogGrid .quote").forEach((btn) => {
      btn.onclick = () => {
        const p = catalogCache.find((x) => x.id === btn.dataset.id);
        quoteForm(p);
      };
    });
  };
  ["fSearch", "fCat", "fCo", "fSort", "fFav"].forEach((id) => { $("#" + id).oninput = render; });
  render();
}

function quoteForm(p) {
  openModal("Demander un devis", `
    <form id="qf">
      <p class="hint">Article : <b>${esc(p.name)}</b> — ${esc(p.company_name)}</p>
      <div class="field"><label>Quantité souhaitée</label><input name="quantity" type="number" min="1" step="1" value="${p.min_qty}"></div>
      <div class="field"><label>Message pour le fournisseur</label><textarea name="message" placeholder="Précisez votre besoin, délai, etc."></textarea></div>
      <div style="display:flex;gap:.6rem;justify-content:flex-end">
        <button type="button" class="btn btn-ghost" id="qfCancel">Annuler</button>
        <button type="submit" class="btn btn-primary">Envoyer la demande</button>
      </div>
    </form>`);
  $("#qfCancel").onclick = closeModal;
  $("#qf").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const items = [{ product_id: p.id, product_name: p.name, quantity: parseInt(f.get("quantity"), 10) || 1 }];
    const { error } = await sb.rpc("request_quote", {
      p_buyer: state.activeCompany.id, p_seller: p.company_id, p_items: items, p_message: f.get("message").trim() || null,
    });
    if (error) return toast(humanError(error), "err");
    closeModal(); toast("Demande de devis envoyée", "ok");
  };
}

const productCard = (p, favSet) => {
  const hasDiscount = p.discount_percent > 0;
  const effPrice = hasDiscount ? p.price_ht * (1 - p.discount_percent / 100) : p.price_ht;
  const stockBadge = p.stock <= 0
    ? `<span class="badge badge-danger">Rupture — précommande possible</span>`
    : (p.stock <= (p.low_stock_threshold ?? 5) ? `<span class="badge badge-warn">Stock faible</span>` : "");
  const isNew = (Date.now() - new Date(p.created_at).getTime()) < 7 * 24 * 3600 * 1000;
  const isFav = favSet && favSet.has(p.company_id);
  return `
  <article class="card product">
    <div class="thumb">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">` : "📦"}${isNew ? `<span class="badge badge-ok" style="position:absolute;top:.5rem;left:.5rem">🆕 Nouveau</span>` : ""}</div>
    <div class="body">
      <div class="seller" style="display:flex;align-items:center;justify-content:space-between">
        <span>${p.company_logo_url ? `<img src="${esc(p.company_logo_url)}" alt="" style="height:16px;vertical-align:middle;border-radius:3px;margin-right:.3rem">` : ""}${esc(p.company_name)}${p.company_city ? " · " + esc(p.company_city) : ""}</span>
        <button class="fav" data-seller="${p.company_id}" title="Favori" style="background:none;border:none;cursor:pointer;font-size:1.1rem">${isFav ? "⭐" : "☆"}</button>
      </div>
      <div class="name">${esc(p.name)}</div>
      <div class="hint">${p.category ? esc(p.category) + " · " : ""}${p.stock > 0 ? p.stock + " en stock" : "stock à confirmer"}</div>
      ${stockBadge}
      ${p.promo_buy_x ? `<div class="hint">🎁 ${p.promo_buy_x} achetés = ${p.promo_get_y} offert(s)</div>` : ""}
      <div class="price">
        ${hasDiscount ? `<span style="text-decoration:line-through;color:var(--muted);font-size:.9em">${money(p.price_ht)}</span> ` : ""}
        ${money(effPrice)} <small>HT / ${esc(p.unit)}</small>
        ${hasDiscount ? ` <span class="badge badge-danger">-${p.discount_percent}%</span>` : ""}
      </div>
      <div class="hint">Minimum : ${p.min_qty} ${esc(p.unit)}</div>
      <div class="actions">
        <input class="qty" type="number" min="${p.min_qty}" step="1" value="${p.min_qty}" aria-label="Quantité">
        <button class="btn btn-primary btn-sm add" data-id="${p.id}" style="flex:1">Ajouter</button>
      </div>
      <button class="btn btn-ghost btn-sm quote" data-id="${p.id}" style="width:100%;margin-top:.4rem">Demander un devis</button>
    </div>
  </article>`;
};

/* ======================================================= MES ARTICLES */
async function viewMyProducts() {
  const { data, error } = await sb.from("products").select("*")
    .eq("company_id", state.activeCompany.id).order("created_at", { ascending: false });
  if (error) throw error;

  const { data: promos } = await sb.from("promo_codes").select("*")
    .eq("company_id", state.activeCompany.id).order("created_at", { ascending: false });

  const stockBadge = (p) => {
    if (p.stock <= 0) return `<span class="badge badge-danger">Rupture</span>`;
    if (p.stock <= p.low_stock_threshold) return `<span class="badge badge-warn">Stock faible</span>`;
    return "";
  };

  $("#view").innerHTML =
    head("Mes articles", "Ce que votre entreprise propose aux autres membres",
         `<button class="btn btn-primary" id="btnNew">+ Nouvel article</button>`) +
    (data.length ? `<div class="card"><table>
      <thead><tr><th>Article</th><th>Catégorie</th><th class="num">Prix HT</th><th class="num">Min.</th><th class="num">Stock</th><th>État</th><th></th></tr></thead>
      <tbody>${data.map(p => `<tr>
        <td><b>${esc(p.name)}</b>${p.sku ? `<div class="hint">${esc(p.sku)}</div>` : ""}${p.discount_percent > 0 ? `<div class="hint">🏷️ -${p.discount_percent}%</div>` : ""}${p.promo_buy_x ? `<div class="hint">🎁 ${p.promo_buy_x} achetés = ${p.promo_get_y} offert(s)</div>` : ""}</td>
        <td>${esc(p.category || "—")}</td>
        <td class="num">${money(p.price_ht)}<div class="hint">/ ${esc(p.unit)}</div></td>
        <td class="num">${p.min_qty}</td>
        <td class="num">${p.stock}
          <div style="display:flex;gap:.3rem;margin-top:.3rem;justify-content:flex-end">
            <input type="number" class="qty restockInput" data-id="${p.id}" min="1" value="10" style="width:60px">
            <button class="btn btn-sm btn-ghost restockBtn" data-id="${p.id}">+ stock</button>
          </div>
        </td>
        <td>${stockBadge(p)} <span class="badge ${p.is_active ? "badge-ok" : ""}">${p.is_active ? "En ligne" : "Masqué"}</span></td>
        <td class="num" style="white-space:nowrap">
          <button class="btn btn-sm btn-ghost edit" data-id="${p.id}">Modifier</button>
          <button class="btn btn-sm btn-danger del" data-id="${p.id}">Suppr.</button>
        </td></tr>`).join("")}</tbody></table></div>`
      : empty("📦", "Aucun article publié", "Ajoutez votre premier article pour apparaître dans le catalogue général.")) +

    `<div class="card" style="margin-top:1.2rem">
      <div class="card-pad" style="display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0">🏷️ Codes promo</h3>
        <button class="btn btn-sm btn-primary" id="btnNewPromo">+ Nouveau code</button>
      </div>
      ${promos && promos.length ? `<table><thead><tr><th>Code</th><th class="num">Remise</th><th class="num">Utilisations</th><th>Expire</th><th>État</th><th></th></tr></thead><tbody>
        ${promos.map(pr => `<tr>
          <td><code>${esc(pr.code)}</code></td>
          <td class="num">${pr.discount_percent}%</td>
          <td class="num">${pr.used_count}${pr.max_uses ? "/" + pr.max_uses : ""}</td>
          <td>${pr.expires_at ? dateFR(pr.expires_at) : "—"}</td>
          <td><span class="badge ${pr.is_active ? "badge-ok" : "badge-danger"}">${pr.is_active ? "Actif" : "Désactivé"}</span></td>
          <td class="num"><button class="btn btn-sm btn-ghost togglePromo" data-id="${pr.id}" data-active="${pr.is_active}">${pr.is_active ? "Désactiver" : "Activer"}</button>
            <button class="btn btn-sm btn-danger delPromo" data-id="${pr.id}">Suppr.</button></td>
        </tr>`).join("")}</tbody></table>` : `<div class="card-pad"><p class="hint">Aucun code promo créé.</p></div>`}
    </div>`;

  $("#btnNew").onclick = () => productForm(null);
  $$(".edit").forEach(b => b.onclick = () => productForm(data.find(p => p.id === b.dataset.id)));
  $$(".del").forEach(b => b.onclick = async () => {
    if (!confirm("Supprimer définitivement cet article ?")) return;
    const { error } = await sb.from("products").delete().eq("id", b.dataset.id);
    if (error) return toast(humanError(error), "err");
    toast("Article supprimé", "ok"); route();
  });
  $$(".restockBtn").forEach(b => b.onclick = async () => {
    const input = document.querySelector(`.restockInput[data-id="${b.dataset.id}"]`);
    const amount = parseInt(input.value, 10);
    if (!amount || amount <= 0) return toast("Quantité invalide", "err");
    const p = data.find(x => x.id === b.dataset.id);
    const { error } = await sb.from("products").update({ stock: p.stock + amount, updated_at: new Date().toISOString() }).eq("id", p.id);
    if (error) return toast(humanError(error), "err");
    toast(`+${amount} en stock`, "ok"); route();
  });

  $("#btnNewPromo").onclick = () => promoForm();
  $$(".togglePromo").forEach(b => b.onclick = async () => {
    const { error } = await sb.rpc("set_promo_code_active", { p_id: b.dataset.id, p_active: b.dataset.active !== "true" });
    if (error) return toast(humanError(error), "err");
    toast("Code mis à jour", "ok"); route();
  });
  $$(".delPromo").forEach(b => b.onclick = async () => {
    if (!confirm("Supprimer ce code promo ?")) return;
    const { error } = await sb.rpc("delete_promo_code", { p_id: b.dataset.id });
    if (error) return toast(humanError(error), "err");
    toast("Code supprimé", "ok"); route();
  });
}

function promoForm() {
  openModal("Nouveau code promo", `
    <form id="prf">
      <div class="field"><label>Code *</label><input name="code" required placeholder="ex: OILROX10" style="text-transform:uppercase"></div>
      <div class="row">
        <div class="field"><label>Remise (%) *</label><input name="discount_percent" type="number" min="1" max="100" step="1" required value="10"></div>
        <div class="field"><label>Utilisations max (facultatif)</label><input name="max_uses" type="number" min="1" step="1" placeholder="illimité"></div>
      </div>
      <div class="field"><label>Date d'expiration (facultatif)</label><input name="expires_at" type="date"></div>
      <div style="display:flex;gap:.6rem;justify-content:flex-end">
        <button type="button" class="btn btn-ghost" id="prfCancel">Annuler</button>
        <button type="submit" class="btn btn-primary">Créer</button>
      </div>
    </form>`);
  $("#prfCancel").onclick = closeModal;
  $("#prf").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await sb.rpc("create_promo_code", {
      p_company_id: state.activeCompany.id,
      p_code: f.get("code").trim(),
      p_discount_percent: Number(f.get("discount_percent")),
      p_max_uses: f.get("max_uses").trim() === "" ? null : parseInt(f.get("max_uses"), 10),
      p_expires_at: f.get("expires_at") ? f.get("expires_at") + "T23:59:59" : null,
    });
    if (error) return toast(humanError(error), "err");
    closeModal(); toast("Code promo créé", "ok"); route();
  };
}

function productForm(p) {
  openModal(p ? "Modifier l'article" : "Nouvel article", `
    <form id="pf">
      <div class="field"><label>Nom de l'article *</label><input name="name" required value="${esc(p?.name || "")}" placeholder="Carton de 12 bouteilles 75 cl"></div>
      <div class="row">
        <div class="field"><label>Référence / SKU</label><input name="sku" value="${esc(p?.sku || "")}"></div>
        <div class="field"><label>Catégorie</label><input name="category" value="${esc(p?.category || "")}" placeholder="Boissons"></div>
      </div>
      <div class="field"><label>Description</label><textarea name="description" placeholder="Conditionnement, origine, délai de livraison…">${esc(p?.description || "")}</textarea></div>
      <div class="row">
        <div class="field"><label>Prix HT *</label><input name="price_ht" type="number" step="0.01" min="0" required value="${p?.price_ht ?? ""}"></div>
        <div class="field"><label>Unité de vente</label><select name="unit">${UNITS.map(u => `<option ${p?.unit === u ? "selected" : ""}>${u}</option>`).join("")}</select></div>
      </div>
      <div class="row">
        <div class="field"><label>Remise (%)</label><input name="discount_percent" type="number" step="1" min="0" max="100" value="${p?.discount_percent ?? 0}"></div>
        <div class="field"><label>Seuil stock faible (alerte)</label><input name="low_stock_threshold" type="number" min="0" step="1" value="${p?.low_stock_threshold ?? 5}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Offre : achetez X…</label><input name="promo_buy_x" type="number" min="0" step="1" value="${p?.promo_buy_x ?? ""}" placeholder="ex: 3"></div>
        <div class="field"><label>…Y offert(s)</label><input name="promo_get_y" type="number" min="0" step="1" value="${p?.promo_get_y ?? ""}" placeholder="ex: 1"></div>
      </div>
      <div class="row">
        <div class="field"><label>Quantité minimum</label><input name="min_qty" type="number" min="1" step="1" value="${p?.min_qty ?? 1}"></div>
        <div class="field"><label>Stock disponible</label><input name="stock" type="number" min="0" step="1" value="${p?.stock ?? 0}"></div>
      </div>
      <div class="field"><label>Poids par ${esc(p?.unit || "unité")} en kg (facultatif, pour livraison groupée)</label><input name="weight_kg" type="number" step="0.001" min="0" value="${p?.weight_kg ?? ""}" placeholder="ex: 25"></div>
      <div class="field"><label>URL de l'image (facultatif)</label><input name="image_url" type="url" value="${esc(p?.image_url || "")}" placeholder="https://…"></div>
      <div class="field"><label style="display:flex;gap:.5rem;align-items:center;font-size:.95rem;color:var(--text)">
        <input type="checkbox" name="is_active" style="width:auto" ${p?.is_active !== false ? "checked" : ""}> Visible dans le catalogue général</label></div>
      <div style="display:flex;gap:.6rem;justify-content:flex-end">
        <button type="button" class="btn btn-ghost" id="pfCancel">Annuler</button>
        <button type="submit" class="btn btn-primary">${p ? "Enregistrer" : "Publier"}</button>
      </div>
    </form>`);

  $("#pfCancel").onclick = closeModal;
  $("#pf").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const payload = {
      company_id: state.activeCompany.id,
      name: f.get("name").trim(),
      sku: f.get("sku").trim() || null,
      category: f.get("category").trim() || null,
      description: f.get("description").trim() || null,
      price_ht: Number(f.get("price_ht")),
      unit: f.get("unit"),
      min_qty: Math.max(parseInt(f.get("min_qty"), 10) || 1, 1),
      stock: parseInt(f.get("stock"), 10) || 0,
      weight_kg: f.get("weight_kg").trim() === "" ? null : Number(f.get("weight_kg")),
      discount_percent: Math.min(Math.max(Number(f.get("discount_percent")) || 0, 0), 100),
      low_stock_threshold: Math.max(parseInt(f.get("low_stock_threshold"), 10) || 0, 0),
      promo_buy_x: f.get("promo_buy_x").trim() === "" ? null : parseInt(f.get("promo_buy_x"), 10),
      promo_get_y: f.get("promo_get_y").trim() === "" ? null : parseInt(f.get("promo_get_y"), 10),
      image_url: f.get("image_url").trim() || null,
      is_active: f.get("is_active") === "on",
      updated_at: new Date().toISOString(),
    };
    const { error } = p
      ? await sb.from("products").update(payload).eq("id", p.id)
      : await sb.from("products").insert(payload);
    if (error) return toast(humanError(error), "err");
    closeModal(); toast(p ? "Article mis à jour" : "Article publié", "ok"); route();
  };
}

/* =============================================================== PANIER */
async function viewCart() {
  if (!state.cart.length) {
    $("#view").innerHTML = head("Panier", "Vos articles sélectionnés") +
      empty("🛒", "Votre panier est vide", "Parcourez le catalogue général pour ajouter des articles.");
    return;
  }
  const sellers = [...new Map(state.cart.map(i => [i.seller_id, i.seller_name])).entries()];

  const { data: deliveryCos } = await sb.from("companies").select("id,name,price_per_tonne").eq("is_delivery", true).eq("is_active", true);
  const totalWeight = state.cart.reduce((s, i) => s + (Number(i.weight_kg) || 0) * i.qty, 0);
  const missingWeight = state.cart.some(i => !i.weight_kg);

  const deliveryPanel = (deliveryCos && deliveryCos.length) ? `
    <div class="card card-pad" style="margin-bottom:1.2rem">
      <label style="display:flex;gap:.5rem;align-items:center;font-weight:700;cursor:pointer">
        <input type="checkbox" id="groupedDelivery" style="width:auto"> 🚚 Livraison groupée
      </label>
      <p class="hint" style="margin-top:.3rem">${sellers.length > 1 ? `Vos commandes chez les ${sellers.length} fournisseurs sont livrées ensemble` : "Votre commande est livrée"} par une entreprise de livraison, à la date et au créneau de votre choix.</p>
      <div id="deliveryOptions" hidden style="margin-top:.8rem;display:flex;flex-direction:column;gap:.6rem">
        <div class="row">
          <div class="field"><label>Entreprise de livraison</label><select id="deliveryCo">${deliveryCos.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join("")}</select></div>
          <div class="field"><label>Date souhaitée</label><input id="deliveryDate" type="date"></div>
        </div>
        <div class="field"><label>Créneau horaire</label><select id="deliverySlot">
          <option value="0h-2h">0h - 2h</option>
          <option value="2h-4h">2h - 4h</option>
          <option value="4h-6h">4h - 6h</option>
          <option value="6h-8h">6h - 8h</option>
          <option value="8h-10h">8h - 10h</option>
          <option value="10h-12h">10h - 12h</option>
          <option value="12h-14h">12h - 14h</option>
          <option value="14h-16h">14h - 16h</option>
          <option value="16h-18h">16h - 18h</option>
          <option value="18h-20h">18h - 20h</option>
          <option value="20h-22h">20h - 22h</option>
          <option value="22h-0h">22h - 0h</option>
        </select></div>
        <p class="hint">Poids total estimé : <b>${totalWeight.toFixed(1)} kg</b>${missingWeight ? " — certains articles n'ont pas de poids renseigné, le tarif final sera confirmé par le livreur." : ""}</p>
        <button class="btn btn-primary" id="btnGroupedOrder">Passer toutes les commandes (livraison groupée)</button>
      </div>
    </div>` : "";

  $("#view").innerHTML = head("Panier", `Commande passée au nom de : ${esc(state.activeCompany.name)}`) +
    deliveryPanel +
    sellers.map(([sid, sname]) => {
      const lines = state.cart.filter(i => i.seller_id === sid);
      const total = lines.reduce((s, i) => s + i.price * i.qty, 0);
      return `<div class="card" style="margin-bottom:1.2rem">
        <div class="card-pad" style="padding-bottom:.2rem;display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0">🏢 ${esc(sname)}</h3><span class="hint">${lines.length} ligne(s)</span></div>
        <table><thead><tr><th>Article</th><th class="num">P.U. HT</th><th class="num">Quantité</th><th class="num">Total HT</th><th></th></tr></thead>
        <tbody>${lines.map(i => `<tr>
          <td><b>${esc(i.name)}</b><div class="hint">${esc(i.unit)} · min ${i.min_qty}</div></td>
          <td class="num">${money(i.price)}</td>
          <td class="num"><input class="qty cqty" type="number" min="${i.min_qty}" value="${i.qty}" data-id="${i.product_id}"></td>
          <td class="num"><b>${money(i.price * i.qty)}</b></td>
          <td class="num"><button class="btn btn-sm btn-danger rm" data-id="${i.product_id}">×</button></td>
        </tr>`).join("")}</tbody></table>
        <div class="card-pad" style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap">
          <input class="note" data-sid="${sid}" placeholder="Note pour le fournisseur (facultatif)" style="flex:1;min-width:200px">
          <input class="promo" data-sid="${sid}" placeholder="Code promo (facultatif)" style="width:160px;text-transform:uppercase">
          <div style="display:flex;align-items:center;gap:1rem">
            <div><span class="hint">Total HT</span> <b style="font-size:1.2rem">${money(total)}</b></div>
            <button class="btn btn-primary order" data-sid="${sid}">Passer commande</button>
          </div>
        </div></div>`;
    }).join("") +
    `<button class="btn btn-ghost" id="clearCart">Vider le panier</button>`;

  $$(".cqty").forEach(inp => inp.onchange = () => {
    const line = state.cart.find(i => i.product_id === inp.dataset.id);
    line.qty = Math.max(parseInt(inp.value, 10) || line.min_qty, line.min_qty);
    saveCart(); route();
  });
  $$(".rm").forEach(b => b.onclick = () => {
    state.cart = state.cart.filter(i => i.product_id !== b.dataset.id); saveCart(); route();
  });
  $("#clearCart").onclick = () => { state.cart = []; saveCart(); route(); };

  $$(".order").forEach(b => b.onclick = async () => {
    const sid = b.dataset.sid;
    b.disabled = true; b.textContent = "Envoi…";
    const items = state.cart.filter(i => i.seller_id === sid)
      .map(i => ({ product_id: i.product_id, quantity: i.qty }));
    const note = $(`.note[data-sid="${sid}"]`)?.value.trim() || null;
    const promo = $(`.promo[data-sid="${sid}"]`)?.value.trim() || null;
    const { error } = await sb.rpc("place_order", { p_buyer: state.activeCompany.id, p_seller: sid, p_items: items, p_note: note, p_promo_code: promo });
    if (error) { b.disabled = false; b.textContent = "Passer commande"; return toast(humanError(error), "err"); }
    state.cart = state.cart.filter(i => i.seller_id !== sid); saveCart();
    toast("Commande envoyée au fournisseur", "ok");
    location.hash = "#achats";
  });

  const groupedCb = $("#groupedDelivery");
  if (groupedCb) {
    const dateInput = $("#deliveryDate");
    const today = new Date().toISOString().slice(0, 10);
    dateInput.min = today; dateInput.value = today;
    groupedCb.onchange = (e) => {
      $("#deliveryOptions").hidden = !e.target.checked;
      $$(".order").forEach(b => { b.disabled = e.target.checked; b.textContent = e.target.checked ? "Regroupé ci-dessus" : "Passer commande"; });
    };
    $("#btnGroupedOrder").onclick = async () => {
      const deliveryCoId = $("#deliveryCo").value;
      const date = $("#deliveryDate").value;
      const slot = $("#deliverySlot").value;
      if (!date) return toast("Choisissez une date de livraison", "err");
      const btn = $("#btnGroupedOrder");
      btn.disabled = true; btn.textContent = "Envoi…";

      const orderIds = [];
      for (const [sid] of sellers) {
        const items = state.cart.filter(i => i.seller_id === sid).map(i => ({ product_id: i.product_id, quantity: i.qty }));
        const note = $(`.note[data-sid="${sid}"]`)?.value.trim() || null;
        const promo = $(`.promo[data-sid="${sid}"]`)?.value.trim() || null;
        const { data, error } = await sb.rpc("place_order", { p_buyer: state.activeCompany.id, p_seller: sid, p_items: items, p_note: note, p_promo_code: promo });
        if (error) { btn.disabled = false; btn.textContent = "Passer toutes les commandes (livraison groupée)"; return toast(humanError(error), "err"); }
        orderIds.push(data);
      }
      const { error: gError } = await sb.rpc("create_delivery_group", {
        p_buyer: state.activeCompany.id, p_delivery_company: deliveryCoId, p_requested_date: date, p_time_slot: slot, p_order_ids: orderIds,
      });
      if (gError) { toast(humanError(gError), "err"); }
      else toast("Commandes groupées envoyées", "ok");
      state.cart = []; saveCart();
      location.hash = "#achats"; route();
    };
  }
}

/* ====================================================== COMMANDES ACHAT */
async function viewPurchases() { await ordersView("achat"); }
async function viewSales()     { await ordersView("vente"); }

async function ordersView(sens) {
  const col = sens === "achat" ? "buyer_company_id" : "seller_company_id";
  const other = sens === "achat" ? "seller_company_id" : "buyer_company_id";

  const { data, error } = await sb.from("orders")
    .select("*, order_items(*)").eq(col, state.activeCompany.id)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const names = await companyNames(data.map(o => o[other]));

  let groupByOrder = {};
  if (sens === "achat" && data.length) {
    const { data: links } = await sb.from("delivery_group_orders")
      .select("order_id, delivery_groups(time_slot, requested_date, status, delivery_company_id)")
      .in("order_id", data.map(o => o.id));
    const dgNames = await companyNames((links || []).map(l => l.delivery_groups?.delivery_company_id));
    (links || []).forEach(l => { groupByOrder[l.order_id] = { ...l.delivery_groups, name: dgNames[l.delivery_groups?.delivery_company_id] }; });
  }

  const title = sens === "achat" ? "Mes commandes" : "Commandes reçues";
  const sub = sens === "achat"
    ? "Ce que vous avez commandé auprès des autres entreprises"
    : "Ce que les autres entreprises vous ont commandé";

  $("#view").innerHTML = head(title, sub) + (data.length ? data.map(o => `
    <div class="card" style="margin-bottom:1rem">
      <div class="card-pad" style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;align-items:center">
        <div>
          <b>${esc(o.reference)}</b>
          <span class="badge ${STATUS[o.status]?.cls || ""}" style="margin-left:.5rem">${STATUS[o.status]?.label || o.status}</span>
          <div class="hint">${sens === "achat" ? "Fournisseur" : "Client"} : <b>${esc(names[o[other]] || "—")}</b> · ${dateFR(o.created_at)}</div>
          ${o.note ? `<div class="hint">📝 ${esc(o.note)}</div>` : ""}
          ${(o.order_items || []).some(i => i.is_backorder) ? `<span class="badge badge-warn">⏳ Contient de la précommande</span>` : ""}
          ${o.promo_code ? `<div class="hint">🏷️ Code promo <b>${esc(o.promo_code)}</b> · -${money(o.discount_amount)}</div>` : ""}
          ${groupByOrder[o.id] ? `<div class="hint">🚚 Livraison groupée via <b>${esc(groupByOrder[o.id].name || "—")}</b> · ${groupByOrder[o.id].requested_date ? dateFR(groupByOrder[o.id].requested_date) : ""} · ${esc(groupByOrder[o.id].time_slot || "")}</div>` : ""}
        </div>
        <div style="text-align:right">
          <div class="hint">Total HT</div><b style="font-size:1.25rem">${money(o.total_ht)}</b>
        </div>
      </div>
      <table><thead><tr><th>Article</th><th class="num">P.U. HT</th><th class="num">Qté</th><th class="num">Total</th></tr></thead>
      <tbody>${(o.order_items || []).map(i => `<tr>
        <td>${esc(i.product_name)}</td><td class="num">${money(i.unit_price_ht)}</td>
        <td class="num">${i.quantity} ${esc(i.unit || "")}</td><td class="num">${money(i.line_total)}</td></tr>`).join("")}
      </tbody></table>
      <div class="card-pad" style="display:flex;gap:.5rem;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn btn-sm btn-ghost invoice" data-id="${o.id}">🧾 Facture</button>
        ${statusButtons(o, sens)}
      </div>
    </div>`).join("")
    : empty(sens === "achat" ? "📥" : "📤",
            sens === "achat" ? "Aucune commande passée" : "Aucune commande reçue",
            sens === "achat" ? "Ajoutez des articles au panier depuis le catalogue général."
                             : "Publiez vos articles pour être visible des autres entreprises."));

  $$(".setstatus").forEach(b => b.onclick = async () => {
    const { error } = await sb.from("orders")
      .update({ status: b.dataset.status, updated_at: new Date().toISOString() })
      .eq("id", b.dataset.id);
    if (error) return toast(humanError(error), "err");
    toast("Statut mis à jour", "ok"); route();
  });
  $$(".invoice").forEach(b => b.onclick = () => generateInvoice(data.find(o => o.id === b.dataset.id)));
}

async function generateInvoice(o) {
  const [{ data: seller }, { data: buyer }] = await Promise.all([
    sb.from("companies").select("*").eq("id", o.seller_company_id).single(),
    sb.from("companies").select("*").eq("id", o.buyer_company_id).single(),
  ]);
  if (!seller || !buyer) return toast("Impossible de générer la facture", "err");

  const rows = (o.order_items || []).map(i => `
    <tr>
      <td>${esc(i.product_name)}</td>
      <td style="text-align:right">${i.quantity} ${esc(i.unit || "")}</td>
      <td style="text-align:right">${money(i.unit_price_ht)}</td>
      <td style="text-align:right">${money(i.line_total)}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>Facture ${esc(o.reference)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#151a21;max-width:760px;margin:2rem auto;padding:0 1rem}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1f5eff;padding-bottom:1.2rem;margin-bottom:1.5rem}
  .head img{height:50px;margin-bottom:.5rem}
  .head h1{font-size:1.5rem;margin:0 0 .3rem}
  .parties{display:flex;justify-content:space-between;gap:2rem;margin-bottom:2rem}
  .parties .box{flex:1}
  .parties h3{font-size:.8rem;text-transform:uppercase;color:#666f7d;margin:0 0 .4rem}
  table{width:100%;border-collapse:collapse;margin-bottom:1.5rem}
  th{text-align:left;font-size:.78rem;text-transform:uppercase;color:#666f7d;border-bottom:2px solid #e2e5ea;padding:.5rem}
  td{padding:.6rem .5rem;border-bottom:1px solid #e2e5ea}
  .totals{margin-left:auto;width:280px}
  .totals div{display:flex;justify-content:space-between;padding:.3rem 0}
  .totals .grand{font-size:1.2rem;font-weight:700;border-top:2px solid #151a21;padding-top:.5rem;margin-top:.3rem}
  .no-print{margin-top:2rem}
  @media print{.no-print{display:none}}
</style></head>
<body>
  <div class="head">
    <div>
      ${seller.logo_url ? `<img src="${esc(seller.logo_url)}" alt="">` : ""}
      <h1>${esc(seller.name)}</h1>
      <div>${esc(seller.city || "")}${seller.city && seller.country ? ", " : ""}${esc(seller.country || "")}</div>
      ${seller.phone ? `<div>${esc(seller.phone)}</div>` : ""}
    </div>
    <div style="text-align:right">
      <h1>FACTURE</h1>
      <div><b>${esc(o.reference)}</b></div>
      <div>${dateFR(o.created_at)}</div>
    </div>
  </div>
  <div class="parties">
    <div class="box"><h3>Vendeur</h3><div><b>${esc(seller.name)}</b></div></div>
    <div class="box"><h3>Client</h3><div><b>${esc(buyer.name)}</b></div></div>
  </div>
  <table>
    <thead><tr><th>Article</th><th style="text-align:right">Qté</th><th style="text-align:right">P.U. HT</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    ${o.discount_amount > 0 ? `<div><span>Sous-total</span><span>${money(o.total_ht + Number(o.discount_amount))}</span></div>
    <div><span>Remise ${o.promo_code ? "(" + esc(o.promo_code) + ")" : ""}</span><span>-${money(o.discount_amount)}</span></div>` : ""}
    <div class="grand"><span>Total HT</span><span>${money(o.total_ht)}</span></div>
  </div>
  <div class="no-print">
    <button onclick="window.print()" style="padding:.7em 1.4em;font-size:1rem;cursor:pointer;background:#1f5eff;color:#fff;border:0;border-radius:8px">🖨️ Imprimer / Enregistrer en PDF</button>
  </div>
</body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
}

function statusButtons(o, sens) {
  const B = (s, label, cls = "btn-ghost") =>
    `<button class="btn btn-sm ${cls} setstatus" data-id="${o.id}" data-status="${s}">${label}</button>`;
  if (o.status === "annulee" || o.status === "livree") return `<span class="hint">Commande clôturée</span>`;
  if (sens === "vente") {
    return [
      o.status === "en_attente" ? B("confirmee", "Confirmer", "btn-primary") : "",
      o.status === "confirmee"  ? B("attente_paiement", "Marquer en attente de paiement", "btn-primary") : "",
      o.status === "attente_paiement" ? B("expediee", "Marquer expédiée", "btn-primary") : "",
      o.status === "expediee"   ? B("livree", "Marquer livrée", "btn-primary") : "",
      B("annulee", "Refuser", "btn-danger"),
    ].join("");
  }
  return o.status === "en_attente" ? B("annulee", "Annuler ma commande", "btn-danger")
                                   : `<span class="hint">En cours de traitement par le fournisseur</span>`;
}

/* ========================================================== ENTREPRISE */
async function viewCompany() {
  const c = state.activeCompany;
  const isAdmin = state.activeRole === "admin";

  const { data: members } = await sb.from("company_members")
    .select("role, created_at, profiles(id, full_name, discord_username)")
    .eq("company_id", c.id).order("created_at");

  $("#view").innerHTML = head("Mon entreprise", "Ces informations sont visibles par les autres membres") + `
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));align-items:start;gap:1.2rem">

      <div class="card card-pad">
        <form id="cf">
          <div class="field"><label>Nom de l'entreprise *</label><input name="name" required value="${esc(c.name || "")}" ${isAdmin ? "" : "disabled"}></div>
          <div class="row">
            <div class="field"><label>Secteur d'activité</label><input name="sector" value="${esc(c.sector || "")}" ${isAdmin ? "" : "disabled"}></div>
            <div class="field"><label>Ville</label><input name="city" value="${esc(c.city || "")}" ${isAdmin ? "" : "disabled"}></div>
          </div>
          <div class="row">
            <div class="field"><label>Pays</label><input name="country" value="${esc(c.country || "France")}" ${isAdmin ? "" : "disabled"}></div>
            <div class="field"><label>Téléphone</label><input name="phone" value="${esc(c.phone || "")}" ${isAdmin ? "" : "disabled"}></div>
          </div>
          <div class="field"><label>Présentation</label><textarea name="description" ${isAdmin ? "" : "disabled"}>${esc(c.description || "")}</textarea></div>
          <div class="field"><label>Logo (URL de l'image)</label><input name="logo_url" type="url" value="${esc(c.logo_url || "")}" ${isAdmin ? "" : "disabled"} placeholder="https://…">
            ${c.logo_url ? `<img src="${esc(c.logo_url)}" alt="" style="height:36px;margin-top:.4rem;border-radius:6px">` : ""}</div>
          <div class="row">
            <div class="field"><label>ID salon Discord (notifications)</label><input name="discord_channel_id" value="${esc(c.discord_channel_id || "")}" ${isAdmin ? "" : "disabled"}></div>
            <div class="field"><label>ID serveur Discord (guild)</label><input name="discord_guild_id" value="${esc(c.discord_guild_id || "")}" ${isAdmin ? "" : "disabled"}></div>
          </div>
          <div class="field"><label>ID rôle à ping (facultatif)</label><input name="discord_role_id" value="${esc(c.discord_role_id || "")}" ${isAdmin ? "" : "disabled"}></div>
          ${c.is_delivery ? `<div class="field"><label>Tarif à la tonne (€ / 1000 kg)</label><input name="price_per_tonne" type="number" step="0.01" min="0" value="${c.price_per_tonne ?? ""}" ${isAdmin ? "" : "disabled"}></div>` : ""}
          ${isAdmin
            ? `<button class="btn btn-primary" type="submit">Enregistrer</button>`
            : `<p class="hint">Seul l'administrateur de l'entreprise peut modifier ces informations.</p>`}
        </form>
      </div>

      ${isAdmin ? `<div class="card card-pad">
        <h3>Code d'invitation</h3>
        <p class="hint">Partagez ce code avec vos collègues (${c.max_members} membres maximum). Il ne consomme aucune place tant qu'il n'est pas utilisé.</p>
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          <input id="inviteCode" readonly value="${esc(c.invite_code || "—")}" style="font-family:monospace;font-size:1.1rem;font-weight:700;flex:1;min-width:140px">
          <button class="btn btn-sm btn-ghost" id="copyCode">Copier</button>
          <button class="btn btn-sm btn-danger" id="regenCode">Régénérer</button>
        </div>
      </div>` : ""}

      <div class="card" style="grid-column:1/-1">
        <div class="card-pad" style="padding-bottom:.4rem"><h3>Membres (${members?.length || 0}/${c.max_members})</h3></div>
        <table><thead><tr><th>Nom</th><th>Rôle</th><th></th></tr></thead><tbody>
          ${(members || []).map(m => `<tr>
            <td>${esc(m.profiles.full_name || m.profiles.discord_username || "—")}${m.profiles.id === state.user.id ? " (vous)" : ""}</td>
            <td><span class="badge ${m.role === "admin" ? "badge-ok" : ""}">${m.role === "admin" ? "Administrateur" : "Membre"}</span></td>
            <td class="num" style="white-space:nowrap">
              ${isAdmin && m.profiles.id !== state.user.id ? `
                ${m.role !== "admin" ? `<button class="btn btn-sm btn-ghost promote" data-id="${m.profiles.id}">Promouvoir</button>` : ""}
                <button class="btn btn-sm btn-danger remove" data-id="${m.profiles.id}">Retirer</button>` : ""}
              ${m.profiles.id === state.user.id ? `<button class="btn btn-sm btn-danger leave">Quitter l'entreprise</button>` : ""}
            </td></tr>`).join("")}
        </tbody></table>
      </div>
    </div>`;

  $("#cf").onsubmit = async (e) => {
    e.preventDefault();
    if (!isAdmin) return;
    const f = new FormData(e.target);
    const payload = Object.fromEntries([...f.entries()]
      .filter(([k]) => k !== "price_per_tonne")
      .map(([k, v]) => [k, String(v).trim() || null]));
    if (c.is_delivery) {
      const rate = f.get("price_per_tonne");
      payload.price_per_tonne = rate && rate.trim() !== "" ? Number(rate) : null;
    }
    const { data, error } = await sb.from("companies").update(payload).eq("id", c.id).select().single();
    if (error) return toast(humanError(error), "err");
    state.activeCompany = data;
    const m = state.memberships.find((x) => x.companies.id === c.id);
    if (m) m.companies = data;
    renderCompanyBox();
    toast("Fiche entreprise enregistrée", "ok");
  };

  if (isAdmin) {
    $("#copyCode").onclick = () => {
      navigator.clipboard.writeText($("#inviteCode").value || "");
      toast("Code copié", "ok");
    };
    $("#regenCode").onclick = async () => {
      if (!confirm("L'ancien code ne fonctionnera plus. Continuer ?")) return;
      const { data, error } = await sb.rpc("regenerate_invite_code", { p_company_id: c.id });
      if (error) return toast(humanError(error), "err");
      state.activeCompany.invite_code = data;
      toast("Nouveau code généré", "ok"); route();
    };
    $$(".promote").forEach(b => b.onclick = async () => {
      const { error } = await sb.rpc("promote_member", { p_company_id: c.id, p_profile_id: b.dataset.id });
      if (error) return toast(humanError(error), "err");
      toast("Membre promu administrateur", "ok"); route();
    });
    $$(".remove").forEach(b => b.onclick = async () => {
      if (!confirm("Retirer ce membre de l'entreprise ?")) return;
      const { error } = await sb.rpc("remove_member", { p_company_id: c.id, p_profile_id: b.dataset.id });
      if (error) return toast(humanError(error), "err");
      toast("Membre retiré", "ok"); route();
    });
  }
  const leaveBtn = document.querySelector(".leave");
  if (leaveBtn) leaveBtn.onclick = async () => {
    if (!confirm("Quitter cette entreprise ?")) return;
    const { error } = await sb.rpc("leave_company", { p_company_id: c.id });
    if (error) return toast(humanError(error), "err");
    location.reload();
  };
}

/* ========================================================= STATISTIQUES */
async function viewStats() {
  const cid = state.activeCompany.id;
  const { data, error } = await sb.from("orders")
    .select("total_ht, status, created_at, order_items(product_name, quantity, line_total)")
    .eq("seller_company_id", cid)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const valid = data.filter(o => o.status !== "annulee");

  const byMonth = {};
  valid.forEach(o => {
    const key = new Date(o.created_at).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    byMonth[key] = (byMonth[key] || 0) + Number(o.total_ht);
  });
  const months = Object.entries(byMonth);

  const byProduct = {};
  valid.forEach(o => (o.order_items || []).forEach(i => {
    if (!byProduct[i.product_name]) byProduct[i.product_name] = { qty: 0, total: 0 };
    byProduct[i.product_name].qty += i.quantity;
    byProduct[i.product_name].total += Number(i.line_total);
  }));
  const topProducts = Object.entries(byProduct).sort((a, b) => b[1].qty - a[1].qty).slice(0, 10);

  const totalCA = valid.reduce((s, o) => s + Number(o.total_ht), 0);
  const maxMonth = Math.max(1, ...months.map(([, v]) => v));

  $("#view").innerHTML = head("Statistiques", "Vos ventes sur la place de marché") + `
    <div class="grid stats">
      <div class="stat"><div class="label">Chiffre d'affaires total HT</div><div class="value">${money(totalCA)}</div>
        <div class="sub">${valid.length} commande(s) valide(s)</div></div>
      <div class="stat"><div class="label">Panier moyen</div><div class="value">${money(valid.length ? totalCA / valid.length : 0)}</div></div>
      <div class="stat"><div class="label">Articles différents vendus</div><div class="value">${Object.keys(byProduct).length}</div></div>
    </div>

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
      <div class="card">
        <div class="card-pad" style="padding-bottom:.4rem"><h3>CA par mois</h3></div>
        ${months.length ? `<div class="card-pad" style="display:flex;flex-direction:column;gap:.5rem">
          ${months.map(([m, v]) => `<div>
            <div style="display:flex;justify-content:space-between;font-size:.9rem"><span>${esc(m)}</span><b>${money(v)}</b></div>
            <div style="background:var(--border);border-radius:4px;height:8px;overflow:hidden">
              <div style="background:var(--primary,#3b82f6);height:100%;width:${Math.max((v / maxMonth) * 100, 3)}%"></div>
            </div>
          </div>`).join("")}
        </div>` : `<div class="card-pad"><p class="hint">Aucune vente pour l'instant.</p></div>`}
      </div>

      <div class="card">
        <div class="card-pad" style="padding-bottom:.4rem"><h3>Top articles vendus</h3></div>
        ${topProducts.length ? `<table><thead><tr><th>Article</th><th class="num">Qté vendue</th><th class="num">CA généré</th></tr></thead><tbody>
          ${topProducts.map(([name, v]) => `<tr><td>${esc(name)}</td><td class="num">${v.qty}</td><td class="num">${money(v.total)}</td></tr>`).join("")}
        </tbody></table>` : `<div class="card-pad"><p class="hint">Aucune vente pour l'instant.</p></div>`}
      </div>
    </div>`;
}

/* ============================================================== DEVIS */
async function viewDevis() {
  const cid = state.activeCompany.id;
  const { data, error } = await sb.from("quotes")
    .select("*")
    .or(`buyer_company_id.eq.${cid},seller_company_id.eq.${cid}`)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const names = await companyNames([...new Set(data.flatMap(q => [q.buyer_company_id, q.seller_company_id]))]);
  const QSTATUS = {
    en_attente: { label: "En attente de réponse", cls: "badge-warn" },
    repondu:    { label: "Réponse reçue", cls: "badge-info" },
    accepte:    { label: "Accepté", cls: "badge-ok" },
    refuse:     { label: "Refusé", cls: "badge-danger" },
  };

  $("#view").innerHTML = head("Devis", "Demandes de prix envoyées et reçues") +
    (data.length ? data.map(q => {
      const sens = q.buyer_company_id === cid ? "achat" : "vente";
      const other = sens === "achat" ? q.seller_company_id : q.buyer_company_id;
      return `<div class="card" style="margin-bottom:1rem">
        <div class="card-pad">
          <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:.5rem;align-items:center">
            <div>
              <b>${sens === "achat" ? "📥 Demande envoyée à" : "📤 Demande reçue de"} ${esc(names[other] || "—")}</b>
              <span class="badge ${QSTATUS[q.status]?.cls || ""}" style="margin-left:.5rem">${QSTATUS[q.status]?.label || q.status}</span>
              <div class="hint">${dateFR(q.created_at)}</div>
            </div>
          </div>
          <div class="hint" style="margin-top:.5rem">Articles : ${(q.items || []).map(i => `${esc(i.product_name)} × ${i.quantity}`).join(", ")}</div>
          ${q.message ? `<div class="hint">📝 ${esc(q.message)}</div>` : ""}
          ${q.proposed_price != null ? `<div style="margin-top:.5rem">💰 Prix proposé : <b>${money(q.proposed_price)}</b></div>` : ""}
          ${q.seller_message ? `<div class="hint">💬 ${esc(q.seller_message)}</div>` : ""}
          <div style="display:flex;gap:.5rem;margin-top:.6rem;flex-wrap:wrap">
            ${sens === "vente" && q.status === "en_attente" ? `<button class="btn btn-sm btn-primary respond" data-id="${q.id}">Répondre</button>` : ""}
            ${sens === "achat" && q.status === "repondu" ? `
              <button class="btn btn-sm btn-primary accept" data-id="${q.id}">Accepter</button>
              <button class="btn btn-sm btn-danger refuse" data-id="${q.id}">Refuser</button>` : ""}
          </div>
        </div>
      </div>`;
    }).join("") : empty("📋", "Aucun devis", "Demandez un devis depuis le catalogue général pour lancer une négociation."));

  $$(".respond").forEach(b => b.onclick = () => {
    openModal("Répondre au devis", `
      <form id="rf">
        <div class="field"><label>Prix proposé (€ HT) *</label><input name="price" type="number" step="0.01" min="0" required></div>
        <div class="field"><label>Message</label><textarea name="message" placeholder="Conditions, délai, remarques…"></textarea></div>
        <div style="display:flex;gap:.6rem;justify-content:flex-end">
          <button type="button" class="btn btn-ghost" id="rfCancel">Annuler</button>
          <button type="submit" class="btn btn-primary">Envoyer</button>
        </div>
      </form>`);
    $("#rfCancel").onclick = closeModal;
    $("#rf").onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const { error } = await sb.rpc("respond_quote", { p_quote_id: b.dataset.id, p_proposed_price: Number(f.get("price")), p_seller_message: f.get("message").trim() || null });
      if (error) return toast(humanError(error), "err");
      closeModal(); toast("Réponse envoyée", "ok"); route();
    };
  });
  $$(".accept").forEach(b => b.onclick = async () => {
    const { error } = await sb.rpc("set_quote_status", { p_quote_id: b.dataset.id, p_status: "accepte" });
    if (error) return toast(humanError(error), "err");
    toast("Devis accepté", "ok"); route();
  });
  $$(".refuse").forEach(b => b.onclick = async () => {
    const { error } = await sb.rpc("set_quote_status", { p_quote_id: b.dataset.id, p_status: "refuse" });
    if (error) return toast(humanError(error), "err");
    toast("Devis refusé", "ok"); route();
  });
}

/* ========================================================= ACTUALITÉS */
async function viewAnnouncements() {
  const { data, error } = await sb.from("announcements").select("*").order("created_at", { ascending: false }).limit(50);
  if (error) throw error;

  const cids = [...new Set(data.map(a => a.company_id).filter(Boolean))];
  const names = await companyNames(cids);

  const canPublishCompany = state.activeCompany && state.activeRole === "admin";
  const canPublishPlatform = state.profile.is_staff;

  $("#view").innerHTML = head("Actualités", "Ce qu'il se passe sur la place de marché",
    `${canPublishPlatform ? `<button class="btn btn-primary" id="btnNewsPlatform">+ Actualité plateforme</button>` : ""}
     ${canPublishCompany ? `<button class="btn btn-ghost" id="btnNewsCompany">+ Actualité de mon entreprise</button>` : ""}`) +
    (data.length ? data.map(a => `
      <div class="card" style="margin-bottom:1rem">
        <div class="card-pad">
          <div style="display:flex;justify-content:space-between;gap:.5rem;align-items:start">
            <div>
              <b>${a.company_id ? "🏢 " + esc(names[a.company_id] || "Entreprise") : "📢 Plateforme"}</b>
              <div class="hint">${dateFR(a.created_at)}</div>
            </div>
            ${(state.profile.is_staff || (a.company_id && state.activeCompany?.id === a.company_id && state.activeRole === "admin")) ? `<button class="btn btn-sm btn-danger delAnn" data-id="${a.id}">Suppr.</button>` : ""}
          </div>
          <h3 style="margin:.4rem 0">${esc(a.title)}</h3>
          ${a.image_url ? `<img src="${esc(a.image_url)}" alt="" style="max-width:100%;border-radius:8px;margin-bottom:.5rem">` : ""}
          ${a.body ? `<p>${esc(a.body)}</p>` : ""}
        </div>
      </div>`).join("") : empty("📰", "Aucune actualité pour le moment"));

  if (canPublishPlatform) $("#btnNewsPlatform").onclick = () => announcementForm(null);
  if (canPublishCompany) $("#btnNewsCompany").onclick = () => announcementForm(state.activeCompany.id);
  $$(".delAnn").forEach(b => b.onclick = async () => {
    if (!confirm("Supprimer cette actualité ?")) return;
    const { error } = await sb.rpc("delete_announcement", { p_id: b.dataset.id });
    if (error) return toast(humanError(error), "err");
    toast("Actualité supprimée", "ok"); route();
  });
}

function announcementForm(companyId) {
  openModal(companyId ? "Actualité de mon entreprise" : "Actualité plateforme", `
    <form id="af">
      <div class="field"><label>Titre *</label><input name="title" required></div>
      <div class="field"><label>Image (URL, facultatif)</label><input name="image_url" type="url" placeholder="https://…"></div>
      <div class="field"><label>Message</label><textarea name="body"></textarea></div>
      <div style="display:flex;gap:.6rem;justify-content:flex-end">
        <button type="button" class="btn btn-ghost" id="afCancel">Annuler</button>
        <button type="submit" class="btn btn-primary">Publier</button>
      </div>
    </form>`);
  $("#afCancel").onclick = closeModal;
  $("#af").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await sb.rpc("create_announcement", { p_title: f.get("title").trim(), p_body: f.get("body").trim() || null, p_company_id: companyId, p_image_url: f.get("image_url").trim() || null });
    if (error) return toast(humanError(error), "err");
    closeModal(); toast("Actualité publiée", "ok"); route();
  };
}

/* ======================================================= JOURNAL STAFF */
async function viewAuditLog() {
  if (!state.profile.is_staff) { $("#view").innerHTML = empty("⛔", "Accès réservé au staff"); return; }
  const { data, error } = await sb.from("admin_audit_log").select("*").order("created_at", { ascending: false }).limit(100);
  if (error) throw error;

  const actorIds = [...new Set(data.map(l => l.actor_id).filter(Boolean))];
  let actorNames = {};
  if (actorIds.length) {
    const { data: profs } = await sb.from("profiles").select("id, full_name, discord_username").in("id", actorIds);
    actorNames = Object.fromEntries((profs || []).map(p => [p.id, p.full_name || p.discord_username || p.id]));
  }

  const ACTION_LABELS = {
    create_company: "Création entreprise", update_company: "Modification entreprise", delete_company: "Suppression entreprise",
    activate_company: "Activation entreprise", deactivate_company: "Désactivation entreprise",
    attach_profile: "Rattachement membre", remove_member: "Retrait accès membre",
    delete_order: "Suppression commande", grant_staff: "Attribution staff", revoke_staff: "Retrait staff",
  };

  $("#view").innerHTML = head("Journal d'activité staff", "Historique des actions de modération (100 dernières)") +
    (data.length ? `<div class="card"><table><thead><tr><th>Quand</th><th>Qui</th><th>Action</th><th>Détails</th></tr></thead><tbody>
      ${data.map(l => `<tr>
        <td class="hint">${dateFR(l.created_at)}</td>
        <td>${esc(actorNames[l.actor_id] || "—")}</td>
        <td>${esc(ACTION_LABELS[l.action] || l.action)}</td>
        <td class="hint">${esc(JSON.stringify(l.details || {}))}</td>
      </tr>`).join("")}
    </tbody></table></div>` : empty("🗒️", "Aucune action enregistrée pour l'instant"));
}

/* ========================================================== RECHERCHE */
async function viewSearch() {
  const q = searchQuery.trim();
  if (!q) { $("#view").innerHTML = empty("🔍", "Tapez une recherche dans la barre latérale"); return; }

  const [{ data: products }, { data: companies }] = await Promise.all([
    sb.from("catalog").select("*").eq("is_active", true).neq("company_id", state.activeCompany?.id || "")
      .or(`name.ilike.%${q}%,sku.ilike.%${q}%,category.ilike.%${q}%`).limit(30),
    sb.from("companies").select("*").ilike("name", `%${q}%`).eq("is_active", true).limit(20),
  ]);

  $("#view").innerHTML = head("Résultats de recherche", `Pour « ${q} »`) +
    `<h3>🏢 Entreprises (${companies?.length || 0})</h3>` +
    (companies && companies.length ? `<div class="card" style="margin-bottom:1.2rem"><table><thead><tr><th>Nom</th><th>Ville</th><th>Secteur</th></tr></thead><tbody>
      ${companies.map(c => `<tr><td>${c.logo_url ? `<img src="${esc(c.logo_url)}" alt="" style="height:16px;vertical-align:middle;border-radius:3px;margin-right:.3rem">` : ""}${esc(c.name)}</td><td>${esc(c.city || "—")}</td><td>${esc(c.sector || "—")}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="hint" style="margin-bottom:1.2rem">Aucune entreprise trouvée.</p>`) +
    `<h3>📦 Articles (${products?.length || 0})</h3>` +
    `<div class="grid grid-products">${products && products.length ? products.map(p => productCard(p)).join("") : ""}</div>` +
    (!products || !products.length ? `<p class="hint">Aucun article trouvé.</p>` : "");

  $$(".grid-products .add").forEach((btn) => {
    btn.onclick = () => {
      const p = products.find((x) => x.id === btn.dataset.id);
      const input = btn.parentElement.querySelector("input");
      addToCart(p, Math.max(parseInt(input.value, 10) || p.min_qty, p.min_qty));
    };
  });
  $$(".grid-products .quote").forEach((btn) => {
    btn.onclick = () => quoteForm(products.find((x) => x.id === btn.dataset.id));
  });
}

/* ============================================================= STAFF */
async function viewStaff() {
  if (!state.profile.is_staff) {
    $("#view").innerHTML = empty("⛔", "Accès réservé au staff");
    return;
  }

  const [{ data: companies, error: e1 }, { data: counts }, { data: allProfiles }] = await Promise.all([
    sb.from("companies").select("*").order("created_at", { ascending: false }),
    sb.rpc("admin_company_counts"),
    sb.rpc("admin_list_all_profiles"),
  ]);
  if (e1) throw e1;

  const countMap = Object.fromEntries((counts || []).map(c => [c.company_id, c]));
  const attachable = (allProfiles || []).filter(p => Number(p.company_count) < MAX_COMPANIES_PER_USER);

  $("#view").innerHTML = head("Console staff", "Créez et gérez toutes les entreprises sans y consommer de place",
    `<button class="btn btn-primary" id="btnNewCo">+ Nouvelle entreprise</button>`) + `

    <div class="card" style="margin-bottom:1.2rem">
      <div class="card-pad" style="padding-bottom:.4rem"><h3>Entreprises (${companies.length})</h3></div>
      ${companies.length ? `<table><thead><tr><th>Nom</th><th>Ville</th><th class="num">Membres</th><th>Code</th><th>État</th><th></th></tr></thead>
      <tbody>${companies.map(c => {
        const cnt = countMap[c.id] || { member_count: 0 };
        return `<tr>
          <td><b>${c.logo_url ? `<img src="${esc(c.logo_url)}" alt="" style="height:18px;vertical-align:middle;border-radius:3px;margin-right:.3rem">` : ""}${esc(c.name)}</b><div class="hint">${esc(c.sector || "—")}</div></td>
          <td>${esc(c.city || "—")}</td>
          <td class="num">${cnt.member_count}/${c.max_members}</td>
          <td><code>${esc(c.invite_code || "—")}</code></td>
          <td><span class="badge ${c.is_active ? "badge-ok" : "badge-danger"}">${c.is_active ? "Active" : "Désactivée"}</span></td>
          <td class="num" style="white-space:nowrap">
            <button class="btn btn-sm btn-ghost viewco" data-id="${c.id}" data-name="${esc(c.name)}">👁 Voir</button>
            <button class="btn btn-sm btn-ghost editco" data-id="${c.id}">Modifier</button>
            <button class="btn btn-sm btn-ghost regenco" data-id="${c.id}">Régén. code</button>
            <button class="btn btn-sm btn-ghost toggleco" data-id="${c.id}" data-active="${c.is_active}">${c.is_active ? "Désactiver" : "Activer"}</button>
            <button class="btn btn-sm btn-danger delco" data-id="${c.id}">Suppr.</button>
          </td></tr>`;
      }).join("")}</tbody></table>` : `<div class="card-pad"><p class="hint">Aucune entreprise créée pour l'instant.</p></div>`}
    </div>

    <div class="card">
      <div class="card-pad" style="padding-bottom:.4rem"><h3>Rattacher un compte à une entreprise</h3>
        <p class="hint" style="margin-top:.2rem">Comptes pouvant encore rejoindre une entreprise (moins de ${MAX_COMPANIES_PER_USER})</p></div>
      ${attachable.length ? `<table><thead><tr><th>Discord</th><th class="num">Entreprises</th><th>Rattacher à</th><th></th></tr></thead>
      <tbody>${attachable.map(p => `<tr>
        <td>${esc(p.full_name || p.discord_username || p.id)}</td>
        <td class="num">${p.company_count}/${MAX_COMPANIES_PER_USER}</td>
        <td><select class="attachSelect" data-id="${p.id}"><option value="">Choisir une entreprise…</option>
          ${companies.filter(c => c.is_active).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></td>
        <td><button class="btn btn-sm btn-primary attachBtn" data-id="${p.id}">Attacher</button></td>
      </tr>`).join("")}</tbody></table>` : `<div class="card-pad"><p class="hint">Tous les comptes ont atteint la limite.</p></div>`}
    </div>`;

  $("#btnNewCo").onclick = () => companyForm(null);
  $$(".viewco").forEach(b => b.onclick = () => companyPanel(b.dataset.id, b.dataset.name));
  $$(".editco").forEach(b => b.onclick = () => companyForm(companies.find(c => c.id === b.dataset.id)));
  $$(".regenco").forEach(b => b.onclick = async () => {
    const { data, error } = await sb.rpc("admin_regenerate_code", { p_company_id: b.dataset.id });
    if (error) return toast(humanError(error), "err");
    toast("Nouveau code : " + data, "ok"); route();
  });
  $$(".toggleco").forEach(b => b.onclick = async () => {
    const { error } = await sb.rpc("admin_set_active", { p_company_id: b.dataset.id, p_active: b.dataset.active !== "true" });
    if (error) return toast(humanError(error), "err");
    toast("État mis à jour", "ok"); route();
  });
  $$(".delco").forEach(b => b.onclick = async () => {
    if (!confirm("Supprimer définitivement cette entreprise ?")) return;
    let { error } = await sb.rpc("admin_delete_company", { p_company_id: b.dataset.id, p_force: false });
    if (error && /commandes existent/i.test(error.message || "")) {
      if (!confirm("Cette entreprise a des commandes. Forcer la suppression va aussi supprimer ces commandes définitivement. Continuer ?")) return;
      ({ error } = await sb.rpc("admin_delete_company", { p_company_id: b.dataset.id, p_force: true }));
    }
    if (error) return toast(humanError(error), "err");
    toast("Entreprise supprimée", "ok"); route();
  });
  $$(".attachBtn").forEach(b => b.onclick = async () => {
    const sel = document.querySelector(`.attachSelect[data-id="${b.dataset.id}"]`);
    if (!sel.value) return toast("Choisissez une entreprise", "err");
    const { error } = await sb.rpc("admin_attach_profile", { p_profile_id: b.dataset.id, p_company_id: sel.value });
    if (error) return toast(humanError(error), "err");
    toast("Compte rattaché", "ok"); route();
  });
}

function companyForm(c) {
  openModal(c ? "Modifier l'entreprise" : "Nouvelle entreprise", `
    <form id="cof">
      <div class="field"><label>Nom *</label><input name="name" required value="${esc(c?.name || "")}"></div>
      <div class="row">
        <div class="field"><label>Secteur</label><input name="sector" value="${esc(c?.sector || "")}"></div>
        <div class="field"><label>Ville</label><input name="city" value="${esc(c?.city || "")}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Pays</label><input name="country" value="${esc(c?.country || "France")}"></div>
        <div class="field"><label>Téléphone</label><input name="phone" value="${esc(c?.phone || "")}"></div>
      </div>
      <div class="field"><label>Présentation</label><textarea name="description">${esc(c?.description || "")}</textarea></div>
      <div class="row">
        <div class="field"><label>Membres max</label><input name="max_members" type="number" min="1" step="1" value="${c?.max_members ?? 5}"></div>
        <div class="field"><label>ID salon Discord (notifications)</label><input name="discord_channel_id" value="${esc(c?.discord_channel_id || "")}"></div>
      </div>
      <div class="row">
        <div class="field"><label>ID serveur Discord (guild)</label><input name="discord_guild_id" value="${esc(c?.discord_guild_id || "")}"></div>
        <div class="field"><label>ID rôle à ping (facultatif)</label><input name="discord_role_id" value="${esc(c?.discord_role_id || "")}"></div>
      </div>
      <div class="field"><label style="display:flex;gap:.5rem;align-items:center;font-size:.95rem;color:var(--text)">
        <input type="checkbox" name="is_delivery" style="width:auto" ${c?.is_delivery ? "checked" : ""}> Entreprise de livraison (ex: Post OP)</label></div>
      <div class="field"><label>Tarif à la tonne (€ / 1000 kg)</label><input name="price_per_tonne" type="number" step="0.01" min="0" value="${c?.price_per_tonne ?? ""}" placeholder="ex: 150"></div>
      <div class="field"><label>Logo (URL de l'image)</label><input name="logo_url" type="url" value="${esc(c?.logo_url || "")}" placeholder="https://…">
        ${c?.logo_url ? `<img src="${esc(c.logo_url)}" alt="" style="height:36px;margin-top:.4rem;border-radius:6px">` : ""}</div>
      <div style="display:flex;gap:.6rem;justify-content:flex-end">
        <button type="button" class="btn btn-ghost" id="cofCancel">Annuler</button>
        <button type="submit" class="btn btn-primary">${c ? "Enregistrer" : "Créer"}</button>
      </div>
    </form>`);

  $("#cofCancel").onclick = closeModal;
  $("#cof").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const payload = {
      p_name: f.get("name").trim(),
      p_sector: f.get("sector").trim() || null,
      p_city: f.get("city").trim() || null,
      p_country: f.get("country").trim() || "France",
      p_phone: f.get("phone").trim() || null,
      p_description: f.get("description").trim() || null,
      p_max_members: Math.max(parseInt(f.get("max_members"), 10) || 5, 1),
      p_discord_channel_id: f.get("discord_channel_id").trim() || null,
      p_is_delivery: f.get("is_delivery") === "on",
      p_price_per_tonne: f.get("price_per_tonne").trim() === "" ? null : Number(f.get("price_per_tonne")),
      p_logo_url: f.get("logo_url").trim() || null,
      p_discord_guild_id: f.get("discord_guild_id").trim() || null,
      p_discord_role_id: f.get("discord_role_id").trim() || null,
    };
    let error;
    if (c) {
      ({ error } = await sb.rpc("admin_update_company", { p_id: c.id, ...payload }));
    } else {
      ({ error } = await sb.rpc("admin_create_company", payload));
    }
    if (error) return toast(humanError(error), "err");
    closeModal(); toast(c ? "Entreprise mise à jour" : "Entreprise créée", "ok"); route();
  };
}

/* ========================================================= LIVRAISONS */
const DELIVERY_STATUS = {
  en_attente: { label: "En attente des fournisseurs", cls: "badge-warn" },
  prete:      { label: "Prête à enlever",              cls: "badge-info" },
  livree:     { label: "Livrée",                        cls: "badge-ok" },
  annulee:    { label: "Annulée",                        cls: "badge-danger" },
};

async function viewDeliveries() {
  if (!state.activeCompany.is_delivery) {
    $("#view").innerHTML = empty("⛔", "Cette entreprise n'est pas une entreprise de livraison");
    return;
  }

  const { data: groups, error } = await sb.from("delivery_groups")
    .select("*, delivery_group_orders(order_id, orders(reference, seller_company_id, buyer_company_id))")
    .eq("delivery_company_id", state.activeCompany.id)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const sellerIds = [...new Set((groups || []).flatMap(g => (g.delivery_group_orders || []).map(o => o.orders?.seller_company_id)))];
  const buyerIds = [...new Set((groups || []).map(g => g.buyer_company_id))];
  const names = await companyNames([...new Set([...sellerIds, ...buyerIds])]);

  $("#view").innerHTML = head("Livraisons", "Regroupements de commandes à livrer") +
    (groups.length ? groups.map(g => `
      <div class="card" style="margin-bottom:1rem">
        <div class="card-pad" style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;align-items:center">
          <div>
            <b>${esc(names[g.buyer_company_id] || "—")}</b>
            <span class="badge ${DELIVERY_STATUS[g.status]?.cls || ""}" style="margin-left:.5rem">${DELIVERY_STATUS[g.status]?.label || g.status}</span>
            <div class="hint">📅 ${g.requested_date ? dateFR(g.requested_date) : "—"} · 🕐 ${esc(g.time_slot || "—")}</div>
            <div class="hint">Fournisseurs : ${(g.delivery_group_orders || []).map(o => esc(names[o.orders?.seller_company_id] || "—")).join(", ")}</div>
          </div>
          <div style="text-align:right">
            <div class="hint">Poids estimé</div><b>${Number(g.total_weight_kg).toFixed(1)} kg</b>
            <div class="hint" style="margin-top:.3rem">Tarif</div><b>${money(g.price_ht)}</b>
          </div>
        </div>
        <div class="card-pad" style="display:flex;gap:.5rem;justify-content:flex-end;flex-wrap:wrap">
          ${g.status === "prete" ? `<button class="btn btn-sm btn-primary setdelstatus" data-id="${g.id}" data-status="livree">Marquer livrée</button>` : ""}
          ${g.status !== "livree" && g.status !== "annulee" ? `<button class="btn btn-sm btn-danger setdelstatus" data-id="${g.id}" data-status="annulee">Annuler</button>` : ""}
        </div>
      </div>`).join("")
      : empty("🚚", "Aucune livraison pour le moment", "Elles apparaîtront ici dès qu'un client choisira la livraison groupée."));

  $$(".setdelstatus").forEach(b => b.onclick = async () => {
    const { error } = await sb.rpc("update_delivery_status", { p_group_id: b.dataset.id, p_status: b.dataset.status });
    if (error) return toast(humanError(error), "err");
    toast("Statut mis à jour", "ok"); route();
  });
}

async function companyPanel(companyId, companyName) {
  openModal(companyName, `<p class="hint">Chargement…</p>`);

  const [{ data: members, error: e1 }, { data: products, error: e2 }, { data: orders, error: e3 }] = await Promise.all([
    sb.rpc("admin_company_members", { p_company_id: companyId }),
    sb.rpc("admin_company_products", { p_company_id: companyId }),
    sb.rpc("admin_company_orders", { p_company_id: companyId }),
  ]);
  if (e1 || e2 || e3) {
    $("#modalContent").innerHTML = `<p class="hint">${esc(humanError(e1 || e2 || e3))}</p>`;
    return;
  }

  function renderMembers() {
    $("#modalContent").innerHTML = `
      <h3 style="margin-top:0">👥 Membres (${members.length})</h3>
      ${members.length ? `<table><thead><tr><th>Nom</th><th>Rôle</th><th></th></tr></thead><tbody>
        ${members.map(m => `<tr><td>${esc(m.full_name || m.discord_username || "—")}</td>
          <td><span class="badge ${m.role === "admin" ? "badge-ok" : ""}">${m.role === "admin" ? "Administrateur" : "Membre"}</span></td>
          <td class="num"><button class="btn btn-sm btn-danger staffRemove" data-id="${m.id}">Retirer l'accès</button></td></tr>`).join("")}
      </tbody></table>` : `<p class="hint">Aucun membre.</p>`}

      <h3>📦 Articles (${products.length})</h3>
      ${products.length ? `<table><thead><tr><th>Article</th><th>Catégorie</th><th class="num">Prix HT</th><th class="num">Stock</th><th>État</th></tr></thead><tbody>
        ${products.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.category || "—")}</td>
          <td class="num">${money(p.price_ht)}</td><td class="num">${p.stock}</td>
          <td><span class="badge ${p.is_active ? "badge-ok" : ""}">${p.is_active ? "En ligne" : "Masqué"}</span></td></tr>`).join("")}
      </tbody></table>` : `<p class="hint">Aucun article.</p>`}

      <h3>🧾 Commandes récentes (${orders.length})</h3>
      ${orders.length ? `<table><thead><tr><th>Réf.</th><th>Type</th><th>Contrepartie</th><th>Statut</th><th class="num">Total HT</th><th></th></tr></thead><tbody>
        ${orders.map(o => `<tr><td>${esc(o.reference)}</td><td>${o.sens === "vente" ? "📤 Vente" : "📥 Achat"}</td>
          <td>${esc(o.other_name || "—")}</td><td><span class="badge ${STATUS[o.status]?.cls || ""}">${STATUS[o.status]?.label || o.status}</span></td>
          <td class="num">${money(o.total_ht)}</td>
          <td class="num"><button class="btn btn-sm btn-danger staffDelOrder" data-id="${o.id}">Suppr.</button></td></tr>`).join("")}
      </tbody></table>` : `<p class="hint">Aucune commande.</p>`}
    `;
    $$(".staffDelOrder").forEach(b => b.onclick = async () => {
      if (!confirm("Supprimer définitivement cette commande ?")) return;
      const { error } = await sb.rpc("admin_delete_order", { p_order_id: b.dataset.id });
      if (error) return toast(humanError(error), "err");
      toast("Commande supprimée", "ok");
      const idx = orders.findIndex(o => o.id === b.dataset.id);
      if (idx > -1) orders.splice(idx, 1);
      renderMembers();
    });
    $$(".staffRemove").forEach(b => b.onclick = async () => {
      if (!confirm("Retirer l'accès de ce membre à cette entreprise ?")) return;
      const { error } = await sb.rpc("admin_remove_member", { p_company_id: companyId, p_profile_id: b.dataset.id });
      if (error) return toast(humanError(error), "err");
      toast("Accès retiré", "ok");
      const idx = members.findIndex(m => m.id === b.dataset.id);
      if (idx > -1) members.splice(idx, 1);
      renderMembers();
    });
  }
  renderMembers();
}
