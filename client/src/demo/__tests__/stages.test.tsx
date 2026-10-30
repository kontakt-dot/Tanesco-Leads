import { beforeEach, describe, expect, it } from "vitest";
import { callProcedure, getStore, resetStore } from "../backend";

const call = (path: string, input?: unknown) => callProcedure(path, input) as Promise<any>;
const stageOf = (publicId: string) => getStore().tables.leads.find((row) => row.publicId === publicId)?.pipelineStage;

describe("Stufen umbenannt oder neu angelegt: Verschieben findet die Stufe am Namen (Chat-Build)", () => {
  beforeEach(() => resetStore());

  it("„In andere Pipeline“, „In Stufe verschieben“ mit Standard-Schlüssel, Mehrfachauswahl und Speichern der Stufen – alles landet in der gleichnamigen Stufe, nie blind auf dem Eingang", async () => {
    const pipe = await call("leadops.createCustomPipeline", { label: "Stufen-Demo" });
    const own = [{ key: "neu", label: "Eingang", hint: "", fixed: "entry" }, { key: "stufe_k1", label: "Kontaktiert", hint: "" }, { key: "stufe_t1", label: "Termin", hint: "" }, { key: "kunde", label: "Kunde", hint: "", fixed: "won" }, { key: "raus", label: "Kein Interesse", hint: "", fixed: "lost" }];
    await call("leadops.savePipelineStages", { source: pipe.key, stages: own });
    const imported = await call("leadops.importColdList", { pipeline: "kaltakquise", listName: "Stufen-Demo Kalt", rows: [{ firstName: "Karl", lastName: "Kontakt", phone: "+49 30 9100001", email: "karl@stufen-demo.example" }, { firstName: "Tina", lastName: "Termin", phone: "+49 30 9100002", email: "tina@stufen-demo.example" }, { firstName: "Vera", lastName: "Verloren", phone: "+49 30 9100003", email: "vera@stufen-demo.example" }] });
    expect(imported.created).toBe(3);
    const byMail = (email: string) => getStore().tables.leads.find((row) => row.email === email)!.publicId;
    const karl = byMail("karl@stufen-demo.example"); const tina = byMail("tina@stufen-demo.example"); const vera = byMail("vera@stufen-demo.example");
    await call("leadops.movePipelineStage", { publicId: karl, stage: "kontaktiert" }); await call("leadops.movePipelineStage", { publicId: tina, stage: "termin" }); await call("leadops.movePipelineStage", { publicId: vera, stage: "verloren" });
    // In andere Pipeline: gleicher Name (anderer Schlüssel) bzw. gleiche Rolle
    expect((await call("leadops.moveLeadsToPipeline", { publicIds: [karl, tina, vera], target: pipe.key })).moved).toBe(3);
    expect(stageOf(karl)).toBe("stufe_k1"); expect(stageOf(tina)).toBe("stufe_t1"); expect(stageOf(vera)).toBe("raus");
    // Standard-Schlüssel oder Name statt eigenem Schlüssel
    expect((await call("leadops.movePipelineStage", { publicId: karl, stage: "termin" })).to).toBe("stufe_t1");
    expect((await call("leadops.movePipelineStage", { publicId: karl, stage: "Kontaktiert" })).to).toBe("stufe_k1");
    await expect(call("leadops.movePipelineStage", { publicId: karl, stage: "qualifiziert" })).rejects.toThrow(/Unbekannte Stufe „qualifiziert“ – die Pipeline dieses Kontakts hat: Eingang, Kontaktiert, Termin, Kunde, Kein Interesse/);
    // Mehrfachauswahl über zwei Pipelines
    await call("leadops.importColdList", { pipeline: "kaltakquise", listName: "Stufen-Demo Kalt 2", rows: [{ firstName: "Bodo", lastName: "Bulk", phone: "+49 30 9100004", email: "bodo@stufen-demo.example" }] }); const bodo = byMail("bodo@stufen-demo.example");
    expect((await call("leadops.bulkMovePipelineStage", { publicIds: [tina, bodo], stage: "kontaktiert" })).moved).toBe(2);
    expect(stageOf(tina)).toBe("stufe_k1"); expect(stageOf(bodo)).toBe("kontaktiert");
    // Stufe löschen und gleichnamig neu anlegen → Karte bleibt; ohne Namensvetter → Eingang
    await call("leadops.movePipelineStage", { publicId: karl, stage: "stufe_t1" });
    await call("leadops.savePipelineStages", { source: pipe.key, stages: [own[0], own[1], { key: "stufe_t2neu", label: "Termin", hint: "" }, own[3], own[4]] });
    expect(stageOf(karl)).toBe("stufe_t2neu"); expect((await call("leadops.pipelineHistory", { publicId: karl }))[0].note).toMatch(/„Termin“ wurde neu angelegt – Karte bleibt in „Termin“/);
    await call("leadops.savePipelineStages", { source: pipe.key, stages: [own[0], own[1], own[3], own[4]] });
    expect(stageOf(karl)).toBe("neu"); expect((await call("leadops.pipelineHistory", { publicId: karl }))[0].note).toMatch(/„Termin“ gibt es nicht mehr – auf „Eingang“ gesetzt/);
    // Pipeline löschen → Kaltakquise: Kontaktiert bleibt Kontaktiert, „Kein Interesse“ wird „Verloren“
    await call("leadops.deleteCustomPipeline", { key: pipe.key });
    expect(stageOf(tina)).toBe("kontaktiert"); expect(stageOf(vera)).toBe("verloren"); expect(stageOf(karl)).toBe("neu");
  });
});
