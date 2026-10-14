import { describe, expect, it } from "vitest";

const normalizeLegalSettings = (input: { invoicePrefix: string; vatRate: string; emailFooterHtml: string }) => ({ invoicePrefix: input.invoicePrefix.trim(), vatRate: Number(input.vatRate.replace(",", ".")), emailFooterHtml: input.emailFooterHtml.trim() || null });

describe("Rechnungs- und Rechtseinstellungen", () => {
  it("normalisiert Präfix, Steuersatz und optionalen E-Mail-Footer vor dem Speichern", () => {
    expect(normalizeLegalSettings({ invoicePrefix: " RE ", vatRate: "19,0", emailFooterHtml: "  " })).toEqual({ invoicePrefix: "RE", vatRate: 19, emailFooterHtml: null });
  });
});
