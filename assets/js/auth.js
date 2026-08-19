/* Page publique : connexion via Discord uniquement */
import { sb, configOK, $, toast, humanError, showSetupScreen } from "./common.js";

if (!configOK) showSetupScreen();
else init();

function init() {
  const C = window.CONFIG;
  $("#brandName").textContent = C.APP_NAME || "Grosso";
  if (C.APP_TAGLINE) document.title = `${C.APP_NAME} — ${C.APP_TAGLINE}`;

  const msg = $("#authMsg");

  // Déjà connecté ? on file vers l'application
  sb.auth.getSession().then(({ data }) => {
    if (data.session) location.replace("app.html");
  });

  $("#discordLogin").onclick = async () => {
    const redirectTo = location.origin + location.pathname.replace(/index\.html$/, "") + "app.html";
    const { error } = await sb.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo },
    });
    if (error) {
      msg.textContent = humanError(error);
      toast(humanError(error), "err");
    }
  };
}
