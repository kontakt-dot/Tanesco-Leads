/**
 * Verträge: Bausteine, Vorlage, Platzhalter und die HTML-Ansicht – für den Builder (Vorschau), die öffentliche
 * Unterschriften-Seite (Kunde) und die unterschriebene Fassung mit Nachweis. Server und Chat-Build nutzen dieselbe Datei.
 */
import { COMPANY_FOOTER, COMPANY_WEBSITE, TANESCO_LOGO_PATH, newBlockId } from "./email-design";
import { proofEvents } from "./contract-tracking";

export type ContractBlock =
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "bullets"; items: string[] }
  | { id: string; type: "image"; src: string; alt?: string; width?: number; align?: "left" | "center" | "right" } // src: eingebettetes Bild (data:) oder Adresse
  | { id: string; type: "logo"; src?: string | null; height?: number }
  | { id: string; type: "parties" } // Vertragsparteien aus den Werten (Anbieter + Kunde)
  | { id: string; type: "detail"; key: string; label: string; value: string; hint?: string; region?: ContractRegion | null } // Vertragsangabe – füllt der Anbieter im Builder aus (Liefergebiet, Menge, Preis …), im Text als {{key}}
  | { id: string; type: "field"; key: string; label: string; required?: boolean; placeholder?: string } // füllt der Kunde beim Unterschreiben aus (optional)
  | { id: string; type: "date"; label?: string; mode: "unterschrift" | "fest"; value?: string | null }
  | { id: string; type: "signature"; party: "kunde" | "anbieter"; label?: string; image?: string | null; signedName?: string | null; signedAt?: string | null } // Anbieter: eigene Unterschrift (Bild, Name, Zeitpunkt) direkt im Builder
  | { id: string; type: "divider" }
  | { id: string; type: "pagebreak" };
export type ContractBlockType = ContractBlock["type"];
export type ContractStatus = "entwurf" | "gesendet" | "angesehen" | "unterschrieben" | "abgelehnt" | "storniert";
export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = { entwurf: "Entwurf", gesendet: "Gesendet", angesehen: "Angesehen", unterschrieben: "Unterschrieben", abgelehnt: "Abgelehnt", storniert: "Storniert" };
export type ContractEventKind = "erstellt" | "geaendert" | "gesendet" | "erinnert" | "angesehen" | "unterschrieben" | "abgelehnt" | "storniert" | "mail_geoeffnet" | "pdf_geladen";
export const CONTRACT_EVENT_LABEL: Record<ContractEventKind, string> = { erstellt: "Erstellt", geaendert: "Geändert", gesendet: "Zur Unterschrift gesendet", erinnert: "Erinnerung gesendet", angesehen: "Vertrag geöffnet", unterschrieben: "Elektronisch unterschrieben", abgelehnt: "Abgelehnt", storniert: "Storniert", mail_geoeffnet: "E-Mail geöffnet", pdf_geladen: "PDF heruntergeladen" };
/** Werte für Platzhalter: {{firma}}, {{name}}, {{email}}, {{strasse}}, {{plzOrt}}, {{anbieterFirma}}, {{anbieterAdresse}}, {{anbieterVertreter}}, {{datum}}, {{titel}} – plus die Vertragsangaben des Anbieters und die Felder des Kunden ({{key}}). */
export type ContractValues = Record<string, string>;
export type ContractSignature = { name: string; image: string | null; signedAt: Date | string; ip?: string | null; userAgent?: string | null; documentHash?: string | null; signedHash?: string | null };
export type ContractEventView = { kind: ContractEventKind; note?: string | null; ip?: string | null; createdAt: Date | string; userAgent?: string | null; /** Verlauf beim Kunden: wie die Seite erreicht wurde, wie lange gelesen (Sekunden), wie weit (0–100 %) */ source?: string | null; seconds?: number | null; depth?: number | null };
export type ContractDesign = { primaryColor?: string; logoUrl?: string | null; anbieterUnterschrift?: string | null /* eingebettetes Bild der eigenen Unterschrift */ };
export const DEFAULT_CONTRACT_DESIGN: Required<Pick<ContractDesign, "primaryColor">> & ContractDesign = { primaryColor: "#bc001d", logoUrl: TANESCO_LOGO_PATH, anbieterUnterschrift: null };

export const CONTRACT_BLOCK_TYPES: Array<{ type: ContractBlockType; label: string; hint: string }> = [
  { type: "heading", label: "Überschrift", hint: "Abschnittstitel, z. B. „§ 1 Vertragsgegenstand“" },
  { type: "text", label: "Text", hint: "Absätze mit Platzhaltern wie {{firma}} oder {{datum}}" },
  { type: "bullets", label: "Aufzählung", hint: "Punkte, z. B. Leistungen oder Pflichten" },
  { type: "parties", label: "Vertragsparteien", hint: "Anbieter und Kunde mit Anschrift – aus den Vertragsdaten" },
  { type: "detail", label: "Vertragsangabe", hint: "Angabe, die du selbst ausfüllst – z. B. Liefergebiet, Menge oder Preis; im Text als {{schlüssel}} nutzbar" },
  { type: "field", label: "Feld für den Kunden", hint: "Nur wenn der Kunde selbst etwas eintragen soll, z. B. seine USt-ID – beim Unterschreiben" },
  { type: "date", label: "Datum", hint: "Datum der Unterschrift (automatisch) oder ein festes Datum" },
  { type: "signature", label: "Unterschrift", hint: "Unterschriftsfeld für den Kunden oder den Anbieter" },
  { type: "logo", label: "Logo", hint: "Dein Logo oben im Vertrag" },
  { type: "image", label: "Bild", hint: "Ein Bild, z. B. Ablaufgrafik oder Stempel" },
  { type: "divider", label: "Trennlinie", hint: "Feine Linie zwischen Abschnitten" },
  { type: "pagebreak", label: "Seitenumbruch", hint: "Neue Seite im PDF und beim Drucken" },
];

export const newContractBlock = (type: ContractBlockType): ContractBlock => {
  const id = newBlockId();
  switch (type) {
    case "heading": return { id, type, text: "Neuer Abschnitt" };
    case "text": return { id, type, text: "Text des Abschnitts …" };
    case "bullets": return { id, type, items: ["Erster Punkt", "Zweiter Punkt"] };
    case "image": return { id, type, src: "", alt: "", width: 60, align: "center" };
    case "logo": return { id, type, src: null, height: 36 };
    case "parties": return { id, type };
    case "detail": return { id, type, key: `angabe_${id.slice(1)}`, label: "Angabe", value: "", hint: "" };
    case "field": return { id, type, key: `feld_${id.slice(1)}`, label: "USt-IdNr.", required: true, placeholder: "" };
    case "date": return { id, type, label: "Datum", mode: "unterschrift", value: null };
    case "signature": return { id, type, party: "kunde", label: "Unterschrift Kunde" };
    case "divider": return { id, type };
    case "pagebreak": return { id, type };
  }
};

/** Liefergebiet: deutschlandweit, einzelne Bundesländer oder PLZ-Gebiete mit Umkreis – wird als lesbarer Text in die Angabe geschrieben. */
export const BUNDESLAENDER = ["Baden-Württemberg", "Bayern", "Berlin", "Brandenburg", "Bremen", "Hamburg", "Hessen", "Mecklenburg-Vorpommern", "Niedersachsen", "Nordrhein-Westfalen", "Rheinland-Pfalz", "Saarland", "Sachsen", "Sachsen-Anhalt", "Schleswig-Holstein", "Thüringen"] as const;
export type ContractRegion = { mode: "deutschland" | "bundeslaender" | "plz"; states?: string[]; plz?: string[]; radiusKm?: number | null };
export const parsePlzList = (text: string) => Array.from(new Set(text.split(/[\s,;]+/).map((part) => part.trim()).filter((part) => /^\d{1,5}$/.test(part)))).slice(0, 200);
export function regionText(region: ContractRegion): string {
  if (region.mode === "deutschland") return "Deutschlandweit";
  if (region.mode === "bundeslaender") { const states = BUNDESLAENDER.filter((name) => region.states?.includes(name)); if (!states.length) return ""; if (states.length === BUNDESLAENDER.length) return "Deutschlandweit (alle Bundesländer)"; return `${states.length === 1 ? "Bundesland" : "Bundesländer"}: ${states.join(", ")}`; }
  const plz = region.plz ?? []; if (!plz.length) return "";
  const areas = plz.every((code) => code.length < 5); const list = `${areas ? (plz.length === 1 ? "PLZ-Gebiet" : "PLZ-Gebiete") : "PLZ"} ${plz.join(", ")}`;
  return region.radiusKm ? `${list} – jeweils im Umkreis von ${region.radiusKm} km` : list;
}
/** Schnellauswahl für Vertragsangaben (nach Schlüssel). */
export const DETAIL_PRESETS: Record<string, string[]> = {
  menge: ["10 Leads", "20 Leads", "30 Leads", "50 Leads", "100 Leads"],
  leadart: ["Photovoltaik", "Wärmepumpe", "Photovoltaik und Wärmepumpe", "Photovoltaik mit Speicher"],
  preis: ["49 €", "59 €", "69 €", "79 €", "89 €", "99 €"],
  kennenlernen: ["die ersten 10 Leads sind kostenlos", "die ersten 20 Leads sind kostenlos", "es gibt kein kostenloses Test-Kontingent"],
  abrechnung: ["wöchentlich", "alle 14 Tage", "monatlich"],
  dauer: ["2 Wochen", "4 Wochen", "6 Wochen", "3 Monate"],
  umfang: ["bis zu 10 Leads", "bis zu 20 Leads", "bis zu 50 Leads"],
  beginn: ["mit Unterzeichnung dieser Vereinbarung", "am Ersten des Folgemonats"],
  konditionen: ["alle Leads in der Testphase sind kostenlos", "die ersten 10 Leads kostenlos, danach 49 € je Lead netto", "halber Preis je Lead während der Testphase"],
  danach: ["Fortsetzung nur nach Bestätigung beider Seiten in Textform", "automatische Fortsetzung zum regulären Preis, jederzeit mit 14 Tagen zum Monatsende kündbar", "die Zusammenarbeit endet ohne weitere Pflichten"],
};
export const isRegionDetail = (block: { key: string; label: string }) => block.key === "liefergebiet" || /liefergebiet|region|gebiet/i.test(block.label);
export type ContractStarterKind = "leadliefervertrag" | "testphase" | "leer";
export const CONTRACT_STARTERS: Array<{ kind: ContractStarterKind; label: string; hint: string }> = [
  { kind: "leadliefervertrag", label: "Leadliefervertrag", hint: "Vollständiger Vertrag in einfacher Sprache: was ein Lead ist, Liefergebiet, Menge, Preis, Reklamation, Datenschutz, Haftung, Kündigung – du trägst die Eckdaten ein, der Kunde unterschreibt nur" },
  { kind: "testphase", label: "Testphase", hint: "Vereinbarung für eine Testphase: Leistung, Dauer, Umfang, Konditionen, was danach gilt – mit Datenschutz und Haftung" },
  { kind: "leer", label: "Leerer Vertrag", hint: "Logo, Vertragsparteien, ein Textabschnitt, Datum und Unterschriften – den Rest baust du selbst oder lässt ihn von der KI schreiben" },
];
const detail = (key: string, label: string, hint: string, value = ""): ContractBlock => ({ id: newBlockId(), type: "detail", key, label, value, hint });
const heading = (text: string): ContractBlock => ({ id: newBlockId(), type: "heading", text });
const text = (...paragraphs: string[]): ContractBlock => ({ id: newBlockId(), type: "text", text: paragraphs.join("\n\n") });
const bullets = (...items: string[]): ContractBlock => ({ id: newBlockId(), type: "bullets", items });
/**
 * Regeln, die in jedem Vertrag zwischen Unternehmen gleich lauten – einfach geschrieben und so gefasst, wie sie üblicherweise
 * als wirksam gelten (Haftung bei Vorsatz/grober Fahrlässigkeit und wesentlichen Pflichten bleibt, Textform statt Schriftform,
 * Gerichtsstand nur unter Kaufleuten). Kein Rechtsrat: vor dem Einsatz prüfen (lassen).
 */
export const CONTRACT_CLAUSES = {
  unternehmer: "Der Kunde handelt als Unternehmer (§ 14 BGB) und nicht als Verbraucher.",
  haftung: [
    "(1) Der Anbieter haftet unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei Schäden an Leben, Körper oder Gesundheit und überall dort, wo das Gesetz eine Haftung zwingend vorschreibt.",
    "(2) Bei leichter Fahrlässigkeit haftet der Anbieter nur, wenn er eine wesentliche Pflicht verletzt. Wesentlich ist eine Pflicht, ohne die der Vertrag nicht durchgeführt werden kann und auf deren Einhaltung der Kunde vertrauen darf. Die Haftung ist dann auf den Schaden begrenzt, der bei einem solchen Vertrag typisch und vorhersehbar ist.",
    "(3) Darüber hinaus haftet der Anbieter nicht. Das gilt auch für seine Mitarbeiter und Beauftragten.",
  ],
  elektronisch: (was: "Dieser Vertrag" | "Diese Vereinbarung") => `${was} wird elektronisch geschlossen. Die elektronische Unterschrift des Kunden wird mit Zeitstempel, IP-Adresse und Prüfsumme des Dokuments protokolliert. Zum Nachweis wird auch festgehalten, wann das Dokument geöffnet wird. Beide Seiten erkennen diese Form als verbindlich an.`,
  schluss: (was: "Dieser Vertrag" | "Diese Vereinbarung") => { const dieser = was === "Dieser Vertrag" ? "dieses Vertrags" : "dieser Vereinbarung"; return [
    `(1) ${was} enthält alle Absprachen zu ${was === "Dieser Vertrag" ? "seinem" : "ihrem"} Gegenstand. Geschäftsbedingungen des Kunden gelten nicht – auch dann nicht, wenn der Anbieter ihnen nicht ausdrücklich widerspricht.`,
    "(2) Änderungen und Ergänzungen brauchen die Textform (zum Beispiel E-Mail). Individuelle Absprachen zwischen den Parteien haben Vorrang.",
    `(3) Ist eine Regelung ${dieser} unwirksam, bleibt der Rest gültig. An die Stelle der unwirksamen Regelung tritt das Gesetz.`,
    "(4) Es gilt deutsches Recht. Ist der Kunde Kaufmann, ist der Gerichtsstand der Sitz des Anbieters.",
    `(5) ${CONTRACT_CLAUSES.elektronisch(was)}`,
  ]; },
};
/** Vorlagen – fertige Rahmen, die du im Builder anpasst. Der Kunde füllt nichts aus: alle Eckdaten sind Vertragsangaben des Anbieters. Kein Rechtsrat: Texte vor dem Einsatz prüfen (lassen). */
export function contractStarter(kind: ContractStarterKind = "leadliefervertrag"): { title: string; blocks: ContractBlock[] } {
  if (kind === "leer") return { title: "Neuer Vertrag", blocks: [{ id: newBlockId(), type: "logo", src: null, height: 36 }, { id: newBlockId(), type: "heading", text: "Vertrag" }, { id: newBlockId(), type: "parties" }, { id: newBlockId(), type: "text", text: "Text des Vertrags …" }, { id: newBlockId(), type: "date", label: "Datum", mode: "unterschrift", value: null }, { id: newBlockId(), type: "signature", party: "anbieter", label: "Unterschrift Anbieter" }, { id: newBlockId(), type: "signature", party: "kunde", label: "Unterschrift Kunde" }] };
  if (kind === "testphase") return { title: "Vereinbarung über eine Testphase", blocks: [
    { id: newBlockId(), type: "logo", src: null, height: 36 },
    heading("Vereinbarung über eine Testphase"),
    { id: newBlockId(), type: "parties" },
    heading("§ 1 Gegenstand"),
    text("(1) Der Anbieter stellt dem Kunden für eine begrenzte Zeit folgende Leistung zur Verfügung: {{leistung}}.", "(2) Die Testphase soll zeigen, ob Qualität, Ablauf und Zusammenarbeit passen. Erst danach entscheiden beide Seiten, ob sie dauerhaft zusammenarbeiten.", "(3) Der Anbieter schuldet die vereinbarte Leistung. Er schuldet nicht, dass daraus Aufträge oder ein bestimmter Umsatz entstehen.", `(4) ${CONTRACT_CLAUSES.unternehmer}`),
    detail("leistung", "Leistung", "z. B. Lieferung telefonisch qualifizierter Kundenanfragen (Leads) für Photovoltaik"),
    heading("§ 2 Dauer und Umfang der Testphase"),
    text("(1) Die Testphase beginnt {{beginn}} und dauert {{dauer}}. Sie umfasst {{umfang}}.", "(2) Für die Testphase gilt: {{konditionen}}."),
    detail("beginn", "Beginn", "z. B. mit Unterzeichnung oder am 01.12.2026", "mit Unterzeichnung dieser Vereinbarung"),
    detail("dauer", "Dauer", "z. B. 4 Wochen"),
    detail("umfang", "Umfang", "z. B. bis zu 20 Leads"),
    detail("konditionen", "Konditionen in der Testphase", "z. B. die ersten 10 Leads kostenlos, danach 49 € je Lead netto"),
    heading("§ 3 Nach der Testphase"),
    text("(1) Die Testphase endet von selbst, sobald die vereinbarte Dauer abgelaufen ist. Eine Kündigung ist nicht nötig.", "(2) Nach der Testphase gilt: {{danach}}.", "(3) Ohne eine neue Vereinbarung in Textform entstehen dem Kunden nach der Testphase keine Kosten und keine Pflicht zur Abnahme."),
    detail("danach", "Nach der Testphase", "z. B. Fortsetzung nur nach Bestätigung beider Seiten in Textform, dann 79 € je Lead netto, Kündigung jederzeit mit 14 Tagen zum Monatsende"),
    heading("§ 4 Mitwirkung des Kunden"),
    bullets("Der Kunde bearbeitet die gelieferte Leistung zügig. Übergebene Interessenten ruft er innerhalb von 24 Stunden (an Werktagen) an.", "Der Kunde gibt innerhalb von 7 Tagen eine Rückmeldung zur Qualität, damit der Anbieter nachbessern kann.", "Der Kunde nutzt übergebene Daten nur für die Testphase und gibt sie nicht an Dritte weiter."),
    heading("§ 5 Vergütung und Abrechnung"),
    text("(1) Fallen in der Testphase Kosten an, rechnet der Anbieter sie nach der Lieferung ab. Vorkasse gibt es nicht.", "(2) Alle Preise sind Nettopreise zuzüglich gesetzlicher Umsatzsteuer. Rechnungen sind innerhalb von 14 Tagen nach Zugang ohne Abzug zu zahlen."),
    heading("§ 6 Mängel und Ersatz"),
    text("Liefert der Anbieter in der Testphase Kundenanfragen (Leads), ersetzt er Anfragen mit falscher Telefonnummer oder außerhalb des vereinbarten Gebiets oder schreibt sie gut. Dafür meldet der Kunde sie innerhalb von 7 Tagen nach der Lieferung in Textform und nennt den Grund."),
    heading("§ 7 Datenschutz und Vertraulichkeit"),
    text("(1) Anbieter und Kunde sind jeweils selbst für den Datenschutz verantwortlich (eigene Verantwortliche nach der DSGVO). Der Kunde verarbeitet Daten nicht im Auftrag des Anbieters.", "(2) Übergibt der Anbieter Daten von Interessenten, holt er vorher deren Einwilligung in die Weitergabe und in die Kontaktaufnahme ein und bewahrt den Nachweis auf.", "(3) Der Kunde nutzt die Daten nur für den vereinbarten Zweck. Er informiert die Interessenten beim ersten Kontakt über die Verarbeitung ihrer Daten (Art. 14 DSGVO) und löscht die Daten, sobald er sie nicht mehr braucht und keine gesetzliche Aufbewahrungspflicht besteht. Möchte ein Interessent nicht mehr kontaktiert werden, informieren sich beide Seiten sofort.", "(4) Beide Seiten behandeln den Inhalt dieser Vereinbarung und alle nicht öffentlichen Informationen der anderen Seite vertraulich – auch noch zwei Jahre nach dem Ende der Testphase."),
    heading("§ 8 Haftung"),
    text(...CONTRACT_CLAUSES.haftung),
    heading("§ 9 Schlussbestimmungen"),
    text(...CONTRACT_CLAUSES.schluss("Diese Vereinbarung")),
    { id: newBlockId(), type: "date", label: "Datum", mode: "unterschrift", value: null },
    { id: newBlockId(), type: "signature", party: "anbieter", label: "Unterschrift Anbieter" },
    { id: newBlockId(), type: "signature", party: "kunde", label: "Unterschrift Kunde" },
  ] };
  return { title: "Leadliefervertrag", blocks: [
    { id: newBlockId(), type: "logo", src: null, height: 36 },
    heading("Vertrag über die Lieferung qualifizierter Kundenanfragen (Leads)"),
    { id: newBlockId(), type: "parties" },
    heading("§ 1 Gegenstand des Vertrags"),
    text("(1) Der Anbieter liefert dem Kunden Anfragen von Interessenten (Leads) für {{leadart}}. Der Kunde zahlt für jeden gelieferten Lead den vereinbarten Preis.", "(2) Der Anbieter schuldet die Lieferung der Leads. Er schuldet nicht, dass aus einem Lead ein Auftrag wird – ob der Interessent beim Kunden kauft, hat der Anbieter nicht in der Hand.", `(3) ${CONTRACT_CLAUSES.unternehmer}`),
    heading("§ 2 Was ein Lead ist"),
    text("(1) Ein Lead ist die Anfrage einer Person, die sich für {{leadart}} interessiert und damit einverstanden ist, dass ein Fachbetrieb sie dazu kontaktiert.", "(2) Jeder Lead enthält mindestens den Namen, die Telefonnummer, die Postleitzahl und die Antworten aus der Vorqualifizierung.", "(3) Jeder Lead wird vor der Übergabe in der Regel anhand von zehn Fragen telefonisch vorqualifiziert."),
    heading("§ 3 Leistungen des Anbieters"),
    bullets("Eigene Leadgenerierung über Online-Kampagnen", "Telefonische Vorqualifizierung jedes Interessenten vor der Übergabe", "Exklusive Übergabe: Der Anbieter gibt dieselbe Anfrage an keinen anderen Betrieb weiter", "Einholen der Einwilligung des Interessenten – der Nachweis wird fünf Jahre aufbewahrt und steht auf Anfrage zur Verfügung", "Prüfung von Reklamationen und Ersatz in berechtigten Fällen"),
    heading("§ 4 Liefergebiet, Menge und Übergabe"),
    text("Für die Lieferung gelten diese Eckdaten:"),
    detail("liefergebiet", "Liefergebiet", "z. B. Hessen oder PLZ 60–65"),
    detail("menge", "Menge pro Monat", "z. B. 30 Leads"),
    detail("leadart", "Leadart", "Photovoltaik, Wärmepumpe oder beides"),
    text("(1) Die Menge ist ein Ziel, keine Garantie. Der Anbieter bemüht sich, sie zu erreichen. Liefert er weniger, werden nur die gelieferten Leads berechnet; weitere Ansprüche entstehen daraus nicht.", "(2) Der Anbieter übergibt jeden Lead direkt nach der Vorqualifizierung – per E-Mail, über eine Schnittstelle oder über das vereinbarte System. Ein Lead gilt als geliefert, sobald er dem Kunden auf diesem Weg zugegangen ist.", "(3) Der Kunde kann die Lieferung jederzeit pausieren. Dafür genügt eine Nachricht in Textform (zum Beispiel per E-Mail) mit zwei Werktagen Vorlauf. Leads, die bis dahin geliefert werden, werden berechnet."),
    heading("§ 5 Preis und Abrechnung"),
    text("(1) Der Preis je geliefertem Lead beträgt {{preis}} zuzüglich gesetzlicher Umsatzsteuer. Zum Kennenlernen gilt: {{kennenlernen}}.", "(2) Der Anbieter rechnet {{abrechnung}} über die gelieferten Leads ab. Vorkasse gibt es nicht. Rechnungen sind innerhalb von 14 Tagen nach Zugang ohne Abzug zu zahlen.", "(3) Zahlt der Kunde eine fällige Rechnung trotz Mahnung nicht, darf der Anbieter die Lieferung aussetzen, bis die Rechnung bezahlt ist. Es gelten die gesetzlichen Verzugszinsen und die gesetzliche Verzugspauschale.", "(4) Der Kunde darf nur mit Forderungen aufrechnen, die unbestritten oder rechtskräftig festgestellt sind.", "(5) Der Anbieter kann den Preis für künftige Lieferungen ändern. Er kündigt das mindestens vier Wochen vorher in Textform an. Der Kunde kann den Vertrag dann bis zum Tag der Änderung ohne Frist kündigen."),
    detail("preis", "Preis je Lead (netto)", "z. B. 79 €"),
    detail("kennenlernen", "Zum Kennenlernen", "z. B. die ersten 20 Leads kostenlos", "die ersten 20 Leads sind kostenlos"),
    detail("abrechnung", "Abrechnung", "wöchentlich, alle 14 Tage oder monatlich", "monatlich"),
    heading("§ 6 Pflichten des Kunden"),
    bullets("Der Kunde ruft jeden Interessenten zügig an – möglichst am selben Tag, spätestens innerhalb von 24 Stunden (an Werktagen).", "Erreicht er ihn nicht, versucht er es mindestens dreimal an drei verschiedenen Werktagen und notiert Datum und Uhrzeit.", "Der Kunde nutzt die Leads nur für sein eigenes Angebot zu der Anfrage.", "Der Kunde gibt Leads nicht an Dritte weiter und verkauft sie nicht."),
    text("Gibt der Kunde Leads schuldhaft an Dritte weiter oder verkauft er sie, zahlt er dem Anbieter für jeden betroffenen Lead eine Vertragsstrafe in Höhe des dreifachen Lead-Preises. Der Anbieter kann einen höheren Schaden verlangen, wenn er ihn nachweist; die Vertragsstrafe wird darauf angerechnet."),
    heading("§ 7 Reklamation"),
    text("(1) Der Kunde kann einen Lead nur aus diesen Gründen reklamieren:"),
    bullets("Die Telefonnummer ist falsch oder existiert nicht.", "Der Interessent ist trotz drei dokumentierter Anrufversuche an drei verschiedenen Werktagen nicht erreichbar.", "Die Person erklärt glaubhaft, nie eine Anfrage gestellt zu haben.", "Der Lead liegt außerhalb des vereinbarten Liefergebiets oder passt nicht zur vereinbarten Leadart.", "Der Anbieter hat dieselbe Person mit derselben Anfrage in den letzten 90 Tagen schon einmal an den Kunden geliefert."),
    text("(2) Das ist kein Grund für eine Reklamation: Der Interessent hat nach der Übergabe kein Interesse mehr, entscheidet sich für einen anderen Betrieb oder lehnt das Angebot des Kunden ab.", "(3) Die Reklamation muss innerhalb von 7 Tagen nach der Lieferung in Textform beim Anbieter eingehen und den Grund nennen. Bei „nicht erreichbar“ gehören die Anrufversuche mit Datum und Uhrzeit dazu.", "(4) Der Anbieter prüft die Reklamation innerhalb von fünf Werktagen. Ist sie berechtigt, liefert er einen Ersatz-Lead oder schreibt den Preis gut. Weitere Ansprüche wegen dieses Leads bestehen nicht; die Regeln zur Haftung (§ 9) bleiben unberührt.", "(5) Einen reklamierten Lead bearbeitet der Kunde nicht weiter."),
    heading("§ 8 Datenschutz"),
    text("(1) Anbieter und Kunde sind jeweils selbst für den Datenschutz verantwortlich (eigene Verantwortliche nach der DSGVO). Der Kunde verarbeitet die Daten nicht im Auftrag des Anbieters.", "(2) Der Anbieter holt vor der Übergabe die Einwilligung des Interessenten ein: in die Weitergabe seiner Daten an den Kunden und in die Kontaktaufnahme per Telefon und E-Mail. Er bewahrt den Nachweis fünf Jahre auf und gibt ihn dem Kunden auf Anfrage.", "(3) Der Kunde nutzt die Daten nur, um die Anfrage zu bearbeiten. Er informiert den Interessenten beim ersten Kontakt über die Verarbeitung seiner Daten (Art. 14 DSGVO), schützt die Daten vor fremdem Zugriff und löscht sie, sobald er sie nicht mehr braucht und keine gesetzliche Aufbewahrungspflicht besteht.", "(4) Widerruft ein Interessent seine Einwilligung oder möchte er nicht mehr kontaktiert werden, informieren sich Anbieter und Kunde gegenseitig sofort. Der Kunde kontaktiert den Interessenten dann nicht mehr.", "(5) Verstößt eine Seite schuldhaft gegen diese Pflichten, steht sie dafür selbst ein. Wird die andere Seite deshalb von Dritten oder Behörden in Anspruch genommen, stellt die verantwortliche Seite sie davon frei. Sie trägt auch die angemessenen Kosten der Rechtsverteidigung."),
    heading("§ 9 Haftung"),
    text(...CONTRACT_CLAUSES.haftung),
    heading("§ 10 Laufzeit und Kündigung"),
    text("(1) Der Vertrag beginnt mit der Unterschrift beider Seiten und läuft auf unbestimmte Zeit. Eine Mindestabnahme gibt es nicht.", "(2) Beide Seiten können den Vertrag jederzeit mit einer Frist von 14 Tagen zum Monatsende kündigen.", "(3) Das Recht, aus wichtigem Grund fristlos zu kündigen, bleibt bestehen. Für den Anbieter ist das zum Beispiel der Fall, wenn der Kunde trotz Mahnung länger als 14 Tage nicht zahlt oder Leads an Dritte weitergibt.", "(4) Jede Kündigung braucht die Textform (zum Beispiel E-Mail).", "(5) Leads, die bis zum Vertragsende geliefert werden, bezahlt der Kunde. Die Regeln zu Datenschutz, Vertraulichkeit und Haftung gelten auch nach dem Vertragsende weiter."),
    heading("§ 11 Vertraulichkeit"),
    text("Beide Seiten behandeln den Inhalt dieses Vertrags – besonders Preise und Mengen – und alle nicht öffentlichen Informationen der anderen Seite vertraulich. Das gilt auch noch zwei Jahre nach dem Vertragsende. Ausgenommen sind Auskünfte, zu denen eine Seite gesetzlich verpflichtet ist, und Auskünfte an Berater, die zur Verschwiegenheit verpflichtet sind."),
    heading("§ 12 Schlussbestimmungen"),
    text(...CONTRACT_CLAUSES.schluss("Dieser Vertrag")),
    { id: newBlockId(), type: "date", label: "Datum", mode: "unterschrift", value: null },
    { id: newBlockId(), type: "signature", party: "anbieter", label: "Unterschrift Anbieter" },
    { id: newBlockId(), type: "signature", party: "kunde", label: "Unterschrift Kunde" },
  ] };
}

/** Standardwerte des Anbieters aus der Fußzeile („Firma · Straße · PLZ Ort“). */
export function providerValues(footer?: string | null, website?: string | null): ContractValues {
  const parts = (footer ?? COMPANY_FOOTER).split("·").map((part) => part.trim()).filter(Boolean);
  return { anbieterFirma: parts[0] ?? "Tanesco Digital GbR", anbieterAdresse: parts.slice(1).join(", "), anbieterWebseite: (website ?? COMPANY_WEBSITE).replace(/^https?:\/\//, ""), anbieterVertreter: "" };
}
export const CONTRACT_PLACEHOLDERS = ["{{firma}}", "{{name}}", "{{email}}", "{{strasse}}", "{{plzOrt}}", "{{anbieterFirma}}", "{{anbieterAdresse}}", "{{anbieterVertreter}}", "{{datum}}", "{{titel}}"];

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const formatContractDate = (value: Date | string | null | undefined) => value ? new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
export const formatContractStamp = (value: Date | string | null | undefined) => value ? `${new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Berlin" })} Uhr (Europe/Berlin)` : "";
/** Platzhalter füllen – unbekannte bleiben im Entwurf sichtbar, in der fertigen Fassung leer. */
export function fillContract(text: string, values: ContractValues, keepUnknown = false) {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => (values[key] !== undefined && values[key] !== "" ? values[key] : keepUnknown ? match : "…"));
}
/** Welche Felder der Kunde ausfüllen muss (für Prüfung beim Unterschreiben). */
export const contractFields = (blocks: ContractBlock[]) => blocks.filter((block): block is Extract<ContractBlock, { type: "field" }> => block.type === "field");
/** Vertragsangaben des Anbieters (Liefergebiet, Preis …) – ihre Werte füllen die Platzhalter {{key}} im Text. */
export const contractDetails = (blocks: ContractBlock[]) => blocks.filter((block): block is Extract<ContractBlock, { type: "detail" }> => block.type === "detail");
export const detailValues = (blocks: ContractBlock[]): ContractValues => Object.fromEntries(contractDetails(blocks).filter((block) => block.key && block.value.trim()).map((block) => [block.key, block.value.trim()]));
/** Welche Vertragsangaben noch leer sind (vor dem Senden ausfüllen). */
export const missingDetails = (blocks: ContractBlock[]) => contractDetails(blocks).filter((block) => !block.value.trim()).map((block) => block.label || block.key);
/** Unterschriftsfelder des Anbieters, die noch nicht unterschrieben sind. */
export const unsignedProviderBlocks = (blocks: ContractBlock[]) => blocks.filter((block) => block.type === "signature" && block.party === "anbieter" && !block.image);
/** Eigene Unterschrift entfernen (z. B. bei einer Kopie – dort wird neu unterschrieben). */
export const withoutProviderSignatures = (blocks: ContractBlock[]): ContractBlock[] => blocks.map((block) => block.type === "signature" && block.party === "anbieter" && block.image ? { ...block, image: null, signedName: null, signedAt: null } : block);
export const contractNeedsSignature = (blocks: ContractBlock[]) => blocks.some((block) => block.type === "signature" && block.party === "kunde");
/** Kurze Zusammenfassung für Listen: Anzahl Abschnitte, eigene Angaben, Felder für den Kunden, ob eine Kundenunterschrift drin ist. */
export const contractOutline = (blocks: ContractBlock[]) => ({ sections: blocks.filter((block) => block.type === "heading").length, details: contractDetails(blocks).length, fields: contractFields(blocks).length, signature: contractNeedsSignature(blocks) });

export type ContractRenderOptions = {
  mode: "entwurf" | "unterschreiben" | "unterschrieben" | "abgelehnt" | "storniert";
  values: ContractValues;
  fieldValues?: Record<string, string> | null;
  signature?: ContractSignature | null;
  events?: ContractEventView[] | null;
  design?: ContractDesign | null;
  logoBase?: string | null; // Basis-Adresse für das Standard-Logo (/brand/…)
  token?: string | null; apiBase?: string | null; // Unterschreiben: wohin die Unterschrift geschickt wird
  signerName?: string | null; pdfUrl?: string | null; embedded?: boolean; // embedded: in der App eingebettet (Nachricht statt Neuladen)
  /** Öffentliche Seite: dieser Aufruf wird mitgezählt – die Seite meldet, wie lange gelesen und wie weit gescrollt wurde */
  track?: { viewId: number; url: string } | null;
};

const SIGN_SCRIPT = `
(function(){
  var root=document.getElementById('sign');if(!root)return;var token=root.getAttribute('data-token');var api=root.getAttribute('data-api')||'';var embedded=root.getAttribute('data-embedded')==='1';
  var canvas=document.getElementById('pad');var ctx=canvas.getContext('2d');var drawing=false,last=null,dirty=false;var ratio=window.devicePixelRatio||1;
  function size(){var r=canvas.getBoundingClientRect();canvas.width=r.width*ratio;canvas.height=r.height*ratio;ctx.scale(ratio,ratio);ctx.lineWidth=2.2;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#101828';}
  size();window.addEventListener('resize',function(){var img=canvas.toDataURL();size();var i=new Image();i.onload=function(){ctx.drawImage(i,0,0,canvas.getBoundingClientRect().width,canvas.getBoundingClientRect().height)};i.src=img;});
  function pos(e){var r=canvas.getBoundingClientRect();var t=e.touches?e.touches[0]:e;return {x:t.clientX-r.left,y:t.clientY-r.top};}
  function start(e){drawing=true;last=pos(e);e.preventDefault();}function move(e){if(!drawing)return;var p=pos(e);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();last=p;dirty=true;e.preventDefault();}function end(){drawing=false;}
  canvas.addEventListener('mousedown',start);canvas.addEventListener('mousemove',move);window.addEventListener('mouseup',end);canvas.addEventListener('touchstart',start,{passive:false});canvas.addEventListener('touchmove',move,{passive:false});canvas.addEventListener('touchend',end);
  var mode='zeichnen';document.querySelectorAll('[data-sign-tab]').forEach(function(b){b.addEventListener('click',function(){mode=b.getAttribute('data-sign-tab');document.querySelectorAll('[data-sign-tab]').forEach(function(x){x.classList.toggle('on',x===b)});document.getElementById('pad-wrap').style.display=mode==='zeichnen'?'block':'none';document.getElementById('type-wrap').style.display=mode==='tippen'?'block':'none';});});
  document.getElementById('clear').addEventListener('click',function(){ctx.clearRect(0,0,canvas.width,canvas.height);dirty=false;});
  var typed=document.getElementById('typed');var typedPreview=document.getElementById('typed-preview');if(typed){typed.addEventListener('input',function(){typedPreview.textContent=typed.value||' ';});}
  function typedImage(){var c=document.createElement('canvas');c.width=900;c.height=240;var x=c.getContext('2d');x.fillStyle='#101828';x.font='italic 400 92px "Brush Script MT","Segoe Script","Snell Roundhand",cursive';x.textBaseline='middle';x.fillText(typed.value,30,130);return c.toDataURL('image/png');}
  function msg(text,ok){var m=document.getElementById('sign-msg');m.textContent=text;m.className='sign-msg '+(ok?'ok':'err');m.style.display='block';}
  document.getElementById('submit').addEventListener('click',function(){
    var name=(document.getElementById('signer').value||'').trim();if(name.length<3){msg('Bitte den vollständigen Namen eintragen.',false);return;}
    var fields={};var missing=[];document.querySelectorAll('[data-field]').forEach(function(i){var v=i.value.trim();fields[i.getAttribute('data-field')]=v;if(i.hasAttribute('required')&&!v)missing.push(i.getAttribute('data-label'));});
    if(missing.length){msg('Bitte ausfüllen: '+missing.join(', '),false);return;}
    if(!document.getElementById('consent').checked){msg('Bitte bestätige, dass du den Vertrag gelesen hast und elektronisch unterschreibst.',false);return;}
    var image=null;if(mode==='zeichnen'){if(!dirty){msg('Bitte im Feld unterschreiben (mit Maus oder Finger) – oder auf „Tippen“ wechseln.',false);return;}image=canvas.toDataURL('image/png');}else{if((typed.value||'').trim().length<3){msg('Bitte den Namen als Unterschrift eintippen.',false);return;}image=typedImage();}
    var payload={signerName:name,fields:fields,signatureImage:image,method:mode,consent:true};
    var btn=document.getElementById('submit');btn.disabled=true;btn.textContent='Wird gespeichert …';
    if(embedded&&window.parent&&window.parent!==window){window.parent.postMessage({type:'tanesco:vertrag-unterschrieben',token:token,payload:payload},'*');msg('Unterschrift übermittelt.',true);return;}
    fetch(api+'/api/vertrag/'+token+'/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})}).then(function(x){if(!x.ok){throw new Error(x.j&&x.j.error||'Fehler')}window.location.reload();}).catch(function(e){btn.disabled=false;btn.textContent='Jetzt unterschreiben';msg(e.message||'Das hat nicht geklappt – bitte noch einmal versuchen.',false);});
  });
  var decline=document.getElementById('decline');if(decline){decline.addEventListener('click',function(){var reason=window.prompt('Möchtest du den Vertrag ablehnen? Du kannst einen Grund angeben (optional):');if(reason===null)return;if(embedded&&window.parent&&window.parent!==window){window.parent.postMessage({type:'tanesco:vertrag-abgelehnt',token:token,reason:reason},'*');return;}fetch(api+'/api/vertrag/'+token+'/decline',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reason:reason})}).then(function(){window.location.reload();});});}
})();`;

/** Misst auf der öffentlichen Seite, wie lange der Vertrag sichtbar war und wie weit er gelesen wurde – und meldet es alle paar Sekunden und beim Verlassen. */
const READ_SCRIPT = `
(function(){
  var el=document.getElementById('lesen');if(!el)return;var url=el.getAttribute('data-url');var view=Number(el.getAttribute('data-view'))||0;if(!url||!view)return;
  var seconds=0,depth=0,last=Date.now(),sent='';
  function tick(){var now=Date.now();if(document.visibilityState==='visible'){seconds+=Math.min(2,Math.max(0,(now-last)/1000));}last=now;}
  function measure(){var sheet=document.querySelector('.sheet');if(!sheet)return;var r=sheet.getBoundingClientRect();var d=Math.round(Math.max(0,Math.min(1,(window.innerHeight-r.top)/Math.max(1,r.height)))*100);if(d>depth)depth=d;}
  function send(fin){tick();measure();var body=JSON.stringify({v:view,s:Math.round(seconds),d:depth});if(body===sent)return;sent=body;try{if(fin&&navigator.sendBeacon){navigator.sendBeacon(url,new Blob([body],{type:'application/json'}));}else{fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:body,keepalive:true}).catch(function(){});}}catch(e){}}
  setInterval(tick,1000);window.addEventListener('scroll',measure,{passive:true});window.addEventListener('resize',measure);measure();
  setTimeout(function(){send(false);},5000);setInterval(function(){if(document.visibilityState==='visible')send(false);},15000);
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')send(true);else last=Date.now();});
  window.addEventListener('pagehide',function(){send(true);});
})();`;

/** Die komplette Seite: Vertrag als weißes Blatt, darunter (je nach Modus) das Unterschriftsfeld oder der Nachweis. */
export function renderContractHtml(contract: { title: string; blocks: ContractBlock[] }, options: ContractRenderOptions): string {
  const design = { ...DEFAULT_CONTRACT_DESIGN, ...(options.design ?? {}) }; const accent = design.primaryColor || "#bc001d";
  const signedAt = options.signature?.signedAt ?? null;
  const values: ContractValues = { ...detailValues(contract.blocks), ...options.values, ...(options.fieldValues ?? {}), titel: contract.title, datum: options.values.datum || (signedAt ? formatContractDate(signedAt) : options.mode === "unterschreiben" ? formatContractDate(new Date()) : "") };
  const keepUnknown = options.mode === "entwurf";
  const fill = (text: string) => esc(fillContract(text, values, keepUnknown)).replace(/\n/g, "<br>");
  const logoSrc = (src?: string | null) => { const value = (src ?? design.logoUrl ?? TANESCO_LOGO_PATH) || ""; return value.startsWith("/") ? `${(options.logoBase ?? "").replace(/\/+$/, "")}${value}` : value; };
  const party = (lines: string[]) => lines.filter(Boolean).map((line) => `<div>${esc(line)}</div>`).join("");
  const fieldValue = (key: string) => options.fieldValues?.[key] ?? "";
  const canEdit = options.mode === "unterschreiben";
  const mark = (block: ContractBlock, html: string) => (options.mode === "entwurf" && html ? html.replace(/^<([a-z0-9]+)/i, `<$1 data-b="${esc(block.id)}"`) : html); // Builder: Baustein in der Vorschau finden
  const body = contract.blocks.map((block) => mark(block, (() => {
    switch (block.type) {
      case "heading": return `<h2 class="c-h">${fill(block.text)}</h2>`;
      case "text": return `<div class="c-p">${fillContract(block.text, values, keepUnknown).split(/\n{2,}/).map((part) => `<p>${esc(part).replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
      case "bullets": return `<ul class="c-ul">${block.items.map((item) => `<li>${fill(item)}</li>`).join("")}</ul>`;
      case "image": return block.src ? `<div class="c-img" style="text-align:${block.align ?? "center"}"><img src="${esc(block.src)}" alt="${esc(block.alt ?? "")}" style="width:${Math.min(100, Math.max(10, block.width ?? 60))}%"></div>` : (options.mode === "entwurf" ? `<div class="c-img c-empty">Bild wählen …</div>` : "");
      case "logo": return `<div class="c-logo"><img src="${esc(logoSrc(block.src))}" alt="Logo" style="height:${Math.min(120, Math.max(16, block.height ?? 36))}px"></div>`;
      case "parties": return `<div class="c-parties"><div><span class="c-label">Anbieter</span>${party([values.anbieterFirma, values.anbieterAdresse, values.anbieterVertreter ? `vertreten durch ${values.anbieterVertreter}` : "", values.anbieterWebseite ?? ""])}</div><div><span class="c-label">Kunde</span>${party([values.firma || (keepUnknown ? "{{firma}}" : ""), values.name, values.strasse, values.plzOrt, values.email])}</div></div>`;
      case "detail": return `<div class="c-kv"><span>${esc(block.label)}</span><strong>${block.value.trim() ? esc(block.value.trim()).replace(/\n/g, "<br>") : options.mode === "entwurf" ? `<i class="c-dots">noch eintragen</i>` : "–"}</strong></div>`;
      case "field": return canEdit
        ? `<label class="c-field"><span>${esc(block.label)}${block.required ? " *" : ""}</span><input data-field="${esc(block.key)}" data-label="${esc(block.label)}" ${block.required ? "required" : ""} placeholder="${esc(block.placeholder ?? "")}" value="${esc(fieldValue(block.key))}"></label>`
        : `<div class="c-field is-static"><span>${esc(block.label)}</span><strong>${esc(fieldValue(block.key)) || (options.mode === "entwurf" ? `<i class="c-dots">füllt der Kunde aus</i>` : "–")}</strong></div>`;
      case "date": return `<div class="c-date"><span>${esc(block.label ?? "Datum")}</span><strong>${block.mode === "fest" ? esc(formatContractDate(block.value)) || "–" : (signedAt ? formatContractDate(signedAt) : canEdit ? formatContractDate(new Date()) : `<i class="c-dots">Datum der Unterschrift</i>`)}</strong></div>`;
      case "signature": {
        if (block.party === "anbieter") { const image = block.image || design.anbieterUnterschrift; const who = block.signedName || values.anbieterVertreter; return `<div class="c-sig"><div class="c-sig-box${image ? " is-signed" : options.mode === "entwurf" ? " is-todo" : ""}">${image ? `<img src="${esc(image)}" alt="Unterschrift Anbieter">` : options.mode === "entwurf" ? "Noch nicht unterschrieben" : ""}</div><div class="c-sig-line">${esc(block.label ?? "Unterschrift Anbieter")}${who ? ` · ${esc(who)}` : ""}${values.anbieterFirma ? `, ${esc(values.anbieterFirma)}` : ""}${block.signedAt ? ` · ${formatContractDate(block.signedAt)}` : ""}</div></div>`; }
        if (options.signature) return `<div class="c-sig"><div class="c-sig-box is-signed">${options.signature.image ? `<img src="${esc(options.signature.image)}" alt="Unterschrift">` : ""}</div><div class="c-sig-line">${esc(block.label ?? "Unterschrift Kunde")} · ${esc(options.signature.name)} · ${formatContractStamp(options.signature.signedAt)}</div></div>`;
        if (canEdit) return `<div class="c-sig"><div class="c-sig-box is-here">Unterschrift unten im Feld „Jetzt unterschreiben“</div><div class="c-sig-line">${esc(block.label ?? "Unterschrift Kunde")}</div></div>`;
        return `<div class="c-sig"><div class="c-sig-box"></div><div class="c-sig-line">${esc(block.label ?? "Unterschrift Kunde")}</div></div>`;
      }
      case "divider": return `<hr class="c-hr">`;
      case "pagebreak": return `<div class="c-break"></div>`;
    }
  })())).join("");
  const signPanel = canEdit ? `<section id="sign" class="sign" data-token="${esc(options.token ?? "")}" data-api="${esc(options.apiBase ?? "")}" data-embedded="${options.embedded ? "1" : "0"}">
    <h3>Jetzt unterschreiben</h3>
    <p class="sign-hint">Bitte Felder prüfen, Namen eintragen und im Feld unterschreiben – mit Maus, Finger oder getippt. Die Unterschrift wird mit Datum, Uhrzeit und IP-Adresse protokolliert. Zum Nachweis wird auch festgehalten, wann dieser Vertrag geöffnet wird.</p>
    <label class="sign-name"><span>Vollständiger Name</span><input id="signer" value="${esc(options.signerName ?? values.name ?? "")}" placeholder="Vor- und Nachname"></label>
    <div class="sign-tabs"><button type="button" class="on" data-sign-tab="zeichnen">Zeichnen</button><button type="button" data-sign-tab="tippen">Tippen</button></div>
    <div id="pad-wrap" class="pad-wrap"><canvas id="pad"></canvas><button type="button" id="clear" class="pad-clear">Löschen</button></div>
    <div id="type-wrap" class="type-wrap" style="display:none"><input id="typed" placeholder="Namen als Unterschrift tippen"><div id="typed-preview" class="typed-preview"> </div></div>
    <label class="sign-consent"><input type="checkbox" id="consent"> Ich habe den Vertrag gelesen, bin mit dem Inhalt einverstanden und unterschreibe ihn elektronisch.</label>
    <div id="sign-msg" class="sign-msg" style="display:none"></div>
    <div class="sign-actions"><button type="button" id="submit" class="sign-submit">Jetzt unterschreiben</button><button type="button" id="decline" class="sign-decline">Ablehnen</button></div>
  </section>` : "";
  const proof = options.signature && options.mode === "unterschrieben" ? `<section class="proof"><h3>Nachweis der elektronischen Unterschrift</h3><dl>
    <dt>Unterschrieben von</dt><dd>${esc(options.signature.name)}</dd>
    <dt>Zeitpunkt</dt><dd>${formatContractStamp(options.signature.signedAt)}</dd>
    ${options.signature.ip ? `<dt>IP-Adresse</dt><dd>${esc(options.signature.ip)}</dd>` : ""}
    ${options.signature.userAgent ? `<dt>Gerät / Browser</dt><dd>${esc(options.signature.userAgent.slice(0, 160))}</dd>` : ""}
    ${options.signature.documentHash ? `<dt>Prüfsumme Dokument (SHA-256)</dt><dd class="mono">${esc(options.signature.documentHash)}</dd>` : ""}
    ${options.signature.signedHash ? `<dt>Prüfsumme Unterschrift (SHA-256)</dt><dd class="mono">${esc(options.signature.signedHash)}</dd>` : ""}
  </dl>${options.events?.length ? `<ol class="proof-log">${proofEvents(options.events).map((event) => `<li><span>${formatContractStamp(event.createdAt)}</span> ${esc(CONTRACT_EVENT_LABEL[event.kind] ?? event.kind)}${event.note ? ` – ${esc(event.note)}` : ""}${event.ip ? ` <i>(${esc(event.ip)})</i>` : ""}</li>`).join("")}</ol>` : ""}${options.pdfUrl ? `<p class="proof-actions"><a class="btn" href="${esc(options.pdfUrl)}">PDF herunterladen</a> <button type="button" class="btn ghost" onclick="window.print()">Drucken</button></p>` : `<p class="proof-actions"><button type="button" class="btn ghost" onclick="window.print()">Drucken / als PDF sichern</button></p>`}</section>` : "";
  const notice = options.mode === "abgelehnt" ? `<section class="proof is-warn"><h3>Dieser Vertrag wurde abgelehnt.</h3><p>Bei Fragen antworte einfach auf die E-Mail, mit der du den Vertrag bekommen hast.</p></section>` : options.mode === "storniert" ? `<section class="proof is-warn"><h3>Dieser Vertrag wurde zurückgezogen.</h3><p>Der Anbieter hat den Vertrag storniert – er kann nicht mehr unterschrieben werden.</p></section>` : "";
  const badge = options.mode === "unterschrieben" ? `<div class="topbar is-ok">Elektronisch unterschrieben am ${formatContractDate(signedAt)}</div>` : options.mode === "unterschreiben" ? `<div class="topbar">Bitte prüfen und unten unterschreiben</div>` : "";
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(contract.title)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"><style>
  :root{--accent:${accent};--ink:#101828;--muted:#667085;--line:#e4e7ec}
  *{box-sizing:border-box}body{margin:0;background:#f2f4f7;font-family:"DM Sans",Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
  .wrap{max-width:820px;margin:0 auto;padding:22px 14px 60px}
  .topbar{display:inline-flex;align-items:center;gap:8px;margin:0 0 12px;padding:7px 12px;border-radius:999px;background:#fff;border:1px solid var(--line);font-size:13px;font-weight:600;color:var(--muted)}.topbar.is-ok{color:#067647;border-color:#abefc6;background:#ecfdf3}
  .sheet{background:#fff;border:1px solid var(--line);border-radius:18px;padding:48px 56px;box-shadow:0 12px 40px -24px rgba(16,24,40,.25)}
  .c-logo{margin:0 0 22px}.c-logo img{display:block;max-width:240px;object-fit:contain}
  .c-h{font-size:20px;line-height:1.3;margin:26px 0 10px;font-weight:700;letter-spacing:-.01em}.c-h:first-child{margin-top:0}.sheet>.c-logo+.c-h{font-size:24px}
  .c-p p{margin:0 0 10px}.c-ul{margin:4px 0 12px;padding-left:22px}.c-ul li{margin:3px 0}
  .c-img{margin:14px 0}.c-img img{max-width:100%;border-radius:8px}.c-empty{padding:28px;border:1px dashed var(--line);border-radius:10px;color:var(--muted);text-align:center;font-size:13px}
  .c-parties{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:8px 0 18px;padding:16px 18px;border:1px solid var(--line);border-radius:12px;background:#fafafb;font-size:14px}.c-label{display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin-bottom:4px}
  .c-field{display:grid;gap:4px;margin:10px 0}.c-field>span{font-size:12.5px;font-weight:600;color:var(--muted)}.c-field input{height:42px;border:1.5px solid var(--line);border-radius:10px;padding:0 12px;font:inherit;font-size:15px;color:var(--ink);background:#fff;outline:none}.c-field input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(188,0,29,.12)}.c-field.is-static strong{font-weight:600;padding:8px 0;border-bottom:1px solid var(--line)}.c-dots{color:var(--muted);font-weight:400}
  [data-b].is-focus{outline:2px solid rgba(188,0,29,.45);outline-offset:6px;border-radius:6px;background:rgba(188,0,29,.035);transition:outline-color .3s}
  .c-kv{display:grid;grid-template-columns:minmax(150px,220px) 1fr;gap:6px 16px;padding:9px 12px;border:1px solid var(--line);border-top:0;font-size:14px;background:#fafafb}.c-kv span{color:var(--muted)}.c-kv strong{font-weight:600}.c-kv:first-child,:not(.c-kv)+.c-kv{border-top:1px solid var(--line);border-radius:10px 10px 0 0;margin-top:6px}.c-kv:last-child,.c-kv:not(:has(+.c-kv)){border-radius:0 0 10px 10px;margin-bottom:12px}.c-kv:first-child:last-child,:not(.c-kv)+.c-kv:not(:has(+.c-kv)){border-radius:10px}
  .c-date{display:flex;gap:10px;align-items:baseline;margin:16px 0 6px;font-size:14px}.c-date span{color:var(--muted)}.c-date strong{font-weight:600}
  .c-sig{margin:26px 0 8px;max-width:360px}.c-sig-box{height:92px;border-bottom:1.5px solid var(--ink);display:flex;align-items:flex-end;padding:0 4px 6px}.c-sig-box img{max-height:84px;max-width:100%}.c-sig-box.is-todo{align-items:center;justify-content:center;border:1.5px dashed #cfd4dc;border-radius:10px;color:var(--muted);font-size:13px;font-weight:600}.c-sig-box.is-here{align-items:center;justify-content:center;border:1.5px dashed var(--accent);border-radius:10px;color:var(--accent);font-size:13px;font-weight:600;background:rgba(188,0,29,.04)}.c-sig-line{margin-top:6px;font-size:12.5px;color:var(--muted)}
  .c-hr{border:0;border-top:1px solid var(--line);margin:22px 0}.c-break{height:0;page-break-after:always;break-after:page}
  .sign{margin-top:18px;background:#fff;border:1px solid var(--line);border-radius:18px;padding:26px 28px;box-shadow:0 12px 40px -24px rgba(16,24,40,.25)}.sign h3{margin:0 0 6px;font-size:18px}.sign-hint{margin:0 0 14px;color:var(--muted);font-size:13.5px}
  .sign-name{display:grid;gap:4px;margin-bottom:12px}.sign-name span{font-size:12.5px;font-weight:600;color:var(--muted)}.sign-name input{height:44px;border:1.5px solid var(--line);border-radius:10px;padding:0 12px;font:inherit;font-size:15px}.sign-name input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(188,0,29,.12)}
  .sign-tabs{display:inline-flex;gap:4px;padding:3px;border-radius:10px;background:#f2f4f7;margin-bottom:10px}.sign-tabs button{border:0;background:transparent;padding:7px 14px;border-radius:8px;font:inherit;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer}.sign-tabs button.on{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(16,24,40,.08)}
  .pad-wrap{position:relative}#pad{display:block;width:100%;height:190px;border:1.5px dashed #cfd4dc;border-radius:12px;background:#fff;touch-action:none;cursor:crosshair}.pad-clear{position:absolute;right:10px;top:10px;border:1px solid var(--line);background:#fff;border-radius:8px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer}
  .type-wrap input{width:100%;height:44px;border:1.5px solid var(--line);border-radius:10px;padding:0 12px;font:inherit;font-size:15px}.typed-preview{margin-top:10px;min-height:70px;padding:10px 14px;border:1.5px dashed #cfd4dc;border-radius:12px;font-family:"Brush Script MT","Segoe Script","Snell Roundhand",cursive;font-size:38px;font-style:italic}
  .sign-consent{display:flex;gap:10px;align-items:flex-start;margin:16px 0 12px;font-size:13.5px}.sign-consent input{margin-top:3px;width:17px;height:17px;accent-color:var(--accent)}
  .sign-msg{margin:0 0 12px;padding:10px 12px;border-radius:10px;font-size:13.5px}.sign-msg.err{background:#fef3f2;color:#b42318;border:1px solid #fecdca}.sign-msg.ok{background:#ecfdf3;color:#067647;border:1px solid #abefc6}
  .sign-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.sign-submit{border:0;border-radius:12px;padding:0 22px;height:46px;background:linear-gradient(90deg,#bc001d,#fb2c36);color:#fff;font:inherit;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 8px 24px rgba(220,38,38,.28)}.sign-submit:disabled{opacity:.6;cursor:default}.sign-decline{border:0;background:transparent;color:var(--muted);font:inherit;font-size:13px;cursor:pointer;text-decoration:underline}
  .proof{margin-top:18px;background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px 26px}.proof h3{margin:0 0 10px;font-size:16px}.proof dl{display:grid;grid-template-columns:200px 1fr;gap:6px 14px;margin:0;font-size:13.5px}.proof dt{color:var(--muted)}.proof dd{margin:0;word-break:break-all}.proof .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
  .proof-log{margin:14px 0 0;padding-left:18px;font-size:13px;color:var(--muted)}.proof-log span{color:var(--ink);font-weight:600;margin-right:6px}.proof.is-warn{border-color:#fedf89;background:#fffaeb}.proof.is-warn p{margin:0;color:#7a4b00}
  .proof-actions{margin:16px 0 0;display:flex;gap:10px}.btn{display:inline-flex;align-items:center;height:40px;padding:0 16px;border-radius:10px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;font-size:14px;border:0;cursor:pointer;font-family:inherit}.btn.ghost{background:#fff;color:var(--ink);border:1px solid var(--line)}
  @media (max-width:640px){.sheet{padding:26px 18px;border-radius:14px}.c-parties{grid-template-columns:1fr}.proof dl{grid-template-columns:1fr}.sign{padding:18px}}
  @media print{body{background:#fff}.wrap{padding:0;max-width:none}.sheet{border:0;box-shadow:none;padding:0}.topbar,.sign,.proof-actions{display:none}.proof{break-inside:avoid;border:1px solid #ccc}}
  </style></head><body><div class="wrap">${badge}<article class="sheet">${body}</article>${signPanel}${proof}${notice}</div>${options.track ? `<div id="lesen" data-url="${esc(options.track.url)}" data-view="${Number(options.track.viewId) || 0}" hidden></div>` : ""}${canEdit ? `<script>${SIGN_SCRIPT}</script>` : ""}${options.track ? `<script>${READ_SCRIPT}</script>` : ""}</body></html>`;
}

/* ---------------- KI: Vertrag aus einer Beschreibung ---------------- */
export type AiContractSection = { type: "heading" | "text" | "bullets" | "detail"; text?: string; items?: string[]; key?: string; label?: string; value?: string };
export type AiContractDraft = { title: string; sections: AiContractSection[] };
export const CONTRACT_AI_SCHEMA = { name: "vertrag", strict: false, schema: { type: "object", properties: {
  title: { type: "string", description: "Titel des Vertrags, z. B. „Vereinbarung über eine Testphase“" },
  sections: { type: "array", description: "Inhalt in Reihenfolge – Überschriften (§ 1 …), Absätze, Aufzählungen und Vertragsangaben", items: { type: "object", properties: {
    type: { type: "string", enum: ["heading", "text", "bullets", "detail"] },
    text: { type: "string", description: "heading: Überschrift; text: Absätze (Leerzeile trennt Absätze)" },
    items: { type: "array", items: { type: "string" }, description: "bullets: die Punkte" },
    key: { type: "string", description: "detail: Schlüssel in Kleinbuchstaben, z. B. preis – im Text als {{preis}} nutzbar" },
    label: { type: "string", description: "detail: Bezeichnung, z. B. „Preis je Lead (netto)“" },
    value: { type: "string", description: "detail: der Wert aus der Beschreibung, sonst leer" },
  }, required: ["type"] } },
}, required: ["title", "sections"] } };
export const CONTRACT_AI_SYSTEM = `Du schreibst deutsche Verträge zwischen Unternehmen (B2B) für den Anbieter – so sorgfältig wie ein erfahrener Wirtschaftsanwalt, aber in einfacher Sprache. Du bekommst eine Beschreibung in Alltagssprache und machst daraus einen vollständigen Vertrag.

Sprache:
- Kurze Sätze, Alltagswörter, aktive Verben. Kein Juristendeutsch, keine Schachtelsätze. Ein Fachwort nur, wenn es nötig ist – dann kurz in Klammern erklären.
- Sprich den Kunden als „der Kunde“ und den Anbieter als „der Anbieter“ an.

Aufbau:
- Gliedere in Paragrafen als Überschriften („§ 1 Gegenstand des Vertrags“, „§ 2 …“). Längere Paragrafen in nummerierte Absätze teilen: „(1) …“, Leerzeile, „(2) …“.
- Übliche Reihenfolge: Gegenstand, Leistungen, Umfang oder Dauer, Preis und Abrechnung, Pflichten des Kunden, Mängel oder Reklamation (wenn es passt), Datenschutz, Haftung, Laufzeit und Kündigung, Vertraulichkeit, Schlussbestimmungen.
- Konkrete Eckdaten (Preise, Mengen, Dauer, Gebiet, Termine …) als Vertragsangaben (type "detail") mit Schlüssel, Bezeichnung und dem Wert aus der Beschreibung. Im Fließtext kannst du sie als {{schlüssel}} einsetzen. Fehlt ein Wert, lass value leer.

Das gehört in jeden Vertrag (in einfachen Worten):
- Gegenstand: was genau geschuldet ist – und was nicht (kein bestimmter Erfolg oder Umsatz, wenn die Beschreibung nichts anderes sagt). Dazu der Satz: „${CONTRACT_CLAUSES.unternehmer}“
- Preis: Nettopreise zuzüglich gesetzlicher Umsatzsteuer, Zahlungsfrist, bei Zahlungsverzug gesetzliche Verzugszinsen und das Recht, die Leistung auszusetzen. Aufrechnung nur mit unbestrittenen oder rechtskräftig festgestellten Forderungen.
- Haftung genau in dieser Form, ohne weitere Ausschlüsse: „${CONTRACT_CLAUSES.haftung.join(" ")}“
- Datenschutz, wenn personenbezogene Daten fließen: Jede Seite ist selbst verantwortlich (DSGVO), Daten nur für den vereinbarten Zweck nutzen und löschen, wenn sie nicht mehr gebraucht werden.
- Laufzeit und Kündigung: Beginn, Frist, Textform (E-Mail genügt). Die fristlose Kündigung aus wichtigem Grund bleibt möglich.
- Vertraulichkeit: Inhalt des Vertrags und nicht öffentliche Informationen bleiben vertraulich, auch zwei Jahre nach dem Vertragsende.
- Schlussbestimmungen: Geschäftsbedingungen des Kunden gelten nicht. Änderungen brauchen die Textform, individuelle Absprachen haben Vorrang. Ist eine Regelung unwirksam, bleibt der Rest gültig und an ihre Stelle tritt das Gesetz. Es gilt deutsches Recht; Gerichtsstand ist der Sitz des Anbieters, wenn der Kunde Kaufmann ist.
- Letzter Absatz der Schlussbestimmungen wörtlich: „Dieser Vertrag wird elektronisch geschlossen. Die elektronische Unterschrift des Kunden wird mit Zeitstempel, IP-Adresse und Prüfsumme des Dokuments protokolliert.“

Grenzen:
- Keine erfundenen Gesetzesparagrafen, keine Platzhalter wie [XY].
- Regeln müssen für beide Seiten fair bleiben – einseitige oder überraschende Klauseln sind unwirksam. Vertragsstrafen nur, wenn die Beschreibung sie verlangt, und dann maßvoll.
- Der Kunde füllt nichts aus – er unterschreibt nur. Keine Felder für den Kunden.
- Vertragsparteien, Logo, Datum und Unterschriften ergänzt die Software selbst – schreibe sie nicht.`;
const slugKey = (value: string) => value.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
/** KI-Antwort → Bausteine: Logo, Titel, Vertragsparteien, Inhalt, Datum und beide Unterschriften. */
export function aiDraftToContract(draft: Partial<AiContractDraft> | null | undefined): { title: string; blocks: ContractBlock[] } {
  const title = String(draft?.title ?? "").trim().slice(0, 200) || "Vertrag";
  const used = new Set<string>(); const body: ContractBlock[] = [];
  for (const section of Array.isArray(draft?.sections) ? draft!.sections : []) {
    if (!section || typeof section !== "object") continue;
    if (section.type === "heading" && section.text?.trim()) body.push({ id: newBlockId(), type: "heading", text: section.text.trim().slice(0, 300) });
    else if (section.type === "text" && section.text?.trim()) body.push({ id: newBlockId(), type: "text", text: section.text.trim().slice(0, 6000) });
    else if (section.type === "bullets" && Array.isArray(section.items)) { const items = section.items.map((item) => String(item).trim()).filter(Boolean).slice(0, 30); if (items.length) body.push({ id: newBlockId(), type: "bullets", items }); }
    else if (section.type === "detail" && (section.label || section.key)) { let key = slugKey(section.key || section.label || "") || `angabe_${body.length}`; while (used.has(key)) key = `${key}_2`; used.add(key); body.push({ id: newBlockId(), type: "detail", key, label: String(section.label || section.key).trim().slice(0, 120), value: String(section.value ?? "").trim().slice(0, 500), hint: "" }); }
  }
  if (!body.length) throw new Error("Die KI hat keinen Vertragstext geliefert – bitte die Beschreibung etwas genauer fassen.");
  return { title, blocks: [{ id: newBlockId(), type: "logo", src: null, height: 36 }, { id: newBlockId(), type: "heading", text: title }, { id: newBlockId(), type: "parties" }, ...body, { id: newBlockId(), type: "date", label: "Datum", mode: "unterschrift", value: null }, { id: newBlockId(), type: "signature", party: "anbieter", label: "Unterschrift Anbieter" }, { id: newBlockId(), type: "signature", party: "kunde", label: "Unterschrift Kunde" }] };
}
/** Ohne KI-Anbindung: passende Vorlage nach Stichworten (Testphase oder Leadlieferung), sonst leerer Rahmen mit der Beschreibung als Text. */
export function fallbackContractFromPrompt(prompt: string): { title: string; blocks: ContractBlock[] } {
  const text = prompt.toLowerCase();
  if (/test|probe|pilot/.test(text)) return contractStarter("testphase");
  if (/lead|anfrage/.test(text)) return contractStarter("leadliefervertrag");
  return aiDraftToContract({ title: "Vertrag", sections: [{ type: "heading", text: "§ 1 Gegenstand des Vertrags" }, { type: "text", text: `${prompt.trim()}\n\n${CONTRACT_CLAUSES.unternehmer}` }, { type: "heading", text: "§ 2 Haftung" }, { type: "text", text: CONTRACT_CLAUSES.haftung.join("\n\n") }, { type: "heading", text: "§ 3 Schlussbestimmungen" }, { type: "text", text: CONTRACT_CLAUSES.schluss("Dieser Vertrag").join("\n\n") }] });
}
