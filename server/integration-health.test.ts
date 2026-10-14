import { describe, expect, it } from "vitest";
import { isSafeHealthUrl } from "./integration-health";

describe("Integrationsgesundheit", () => {
  it("prüft nur öffentliche HTTPS-Ziele und blockiert interne oder unverschlüsselte Adressen", () => {
    expect(isSafeHealthUrl("https://api.partner.example/health")).toBe(true);
    expect(isSafeHealthUrl("http://api.partner.example/health")).toBe(false);
    expect(isSafeHealthUrl("https://localhost:3000/health")).toBe(false);
    expect(isSafeHealthUrl("https://192.168.1.7/health")).toBe(false);
    expect(isSafeHealthUrl("https://172.20.10.8/health")).toBe(false);
  });
});
