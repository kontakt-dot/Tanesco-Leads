import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { fieldLabel, inputErrorMessage } from "../shared/input-errors";
import { publicProcedure, router } from "./_core/trpc";

const issuesOf = (schema: z.ZodType, value: unknown) => { const result = schema.safeParse(value); return result.success ? [] : result.error.issues; };

describe("Eingabefehler als deutscher Satz", () => {
  it("Feldbezeichnung aus dem Pfad", () => {
    expect(fieldLabel(["criteria", 0, "description"])).toBe("Kriterium 1 – Beschreibung");
    expect(fieldLabel(["questions", 2, "label"])).toBe("Frage 3 – Bezeichnung");
    expect(fieldLabel(["name"])).toBe("Name");
    expect(fieldLabel([])).toBe("Die Eingabe");
    expect(fieldLabel(["unbekanntesFeld"])).toBe("unbekanntesFeld");
  });
  it("zu lang, zu kurz, fehlt", () => {
    const schema = z.object({ criteria: z.array(z.object({ label: z.string().trim().min(2).max(160), description: z.string().max(500) })).max(2), name: z.string().trim().min(1) });
    expect(inputErrorMessage(issuesOf(schema, { name: "x", criteria: [{ label: "ok", description: "a".repeat(501) }] }))).toBe("Kriterium 1 – Beschreibung ist zu lang (höchstens 500 Zeichen).");
    expect(inputErrorMessage(issuesOf(schema, { name: "x", criteria: [{ label: "a", description: "" }] }))).toBe("Kriterium 1 – Bezeichnung ist zu kurz (mindestens 2 Zeichen).");
    expect(inputErrorMessage(issuesOf(schema, { name: "", criteria: [] }))).toBe("Name fehlt.");
    expect(inputErrorMessage(issuesOf(schema, { criteria: [] }))).toBe("Name fehlt.");
    expect(inputErrorMessage(issuesOf(schema, { name: "x", criteria: [{ label: "ok", description: "" }, { label: "ok", description: "" }, { label: "ok", description: "" }] }))).toBe("Kriterium: höchstens 2 Einträge möglich.");
  });
  it("Zahlen, Auswahlwerte, E-Mail und mehrere Fehler", () => {
    const schema = z.object({ weight: z.number().min(0).max(100), rule: z.enum(["ko", "required", "info"]), email: z.string().email() });
    expect(inputErrorMessage(issuesOf(schema, { weight: 120, rule: "ko", email: "a@b.de" }))).toBe("Gewicht darf höchstens 100 sein.");
    expect(inputErrorMessage(issuesOf(schema, { weight: -1, rule: "ko", email: "a@b.de" }))).toBe("Gewicht muss mindestens 0 sein.");
    expect(inputErrorMessage(issuesOf(schema, { weight: 1, rule: "pruefen", email: "a@b.de" }))).toBe("Regel: Dieser Wert ist nicht möglich.");
    expect(inputErrorMessage(issuesOf(schema, { weight: 1, rule: "ko", email: "keine-adresse" }))).toBe("E-Mail-Adresse ist keine gültige E-Mail-Adresse.");
    expect(inputErrorMessage(issuesOf(schema, { weight: 500, rule: "x", email: "y" }))).toBe("Gewicht darf höchstens 100 sein. (2 weitere Angaben passen ebenfalls nicht.)");
    expect(inputErrorMessage(issuesOf(schema, { weight: 500, rule: "x", email: "a@b.de" }))).toBe("Gewicht darf höchstens 100 sein. (1 weitere Angabe passt ebenfalls nicht.)");
  });
  it("ohne Angaben: allgemeine Meldung – nie die technische Liste", () => {
    expect(inputErrorMessage([])).toBe("Die Eingabe ist ungültig."); expect(inputErrorMessage(null)).toBe("Die Eingabe ist ungültig.");
    expect(inputErrorMessage([{ code: "etwas_neues", path: ["note"] }])).toBe("Notiz: Die Eingabe ist ungültig.");
  });
  it("kommt so beim Nutzer an: die Schnittstelle antwortet mit dem deutschen Satz, andere Fehler bleiben unverändert", async () => {
    const app = router({
      probe: publicProcedure.input(z.object({ criteria: z.array(z.object({ description: z.string().max(5) })) })).mutation(() => "ok"),
      kaputt: publicProcedure.mutation(() => { throw new Error("Bitte mindestens eine Frage angeben."); }),
    });
    const call = async (path: string, input: unknown) => (await (await fetchRequestHandler({ endpoint: "/trpc", req: new Request(`http://app.test/trpc/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: input }) }), router: app, createContext: () => ({}) as never })).json()) as { error?: { json: { message: string; data: { code: string } } }; result?: unknown };
    const rejected = await call("probe", { criteria: [{ description: "viel zu lang" }] });
    expect(rejected.error?.json.message).toBe("Kriterium 1 – Beschreibung ist zu lang (höchstens 5 Zeichen)."); expect(rejected.error?.json.data.code).toBe("BAD_REQUEST");
    expect((await call("kaputt", null)).error?.json.message).toBe("Bitte mindestens eine Frage angeben.");
    expect((await call("probe", { criteria: [{ description: "kurz" }] })).error).toBeUndefined();
  });
});
