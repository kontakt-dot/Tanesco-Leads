/**
 * Überschriften-Symbole für die ganze Plattform: Jedes `.eyebrow`-Label bekommt automatisch ein passendes Lucide-Icon
 * (nach Stichwort im Text), so wie im Dashboard (Zeitraum = Kalender, Kategorie = Trichter). Läuft über einen Beobachter,
 * damit auch später gerenderte Bereiche erfasst werden. Labels, die schon ein Icon tragen, bleiben unverändert.
 */
import { Activity, BarChart3, Bot, Cable, CalendarDays, Clock3, CreditCard, DoorOpen, FileText, Filter, Globe, Headphones, KeyRound, Layers3, LayoutDashboard, LifeBuoy, Mail, MessageCircle, Package, PackageCheck, Palette, Phone, Route, Settings2, Share2, ShieldQuestion, Sparkles, Store, Tag, Truck, UserRound, Users, Wand2, createElement, type IconNode } from "lucide";

type IconComponent = IconNode;
const RULES: Array<[RegExp, IconComponent]> = [
  [/zeitraum|termin|frist|kalender/i, CalendarDays],
  [/kategorie|sparte|datenmodell|fachfeld/i, Layers3],
  [/filter|fallsuche/i, Filter],
  [/lead-log|verlauf|protokoll|aktivität|chronik|historie/i, Clock3],
  [/lead-puls|integrationsgesundheit|status|gesundheit/i, Activity],
  [/bestellverteilung|bestellung|auftrag/i, PackageCheck],
  [/lieferkette|kette|routing|verteilung|stop/i, Route],
  [/auslieferung|lieferant|lieferung/i, Truck],
  [/reklamation|service desk|dublette/i, ShieldQuestion],
  [/automatisierung|regel|ablauf|wenn|dann|sonst|aktion/i, Bot],
  [/integration|api|schnittstelle|endpoint|webhook|verbindung/i, Cable],
  [/e-mail|mail|versand|vorlage/i, Mail],
  [/support|hilfe|ki-assistenz|assistent/i, LifeBuoy],
  [/whatsapp|chat|gespräch|nachricht/i, MessageCircle],
  [/telefon|anruf|dialer|kampagne/i, Phone],
  [/rohdaten|import|csv|datei|dokument|export|bericht|nutzungsbedingungen|rechtlich/i, FileText],
  [/haustür|außendienst|vertriebler|agentur|erfassung/i, DoorOpen],
  [/kooperation|partner|affiliate|teilen/i, Share2],
  [/team|mitglieder|gruppe/i, Users],
  [/benutzer|profil|konto|nutzer|käufer|kunde|person|mein bereich/i, UserRound],
  [/tag/i, Tag],
  [/statistik|reporting|analyse|kennzahl|auswertung|übersicht|funnel|verteilung/i, BarChart3],
  [/einstellung|konfiguration|system|zuweisung|ansicht|navigation|menü/i, Settings2],
  [/branding|logo|farbe|design|darstellung/i, Palette],
  [/domain|adresse|website/i, Globe],
  [/zahlung|rechnung|abrechnung|preis|umsatz|abonnement|guthaben/i, CreditCard],
  [/passwort|sicherheit|token|schlüssel|zugang|login/i, KeyRound],
  [/produkt|marktplatz|angebot/i, Store],
  [/callcenter|headset/i, Headphones],
  [/dashboard|overview|operations/i, LayoutDashboard],
  [/builder|spezifikation|neu|anlegen/i, Wand2],
  [/paket|lead/i, Package],
];
const DEFAULT_ICON: IconComponent = Sparkles;
const build = (icon: IconComponent) => { const svg = createElement(icon); svg.setAttribute("class", "eyebrow-icon"); svg.setAttribute("stroke-width", "2"); return svg; };

export function iconFor(label: string): IconComponent { const text = label.trim(); for (const [pattern, Icon] of RULES) if (pattern.test(text)) return Icon; return DEFAULT_ICON; }

/** Startet den Beobachter; gibt eine Stop-Funktion zurück. */
export function startEyebrowIcons(): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
  const apply = () => {
    document.querySelectorAll<HTMLElement>(".eyebrow").forEach((el) => {
      if (el.dataset.iconized || el.querySelector("svg")) { el.dataset.iconized = "1"; return; }
      const label = (el.textContent ?? "").trim(); if (!label) return;
      el.dataset.iconized = "1"; el.classList.add("has-icon");
      const wrap = document.createElement("span"); wrap.className = "eyebrow-icon-wrap"; wrap.setAttribute("aria-hidden", "true"); wrap.append(build(iconFor(label)));
      el.prepend(wrap);
    });
  };
  let timer = 0; const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { try { apply(); } catch { /* Dokument geschlossen */ } }, 60); };
  const observer = new MutationObserver(schedule); observer.observe(document.body, { childList: true, subtree: true }); schedule();
  return () => { observer.disconnect(); window.clearTimeout(timer); };
}
