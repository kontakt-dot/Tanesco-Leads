import { describe, expect, it, vi } from "vitest";
import { brevoTransport, parseAddress } from "./brevo-api";

/** Versand über die HTTP-Schnittstelle von Brevo – nötig, weil viele Hoster (Railway) die Mail-Ports sperren. */
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Brevo über HTTP: Adressen lesen", () => {
  it("trennt Name und Adresse, akzeptiert blanke Adressen, weist Unsinn ab", () => {
    expect(parseAddress("Tanesco Digital <kontakt@tanescodigital.de>")).toEqual({ name: "Tanesco Digital", email: "kontakt@tanescodigital.de" });
    expect(parseAddress('"Taner, Vertrieb" <taner@example.de>')).toEqual({ name: "Taner, Vertrieb", email: "taner@example.de" });
    expect(parseAddress("kontakt@tanescodigital.de")).toEqual({ email: "kontakt@tanescodigital.de" });
    expect(parseAddress(" <kontakt@tanescodigital.de> ")).toEqual({ email: "kontakt@tanescodigital.de" });
    expect(parseAddress("")).toBeNull(); expect(parseAddress(null)).toBeNull(); expect(parseAddress("kein-email")).toBeNull();
  });
});

describe("Brevo über HTTP: senden", () => {
  it("schickt die Mail an die Schnittstelle und liefert die Nachrichten-Kennung", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init: init ?? {} }); return ok({ messageId: "<abc@brevo>" }); }) as unknown as typeof fetch;
    const transport = brevoTransport("xkeysib-test", { fetchImpl });
    const result = await transport.sendMail({ from: "Tanesco Digital <kontakt@tanescodigital.de>", replyTo: "antwort@tanescodigital.de", to: "kunde@beispiel.de", subject: "Hallo", html: "<p>Text</p>", text: "Text" });
    expect(result.messageId).toBe("<abc@brevo>");
    expect(calls[0].url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((calls[0].init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-test");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ sender: { name: "Tanesco Digital", email: "kontakt@tanescodigital.de" }, to: [{ email: "kunde@beispiel.de" }], subject: "Hallo", htmlContent: "<p>Text</p>", textContent: "Text", replyTo: { email: "antwort@tanescodigital.de" } });
  });

  it("nimmt Anhänge mit und meldet unbrauchbare Adressen klar", async () => {
    const fetchImpl = vi.fn(async () => ok({ messageId: "<x@brevo>" })) as unknown as typeof fetch;
    const transport = brevoTransport("xkeysib-test", { fetchImpl });
    await expect(transport.sendMail({ from: "kaputt", to: "kunde@beispiel.de", subject: "x" })).rejects.toThrow(/Absenderadresse/);
    await expect(transport.sendMail({ from: "kontakt@tanescodigital.de", to: "kaputt", subject: "x" })).rejects.toThrow(/Empfängeradresse/);
    // Brevo will Base64: fertige Base64-Inhalte (encoding "base64") gehen unverändert durch, roher Text (z. B. die Termin-Datei) wird kodiert
    const spy = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => { expect(JSON.parse(String(init?.body)).attachment).toEqual([{ name: "angebot.pdf", content: "QkVHSU4=" }, { name: "termin.ics", content: Buffer.from("BEGIN", "utf8").toString("base64") }]); return ok({ messageId: "<y@brevo>" }); }) as unknown as typeof fetch;
    await brevoTransport("xkeysib-test", { fetchImpl: spy }).sendMail({ from: "kontakt@tanescodigital.de", to: "kunde@beispiel.de", subject: "Termin", attachments: [{ filename: "angebot.pdf", content: "QkVHSU4=", encoding: "base64" }, { filename: "termin.ics", content: "BEGIN" }] });
  });

  it("verify prüft den Schlüssel, weist den SMTP-Schlüssel mit Hinweis ab und reicht Fehler der Schnittstelle weiter", async () => {
    const fetchImpl = vi.fn(async () => ok({ email: "kontakt@tanescodigital.de" })) as unknown as typeof fetch;
    await expect(brevoTransport("xkeysib-test", { fetchImpl }).verify()).resolves.toBe(true);
    await expect(brevoTransport("xsmtpsib-014ba", { fetchImpl }).verify()).rejects.toThrow(/API-Schlüssel/);
    await expect(brevoTransport("", { fetchImpl }).verify()).rejects.toThrow(/Kein Brevo-API-Schlüssel/);
    const failing = vi.fn(async () => ok({ message: "Key not found" }, 401)) as unknown as typeof fetch;
    await expect(brevoTransport("xkeysib-falsch", { fetchImpl: failing }).verify()).rejects.toThrow(/Brevo 401: Key not found/);
  });
});

describe("Einstellungen mit dem HTTP-Anbieter", () => {
  it("transportFor liefert den HTTP-Versand, sobald provider=brevo_api und ein Schlüssel gespeichert ist", async () => {
    const { isApiProvider, PROVIDERS } = await import("./mail-settings");
    expect(isApiProvider("brevo_api")).toBe(true); expect(isApiProvider("brevo")).toBe(false);
    const preset = PROVIDERS.find((item) => item.key === "brevo_api")!;
    expect(preset).toMatchObject({ host: "", dailyLimit: 300 }); expect(preset.hint).toContain("xkeysib-");
    // Der Transport wird aus den gespeicherten Einstellungen gebaut: kein Host/Benutzer nötig, nur das Passwort (= API-Schlüssel)
    const rows = [{ tenantId: 1, provider: "brevo_api", enabled: true, password: "xkeysib-test", host: null, username: null, fromName: "Tanesco Digital", fromEmail: "kontakt@tanescodigital.de", replyTo: null }];
    const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }) } as never;
    const { transportFor } = await import("./mail-settings");
    const ready = await transportFor(db, 1);
    expect(ready?.source).toBe("mandant");
    expect(ready?.from).toBe("Tanesco Digital <kontakt@tanescodigital.de>");
    expect(typeof ready?.transport.sendMail).toBe("function");
  });
});
