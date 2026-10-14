export function getInvoiceBreakdown(amount: string | number, vatRate: string | number = 19) {
  const gross = Number(amount); const rate = Number(vatRate); const net = gross / (1 + rate / 100); const tax = gross - net;
  return { gross: Number(gross.toFixed(2)), net: Number(net.toFixed(2)), tax: Number(tax.toFixed(2)), vatRate: rate };
}
