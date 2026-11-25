import { describe, expect, it } from "vitest";
import { gluedAddressError, hasGluedAddress } from "../shared/endpoint-url";

/** Version 365 – zwei Adressen hintereinander in einem Feld (alte beim Einfügen nicht gelöscht) */
describe("Zwei Adressen hintereinander (v365)", () => {
  it("erkennt alte und neue Adresse in einem Feld – eine Adresse in den Parametern ist erlaubt", () => {
    expect(hasGluedAddress("https://prelive.wattfox.net/v1/leadshttps://api-v1.photovoltaik-angebotsvergleich.de/v1/leads")).toBe(true);
    expect(hasGluedAddress(" https://a.example/login https://b.example/login ")).toBe(true);
    expect(hasGluedAddress("http://a.example/xHTTPS://b.example")).toBe(true);
    expect(hasGluedAddress("https://api-v1.photovoltaik-angebotsvergleich.de/v1/leads")).toBe(false);
    expect(hasGluedAddress("https://hooks.example/catch?weiter=https://b.example/x")).toBe(false);
    expect(hasGluedAddress("https://hooks.example/catch#https://b.example")).toBe(false);
    expect(hasGluedAddress("")).toBe(false); expect(hasGluedAddress(null)).toBe(false); expect(hasGluedAddress(undefined)).toBe(false);
  });

  it("sagt, in welchem Feld es steht und dass nichts gespeichert wurde", () => {
    expect(gluedAddressError("oben")).toBe("In der Adresse oben (neben „POST“) stehen zwei Adressen hintereinander – bitte alles im Feld löschen und nur die eine Adresse einfügen. Gespeichert wurde nichts.");
    expect(gluedAddressError("anmeldung")).toBe("In der Anmelde-Adresse stehen zwei Adressen hintereinander – bitte alles im Feld löschen und nur die eine Adresse einfügen. Gespeichert wurde nichts.");
  });
});
