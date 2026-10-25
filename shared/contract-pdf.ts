/**
 * PDF eines Vertrags (jsPDF, läuft im Browser und auf dem Server): A4, saubere Absätze, Felder, Unterschrift als Bild
 * und am Ende der Nachweis der elektronischen Unterschrift. Bilder müssen eingebettet (data:) sein – Adressen werden übersprungen.
 */
import { jsPDF } from "jspdf";
import { CONTRACT_EVENT_LABEL, detailValues, fillContract, formatContractDate, formatContractStamp, type ContractBlock, type ContractEventView, type ContractSignature, type ContractValues } from "./contracts";

const PAGE = { width: 210, height: 297, margin: 20 };
const FONT = { body: 10.5, heading: 13.5, title: 17, small: 8.5 };

export function buildContractPdf(input: { title: string; blocks: ContractBlock[]; values: ContractValues; fieldValues?: Record<string, string> | null; signature?: ContractSignature | null; events?: ContractEventView[] | null; logoDataUrl?: string | null; providerSignatureDataUrl?: string | null }): ArrayBuffer {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const values: ContractValues = { ...detailValues(input.blocks), ...input.values, ...(input.fieldValues ?? {}), titel: input.title, datum: input.values.datum || (input.signature ? formatContractDate(input.signature.signedAt) : "") };
  const width = PAGE.width - PAGE.margin * 2; let y = PAGE.margin;
  const ensure = (needed: number) => { if (y + needed > PAGE.height - PAGE.margin) { doc.addPage(); y = PAGE.margin; } };
  const text = (value: string, size = FONT.body, style: "normal" | "bold" | "italic" = "normal", color: [number, number, number] = [16, 24, 40], indent = 0) => {
    doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(value, width - indent) as string[]; const lineHeight = size * 0.3527 * 1.45;
    for (const line of lines) { ensure(lineHeight); doc.text(line, PAGE.margin + indent, y); y += lineHeight; }
  };
  const gap = (mm: number) => { y += mm; };
  const image = (dataUrl: string, maxWidth: number, maxHeight: number, align: "left" | "center" | "right" = "left") => {
    if (!/^data:image\/(png|jpeg|jpg)/i.test(dataUrl)) return false;
    try {
      const props = doc.getImageProperties(dataUrl); const ratio = props.width / Math.max(1, props.height);
      let w = Math.min(maxWidth, width); let h = w / ratio; if (h > maxHeight) { h = maxHeight; w = h * ratio; }
      ensure(h + 2); const x = align === "center" ? PAGE.margin + (width - w) / 2 : align === "right" ? PAGE.margin + width - w : PAGE.margin;
      doc.addImage(dataUrl, props.fileType === "JPEG" ? "JPEG" : "PNG", x, y, w, h); y += h + 2; return true;
    } catch { return false; }
  };
  const line = (fromX: number, toX: number) => { doc.setDrawColor(16, 24, 40); doc.setLineWidth(0.3); doc.line(fromX, y, toX, y); };
  const fieldValue = (key: string) => input.fieldValues?.[key] ?? "";

  for (const block of input.blocks) {
    switch (block.type) {
      case "logo": if (input.logoDataUrl) image(input.logoDataUrl, 48, Math.min(30, ((block.height ?? 36) / 96) * 25.4 * 1.6)); gap(4); break;
      case "heading": gap(4); text(fillContract(block.text, values), block === input.blocks.find((item) => item.type === "heading") ? FONT.title : FONT.heading, "bold"); gap(1.5); break;
      case "text": for (const part of fillContract(block.text, values).split(/\n{2,}/)) { text(part.replace(/\n/g, " ")); gap(2); } break;
      case "bullets": for (const item of block.items) { text(`•  ${fillContract(item, values)}`, FONT.body, "normal", [16, 24, 40], 2); } gap(2); break;
      case "image": if (block.src && image(block.src, (width * Math.min(100, Math.max(10, block.width ?? 60))) / 100, 120, block.align ?? "center")) gap(2); break;
      case "parties": {
        ensure(30); const top = y; const col = width / 2 - 4;
        const party = (x: number, label: string, lines: string[]) => { let yy = top; doc.setFont("helvetica", "bold"); doc.setFontSize(FONT.small); doc.setTextColor(188, 0, 29); doc.text(label.toUpperCase(), x, yy); yy += 4.5; doc.setFont("helvetica", "normal"); doc.setFontSize(FONT.body); doc.setTextColor(16, 24, 40); for (const value of lines.filter(Boolean)) { for (const wrapped of doc.splitTextToSize(value, col) as string[]) { doc.text(wrapped, x, yy); yy += 5; } } return yy; };
        const left = party(PAGE.margin, "Anbieter", [values.anbieterFirma, values.anbieterAdresse, values.anbieterVertreter ? `vertreten durch ${values.anbieterVertreter}` : "", values.anbieterWebseite ?? ""]);
        const right = party(PAGE.margin + col + 8, "Kunde", [values.firma, values.name, values.strasse, values.plzOrt, values.email]);
        y = Math.max(left, right) + 3; break;
      }
      case "detail": ensure(12); text(block.label, FONT.small, "normal", [102, 112, 133]); text(block.value.trim() || "–", FONT.body, "bold"); gap(1.5); break;
      case "field": ensure(12); text(block.label, FONT.small, "normal", [102, 112, 133]); text(fieldValue(block.key) || "–", FONT.body, "bold"); gap(1.5); break;
      case "date": ensure(8); text(`${block.label ?? "Datum"}: ${block.mode === "fest" ? formatContractDate(block.value) || "–" : input.signature ? formatContractDate(input.signature.signedAt) : "____________"}`); gap(1); break;
      case "signature": {
        ensure(34); gap(6);
        if (block.party === "kunde" && input.signature?.image) image(input.signature.image, 70, 22);
        else if (block.party === "anbieter" && input.providerSignatureDataUrl) image(input.providerSignatureDataUrl, 70, 22);
        else gap(18);
        line(PAGE.margin, PAGE.margin + 80); gap(4.5);
        const caption = block.party === "kunde" ? `${block.label ?? "Unterschrift Kunde"}${input.signature ? ` · ${input.signature.name} · ${formatContractStamp(input.signature.signedAt)}` : ""}` : `${block.label ?? "Unterschrift Anbieter"}${values.anbieterVertreter ? ` · ${values.anbieterVertreter}` : ""}${values.anbieterFirma ? `, ${values.anbieterFirma}` : ""}`;
        text(caption, FONT.small, "normal", [102, 112, 133]); gap(2); break;
      }
      case "divider": ensure(6); gap(2); doc.setDrawColor(228, 231, 236); doc.setLineWidth(0.2); doc.line(PAGE.margin, y, PAGE.margin + width, y); gap(4); break;
      case "pagebreak": doc.addPage(); y = PAGE.margin; break;
    }
  }
  if (input.signature) {
    doc.addPage(); y = PAGE.margin;
    text("Nachweis der elektronischen Unterschrift", FONT.heading, "bold"); gap(3);
    const rows: Array<[string, string]> = [["Dokument", input.title], ["Unterschrieben von", input.signature.name], ["Zeitpunkt", formatContractStamp(input.signature.signedAt)], ["IP-Adresse", input.signature.ip ?? "–"], ["Gerät / Browser", (input.signature.userAgent ?? "–").slice(0, 160)], ["Prüfsumme Dokument (SHA-256)", input.signature.documentHash ?? "–"], ["Prüfsumme Unterschrift (SHA-256)", input.signature.signedHash ?? "–"]];
    for (const [label, value] of rows) { text(label, FONT.small, "normal", [102, 112, 133]); text(value, FONT.body); gap(1.5); }
    if (input.events?.length) { gap(3); text("Vorgang", FONT.body, "bold"); gap(1); for (const event of input.events) text(`${formatContractStamp(event.createdAt)} – ${CONTRACT_EVENT_LABEL[event.kind] ?? event.kind}${event.note ? ` – ${event.note}` : ""}${event.ip ? ` (${event.ip})` : ""}`, FONT.small, "normal", [102, 112, 133]); }
    gap(4); text("Die Prüfsummen erlauben es, nachträglich zu prüfen, dass Dokument und Unterschrift seit der Unterzeichnung unverändert sind.", FONT.small, "italic", [102, 112, 133]);
  }
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) { doc.setPage(page); doc.setFont("helvetica", "normal"); doc.setFontSize(FONT.small); doc.setTextColor(152, 162, 179); doc.text(`${input.title} · Seite ${page} von ${pages}`, PAGE.margin, PAGE.height - 10); }
  return doc.output("arraybuffer");
}
