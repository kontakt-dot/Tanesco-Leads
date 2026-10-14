import { describe, expect, it } from "vitest";
import { claimEventLabel, claimTimelineSource } from "../client/src/components/claim-timeline-contract";

describe("Reklamationschronik-Vertrag", () => {
  it("beschriftet alle gespeicherten Ereignistypen ohne synthetische Fallback-Schritte", () => {
    expect(claimTimelineSource).toBe("persistierte_claim_events");
    expect(["erstellt", "frist_gesetzt", "status_geändert", "entschieden", "notiz"].map(claimEventLabel)).toEqual(["Reklamation erfasst", "Prüfungsfrist gesetzt", "Status aktualisiert", "Entscheidung dokumentiert", "Fallnotiz"]);
  });
});
