/* Page publique : connexion et création d'un espace entreprise */
import { sb, configOK, $, toast, humanError, showSetupScreen } from "./common.js";

if (!configOK) showSetupScreen();
else init();

function init() {
  const C = window.CONFIG;
  $("#brandName").textContent = C.APP_NAME || "Grosso";
  if (C.APP_TAGLINE) document.title = `${C.APP_NAME} — ${C.APP_TAGLINE}`;

  const tabLogin  = $("#tabLogin");
  const tabSignup = $("#tabSignup");
  const formLogin = $("#formLogin");
  const formSignup= $("#formSignup");
  const msg       = $("#authMsg");

  // Déjà connecté ? on file vers l'application
  sb.auth.getSession().then(({ data }) => {
    if (data.session) location.replace("app.html");
  });

  const show = (which) => {
    const login = which === "login";
    tabLogin.classList.toggle("active", login);
    tabSignup.classList.toggle("active", !login);
    formLogin.hidden = !login;
    formSignup.hidden = login;
    msg.textContent = "";
  };
  tabLogin.onclick  = () => show("login");
  tabSignup.onclick = () => show("signup");
  if (location.hash === "#inscription") show("signup");

  const busy = (form, on, label) => {
    const b = form.querySelector('button[type="submit"]');
    b.disabled = on;
    b.textContent = on ? "Un instant…" : label;
  };

  formLogin.addEventListener("submit", async (e) => {
    e.preventDefault();
    busy(formLogin, true);
    const { error } = await sb.auth.signInWithPassword({
      email: $("#li-email").value.trim(),
      password: $("#li-pass").value,
    });
    busy(formLogin, false, "Se connecter");
    if (error) { msg.textContent = humanError(error); toast(humanError(error), "err"); return; }
    location.href = "app.html";
  });

  formSignup.addEventListener("submit", async (e) => {
    e.preventDefault();
    busy(formSignup, true);
    const { data, error } = await sb.auth.signUp({
      email: $("#su-email").value.trim(),
      password: $("#su-pass").value,
      options: {
        data: {
          company_name: $("#su-company").value.trim(),
          city: $("#su-city").value.trim(),
          sector: $("#su-sector").value.trim(),
          full_name: $("#su-name").value.trim(),
        },
        emailRedirectTo: location.origin + location.pathname.replace(/index\.html$/, "") + "app.html",
      },
    });
    busy(formSignup, false, "Créer mon espace");

    if (error) { msg.textContent = humanError(error); toast(humanError(error), "err"); return; }

    if (data.session) {
      location.href = "app.html";
    } else {
      msg.textContent = "Compte créé. Ouvrez l'e-mail de confirmation que nous venons de vous envoyer, puis connectez-vous.";
      toast("Compte créé — confirmez votre e-mail", "ok");
      show("login");
    }
  });
}
