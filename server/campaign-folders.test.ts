import { describe, expect, it } from "vitest";
import { cleanFolderName, folderForSparte, folderNameIssue, planSparteFolders, sortFolders, sortSummary } from "../shared/campaign-folders";
import { resolveSparte, sparteOf } from "../shared/lead-sparte";

const sparte = (label: string) => { const found = resolveSparte(label)!; return { key: found.key, label: found.label }; };

describe("Ordner der E-Mail-Kampagnen", () => {
  it("Namen: Leerzeichen bereinigt, nie leer, nie doppelt (Groß-/Kleinschreibung egal) – umbenennen in sich selbst geht", () => {
    expect(cleanFolderName("  Haus   notruf ")).toBe("Haus notruf");
    const folders = [{ id: 1, name: "Hausnotruf" }, { id: 2, name: "Alarmanlage" }];
    expect(folderNameIssue("   ", folders)).toBe("Bitte einen Namen für den Ordner angeben.");
    expect(folderNameIssue("hausnotruf", folders)).toBe("Den Ordner „Hausnotruf“ gibt es schon.");
    expect(folderNameIssue("HAUSNOTRUF", folders, 1)).toBeNull(); // eigener Ordner, nur anders geschrieben
    expect(folderNameIssue("Elektrorollstuhl", folders)).toBeNull();
    expect(cleanFolderName("x".repeat(200))).toHaveLength(120);
  });
  it("Reihenfolge in der Leiste: A–Z, Zahlen natürlich", () => {
    expect(sortFolders([{ name: "Region 10" }, { name: "alarmanlage" }, { name: "Region 2" }, { name: "Hausnotruf" }]).map((folder) => folder.name)).toEqual(["alarmanlage", "Hausnotruf", "Region 2", "Region 10"]);
  });
  it("passender Ordner zur Sparte: gleicher Name oder ein eigener Ordner, der dieselbe Sparte meint – eigene Sparten nur über den Namen", () => {
    const folders = [{ id: 1, name: "PV & WP" }, { id: 2, name: "Hausnotruf Bayern" }, { id: 3, name: "Batteriespeicher" }, { id: 4, name: "Alarmanlage" }];
    expect(folderForSparte(folders, sparte("Photovoltaik & Wärmepumpe"))?.id).toBe(1);
    expect(folderForSparte(folders, sparte("Hausnotruf"))?.id).toBe(2);
    expect(folderForSparte(folders, sparte("Alarmanlage"))?.id).toBe(4);
    expect(folderForSparte(folders, sparte("Elektrorollstuhl"))).toBeNull();
    expect(folderForSparte(folders, sparte("batteriespeicher"))?.id).toBe(3); // eigene Sparte, gleicher Name
    expect(folderForSparte(folders, { key: "eigene", label: "Speicher" })).toBeNull();
  });
  it("nach Leadsparte einsortieren: nur Kampagnen ohne Ordner, vorhandene Ordner werden genommen, fehlende einmal angelegt", () => {
    const folders = [{ id: 7, name: "Hausnotruf" }];
    const campaigns = [
      { id: 1, folderId: null, sparte: sparteOf({ name: "Hausnotruf • Bayern" }) },
      { id: 2, folderId: null, sparte: sparteOf({ leadSparte: "Alarmanlage", name: "Errichter NRW" }) },
      { id: 3, folderId: null, sparte: sparteOf({ leadSparte: "Alarmanlagen", name: "Errichter Hessen" }) }, // „Alarmanlagen“ = bekannte Sparte Alarmanlage
      { id: 4, folderId: 7, sparte: sparteOf({ leadSparte: "Elektrorollstuhl" }) }, // liegt schon in einem Ordner → bleibt
      { id: 5, folderId: 99, sparte: sparteOf({ name: "PV & WP Süd" }) }, // Ordner gibt es nicht mehr → gilt als ohne Ordner
      { id: 6, folderId: null, sparte: sparteOf({ name: "Dachdecker Hessen" }) }, // nichts erkannt → wie auf der Karte: Photovoltaik & Wärmepumpe
    ];
    const plan = planSparteFolders(campaigns, folders);
    expect(plan.create).toEqual(["Alarmanlage", "Photovoltaik & Wärmepumpe"]);
    expect(plan.moves).toEqual([
      { id: 1, folderId: 7, folderName: "Hausnotruf" },
      { id: 2, folderId: null, folderName: "Alarmanlage" },
      { id: 3, folderId: null, folderName: "Alarmanlage" },
      { id: 5, folderId: null, folderName: "Photovoltaik & Wärmepumpe" },
      { id: 6, folderId: null, folderName: "Photovoltaik & Wärmepumpe" },
    ]);
    expect(sortSummary(plan.moves)).toEqual([{ name: "Alarmanlage", count: 2 }, { name: "Photovoltaik & Wärmepumpe", count: 2 }, { name: "Hausnotruf", count: 1 }]);
    expect(planSparteFolders([{ id: 4, folderId: 7, sparte: sparte("Hausnotruf") }], folders)).toEqual({ create: [], moves: [] }); // alles einsortiert → nichts zu tun
  });
});
