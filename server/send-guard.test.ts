import { describe, expect, it } from "vitest";
import { replayPosition, withSendLog } from "../shared/send-guard";
import type { EmailTree } from "../shared/email-campaigns";

const tree = { start: "a", nodes: [{ id: "a", type: "send", label: "Erste", subject: "Erste", blocks: [], next: "w" }, { id: "w", type: "wait", hours: 72, next: "b" }, { id: "b", type: "send", label: "Nachfrage", subject: "Nachfrage", blocks: [], next: null }] } as unknown as EmailTree;
const at = (iso: string) => new Date(iso);

describe("Doppelt-Schutz: wo steht ein Kontakt, der die Kampagne schon bekommen hat?", () => {
  it("nach der Erst-E-Mail: in der Wartezeit bis Erst-E-Mail + 72 Stunden", () => {
    const result = replayPosition(tree, [{ nodeId: "a", at: at("2026-11-02T09:15:00Z") }])!;
    expect(result.sends.map((send) => send.nodeId)).toEqual(["a"]);
    expect(result.position).toMatchObject({ status: "wartet", nodeId: "w" }); expect(result.position.nextActionAt?.toISOString()).toBe("2026-11-05T09:15:00.000Z");
  });
  it("nach der letzten E-Mail: fertig; unbekannter Schritt zählt als Erst-E-Mail; nur der letzte Durchlauf zählt", () => {
    expect(replayPosition(tree, [{ nodeId: "a", at: at("2026-11-01T09:00:00Z") }, { nodeId: "b", at: at("2026-11-04T09:00:00Z") }])!.position.status).toBe("fertig");
    expect(replayPosition(tree, [{ nodeId: "alt-weg", at: at("2026-11-01T09:00:00Z") }])!.sends.map((send) => send.nodeId)).toEqual(["a"]);
    const runs = replayPosition(tree, [{ nodeId: "a", at: at("2026-10-01T09:00:00Z") }, { nodeId: "b", at: at("2026-10-04T09:00:00Z") }, { nodeId: "a", at: at("2026-11-02T09:00:00Z") }])!;
    expect(runs.sends.map((send) => send.nodeId)).toEqual(["a"]); expect(runs.position.status).toBe("wartet");
    expect(replayPosition(tree, [])).toBeNull();
  });
  it("Zahlen mit Protokoll: Kennzahlen bleiben bei den Kontakten der Kampagne, dazu E-Mails an Entfernte und heute", () => {
    expect(withSendLog({ mails: { sent: 3, opened: 1, clicked: 0, replied: 0 }, sent: 3 }, 7, 2)).toMatchObject({ mails: { sent: 3, opened: 1 }, sentGone: 4, sentToday: 2, sent: 3 });
    expect(withSendLog({ mails: { sent: 5, opened: 0, clicked: 0, replied: 0 } }, 4, 0)).toMatchObject({ mails: { sent: 5 }, sentGone: 0 });
  });
});
