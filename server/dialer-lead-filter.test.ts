import { describe, expect, it } from "vitest";
import { keepHiddenFilter } from "../shared/dialer-lead-filter";
import { isListTag } from "../shared/list-tags";

/** Version 375 – Telefonie: Das Fenster „Kampagne“ zeigt keine Listen-Marker mehr; was es nicht kennt, übersteht das Speichern. */
describe("Wählliste einer Kampagne – was das Fenster nicht zeigt, bleibt erhalten", () => {
  it("Anrufkampagne einer Liste: Art der Kontakte und Listen-Marker bleiben, sichtbare Filter gelten neu", () => {
    const stored = { tagIds: [7], onlyWithoutCall: true, kind: "vertrieb" as const };
    const fromWindow = { categoryIds: [], statuses: ["neu", "hängend"], tagIds: [7], notCalledDays: null, onlyWithoutCall: false, rawBatchIds: [], leadsEnabled: true };
    expect(keepHiddenFilter(stored, fromWindow)).toEqual({ ...fromWindow, kind: "vertrieb" });
  });
  it("fest gewählte Karten und Lieferanten bleiben – außer die neue Angabe nennt sie selbst (auch leer)", () => {
    const stored = { leadIds: [3, 4], supplierIds: [9], statuses: [] };
    expect(keepHiddenFilter(stored, { statuses: ["neu"] })).toEqual({ statuses: ["neu"], leadIds: [3, 4], supplierIds: [9] });
    expect(keepHiddenFilter(stored, { statuses: ["neu"], supplierIds: [], leadIds: [5] })).toEqual({ statuses: ["neu"], supplierIds: [], leadIds: [5] });
    expect(keepHiddenFilter({ kind: "vertrieb" }, { kind: "verkauf" }).kind).toBe("verkauf");
  });
  it("neue Kampagne oder nichts gespeichert: die Angabe gilt, wie sie kommt", () => {
    expect(keepHiddenFilter(null, { categoryIds: [1] })).toEqual({ categoryIds: [1] }); expect(keepHiddenFilter({}, { categoryIds: [1] })).toEqual({ categoryIds: [1] });
  });
  it("Listen-Marker erkennt man am Anfang „Liste: “", () => {
    expect(isListTag("Liste: Dachdecker Hessen")).toBe(true); expect(isListTag("Rückruf")).toBe(false); expect(isListTag("Listenplatz")).toBe(false); expect(isListTag(null)).toBe(false);
  });
});
