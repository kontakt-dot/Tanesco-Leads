import { describe, expect, it } from "vitest";
import { validatePasswordStrength } from "./_core/auth";
import { movedReasons, passwordIssue, SETTING_GROUPS, SETTING_INFO, settingFromAddress, SYSTEM_SWITCHES, systemSwitchGroups } from "../shared/settings-view";

describe("Einstellungen: Bereiche in Gruppen", () => {
  it("vier Gruppen, zehn Bereiche – die leeren Platzhalter von früher sind nicht mehr dabei", () => {
    expect(SETTING_GROUPS.map((group) => [group.label, [...group.items]])).toEqual([
      ["Mein Zugang", ["Profil", "Passwort"]],
      ["Firma", ["Branding", "Rechnung & Rechtliches", "Nutzungsbedingungen"]],
      ["Leads & Auslieferung", ["System", "Reklamationen"]],
      ["Versand & Schnittstellen", ["E-Mail-Versand", "Integrationen", "API-Dokumentation"]],
    ]);
    const all = SETTING_GROUPS.flatMap((group) => [...group.items] as string[]);
    for (const gone of ["E-Mail", "Domain", "Zahlung", "Abonnement", "Affiliate"]) expect(all).not.toContain(gone);
    expect(new Set(all).size).toBe(all.length);
  });
  it("jeder Bereich hat eine Zeile, die sagt, was man dort einstellt – ohne die alten falschen Angaben", () => {
    const all = SETTING_GROUPS.flatMap((group) => [...group.items]);
    for (const item of all) { expect(SETTING_INFO[item].length, item).toBeGreaterThan(20); expect(SETTING_INFO[item].endsWith("."), item).toBe(true); }
    expect(SETTING_INFO.System).not.toMatch(/Zeitzone|Währung/); expect(SETTING_INFO.System).toContain("doppelten Kontakten");
    expect(Object.values(SETTING_INFO).join(" ")).not.toMatch(/Mandant|Tenant|Stripe/);
  });
  it("Adresse: gültige Namen bleiben; frühere Namen führen weiter; Platzhalter und Unbekanntes öffnen die Übersicht", () => {
    expect(settingFromAddress("System")).toBe("System"); expect(settingFromAddress("Rechnung & Rechtliches")).toBe("Rechnung & Rechtliches"); expect(settingFromAddress(" Profil ")).toBe("Profil");
    expect(settingFromAddress("E-Mail")).toBe("E-Mail-Versand"); expect(settingFromAddress("Domain")).toBe("E-Mail-Versand"); expect(settingFromAddress("Ansicht")).toBe("Profil");
    for (const gone of ["Zahlung", "Abonnement", "Affiliate", "Opt-in", "", null, undefined]) expect(settingFromAddress(gone)).toBeNull();
  });
});

describe("Einstellungen → System: Schalter in einfachen Worten", () => {
  it("fünf Schalter in drei Gruppen; jeder sagt, was passiert", () => {
    expect(systemSwitchGroups().map((group) => [group.group, group.items.map((item) => item.key)])).toEqual([["Auslieferung", ["fifo", "skipEmpty"]], ["Doppelte Kontakte", ["duplicate", "uploadUpdate"]], ["Ablehnungen", ["preping"]]]);
    expect(new Set(SYSTEM_SWITCHES.map((item) => item.key)).size).toBe(5);
    for (const item of SYSTEM_SWITCHES) { expect(item.title.length, item.key).toBeGreaterThan(10); expect(item.text.length, item.key).toBeGreaterThan(40); expect(`${item.title} ${item.text}`, item.key).not.toMatch(/FIFO|LIFO|API-Feld|Dublettenschutz|qualifiziert/); }
  });
  it("wo „aus“ nicht selbsterklärend ist, steht es dabei", () => {
    const text = (key: string) => SYSTEM_SWITCHES.find((item) => item.key === key)!.text;
    expect(text("fifo")).toContain("Aus: Der neueste Lead geht zuerst raus."); expect(text("uploadUpdate")).toContain("Aus: Er bleibt, wie er ist."); expect(text("uploadUpdate")).toContain("Doppelt angelegt wird er in keinem Fall.");
    expect(text("preping")).toContain("7 Tagen Prüffrist");
  });
});

describe("Einstellungen → Passwort: Eingaben prüfen", () => {
  it("nennt das erste, was nicht stimmt – in dieser Reihenfolge", () => {
    expect(passwordIssue("", "Neu12345678", "Neu12345678")).toBe("Bitte das aktuelle Passwort eintragen.");
    expect(passwordIssue("alt", "kurz1", "kurz1")).toBe("Das neue Passwort braucht mindestens 10 Zeichen.");
    expect(passwordIssue("alt", "nurbuchstaben", "nurbuchstaben")).toBe("Das neue Passwort braucht Buchstaben und mindestens eine Ziffer."); expect(passwordIssue("alt", "1234567890", "1234567890")).toContain("Buchstaben");
    expect(passwordIssue("alt", "Neu12345678", "Neu1234567")).toBe("Die Wiederholung stimmt nicht mit dem neuen Passwort überein.");
    expect(passwordIssue("Neu12345678", "Neu12345678", "Neu12345678")).toBe("Das neue Passwort ist dasselbe wie das aktuelle.");
    expect(passwordIssue("alt", "Neu12345678", "Neu12345678")).toBeNull();
  });
  it("dieselbe Regel wie auf dem Server: Was hier durchgeht, nimmt auch der Server – und umgekehrt", () => {
    for (const candidate of ["kurz1", "nurbuchstaben", "1234567890", "Neu12345678", "abcdefghi1", "ABCDEFGHIJ1", "passwort mit leerzeichen 9", "äöüäöüäöü1"]) expect(passwordIssue("alt", candidate, candidate) === null, candidate).toBe(validatePasswordStrength(candidate) === null);
  });
});

describe("Einstellungen → Reklamationen: Grund nach oben oder unten schieben", () => {
  const rows = [{ id: 11, sortOrder: 0 }, { id: 12, sortOrder: 1 }, { id: 13, sortOrder: 2 }, { id: 14, sortOrder: 3 }];
  it("tauscht zwei Nachbarn – nur diese beiden bekommen eine neue Platznummer", () => {
    expect(movedReasons(rows, 12, -1)).toEqual([{ id: 12, sortOrder: 0 }, { id: 11, sortOrder: 1 }]);
    expect(movedReasons(rows, 12, 1)).toEqual([{ id: 13, sortOrder: 1 }, { id: 12, sortOrder: 2 }]);
  });
  it("am Rand und bei unbekannter Nummer passiert nichts", () => {
    expect(movedReasons(rows, 11, -1)).toEqual([]); expect(movedReasons(rows, 14, 1)).toEqual([]); expect(movedReasons(rows, 99, 1)).toEqual([]); expect(movedReasons([], 1, 1)).toEqual([]);
  });
  it("gleiche oder lückenhafte Platznummern werden dabei lückenlos durchgezählt", () => {
    const messy = [{ id: 1, sortOrder: 0 }, { id: 2, sortOrder: 0 }, { id: 3, sortOrder: 0 }, { id: 4, sortOrder: 7 }];
    const changes = movedReasons(messy, 3, -1); // gezeigt: 1, 2, 3, 4 → 1, 3, 2, 4
    const after = messy.map((item) => ({ ...item, sortOrder: changes.find((change) => change.id === item.id)?.sortOrder ?? item.sortOrder })).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(after.map((item) => item.id)).toEqual([1, 3, 2, 4]); expect(after.map((item) => item.sortOrder)).toEqual([0, 1, 2, 3]);
    expect(changes.some((change) => change.id === 1)).toBe(false); // Platz 0 stimmte schon
  });
});
