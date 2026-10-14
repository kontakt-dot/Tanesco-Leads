export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Ohne gültige Sitzung zeigt der geschützte Bereich die Anmeldemaske; ein Neuladen räumt veraltete Abfragen ab.
export const startLogin = () => {
  if (window.location.pathname !== "/") window.location.assign("/");
  else window.location.reload();
};
