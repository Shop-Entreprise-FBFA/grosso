/* Fonctions et client partagés par toutes les pages */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const C = window.CONFIG || {};

export const configOK =
  !!C.SUPABASE_URL &&
  !!C.SUPABASE_ANON_KEY &&
  !C.SUPABASE_URL.includes("VOTRE-PROJET") &&
  !C.SUPABASE_ANON_KEY.includes("VOTRE_CLE");

export const sb = configOK
  ? createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY)
  : null;

/* ---------- Utilitaires ---------- */
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const money = (n) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: C.CURRENCY || "EUR",
    minimumFractionDigits: 2,
  }).format(Number(n || 0));

export const dateFR = (iso) =>
  new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
  });

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function toast(message, type = "") {
  let box = document.getElementById("toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    document.body.appendChild(box);
  }
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

/* Message d'erreur Supabase traduit en français lisible */
export function humanError(error) {
  const m = (error?.message || String(error) || "").toLowerCase();
  if (m.includes("invalid login")) return "E-mail ou mot de passe incorrect.";
  if (m.includes("already registered")) return "Un compte existe déjà avec cet e-mail.";
  if (m.includes("email not confirmed")) return "Vérifiez votre boîte mail pour confirmer votre adresse.";
  if (m.includes("password should be")) return "Mot de passe trop court (8 caractères minimum).";
  if (m.includes("failed to fetch")) return "Connexion au serveur impossible — vérifiez l'URL Supabase.";
  return error?.message || "Une erreur est survenue.";
}

/* Écran affiché tant que config.js n'est pas rempli */
export function showSetupScreen() {
  document.body.innerHTML = `
    <div class="center-screen">
      <div class="setup card card-pad">
        <h1>Dernière étape : connecter Supabase</h1>
        <p>Le site est en place, il lui manque juste sa base de données.</p>
        <ol>
          <li>Créez un projet gratuit sur <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a></li>
          <li>Dans <b>SQL Editor</b>, collez et exécutez le contenu de <code>supabase/schema.sql</code></li>
          <li>Dans <b>Project Settings → API</b>, copiez <code>Project URL</code> et la clé <code>anon public</code></li>
          <li>Collez-les dans <code>assets/js/config.js</code>, puis poussez sur GitHub</li>
        </ol>
        <pre>window.CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi...",
};</pre>
        <p class="hint">Le guide complet se trouve dans le fichier <code>README.md</code> du dépôt.</p>
      </div>
    </div>`;
}
