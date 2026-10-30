import { describe, expect, it } from "vitest";
import { MAILBOX_KINDS, mailboxMissing, mailboxOf, mailboxPreset } from "../shared/mailbox";

describe("Eigenes Postfach je Absender-Adresse", () => {
  it("Voreinstellungen: Google (465, TLS sofort), Microsoft (587), anderer Anbieter ohne festen Server", () => {
    expect(MAILBOX_KINDS.map((item) => item.key)).toEqual(["google", "microsoft", "smtp"]);
    expect(mailboxPreset("google")).toMatchObject({ host: "smtp.gmail.com", port: 465, secure: true }); expect(mailboxPreset("microsoft")).toMatchObject({ host: "smtp.office365.com", port: 587, secure: false }); expect(mailboxPreset("smtp")!.host).toBe(""); expect(mailboxPreset("keins")).toBeNull();
  });
  it("mailboxOf: nur mit Art, Server, Benutzer und Passwort – Voreinstellung füllt Server und Port; fehlende Teile werden benannt", () => {
    expect(mailboxOf({ mailboxKind: null })).toBeNull(); expect(mailboxMissing({ mailboxKind: null })).toEqual([]);
    expect(mailboxOf({ mailboxKind: "google", smtpUser: "taner@firma.de", smtpPassword: "x" })).toEqual({ kind: "google", host: "smtp.gmail.com", port: 465, secure: true, user: "taner@firma.de", password: "x" });
    expect(mailboxOf({ mailboxKind: "google", smtpUser: "taner@firma.de" })).toBeNull(); expect(mailboxMissing({ mailboxKind: "google", smtpUser: "taner@firma.de" })).toEqual(["Passwort"]);
    expect(mailboxMissing({ mailboxKind: "smtp" })).toEqual(["Server", "Benutzer", "Passwort"]);
    expect(mailboxOf({ mailboxKind: "smtp", smtpHost: "smtp.ionos.de", smtpPort: 587, smtpSecure: false, smtpUser: "u", smtpPassword: "p" })).toMatchObject({ host: "smtp.ionos.de", port: 587, secure: false });
    expect(mailboxOf({ mailboxKind: "smtp", smtpHost: "smtp.ionos.de", smtpPort: 465, smtpUser: "u", smtpPassword: "p" })!.secure).toBe(true); // ohne Angabe: 465 = TLS sofort
    expect(mailboxOf({ mailboxKind: "irgendwas", smtpHost: "h", smtpUser: "u", smtpPassword: "p" })).toBeNull();
  });
});
