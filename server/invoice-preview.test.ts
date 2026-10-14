import { describe, expect, it } from "vitest";
import { getInvoiceBreakdown } from "../client/src/lib/invoicePreview";

describe("Rechnungsvorschau", () => {
  it("berechnet Nettobetrag und Umsatzsteuer aus einem Bruttobetrag", () => {
    expect(getInvoiceBreakdown("119.00", 19)).toEqual({ gross: 119, net: 100, tax: 19, vatRate: 19 });
  });
});
