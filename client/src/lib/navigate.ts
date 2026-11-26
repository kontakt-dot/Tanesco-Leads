/**
 * Innerhalb der Software auf eine andere Seite wechseln, ohne neu zu laden: Adresse setzen und der Oberfläche Bescheid sagen
 * (die Seitenleiste und die Seiten hören auf „popstate“). Geht das nicht, wird die Adresse normal geladen.
 */
export function openInApp(url: string) {
  try { window.history.pushState(null, "", url); window.dispatchEvent(new PopStateEvent("popstate")); } catch { window.location.assign(url); }
}

/**
 * Adresse der Lead-Seite. Die Leads-Seite liest den Parameter „lead“ – ein Link mit „leadId“ (so stand es bis v376 im Gespräch
 * und bei den Rohdaten) landete nur auf der Liste, ohne den Lead zu öffnen.
 */
export const leadUrl = (publicId: string) => `/?page=Leads&lead=${encodeURIComponent(publicId)}`;
