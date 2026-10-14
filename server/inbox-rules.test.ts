import { describe, expect, it } from "vitest";
import { detectOptOut, SUPPRESSION_LABELS, SUPPRESSION_LISTS } from "../shared/email-campaigns";
import { suppressionCounts } from "./pipeline-extras";

describe("Posteingang: Abmeldung erkennen, Sperrliste als Unterlisten", () => {
  it("erkennt Abmeldungen in Antworten – nicht aber normale Antworten oder zitierte Zeilen", () => {
    for (const text of ["Bitte keine weiteren E-Mails.", "Unsubscribe", "Bitte nehmen Sie mich aus dem Verteiler.", "Ich möchte mich abmelden", "STOP", "Stoppen Sie bitte diese Mails", "Bitte nicht mehr anschreiben, danke.", "Keine Werbung bitte"]) expect(detectOptOut(text), text).toBe(true);
    for (const text of ["Hallo, klingt interessant. Wann können wir telefonieren?", "Bitte keine Sorge, wir melden uns nächste Woche.", "Ich stoppe gerade den Betrieb wegen Urlaub", "Im Moment kein Bedarf, bitte melden Sie sich im Frühjahr wieder.", "> bitte keine weiteren E-Mails\nDas war nicht ich, gerne weiter Infos"]) expect(detectOptOut(text), text).toBe(false);
    expect(detectOptOut("", "Abmelden")).toBe(true);
  });
  it("führt jede Adresse genau in einer Unterliste", () => {
    const counts = suppressionCounts([{ reason: "bounce" }, { reason: "bounce" }, { reason: "abgemeldet" }, { reason: "gesperrt" }, { reason: "manuell" }, { reason: "beschwerde" }]);
    expect(counts).toEqual({ alle: 6, bounce: 2, abgemeldet: 1, beschwerde: 1, gesperrt: 1, manuell: 1 });
    expect(SUPPRESSION_LISTS.map((entry) => entry.key)).toEqual(["alle", "bounce", "abgemeldet", "beschwerde", "gesperrt", "manuell"]);
    expect(Object.keys(SUPPRESSION_LABELS)).toEqual(["bounce", "beschwerde", "abgemeldet", "gesperrt", "manuell"]);
  });
});
