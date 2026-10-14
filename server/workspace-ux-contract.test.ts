import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const component = (name: string) => readFileSync(resolve(process.cwd(), "client/src/components", name), "utf8");

describe("Tanesco Leads UX-Verträge", () => {
  it("bündelt Lead-Aktionen in der Auswahlsteuerung und nutzt den rechten Tabellenbereich für Kontaktinformationen", () => {
    const source = component("LiveLeads.tsx");
    expect(source).toContain("Kontakt & Ort");
    expect(source).toContain('href={`mailto:${lead.email}`}');
    expect(source).toContain('href={`tel:${lead.phone}`}');
    expect(source).toContain("Verkauft an");
  });

  it("bietet vollständige E-Mail-Hinweise, Sortierung und eine speicherbare Spaltenauswahl", () => {
    const source = component("LiveLeads.tsx");
    expect(source).toContain("value.title = text");
    expect(source).toContain("Preis: hoch nach niedrig");
    expect(source).toContain("Auslieferung: neueste zuerst");
    expect(source).toContain("Spalten anpassen");
    expect(source).toContain("tanesco-lead-hidden-columns");
  });

  it("kennzeichnet aktive Steuerungen und speichert häufige Filterkombinationen", () => {
    const source = component("LiveLeads.tsx");
    const styles = readFileSync(resolve(process.cwd(), "client/src/index.css"), "utf8");
    expect(source).toContain("Filter speichern");
    expect(source).toContain("Gespeicherte Filter");
    expect(source).toContain("tanesco-lead-saved-views");
    expect(styles).toContain("lead-table-tools");
    expect(styles).toContain("lead-column-menu");
  });

  it("gibt Buttons der schlichten Lead-Kontrollleiste bei Mausinteraktion eine dezente Rückmeldung", () => {
    const styles = readFileSync(resolve(process.cwd(), "client/src/index.css"), "utf8");
    expect(styles).toContain("@media(hover:hover) and (pointer:fine)");
    expect(styles).toContain("translateY(-1px)");
    expect(styles).toContain("lead-column-menu summary:hover");
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
    expect(source).toContain('aria-label="Zeitraum und Sortierung"');
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
    expect(source).toContain('return <WhatsAppSupport />');
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
    expect(source).toContain('<option value="offen">Offen</option>');
    expect(source).toContain('<option value="pausiert">Inaktiv</option>');
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

  it("ordnet Statistikperspektiven fachlich nach Käufer, Lieferanten, Bestellungen, Lieferketten und Integrationen", () => {
    const source = component("StatisticsWorkspace.tsx");
    expect(source).toContain('const views: View[] = ["Käufer", "Lieferanten", "Bestellungen", "Lieferketten", "Integrationen"]');
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
});
