/* =====================================================================
   Grosso — application (espace entreprise)
   ===================================================================== */
import { sb, configOK, $, $$, money, dateFR, esc, toast, humanError, showSetupScreen } from "./common.js";

if (!configOK) { showSetupScreen(); throw new Error("config"); }

const STATUS = {
  en_attente: { label: "En attente", cls: "badge-warn" },
  confirmee:  { label: "Confirmée",  cls: "badge-info" },
  expediee:   { label: "Expédiée",   cls: "badge-info" },
  livree:     { label: "Livrée",     cls: "badge-ok" },
  annulee:    { label: "Annulée",    cls: "badge-danger" },
};
const UNITS = ["unité", "carton", "palette", "kg", "litre", "lot"];

const state = { user: null, profile: null, company: null, cart: [] };

/* ---------------------------------------------------------------- boot */
(async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.replace("index.html"); return; }
  state.user = session.user;

  const { data: profile, error } = await sb
    .from("profiles")
    .select("*, companies(*)")
    .eq("id", state.user.id)
    .single();

  if (error || !profile) {
    document.body.innerHTML = `<div class="center-screen"><div class="setup card card-pad">
      <h1>Profil introuvable</h1>
      <p>Votre compte existe mais aucune entreprise n'y est rattachée. Cela arrive si le script
      <code>supabase/schema.sql</code> n'a pas été exécuté <b>avant</b> la création du compte.</p>
      <p>Exécutez le script dans Supabase, supprimez l'utilisateur dans <b>Authentication → Users</b>,
      puis recréez votre compte.</p>
      <button class="btn btn-primary" onclick="location.href='index.html'">Retour</button>
    </div></div>`;
    await sb.auth.signOut();
    return;
  }

  state.profile = profile;
  state.company = profile.companies;
  loadCart();

  $("#brandName").textContent = window.CONFIG.APP_NAME || "Grosso";
  $("#whoCompany").textContent = state.company?.name || "Entreprise";
  $("#whoEmail").textContent = state.user.email;
  $("#logout").onclick = async () => { await sb.auth.signOut(); location.replace("index.html"); };
  $("#modalClose").onclick = closeModal;
  $("#modalBg").onclick = (e) => { if (e.target.id === "modalBg") closeModal(); };

  $("#boot").hidden = true;
  $("#app").hidden = false;

  window.addEventListener("hashchange", route);
  refreshCartBadge();
  route();
})();

/* --------------------------------------------------------------- panier */
const cartKey = () => "grosso_cart_" + state.user.id;
function loadCart() { try { state.cart = JSON.parse(localStorage.getItem(cartKey())) || []; } catch { state.cart = []; } }
function saveCart() { localStorage.setItem(cartKey(), JSON.stringify(state.cart)); refreshCartBadge(); }
function refreshCartBadge() {
  const n = state.cart.reduce((s, i) => s + i.qty, 0);
  const b = $("#cartCount");
  b.textContent = n; b.hidden = n === 0;
}
function addToCart(p, qty) {
  const line = state.cart.find((i) => i.product_id === p.id);
  if (line) line.qty += qty;
  else state.cart.push({
    product_id: p.id, name: p.name, price: Number(p.price_ht), unit: p.unit,
    min_qty: p.min_qty, seller_id: p.company_id, seller_name: p.company_name, qty,
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
};

async function route() {
  const name = (location.hash.replace("#", "") || "accueil");
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
  const cid = state.company.id;
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

  $("#view").innerHTML =
    head(`Bonjour, ${state.company.name}`, "Vue d'ensemble de votre activité sur la place de marché") + `
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
    .neq("company_id", state.company.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  catalogCache = data || [];

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
    </div>
    <div id="catalogGrid" class="grid grid-products"></div>`;

  const render = () => {
    const q  = $("#fSearch").value.trim().toLowerCase();
    const c  = $("#fCat").value, co = $("#fCo").value, s = $("#fSort").value;
    let list = catalogCache.filter((p) =>
      (!c || p.category === c) && (!co || p.company_id === co) &&
      (!q || [p.name, p.sku, p.description, p.company_name].join(" ").toLowerCase().includes(q)));
    if (s === "price") list.sort((a, b) => a.price_ht - b.price_ht);
    if (s === "name")  list.sort((a, b) => a.name.localeCompare(b.name));

    $("#catalogGrid").innerHTML = list.length
      ? list.map(productCard).join("")
      : empty("🔍", "Aucun article ne correspond", "Essayez d'élargir votre recherche.");

    $$("#catalogGrid .add").forEach((btn) => {
      btn.onclick = () => {
        const p = catalogCache.find((x) => x.id === btn.dataset.id);
        const input = btn.parentElement.querySelector("input");
        addToCart(p, Math.max(parseInt(input.value, 10) || p.min_qty, p.min_qty));
      };
    });
  };
  ["fSearch", "fCat", "fCo", "fSort"].forEach((id) => { $("#" + id).oninput = render; });
  render();
}

const productCard = (p) => `
  <article class="card product">
    <div class="thumb">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">` : "📦"}</div>
    <div class="body">
      <div class="seller">${esc(p.company_name)}${p.company_city ? " · " + esc(p.company_city) : ""}</div>
      <div class="name">${esc(p.name)}</div>
      <div class="hint">${p.category ? esc(p.category) + " · " : ""}${p.stock > 0 ? p.stock + " en stock" : "stock à confirmer"}</div>
      <div class="price">${money(p.price_ht)} <small>HT / ${esc(p.unit)}</small></div>
      <div class="hint">Minimum : ${p.min_qty} ${esc(p.unit)}</div>
      <div class="actions">
        <input class="qty" type="number" min="${p.min_qty}" step="1" value="${p.min_qty}" aria-label="Quantité">
        <button class="btn btn-primary btn-sm add" data-id="${p.id}" style="flex:1">Ajouter</button>
      </div>
    </div>
  </article>`;

/* ======================================================= MES ARTICLES */
async function viewMyProducts() {
  const { data, error } = await sb.from("products").select("*")
    .eq("company_id", state.company.id).order("created_at", { ascending: false });
  if (error) throw error;

  $("#view").innerHTML =
    head("Mes articles", "Ce que votre entreprise propose aux autres membres",
         `<button class="btn btn-primary" id="btnNew">+ Nouvel article</button>`) +
    (data.length ? `<div class="card"><table>
      <thead><tr><th>Article</th><th>Catégorie</th><th class="num">Prix HT</th><th class="num">Min.</th><th class="num">Stock</th><th>État</th><th></th></tr></thead>
      <tbody>${data.map(p => `<tr>
        <td><b>${esc(p.name)}</b>${p.sku ? `<div class="hint">${esc(p.sku)}</div>` : ""}</td>
        <td>${esc(p.category || "—")}</td>
        <td class="num">${money(p.price_ht)}<div class="hint">/ ${esc(p.unit)}</div></td>
        <td class="num">${p.min_qty}</td>
        <td class="num">${p.stock}</td>
        <td><span class="badge ${p.is_active ? "badge-ok" : ""}">${p.is_active ? "En ligne" : "Masqué"}</span></td>
        <td class="num" style="white-space:nowrap">
          <button class="btn btn-sm btn-ghost edit" data-id="${p.id}">Modifier</button>
          <button class="btn btn-sm btn-danger del" data-id="${p.id}">Suppr.</button>
        </td></tr>`).join("")}</tbody></table></div>`
      : empty("📦", "Aucun article publié", "Ajoutez votre premier article pour apparaître dans le catalogue général."));

  $("#btnNew").onclick = () => productForm(null);
  $$(".edit").forEach(b => b.onclick = () => productForm(data.find(p => p.id === b.dataset.id)));
  $$(".del").forEach(b => b.onclick = async () => {
    if (!confirm("Supprimer définitivement cet article ?")) return;
    const { error } = await sb.from("products").delete().eq("id", b.dataset.id);
    if (error) return toast(humanError(error), "err");
    toast("Article supprimé", "ok"); route();
  });
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
        <div class="field"><label>Quantité minimum</label><input name="min_qty" type="number" min="1" step="1" value="${p?.min_qty ?? 1}"></div>
        <div class="field"><label>Stock disponible</label><input name="stock" type="number" min="0" step="1" value="${p?.stock ?? 0}"></div>
      </div>
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
      company_id: state.company.id,
      name: f.get("name").trim(),
      sku: f.get("sku").trim() || null,
      category: f.get("category").trim() || null,
      description: f.get("description").trim() || null,
      price_ht: Number(f.get("price_ht")),
      unit: f.get("unit"),
      min_qty: Math.max(parseInt(f.get("min_qty"), 10) || 1, 1),
      stock: parseInt(f.get("stock"), 10) || 0,
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

  $("#view").innerHTML = head("Panier", "Une commande distincte est créée pour chaque fournisseur") +
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
    const { error } = await sb.rpc("place_order", { p_seller: sid, p_items: items, p_note: note });
    if (error) { b.disabled = false; b.textContent = "Passer commande"; return toast(humanError(error), "err"); }
    state.cart = state.cart.filter(i => i.seller_id !== sid); saveCart();
    toast("Commande envoyée au fournisseur", "ok");
    location.hash = "#achats";
  });
}

/* ====================================================== COMMANDES ACHAT */
async function viewPurchases() { await ordersView("achat"); }
async function viewSales()     { await ordersView("vente"); }

async function ordersView(sens) {
  const col = sens === "achat" ? "buyer_company_id" : "seller_company_id";
  const other = sens === "achat" ? "seller_company_id" : "buyer_company_id";

  const { data, error } = await sb.from("orders")
    .select("*, order_items(*)").eq(col, state.company.id)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const names = await companyNames(data.map(o => o[other]));

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
}

function statusButtons(o, sens) {
  const B = (s, label, cls = "btn-ghost") =>
    `<button class="btn btn-sm ${cls} setstatus" data-id="${o.id}" data-status="${s}">${label}</button>`;
  if (o.status === "annulee" || o.status === "livree") return `<span class="hint">Commande clôturée</span>`;
  if (sens === "vente") {
    return [
      o.status === "en_attente" ? B("confirmee", "Confirmer", "btn-primary") : "",
      o.status === "confirmee"  ? B("expediee", "Marquer expédiée", "btn-primary") : "",
      o.status === "expediee"   ? B("livree", "Marquer livrée", "btn-primary") : "",
      B("annulee", "Refuser", "btn-danger"),
    ].join("");
  }
  return o.status === "en_attente" ? B("annulee", "Annuler ma commande", "btn-danger")
                                   : `<span class="hint">En cours de traitement par le fournisseur</span>`;
}

/* ========================================================== ENTREPRISE */
async function viewCompany() {
  const c = state.company;
  $("#view").innerHTML = head("Mon entreprise", "Ces informations sont visibles par les autres membres") + `
    <div class="card card-pad" style="max-width:640px">
      <form id="cf">
        <div class="field"><label>Nom de l'entreprise *</label><input name="name" required value="${esc(c.name || "")}"></div>
        <div class="row">
          <div class="field"><label>SIRET</label><input name="siret" value="${esc(c.siret || "")}"></div>
          <div class="field"><label>Secteur d'activité</label><input name="sector" value="${esc(c.sector || "")}"></div>
        </div>
        <div class="row">
          <div class="field"><label>Ville</label><input name="city" value="${esc(c.city || "")}"></div>
          <div class="field"><label>Pays</label><input name="country" value="${esc(c.country || "France")}"></div>
        </div>
        <div class="field"><label>Téléphone</label><input name="phone" value="${esc(c.phone || "")}"></div>
        <div class="field"><label>Présentation</label><textarea name="description" placeholder="Votre activité, vos gammes, vos zones de livraison…">${esc(c.description || "")}</textarea></div>
        <button class="btn btn-primary" type="submit">Enregistrer</button>
      </form>
    </div>`;

  $("#cf").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const payload = Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v).trim() || null]));
    const { data, error } = await sb.from("companies").update(payload).eq("id", c.id).select().single();
    if (error) return toast(humanError(error), "err");
    state.company = data;
    $("#whoCompany").textContent = data.name;
    toast("Fiche entreprise enregistrée", "ok");
  };
}
