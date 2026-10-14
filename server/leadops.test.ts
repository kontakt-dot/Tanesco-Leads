import { describe, expect, it } from "vitest";
import { computeDashboardKpis, makeCsv } from "./leadops";

describe("Lead-Operations-Geschäftslogik", () => {
  it("berechnet KPI-Werte statusbasiert", () => {
    const result = computeDashboardKpis([
      { status: "zugewiesen", cost: 48, createdAt: new Date(), email: "Kontakt@Beispiel.de" },
      { status: "zugewiesen", cost: 32, createdAt: new Date(), email: "kontakt@beispiel.de" },
      { status: "reklamiert", cost: 0, createdAt: new Date() },
      { status: "neu", cost: 0, createdAt: new Date() },
    ]);
    expect(result).toEqual({ delivered: 2, revenue: 80, registrations: 1, duplicates: 2, complaints: 1 });
  });

  it("erzeugt ein korrekt gequotetes Semikolon-CSV", () => {
    expect(makeCsv([{ Name: "Müller; GmbH", Notiz: 'Text mit "Anführungszeichen"' }])).toBe(
      'Name;Notiz\n"Müller; GmbH";"Text mit ""Anführungszeichen"""',
    );
  });
});
