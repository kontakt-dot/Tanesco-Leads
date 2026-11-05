import { describe, expect, it } from "vitest";
import { dialerGuideText } from "../shared/dialer-guide";
import { DEFAULT_MAPPING } from "./call-qa";

describe("Anleitung für den Dialer-Entwickler (Webhook „Gespräch beendet“)", () => {
  it("enthält Adresse, Pflichtfelder, Beispiel, Antworten, Testmodus – und keinen Produktnamen", () => {
    const text = dialerGuideText({ webhookUrl: "https://app.example/api/partner/ondialer/geheim123", fieldMapping: DEFAULT_MAPPING, consentRequired: true, recordingAuthHeader: false });
    expect(text).toContain("POST https://app.example/api/partner/ondialer/geheim123");
    expect(text).toContain("GET https://app.example/api/partner/ondialer/geheim123");
    for (const field of ["call_id", "phone", "recording_url", "consent", "agent", "campaign", "started_at", "duration", "lead_id", "transcript"]) expect(text).toContain(`\`${field}\``);
    expect(text).toContain("| `call_id` | ja |"); expect(text).toContain("| `recording_url` | ja |"); expect(text).toContain("| `agent` | nein |");
    expect(text).toContain("\"test\": true"); expect(text).toContain("required_missing"); expect(text).toContain("duplicate"); expect(text).toContain("bis zu 8-mal");
    expect(text).toContain("Einwilligung erforderlich: ja"); expect(text).toContain("ohne Login abrufbar");
    expect(text).not.toMatch(/tanesco|fluxora/i);
  });
  it("übernimmt eigene Feldnamen und den Stand der Einstellungen", () => {
    const text = dialerGuideText({ webhookUrl: "https://app.example/api/partner/dialer/t", fieldMapping: { ...DEFAULT_MAPPING, callId: "call.id", recordingUrl: "record_file" }, consentRequired: false, recordingAuthHeader: true });
    expect(text).toContain("| `call.id` | ja |"); expect(text).toContain("| `record_file` | ja |"); expect(text).toContain("\"record_file\": \"https://IHR-SERVER/recordings/000123.mp3\"");
    expect(text).toContain("Einwilligung erforderlich: nein"); expect(text).toContain("Zugriffs-Header für Aufnahmen: hinterlegt");
  });
});
