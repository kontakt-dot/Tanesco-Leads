import { describe, expect, it } from "vitest";
import { attachmentIssue, validateTree } from "../shared/email-campaigns";

const file = (name: string, size: number) => ({ filename: name, contentType: "application/pdf", contentBase64: "JVBERi0=", size });
describe("Anhänge an Kampagnen-E-Mails", () => {
  it("Grenzen: Anzahl, Größe, keine Programme", () => {
    expect(attachmentIssue([file("Angebot.pdf", 200_000)])).toBeNull();
    expect(attachmentIssue([file("a.pdf", 1), file("b.pdf", 1), file("c.pdf", 1), file("d.pdf", 1)])).toMatch(/Höchstens 3/);
    expect(attachmentIssue([file("riesig.pdf", 6 * 1024 * 1024)])).toMatch(/zu groß/);
    expect(attachmentIssue([file("x.pdf", 4.5 * 1024 * 1024), file("y.pdf", 4.5 * 1024 * 1024)])).toMatch(/zusammen/);
    expect(attachmentIssue([file("setup.exe", 10)])).toMatch(/Programme/);
  });
  it("Ablauf-Prüfung meldet zu große Anhänge", () => {
    const issues = validateTree({ start: "s1", nodes: [{ id: "s1", type: "send", label: "Erste", subject: "Hallo", blocks: [], attachments: [file("riesig.pdf", 9 * 1024 * 1024)], next: null }] } as never);
    expect(issues.some((issue) => /Erste.*zu groß/.test(issue))).toBe(true);
  });
});
