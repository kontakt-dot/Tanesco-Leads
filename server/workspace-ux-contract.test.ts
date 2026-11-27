import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const component = (name: string) => readFileSync(resolve(process.cwd(), "client/src/components", name), "utf8");

describe("Tanesco Leads UX-Verträge", () => {
  it("bündelt Lead-Aktionen in der Auswahlsteuerung und nutzt den rechten Tabellenbereich für Kontaktinformationen", () => {
    // Seit v347 zeichnet LeadTable.tsx die Tabelle selbst; die Spalten stehen in lib/leadColumns.ts.
    const source = component("LiveLeads.tsx");
    const table = component("LeadTable.tsx");
    const columns = readFileSync(resolve(process.cwd(), "client/src/lib/leadColumns.ts"), "utf8");
    expect(table).toContain('href={`mailto:${lead.email}`}');
    expect(table).toContain('href={`tel:${lead.phone}`}');
    for (const label of ["Kategorie", "E-Mail", "Telefon", "Status", "Lieferant", "Geliefert", "Käufer", "Preis"]) expect(columns).toContain(`label: "${label}"`);
    expect(table).toContain("onQuickView");
    expect(table).toContain("onOpenLog");
    expect(source).toContain('className="lt-bulk"');
    expect(source).toContain('aria-label="Aktion für ausgewählte Leads"');
  });

  it("bietet vollständige E-Mail-Hinweise, Sortierung und eine speicherbare Spaltenauswahl", () => {
    const source = component("LiveLeads.tsx");
    const table = component("LeadTable.tsx");
    expect(table).toContain("title={lead.email}");
    expect(source).toContain("Preis: hoch nach niedrig");
    expect(source).toContain("Auslieferung: neueste zuerst");
    expect(source).toContain('aria-label="Spalten ein- und ausblenden"');
    expect(source).toContain("tanesco-lead-hidden-columns");
  });

  it("kennzeichnet aktive Steuerungen und speichert häufige Filterkombinationen", () => {
    const source = component("LiveLeads.tsx") + component("LeadTools.tsx"); // die gespeicherten Filter (laden und löschen) stehen seit v377 in LeadTools.tsx
    const styles = readFileSync(resolve(process.cwd(), "client/src/bausteine.css"), "utf8");
    expect(source).toContain("Filter speichern");
    expect(source).toContain("Gespeicherte Filter");
    expect(source).toContain("Alle gespeicherten Filter löschen");
    expect(source).toContain('className="lt-tabrow"'); // Reiter und Filter-Knöpfe in einer Zeile
    expect(styles).toContain(".lt-tabrow{");
    expect(source).toContain("tanesco-lead-saved-views");
    expect(source).toContain('className="lt-subtools"');
    expect(styles).toContain(".lt-subtools{");
    expect(styles).toContain(".lt-columns-menu{");
  });

  it("gibt Buttons der schlichten Lead-Kontrollleiste bei Mausinteraktion eine dezente Rückmeldung", () => {
    const styles = readFileSync(resolve(process.cwd(), "client/src/bausteine.css"), "utf8");
    expect(styles).toContain("@media(hover:hover) and (pointer:fine)");
    expect(styles).toContain("translateY(-1px)");
    expect(styles).toContain(".lt-columns>summary:hover");
    expect(styles).toContain(".lt-tool:hover");
  });

  it("zeigt laufende Import- und Exportvorgänge an und reserviert Kürzel für die Leadanlage", () => {
    const source = component("LiveLeads.tsx");
    expect(source).toContain("Import läuft …");
    expect(source).toContain("Export läuft …");
    expect(source).toContain('event.key.toLowerCase() === "n"');
    expect(source).toContain('event.key.toLowerCase() === "i"');
    expect(source).toContain('target?.matches(\'input, textarea, select, [contenteditable="true"]\')');
    expect(source).not.toContain('title="Tastenkürzel: I"');
    expect(source).not.toContain('title="Tastenkürzel: N"');
    expect(source).not.toContain('className="lead-shortcut-hint"');
  });

  it("zeigt detaillierten Importfortschritt und ermöglicht den letzten Import mit einem Klick rückgängig zu machen", () => {
    const source = component("LiveLeads.tsx");
    expect(source).toContain("setImportProgress({ completed: index + 1, total: report.rows.length })");
    expect(source).toContain("Zeilen");
    expect(source).toContain("Letzter Import:");
    expect(source).toContain("Import rückgängig machen");
    expect(source).toContain('aria-label="Zeitraum auswählen"');
    expect(source).toContain('aria-label="Leadliste sortieren"');
    expect(source).not.toContain('applyDatePreset("today")}>Heute</Button>');
  });

  it("stellt vor dem Speichern eine Importvorschau, Fehlerdatei und die persistente Importhistorie bereit", () => {
    const source = component("LiveLeads.tsx");
    expect(source).toContain("IMPORTVORSCHAU");
    expect(source).toContain("Fehlerzeilen exportieren");
    expect(source).toContain("IMPORTHISTORIE");
    expect(source).toContain("startLeadImportBatch.useMutation");
    expect(source).toContain("undoLeadImportBatch.useMutation");
  });

  it("zeigt im Support den aktivierten WhatsApp-Einstieg und den Plattformtestplan", () => {
    const source = component("LiveServiceDesk.tsx");
    expect(source).toContain("export default function LiveServiceDesk()"); // seit v380 ist die Datei nur noch die Support-Seite – die Reklamationen stehen in ClaimsDesk.tsx
    expect(source).not.toContain("listClaims");
    expect(source).toContain("491634950514");
    expect(source).toContain("WhatsApp-Chat"); expect(source).toContain("Chat öffnen"); expect(source).toContain("ANFRAGEN DEINER KUNDEN");
    expect(source).toContain("PLATTFORMTEST · SCHRITT FÜR SCHRITT");
    expect(source).toContain("Dashboard & Statistik");
  });

  it("führt Einsteiger in drei klaren Schritten bis zur echten Schnittstellenanlage", () => {
    const source = component("IntegrationBuilder.tsx");
    expect(source).toContain("Integration einfach einrichten");
    expect(source).toContain('title="Unterlagen besorgen"');
    expect(source).toContain('title="Hier einfügen"');
    expect(source).toContain('title="Schnittstelle erstellen"');
    expect(source).toContain("createPartnerIntegration.useMutation");
    expect(source).toContain("Schnittstelle jetzt erstellen");
  });

  it("verankert die erweiterten Referenzwerkzeuge in den operativen Arbeitsbereichen", () => {
    expect(component("LiveLeads.tsx")).toContain("Testlead senden");
    expect(component("LiveLeads.tsx")).toContain("Lead duplizieren");
    expect(component("LiveLeads.tsx")).toContain("Lead deaktivieren");
    expect(component("LiveLeads.tsx")).toContain("countryFlag");
    expect(component("LivePeopleAdmin.tsx")).toContain("Benutzerwerkzeuge");
    expect(component("IntegrationPanel.tsx")).toContain("Vorlagenbibliothek");
    expect(component("IntegrationPanel.tsx")).toContain("InlineIntegrationBuilder"); expect(component("InlineBuilder.tsx")).toContain("Integrationsbuilder"); // Builder klappt direkt auf der Seite auf
    expect(component("IntegrationPanel.tsx")).toContain("Leadnodes");
    expect(component("AutomationWorkspace.tsx")).toContain("InlineAutomationBuilder"); expect(component("InlineBuilder.tsx")).toContain("Automatisierungsbuilder");
  });

  it("ermöglicht die bestätigte Löschung ungenutzter Käufer- und Lieferantenprofile", () => {
    const source = component("LivePeopleAdmin.tsx");
    expect(source).toContain("deleteOrganizationProfile.useMutation");
    expect(source).toContain("In Papierkorb verschieben");
    expect(source).toContain("Das Profil hat keine operativen Verknüpfungen");
    expect(source).toContain("30 Tage in den Papierkorb");
  });

  it("zeigt Partnerbearbeitung, konkrete Löschblocker und einen 30-Tage-Papierkorb", () => {
    const source = component("LivePeopleAdmin.tsx");
    expect(source).toContain("Änderungen speichern");
    expect(source).toContain("Archivierung derzeit gesperrt");
    expect(source).toContain("Leads ·");
    expect(source).toContain("Bestellungen ·");
    expect(source).toContain("Automatisierungen ·");
    expect(source).toContain("PAPIERKORB · 30 TAGE");
    expect(source).toContain("Wiederherstellen");
  });

  it("zeigt jede Bestellung als kompakte KPI-Zeile mit Bearbeiten- und Löschaktion", () => {
    const source = component("OrderOverview.tsx");
    expect(source).toContain("Prüfe Käufer, Lieferant, Lieferfortschritt und Status");
    expect(source).toContain('small>Käufer</small>');
    expect(source).toContain("Lieferstatus");
    expect(source).toContain("Preis & Wert");
    expect(source).toContain("deleteOrder.useMutation");
    expect(source).toContain("wirklich löschen? Zugehörige Lieferketten");
  });

  it("zeigt Lieferantenherkunft und steuert den Bestellstatus direkt in der Zeile", () => {
    const source = component("OrderOverview.tsx");
    expect(source).toContain("Lieferant");
    expect(source).toContain("order.supplierText");
    expect(source).toContain("updateOrderStatus.useMutation");
    expect(source).toContain('<option value="aktiv">Aktiv</option>');
    expect(source).toContain('<option value="pausiert">Inaktiv</option>');
    // seit v365 nur noch Aktiv/Inaktiv – „offen“ steht dort als Inaktiv
    expect(source).not.toContain('<option value="offen">Offen</option>');
    expect(source).toContain("orderStatusChoice(");
  });

  it("ordnet Kategorie-, Lead- und Benutzeraktionen klar ausgerichtet an", () => {
    const categorySource = component("LiveCategories.tsx");
    const leadSource = component("LiveLeads.tsx");
    const peopleSource = component("LivePeopleAdmin.tsx");
    const styles = readFileSync(resolve(process.cwd(), "client/src/lead-refinements.css"), "utf8");
    expect(categorySource).toContain('className="category-header-actions"');
    expect(leadSource).toContain('className="lead-header-actions"');
    expect(peopleSource).toContain('className="people-header-actions"');
    expect(styles).toContain(".category-header-actions");
    expect(styles).toContain(".lead-header-actions");
    expect(styles).toContain("justify-content: center");
    expect(styles).toContain(".people-header-actions");
  });

  it("Statistik zeigt nur noch Integrationen (seit v375) – keine Reiter für Käufer, Lieferanten, Bestellungen, Lieferketten", () => {
    const source = component("StatisticsWorkspace.tsx");
    expect(source).toContain("<PartnerReport />");
    expect(source).not.toContain("const views"); expect(source).not.toContain("status-tabs"); expect(source).not.toContain("-Perspektive");
    const shell = component("FluxoraWorkspace.tsx");
    expect(shell).toContain('{ label: "ORGANISATION", pages: ["Teams", "Benutzer", "Kooperationen"] }'); // Menüpunkt „Integrationen“ gibt es nicht mehr
    expect(shell).not.toContain('{ page: "Integrationen"'); expect(shell).toContain("/?page=Einstellungen&setting=Integrationen"); // alte Links landen in den Einstellungen
  });

  it("bietet einen Kategorien-Builder mit Datei-Upload, editierbarer Entwurfsvorschau und bewusster Übernahme", () => {
    const categorySource = component("LiveCategories.tsx");
    const builderSource = component("LeadCategoryBuilder.tsx");
    expect(categorySource).toContain("Kategorien-Builder");
    expect(categorySource).toContain('get("builder") === "1"');
    expect(builderSource).toContain("Parameterblatt auswählen oder hier ablegen");
    expect(builderSource).toContain("Kategorieentwurf erstellen");
    expect(builderSource).toContain("Erkannte Fachfelder");
    expect(builderSource).toContain("Datenharmonisierung");
    expect(builderSource).toContain("Feld entfernen");
    expect(builderSource).toContain("Regel entfernen");
    expect(builderSource).toContain("Als Vorlage speichern");
    expect(builderSource).toContain("saveAsTemplate");
    expect(builderSource).toContain("Kategorie mit ${draft.fields.length} Feldern anlegen");
  });

  it("Version 377: Glocke zeigt „99+“ ganz, rosa Köpfe sind kräftig rot mit weißer Schrift, Stationen haben einen deutlichen Streifen zum Aufklappen", () => {
    const styles = readFileSync(resolve(process.cwd(), "client/src/bausteine.css"), "utf8");
    // Glocke: Die Zahl darf nicht die Breite des kleinen Punkts (6 px) erben
    expect(styles).toContain(".notification.has-new i{width:auto;");
    // Köpfe: ein Rot für alle, Weiß darauf – nur im hellen Design (im dunklen gab es kein Rosa)
    expect(styles).toContain("--head-red:linear-gradient(90deg,#bc001d,#fb2c36)"); /* seit v386: genau das Rot der Hauptknöpfe */
    for (const head of [".order-overview-head", ".automation-editor-head", ".category-builder-head", ".territory-ai-head"]) expect(styles).toContain(`html:not(.dark) ${head}`);
    expect(styles).toMatch(/html:not\(\.dark\) \.order-overview-head h2[^{]*\{color:var\(--head-ink\)!important\}/);
    // Weiß auf dem hellsten Rot des Verlaufs: mindestens 4,5 : 1 (kleine Schrift)
    const luminance = (hex: string) => { const channel = (index: number) => { const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255; return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }; return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2); };
    const contrast = (front: string, back: string) => { const [light, dark] = [luminance(front), luminance(back)].sort((a, b) => b - a); return (light + 0.05) / (dark + 0.05); };
    expect(contrast("#ffffff", "#bc001d")).toBeGreaterThan(5.5); /* Überschrift links auf dem dunklen Ende */ expect(contrast("#ffffff", "#fb2c36")).toBeGreaterThan(3); /* große Schrift am hellen Ende; die Zahlen dort stehen auf einem abgedunkelten Kästchen (v386) */
    // rosa Kästen unter dem Kopf sind weiß – kein zweites Rot
    expect(styles).toContain("html:not(.dark) .automation-flow-node.trigger-node");
    // Lieferkette: Streifen zum Auf- und Zuklappen
    expect(component("ChainWorkspace.tsx")).toContain('className="lk-stop-toggle"');
    expect(styles).toContain(".lk-stop-toggle{");
  });

  it("Version 377: Menü – „Bestellungen“ heißt „Auslieferung“, „Haustür-Erfassung“ steht nicht mehr im Menü (die Seite bleibt erreichbar)", () => {
    const shell = component("FluxoraWorkspace.tsx");
    expect(shell).toContain('PAGE_LABELS: Partial<Record<Page, string>> = { Bestellungen: "Auslieferung" }');
    expect(shell).toContain('{ label: "VERTRIEB", pages: ["Vertriebspipeline", "E-Mail-Kampagnen", "Verträge"] }');
    expect(shell).toContain('page === "Haustür-Erfassung" ? <D2dWorkspace />'); // alte Links gehen weiter
    expect(component("OrderWorkspace.tsx")).toContain("<h1>Auslieferung</h1>");
  });
});
