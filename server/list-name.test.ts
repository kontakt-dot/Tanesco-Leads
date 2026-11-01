import { describe, expect, it } from "vitest";
import { looksTechnical, tidyListName } from "../shared/list-name";

describe("Listennamen lesbar machen", () => {
  it("macht technische Namen aus dem Kampagnen-Menü lesbar", () => {
    expect(tidyListName("WP_ab_1_Bundesland")).toBe("Wärmepumpe ab 1 Bundesland");
    expect(tidyListName("PV_regional_ab_20_Mitarbeiter")).toBe("Photovoltaik regional ab 20 Mitarbeiter");
    expect(tidyListName("PV_WP_Aroundhome_Vielkaeufer_ab_100_Bewertungen_neu")).toBe("Photovoltaik & Wärmepumpe Aroundhome Vielkäufer ab 100 Bewertungen (neu)");
    expect(tidyListName("PV_WP_Aroundhome_Kaeufer_20_bis_99_Bewertungen_aktiv")).toBe("Photovoltaik & Wärmepumpe Aroundhome Käufer 20 bis 99 Bewertungen (aktiv)");
    expect(tidyListName("PV_WP_Grossanbieter_und_Energieversorger")).toBe("Photovoltaik & Wärmepumpe Großanbieter und Energieversorger");
  });
  it("Dateiendungen, Bindestriche, Abkürzungen, Bundesländer, Teile", () => {
    expect(tidyListName("solarteure-hessen.xlsx")).toBe("Solarteure Hessen");
    expect(tidyListName("pv_nrw_ueber_100_bewertungen.csv")).toBe("Photovoltaik NRW über 100 Bewertungen");
    expect(tidyListName("PV_Baden_Wuerttemberg_teil2")).toBe("Photovoltaik Baden-Württemberg (Teil 2)");
    expect(tidyListName("WP_Heizungsbauer_groesste_ab_20_Bewertungen")).toBe("Wärmepumpe Heizungsbauer größte ab 20 Bewertungen");
  });
  it("lässt bewusst geschriebene Namen in Ruhe und ist idempotent", () => {
    for (const name of ["Wärmepumpe über 100 Bewertungen", "Dachdecker Hessen", "Lead-Finder: Solarteur Kassel", "Feuerwehr-Ausrüster Nord"]) { expect(looksTechnical(name)).toBe(false); expect(tidyListName(name)).toBe(name); }
    for (const name of ["PV_WP_Aroundhome_Vielkaeufer_ab_100_Bewertungen_neu", "solarteure-hessen.xlsx", "PV_Baden_Wuerttemberg_teil2"]) { const once = tidyListName(name); expect(tidyListName(once)).toBe(once); }
    expect(tidyListName("  ")).toBe(""); expect(tidyListName(null)).toBe("");
  });
});
