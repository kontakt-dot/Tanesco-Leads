import { describe, expect, it, beforeAll } from "vitest";
import { callProcedure, getStore, resetStore } from "../backend";

const call = (path: string, input?: unknown) => callProcedure(path, input) as Promise<any>;

describe("Lead-Pipeline im Chat-Build", () => {
  beforeAll(() => resetStore());

  it("liefert neue Leads automatisch über Automatisierung, Bestellung und Käufer-Integration aus", async () => {
    const categories = await call("leadops.listCategories"); const cat = categories[0];
    const suppliers = await call("leadops.listSuppliers"); const supplier = suppliers[0];
    const members = await call("leadops.listMembers"); const buyer = members.find((m: any) => m.status === "aktiv" && m.userId !== getStore().tables.users[0].id) ?? members[1];
    const integrations = await call("leadops.listPartnerIntegrations");
    const integration = integrations.find((i: any) => i.credentialConfigured && i.callbackUrl) ?? integrations[0];
    if (!integration.credentialConfigured) await call("leadops.setPartnerIntegrationCredential", { id: integration.id, secret: "demo-key" });
    if (!integration.callbackUrl) await call("leadops.updatePartnerIntegration", { id: integration.id, callbackUrl: "https://partner.example/leads" });
    await call("leadops.updatePartnerIntegration", { id: integration.id, status: "aktiv" });
    await call("leadops.updateMembership", { id: buyer.membershipId, integrationId: integration.id });

    const order = await call("leadops.createOrder", { name: "Pipeline-Test", buyerName: "Pipeline Käufer", categoryId: cat.id, quantity: 5, unitPrice: 50, status: "aktiv" });
    await call("leadops.saveOrderWorkspace", { orderId: order.orderId, name: "Pipeline-Test", buyerName: "Pipeline Käufer", buyerUserId: buyer.userId, categoryId: cat.id, categoryIds: [cat.id], quantity: 5, unitPrice: 50, supplierId: supplier.id, supplierMode: "ein", supplierIds: [supplier.id], deliveryInterval: "sofort", compensateClaims: false, priority: 1, realtimeDelivery: true, startsAt: null, endsAt: null, ongoing: true, deliveryDays: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"], deliveryArea: "landesweit", pauses: [], advancedFilters: { minAgeDays: null, maxLeadPrice: null, postcodes: null } });
    await call("leadops.createDeliveryChain", { orderId: order.orderId, categoryId: cat.id, name: "Pipeline-Kette", priority: 1, sellTarget: 1, distributionMode: "lieferketten_round_robin" });
    const chain = (await call("leadops.listDeliveryChains")).find((c: any) => c.name === "Pipeline-Kette");
    await call("leadops.addDeliveryStop", { chainId: chain.id, buyerName: "Pipeline Käufer", position: 1, unitPrice: 50 });
    await call("leadops.updateDeliveryChain", { id: chain.id, status: "aktiv" });
    await call("leadops.createAutomationRule", { name: "Pipeline-Regel", triggerType: "lead_erstellt", sourceCategoryId: cat.id, targetCategoryId: cat.id, conditions: [{ field: "city", operator: "gleich", value: "Kiel" }], actionType: "lead_bestellung_zuordnen", actionConfig: { orderId: order.orderId }, status: "aktiv" });

    const before = getStore().tables.integrationEvents.length;
    const imported = await call("leadops.importLead", { categoryId: cat.id, firstName: "Pia", lastName: "Pipeline", email: "pia@example.de", postcode: "24103", city: "Kiel", supplierId: supplier.id });
    expect(imported.automation).toMatchObject({ executed: 1, delivered: 1 });
    const lead = getStore().tables.leads.find((row) => row.publicId === imported.publicId)!;
    expect(lead.status).toBe("zugewiesen");
    const delivery = getStore().tables.leadDeliveries.find((row) => row.leadId === lead.id)!;
    expect(delivery).toMatchObject({ orderId: order.orderId, buyerName: "Pipeline Käufer", result: "angenommen" });
    expect(getStore().tables.integrationEvents.length).toBe(before + 1);
    const log = (await call("leadops.listAutomationExecutionLogs")).find((l: any) => l.ruleName === "Pipeline-Regel");
    expect(log.summary).toContain("ausgeliefert an Pipeline Käufer (API");

    // Lead ohne passende Stadt: Regel greift nicht, Lead bleibt neu; manuelle Auslieferung nennt die Lieferantensperre
    const other = await call("leadops.importLead", { categoryId: cat.id, firstName: "Olaf", lastName: "Ohne", city: "Bonn" });
    expect(other.automation).toMatchObject({ executed: 0, delivered: 0 });
    await expect(call("leadops.deliverLead", { publicId: other.publicId, orderId: order.orderId })).rejects.toThrow("Lieferant für diese Bestellung nicht freigegeben");
    const manual = await call("leadops.runLeadAutomation", { publicId: other.publicId, triggerType: "lead_erstellt" });
    expect(manual).toEqual({ duplicated: 0, executed: 0, delivered: 0 });
  });
});

describe("Pipeline-Zusätze im Chat-Build", () => {
  it("schützt vor Doppelauslieferung, weicht bei Ablehnung aus und plant Intervall-Lieferungen", async () => {
    resetStore();
    const cat = (await call("leadops.listCategories"))[0];
    await call("leadops.createDeliveryChain", { categoryId: cat.id, name: "Ausweichkette", priority: 2, sellTarget: 1, distributionMode: "lieferketten_round_robin" });
    const chain = (await call("leadops.listDeliveryChains")).find((c: any) => c.name === "Ausweichkette");
    await call("leadops.addDeliveryStop", { chainId: chain.id, buyerName: "Ausweich Käufer", position: 1, unitPrice: 30 });
    await call("leadops.updateDeliveryChain", { id: chain.id, status: "aktiv" });
    const lead = await call("leadops.importLead", { categoryId: cat.id, firstName: "Doppel", lastName: "Test", email: "doppel@example.de", city: "Bremen" });
    const first = await call("leadops.deliverLead", { publicId: lead.publicId });
    expect(["angeboten", "angenommen"]).toContain(first.result);
    await expect(call("leadops.deliverLead", { publicId: lead.publicId })).rejects.toThrow("bereits an");
    await expect(call("leadops.deliverLead", { publicId: lead.publicId, allowRepeat: true })).rejects.toThrow("Dublettenschutz"); // gleicher Kontakt nicht erneut an denselben Käufer
    await call("leadops.updateTenantSettings", { outgoingDuplicateProtection: false });
    const repeated = await call("leadops.deliverLead", { publicId: lead.publicId, allowRepeat: true });
    expect(repeated.attempts.length).toBeGreaterThan(0);
    await call("leadops.updateTenantSettings", { outgoingDuplicateProtection: true });

    // Tägliches Intervall ohne Echtzeit → Zeitplaner
    const order = await call("leadops.createOrder", { name: "Tagesbestellung", buyerName: "Tages Käufer", categoryId: cat.id, quantity: 5, unitPrice: 40, status: "aktiv" });
    await call("leadops.saveOrderWorkspace", { orderId: order.orderId, name: "Tagesbestellung", buyerName: "Tages Käufer", buyerUserId: null, categoryId: cat.id, categoryIds: [cat.id], quantity: 5, unitPrice: 40, supplierId: null, supplierMode: "alle", supplierIds: [], deliveryInterval: "täglich", compensateClaims: false, priority: 1, realtimeDelivery: false, startsAt: null, endsAt: null, ongoing: true, deliveryDays: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"], deliveryArea: "landesweit", pauses: [], advancedFilters: { minAgeDays: null, maxLeadPrice: null, postcodes: null } });
    await call("leadops.createDeliveryChain", { orderId: order.orderId, categoryId: cat.id, name: "Tageskette", priority: 1, sellTarget: 1, distributionMode: "lieferketten_round_robin" });
    const daily = (await call("leadops.listDeliveryChains")).find((c: any) => c.name === "Tageskette");
    await call("leadops.addDeliveryStop", { chainId: daily.id, buyerName: "Tages Käufer", position: 1, unitPrice: 40 });
    await call("leadops.updateDeliveryChain", { id: daily.id, status: "aktiv" });
    const pendingLead = await call("leadops.importLead", { categoryId: cat.id, firstName: "Warte", lastName: "Schleife", city: "Kiel" });
    await call("leadops.assignLeadsToOrder", { publicIds: [pendingLead.publicId], orderId: order.orderId });
    expect(getStore().tables.leads.find((row) => row.publicId === pendingLead.publicId)!.status).toBe("neu");
    const run = await call("leadops.runScheduledDeliveries");
    expect(run.delivered).toBe(1);
    expect(getStore().tables.leads.find((row) => row.publicId === pendingLead.publicId)!.status).toBe("zugewiesen");
  });
});

describe("Benutzerbereich im Chat-Build", () => {
  it("legt einen Benutzer an, pflegt Reiter-Einstellungen, Lieferanten-Token, Guthaben und Impersonation", async () => {
    resetStore();
    const created = await call("leadops.createMember", { firstName: "Karla", lastName: "Kunde", company: "Kunde GmbH", email: "karla@kunde.example", password: "sicher-2026-xyz", kind: "benutzer", status: "aktiv", billingCountry: "DE" });
    const detail = await call("leadops.getMemberDetail", { membershipId: created.membershipId });
    expect(detail.user.email).toBe("karla@kunde.example"); expect(detail.membership.partnerType).toBe("käufer"); expect(detail.settings.reclamationPeriodHours).toBe(24);
    await call("leadops.updateMemberClaimSettings", { membershipId: created.membershipId, reclamationPeriodHours: 48, autoAcceptApiClaims: true, blockedClaimCategoryIds: [], excludedClaimReasonIds: [] });
    await call("leadops.updateMemberBillingSettings", { membershipId: created.membershipId, paymentMode: "auf_rechnung", billingInterval: "14_tage", paymentTermsDays: 30, taxRatePercent: null });
    await call("leadops.adjustMemberBalance", { membershipId: created.membershipId, kind: "aufladung", amount: 250, description: "Überweisung" });
    const supplier = await call("leadops.updateSupplierSettings", { membershipId: created.membershipId, supplierActive: true, commissionOnEverySale: false, commissionRates: { [String(getStore().tables.leadCategories[0].id)]: { type: "fix", value: 5 } } });
    expect(supplier.supplierId).toBeGreaterThan(0);
    const token = await call("leadops.issueSupplierToken", { membershipId: created.membershipId });
    expect(token.token).toMatch(/^fx_/);
    expect((await call("leadops.revealSupplierToken", { membershipId: created.membershipId })).token).toBe(token.token);
    await call("leadops.saveSupplierInboundMappings", { membershipId: created.membershipId, kind: "kategorie", rows: [{ kind: "kategorie", sourceValue: "PV-WP", targetValue: String(getStore().tables.leadCategories[0].id) }] });
    const after = await call("leadops.getMemberDetail", { membershipId: created.membershipId });
    expect(after.settings).toMatchObject({ reclamationPeriodHours: 48, autoAcceptApiClaims: true, paymentMode: "auf_rechnung", billingInterval: "14_tage", prepaidBalance: "250.00", supplierActive: true });
    expect(after.mappings).toHaveLength(1); expect(after.supplier?.name).toBe("Kunde GmbH");
    expect((await call("leadops.listMembers")).find((m: any) => m.membershipId === created.membershipId)).toMatchObject({ paymentMode: "auf_rechnung", prepaidBalance: "250.00", supplierActive: true });
    await call("auth.impersonate", { membershipId: created.membershipId });
    expect((await call("auth.me")).impersonatedBy).toBeTruthy();
    await call("auth.stopImpersonation");
    expect((await call("auth.me")).impersonatedBy).toBeNull();
    const activity = await call("leadops.listMemberActivity", { membershipId: created.membershipId });
    expect(activity.some((event: any) => event.kind === "guthaben")).toBe(true);
  });
});

describe("Integration im Chat-Build", () => {
  it("richtet einen ausgehenden API-Call ein, testet ihn, mappt Ablehnungen und liefert darüber aus", async () => {
    resetStore();
    const cat = (await call("leadops.listCategories"))[0];
    const members = await call("leadops.listMembers");
    const buyer = members.find((m: any) => m.status === "aktiv" && m.userId !== getStore().tables.users[0].id) ?? members[1];
    const saved = await call("leadops.saveDeliveryEndpoint", { membershipId: buyer.membershipId, categoryId: cat.id, enabled: true, method: "POST", url: "https://partner.example/leads", sourceFilterMode: "alle", sourceSupplierIds: [], fieldFilters: [], headers: [{ name: "Authorization", value: "Bearer x" }], authEnabled: false, auth: null, bodyTemplate: '{ "name": "{{first_name}} {{last_name}}", "plz": "{{postal_code}}" }', omitAutoFields: false, rotate: false, valueMappings: [] });
    const test = await call("leadops.testDeliveryEndpoint", { membershipId: buyer.membershipId, id: saved.id });
    expect(test.ok).toBe(true); expect(JSON.parse(test.requestBody)).toMatchObject({ name: "Test Lead", plz: "10115", lead_id: expect.stringMatching(/^TEST-/) });
    await call("leadops.applyAroundhomePreset", { membershipId: buyer.membershipId });
    const integration = await call("leadops.getMemberIntegration", { membershipId: buyer.membershipId });
    expect(integration.endpoints).toHaveLength(1); expect(integration.rules).toHaveLength(5); expect(integration.responseMappingEnabled).toBe(true);
    // Bestellung des Käufers mit Echtzeit → Lead läuft über den Endpoint
    const order = await call("leadops.createOrder", { name: "Endpoint-Test", buyerName: buyer.name, categoryId: cat.id, quantity: 5, unitPrice: 40, status: "aktiv" });
    await call("leadops.saveOrderWorkspace", { orderId: order.orderId, name: "Endpoint-Test", buyerName: buyer.name, buyerUserId: buyer.userId, categoryId: cat.id, categoryIds: [cat.id], quantity: 5, unitPrice: 40, supplierId: null, supplierMode: "alle", supplierIds: [], deliveryInterval: "sofort", compensateClaims: false, priority: 1, realtimeDelivery: true, startsAt: null, endsAt: null, ongoing: true, deliveryDays: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"], deliveryArea: "landesweit", pauses: [], advancedFilters: { minAgeDays: null, maxLeadPrice: null, postcodes: null } });
    await call("leadops.createDeliveryChain", { orderId: order.orderId, categoryId: cat.id, name: "Endpoint-Kette", priority: 1, sellTarget: 1, distributionMode: "lieferketten_round_robin" });
    const chain = (await call("leadops.listDeliveryChains")).find((c: any) => c.name === "Endpoint-Kette");
    await call("leadops.addDeliveryStop", { chainId: chain.id, buyerName: buyer.name, position: 1, unitPrice: 40 });
    await call("leadops.updateDeliveryChain", { id: chain.id, status: "aktiv" });
    const lead = await call("leadops.importLead", { categoryId: cat.id, firstName: "Endpoint", lastName: "Kunde", postcode: "50667", city: "Köln" });
    const delivered = await call("leadops.deliverLead", { publicId: lead.publicId, orderId: order.orderId });
    expect(delivered.result).toBe("angenommen"); expect(delivered.export.integrationName).toContain("API-Call");
    expect(getStore().tables.leads.find((row) => row.publicId === lead.publicId)!.metadata.partnerReference).toMatch(/^demo-/);
    // Ablehnung mit Fehlercode → Response-Mapping → Reklamation „Dublette“
    await call("leadops.saveDeliveryEndpoint", { membershipId: buyer.membershipId, id: saved.id, categoryId: cat.id, enabled: true, method: "POST", url: "https://partner.example/reject", sourceFilterMode: "alle", sourceSupplierIds: [], fieldFilters: [], headers: [], authEnabled: false, auth: null, bodyTemplate: "", omitAutoFields: false, rotate: false, valueMappings: [] });
    const rejected = await call("leadops.importLead", { categoryId: cat.id, firstName: "Doppel", lastName: "Kunde", postcode: "50668", city: "Köln" });
    const result = await call("leadops.deliverLead", { publicId: rejected.publicId, orderId: order.orderId });
    expect(result.attempts[0].reason).toContain("Dublette");
    expect(getStore().tables.claims.some((row) => row.leadId === getStore().tables.leads.find((l) => l.publicId === rejected.publicId)!.id && row.reason === "Dublette")).toBe(true);
  });
});

describe("Einstellungen → Integrationen im Chat-Build", () => {
  it("verwaltet Aroundhome-Konten, WattFox-Tracking und die Telefonnummern-Prüfung", async () => {
    resetStore();
    const before = await call("leadops.listPartnerAccounts");
    expect(before.aroundhome).toEqual([]);
    const account = await call("leadops.saveAroundhomeAccount", { label: "Aroundhome PV", publisherId: "pub-1", accessToken: "token-1234", exportUrl: "https://partner.example/export", reclaimOnCancel: true, reclaimReasonId: before.reasons[0]?.id ?? null, enabled: true });
    await call("leadops.saveCancelRules", { provider: "aroundhome", rules: [{ matchOp: "enthaelt", matchValue: "nicht erreichbar", reasonId: before.reasons[0]?.id ?? 1 }] });
    const sync = await call("leadops.syncAroundhomeAccount", { id: account.id });
    expect(sync.summary).toContain("Vorgänge gelesen");
    const wattfox = await call("leadops.createWattfoxAccount", { label: "WattFox", reclaimOnCancel: true, reclaimReasonId: null });
    await call("leadops.saveHlrLookup", { apiKey: "key", apiSecret: "secret", enabled: true });
    expect((await call("leadops.testHlrLookup")).ok).toBe(true);
    const after = await call("leadops.listPartnerAccounts");
    expect(after.aroundhome[0]).toMatchObject({ label: "Aroundhome PV", accessToken: "••••••••1234" });
    expect(after.wattfox.find((row: any) => row.id === wattfox.id).trackingUrl).toContain("/api/partner/wattfox/");
    expect(after.hlrlookup).toMatchObject({ enabled: true, apiKey: "••••••••key" });
    expect(after.cancelRules).toHaveLength(1);
    await call("leadops.deletePartnerAccount", { id: wattfox.id });
    expect((await call("leadops.listPartnerAccounts")).wattfox.some((row: any) => row.id === wattfox.id)).toBe(false);
  });
});

describe("Gesprächsbewertung im Chat-Build", () => {
  it("zeigt Beispielgespräche, bewertet ein Transkript und setzt Entscheidungen um", async () => {
    resetStore();
    const settings = await call("leadops.getCallQaSettings");
    expect(settings.enabled).toBe(true); expect(settings.criteria).toHaveLength(6);
    const calls = await call("leadops.listCalls", {});
    expect(calls.length).toBeGreaterThanOrEqual(5);
    const stats = await call("leadops.callStatistics");
    expect(stats.total).toBe(calls.length);
    const detail = await call("leadops.getCall", { callId: calls[calls.length - 1].id });
    expect(detail.criteria).toHaveLength(6);
    const lead = await call("leadops.importLead", { categoryId: getStore().tables.leadCategories[0].id, firstName: "Test", lastName: "Anruf", city: "Kiel" });
    const good = await call("leadops.simulateCall", { transcript: "Agent: Guten Tag, es geht um Ihre Photovoltaik-Anfrage. Kunde: Ja gerne, ich bin Eigentümer, wir planen das im nächsten Monat, Budget ist vorhanden. Agent: Passt Ihnen ein Termin vor Ort in den nächsten Wochen? Kunde: Ja gerne, passt. Agent: Dürfen wir Sie vorher telefonisch kontaktieren? Kunde: Ja, anrufen ist in Ordnung, meine Nummer stimmt, ein Fachbetrieb darf sich gerne melden.", publicId: lead.publicId, agentName: "Test" });
    expect(good.status).toBe("bewertet"); expect(good.score).toBeGreaterThanOrEqual(70); expect(good.decision).toBe("freigegeben"); // Kampagnenfragen (Standard): Interesse ja, Termin ja, Kontaktaufnahme ja
    const goodDetail = await call("leadops.getCall", { callId: good.callId }); expect(goodDetail.qualificationAnswers.interesse.answer).toBe("ja"); expect(goodDetail.qualificationAnswers.vor_ort_termin.answer).toBe("ja"); expect(String(goodDetail.nextStep)).toContain("entscheidenden Fragen erfüllt");
    const corrected = await call("leadops.setCallQualificationAnswer", { callId: good.callId, key: "interesse", answer: "nein" }); expect(corrected.decision).toBe("zurueckgewiesen"); // manuelle Korrektur → Entscheidung folgt sofort
    await call("leadops.setCallQualificationAnswer", { callId: good.callId, key: "interesse", answer: "ja" });
    expect(getStore().tables.leads.find((row) => row.publicId === lead.publicId)!.status).not.toBe("neu");
    const bad = await call("leadops.simulateCall", { transcript: "Agent: Hallo. Kunde: Ich möchte nicht angerufen werden, keine Weitergabe, löschen Sie meine Daten.", publicId: null, agentName: "Test" });
    expect(bad.decision).toBe("zurueckgewiesen");
    await call("leadops.reviewCall", { callId: bad.callId, decision: "pruefen", note: "Nochmal anhören" });
    expect((await call("leadops.getCall", { callId: bad.callId })).decision).toBe("pruefen");
    await call("leadops.saveCallQaSettings", { ...settings, autoApproveThreshold: 80, autoRejectThreshold: 20, recordingAuthHeader: "" });
    expect((await call("leadops.getCallQaSettings")).autoApproveThreshold).toBe(80);
    const rotated = await call("leadops.rotateCallQaToken");
    expect(rotated.webhookToken).toHaveLength(40);
  });
});

describe("Telefonie im Chat-Build", () => {
  it("kauft Rufnummern, legt Kampagnen an und telefoniert manuell, per Power- und Predictive-Dialer", async () => {
    resetStore();
    const settings = await call("leadops.getTelephonySettings");
    expect(settings.provider).toBe("simulation"); expect(settings.dispositions.length).toBeGreaterThan(3);
    // Rufnummern DE/AT/CH suchen und kaufen
    for (const country of ["DE", "AT", "CH"] as const) {
      const found = await call("leadops.searchPhoneNumbers", { country, type: country === "CH" ? "mobil" : "lokal" });
      expect(found.length).toBeGreaterThan(0); expect(found[0].e164.startsWith(country === "DE" ? "+49" : country === "AT" ? "+43" : "+41")).toBe(true);
      const bought = await call("leadops.purchasePhoneNumber", { e164: found[0].e164, country, type: found[0].type, region: found[0].region, monthlyPrice: found[0].monthlyPrice, currency: found[0].currency });
      expect(bought.id).toBeGreaterThan(0);
    }
    expect((await call("leadops.getTelephonySettings")).numbers).toHaveLength(4); // 3 gekauft + Tanesco-Nummer aus dem Seed
    // Kampagne mit Wählliste
    const cat = (await call("leadops.listCategories"))[0];
    const campaign = await call("leadops.saveDialerCampaign", { name: "Power-Test", mode: "power", leadFilter: { categoryIds: [cat.id], statuses: [] }, callerNumberId: null, maxAttempts: 2, retryMinutes: 30, wrapUpSeconds: 0, pacingRatio: null, callWindow: null, script: "Guten Tag …" });
    await call("leadops.setDialerCampaignStatus", { id: campaign.id, status: "aktiv" });
    const built = await call("leadops.buildDialerQueue", { campaignId: campaign.id });
    expect(built.added).toBeGreaterThan(0);
    expect((await call("leadops.listDialerQueue", { campaignId: campaign.id })).length).toBe(built.total);
    // manueller Anruf: klingelt → verbunden (Simulation) → auflegen → Ergebnis
    await call("leadops.startDialerSession", { campaignId: null, mode: "manuell", connection: "browser", agentPhone: null });
    const lead = await call("leadops.importLead", { categoryId: cat.id, firstName: "Manuell", lastName: "Kunde", phone: "+49 40 777 5559", city: "Hamburg" });
    const placed = await call("leadops.placeManualCall", { publicId: lead.publicId });
    expect(placed.connection).toBe("simulation");
    const ringing = await call("leadops.currentDialerSession");
    expect(ringing.call.status).toBe("klingelt");
    getStore().tables.dialerCalls.find((row) => row.id === placed.callId)!.startedAt = new Date(Date.now() - 5000);
    const connected = await call("leadops.currentDialerSession");
    expect(connected.call.status).toBe("verbunden"); expect(connected.status).toBe("im_gespraech");
    await call("leadops.markCallConsent", { callId: placed.callId });
    const ended = await call("leadops.endDialerCall", { callId: placed.callId, durationSeconds: 180 });
    expect(ended.status).toBe("beendet"); expect(ended.talkSeconds).toBe(180); expect(ended.callRecordId).toBeGreaterThan(0);
    const result = await call("leadops.setCallDisposition", { callId: placed.callId, disposition: "interessiert", notes: "Angebot gewünscht" });
    expect(result.disposition).toBe("interessiert");
    expect(getStore().tables.leads.find((row) => row.publicId === lead.publicId)!.status).not.toBe("neu");
    expect((await call("leadops.currentDialerSession")).status).toBe("bereit");
    await call("leadops.updateDialerSession", { status: "offline" });
    // Power-Dialer: nächster Eintrag der Liste
    await call("leadops.startDialerSession", { campaignId: campaign.id, mode: "power", connection: "browser", agentPhone: null });
    const next = await call("leadops.nextDialerCall");
    expect(next.done).toBe(false); expect(next.instruction.mode).toBe("power");
    expect(getStore().tables.dialerQueueItems.find((row) => row.id === getStore().tables.dialerCalls.find((c) => c.id === next.instruction.callId)!.queueItemId)!.status).toBe("waehlt");
    await call("leadops.endDialerCall", { callId: next.instruction.callId, durationSeconds: 60 });
    await call("leadops.updateDialerSession", { status: "offline" });
    // Predictive: Kampagne + bereiter Agent → Takt wählt mehrere Nummern
    const predictive = await call("leadops.saveDialerCampaign", { name: "Predictive-Test", mode: "predictive", leadFilter: { categoryIds: [cat.id], statuses: [] }, callerNumberId: null, maxAttempts: 2, retryMinutes: 30, wrapUpSeconds: 0, pacingRatio: 2, callWindow: null, script: "" });
    await call("leadops.setDialerCampaignStatus", { id: predictive.id, status: "aktiv" });
    await call("leadops.buildDialerQueue", { campaignId: predictive.id });
    await call("leadops.startDialerSession", { campaignId: predictive.id, mode: "predictive", connection: "browser", agentPhone: null });
    const tick = await call("leadops.runPredictiveTick");
    expect(tick.campaigns).toBe(1); expect(tick.dialed).toBeGreaterThan(0);
    const log = await call("leadops.listDialerCalls", { campaignId: predictive.id });
    expect(log.length).toBe(tick.dialed);
    const campaigns = await call("leadops.listDialerCampaigns");
    expect(campaigns.find((row: any) => row.id === predictive.id).stats.calls).toBeGreaterThan(0);
  });
});

describe("Rohdaten im Chat-Build", () => {
  it("lädt eine Liste hoch, erkennt Doppel, telefoniert sie ab und macht qualifizierte Kontakte zu Leads", async () => {
    resetStore();
    const before = await call("leadops.listRawBatches");
    expect(before.length).toBe(1); expect(before[0].counts.duplikat).toBe(1);
    const cat = (await call("leadops.listCategories"))[0];
    const leadsBefore = getStore().tables.leads.length;
    const created = await call("leadops.createRawBatch", { name: "Test-Liste", categoryId: cat.id, rows: [{ firstName: "Rita", lastName: "Roh", phone: "+49 30 4455667", city: "Berlin", data: { Dach: "Sattel" } }, { firstName: "Alexander", lastName: "Weber", phone: "+49 151 1000000" }, { firstName: "Leer", lastName: "Ohne" }] });
    expect(created).toMatchObject({ imported: 2, duplicates: 1, skipped: 1 });
    expect(getStore().tables.leads.length).toBe(leadsBefore); // keine Leads beim Upload
    const contacts = await call("leadops.listRawContacts", { batchId: created.batchId });
    expect(contacts.find((row: any) => row.lastName === "Weber").status).toBe("duplikat");
    // Wählliste aus der Liste, Anruf, Ergebnis „interessiert“ → Lead
    await call("leadops.searchPhoneNumbers", { country: "DE", type: "lokal" }).then((found: any) => call("leadops.purchasePhoneNumber", { e164: found[0].e164, country: "DE", type: "lokal" }));
    const campaign = await call("leadops.saveDialerCampaign", { name: "Rohdaten-Kampagne", mode: "power", leadFilter: { leadsEnabled: false, rawBatchIds: [created.batchId] }, callerNumberId: null, maxAttempts: null, retryMinutes: null, wrapUpSeconds: 0, pacingRatio: null, callWindow: null, script: "" });
    await call("leadops.setDialerCampaignStatus", { id: campaign.id, status: "aktiv" });
    expect((await call("leadops.buildDialerQueue", { campaignId: campaign.id })).added).toBe(1); // nur der gültige Kontakt
    expect((await call("leadops.listRawContacts", { batchId: created.batchId, status: "in_liste" })).length).toBe(1);
    await call("leadops.startDialerSession", { campaignId: campaign.id, mode: "power", connection: "browser", agentPhone: null });
    const next = await call("leadops.nextDialerCall");
    expect(next.done).toBe(false);
    getStore().tables.dialerCalls.find((row) => row.id === next.instruction.callId)!.startedAt = new Date(Date.now() - 5000);
    const live = await call("leadops.currentDialerSession");
    expect(live.call.rawContact.name).toBe("Rita Roh"); expect(live.call.lead).toBeNull();
    await call("leadops.endDialerCall", { callId: next.instruction.callId, durationSeconds: 90 });
    await call("leadops.setCallDisposition", { callId: next.instruction.callId, disposition: "interessiert", notes: "Will Angebot" });
    const converted = (await call("leadops.listRawContacts", { batchId: created.batchId })).find((row: any) => row.lastName === "Roh");
    expect(converted.status).toBe("konvertiert"); expect(converted.leadPublicId).toBeTruthy();
    const lead = getStore().tables.leads.find((row) => row.publicId === converted.leadPublicId)!;
    expect(lead.status).not.toBe("neu"); expect(lead.metadata).toMatchObject({ Dach: "Sattel", rawBatch: "Test-Liste" });
    expect(getStore().tables.dialerCalls.find((row) => row.id === next.instruction.callId)!.leadId).toBe(lead.id);
    // manuelle Übernahme und Verwerfen
    const seeded = before[0];
    const open = (await call("leadops.listRawContacts", { batchId: seeded.id, status: "neu" }))[0];
    const manual = await call("leadops.convertRawContact", { id: open.id, initialStatus: "neu" });
    expect(manual.publicId).toBeTruthy();
    const other = (await call("leadops.listRawContacts", { batchId: seeded.id, status: "neu" }))[0];
    await call("leadops.discardRawContact", { id: other.id, note: "falsche Zielgruppe" });
    expect((await call("leadops.listRawContacts", { batchId: seeded.id, status: "verworfen" })).some((row: any) => row.id === other.id)).toBe(true);
    await call("leadops.restoreRawContact", { id: other.id });
    const cleaned = await call("leadops.deleteRawBatch", { batchId: created.batchId });
    expect(cleaned.keptConverted).toBe(1);
    // mehrere Kategorien je Liste: Spalte, Auswahl beim Übernehmen, Standard
    const cats = await call("leadops.listCategories");
    const multi = await call("leadops.createRawBatch", { name: "Multi", categoryId: cats[0].id, categoryIds: [cats[0].id, cats[1].id], rows: [{ firstName: "A", lastName: "Spalte", phone: "+49 30 1112221", category: cats[1].shortcode }, { firstName: "B", lastName: "Standard", phone: "+49 30 1112222" }, { firstName: "C", lastName: "Wahl", phone: "+49 30 1112223", category: "Unbekannt" }] });
    expect(multi.categoryIds).toEqual([cats[0].id, cats[1].id]); expect(multi.unmatchedCategories).toBe(1);
    const rows = await call("leadops.listRawContacts", { batchId: multi.batchId });
    expect(rows.find((row: any) => row.lastName === "Spalte").categoryShortcode).toBe(cats[1].shortcode);
    const bySpalte = await call("leadops.convertRawContact", { id: rows.find((row: any) => row.lastName === "Spalte").id });
    expect(getStore().tables.leads.find((row) => row.publicId === bySpalte.publicId)!.categoryId).toBe(cats[1].id);
    const byDefault = await call("leadops.convertRawContact", { id: rows.find((row: any) => row.lastName === "Standard").id });
    expect(getStore().tables.leads.find((row) => row.publicId === byDefault.publicId)!.categoryId).toBe(cats[0].id);
    const byChoice = await call("leadops.convertRawContact", { id: rows.find((row: any) => row.lastName === "Wahl").id, categoryId: cats[1].id });
    expect(getStore().tables.leads.find((row) => row.publicId === byChoice.publicId)!.categoryId).toBe(cats[1].id);
    await expect(call("leadops.convertRawContact", { id: rows[0].id, categoryId: 999999 })).resolves.toMatchObject({ alreadyConverted: true }); // bereits Lead → keine Prüfung nötig
  });
});

describe("Haustür-Erfassung im Chat-Build", () => {
  it("führt Agenturen und Vertriebler mit Sub-ID, erfasst Kontakte als Leads für Aroundhome und liefert die Übersicht", async () => {
    resetStore();
    const reps = await call("leadops.listD2dReps");
    expect(reps.length).toBe(4); expect(reps.filter((rep: any) => rep.subId).every((rep: any) => rep.subId.startsWith("D2D-"))).toBe(true); expect(reps.some((rep: any) => rep.subId === null)).toBe(true); // Lena Voss: Sub-ID fehlt
    const overview = await call("leadops.d2dOverview", {});
    expect(overview.kpis.captured).toBeGreaterThan(5); expect(overview.kpis.qualified).toBeGreaterThan(0); expect(overview.days.length).toBe(7); expect(overview.topReps.length).toBe(3); expect(overview.topAgencies.length).toBe(2);
    const agency = await call("leadops.saveD2dAgency", { name: "Test Agentur" });
    const rep = await call("leadops.saveD2dRep", { name: "Neu Vertriebler", agencyId: agency.id, subId: "D2D-NEU1" });
    expect(rep.subId).toBe("D2D-NEU1");
    await expect(call("leadops.saveD2dRep", { name: "Doppel", subId: rep.subId })).rejects.toThrow("bereits vergeben");
    await expect(call("leadops.saveD2dRep", { name: "Falsch", subId: "ab c" })).rejects.toThrow("Sub-ID: nur Buchstaben");
    // Spezifikation: Zuweisung (Sparte + Käufer), iFrame-Prüfung, Vertriebler-Login, Sperren, Kontakt korrigieren
    const settings = await call("leadops.getD2dSettings"); expect(settings.categories.length).toBeGreaterThan(0); expect(settings.embedScriptUrl).toContain("aroundhome.de");
    await expect(call("leadops.saveD2dSettings", { categoryId: null, buyerUserId: 1 })).rejects.toThrow("Für einen Käufer bitte auch eine Sparte wählen.");
    await expect(call("leadops.saveD2dEmbed", { raw: "https://boese.example/script.js" })).rejects.toThrow("aroundhome.de");
    expect((await call("leadops.saveD2dEmbed", { raw: '<script src="https://aaa.aroundhome.de/trck/ehtml/abc.js"></script>' })).embedScriptUrl).toBe("https://aaa.aroundhome.de/trck/ehtml/abc.js");
    const withLogin = await call("leadops.saveD2dRep", { name: "Lea Login", email: "lea@haustuer.example", createLogin: true });
    const linked = (await call("leadops.listD2dReps")).find((row: any) => row.id === withLogin.id); expect(linked.userId).toBeTruthy(); expect(linked.subId).toBeNull();
    await call("leadops.setD2dRepActive", { id: withLogin.id, active: false }); expect((await call("leadops.listD2dReps")).find((row: any) => row.id === withLogin.id).active).toBe(false);
    const ctx = await call("leadops.d2dContext"); expect(ctx.role).toBe("admin"); expect(ctx.captureEnabled).toBe(true);
    const cat = (await call("leadops.listCategories")).find((row: any) => row.shortcode === "PV");
    await expect(call("leadops.createD2dCapture", { repId: rep.id, categoryId: cat.id, lastName: "Ohne", phone: "+49 30 1", consentGiven: false })).rejects.toThrow("Einwilligung");
    const leadsBefore = getStore().tables.leads.length;
    const created = await call("leadops.createD2dCapture", { repId: rep.id, categoryId: cat.id, firstName: "Haus", lastName: "Tür", phone: "+49 30 9876543", street: "Weg 1", postcode: "10115", city: "Berlin", country: "DE", notes: "Satteldach", consentGiven: true });
    expect(created.status, created.deliveryNote ?? "").toBe("uebermittelt"); expect(created.partnerReference).toMatch(/^ah-/);
    expect(getStore().tables.leads.length).toBe(leadsBefore + 1);
    const lead = getStore().tables.leads.find((row) => row.publicId === created.publicId)!;
    expect(lead.status).toBe("zugewiesen"); expect(lead.metadata).toMatchObject({ d2d_sub_id: rep.subId, d2d_rep: "Neu Vertriebler", d2d_agency: "Test Agentur", street: "Weg 1", consent: true });
    const captures = await call("leadops.listD2dCaptures", { repId: rep.id });
    expect(captures[0]).toMatchObject({ status: "uebermittelt", leadPublicId: created.publicId, subId: rep.subId });
    await call("leadops.updateD2dCapture", { captureId: captures[0].id, city: "Potsdam", postcode: "14467" });
    expect((await call("leadops.listD2dCaptures", { repId: rep.id }))[0].city).toBe("Potsdam");
    await expect(call("leadops.updateD2dCapture", { captureId: captures[0].id, postcode: "123" })).rejects.toThrow("fünfstellige PLZ");
    const csv = await call("leadops.exportD2dCsv", { repId: rep.id });
    expect(csv.csv.startsWith("\uFEFF")).toBe(true); expect(csv.csv.split("\r\n").length).toBe(2); expect(csv.csv).toContain("Erfasst am;Nr.;Vertriebler;Sub-ID;Agentur;Anrede"); expect(csv.csv).toContain(rep.subId); expect(csv.filename).toMatch(/^haustuer_/);
    expect((await call("leadops.deleteD2dRep", { id: rep.id })).deactivated).toBe(true);
  });
});

describe("Kundenpfad im Chat-Build", () => {
  it("Benutzer anlegen → API-Call am Benutzer → Bestellung → Lead automatisch verteilt", async () => {
    resetStore();
    const created = await call("leadops.createMember", { firstName: "Klara", lastName: "Kundin", company: "Kundin Solar", email: "klara@kunde.example", password: "Sicher!Passwort2026", kind: "benutzer", status: "aktiv" });
    const pv = (await call("leadops.listCategories")).find((row: any) => row.shortcode === "FEN"); // Fenster: dort gibt es keine andere aktive Bestellung
    await call("leadops.saveDeliveryEndpoint", { membershipId: created.membershipId, categoryId: pv.id, enabled: true, method: "POST", url: "https://kundin-crm.example/api/leads", sourceFilterMode: "alle", sourceSupplierIds: [], fieldFilters: [], headers: [], authEnabled: false, auth: null, bodyTemplate: "", omitAutoFields: false, rotate: false, valueMappings: [] });
    const order = await call("leadops.createOrder", { name: "Kundin PV", buyerName: "Kundin Solar", categoryId: pv.id, quantity: 20, unitPrice: 39, status: "aktiv" });
    await call("leadops.saveOrderWorkspace", { orderId: order.orderId, name: "Kundin PV", buyerName: "Kundin Solar", buyerUserId: created.userId, categoryId: pv.id, categoryIds: [pv.id], quantity: 20, unitPrice: 39, supplierId: null, supplierMode: "alle", supplierIds: [], deliveryInterval: "sofort", compensateClaims: true, priority: 1, realtimeDelivery: true, startsAt: null, endsAt: null, ongoing: true, deliveryDays: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"], deliveryArea: "landesweit", pauses: [], advancedFilters: { minAgeDays: null, maxLeadPrice: null, postcodes: null } });
    await call("leadops.setOrderWorkspaceActive", { orderId: order.orderId, active: true });
    await call("leadops.createAutomationRule", { name: "PV automatisch ausliefern", triggerType: "lead_erstellt", sourceCategoryId: pv.id, targetCategoryId: pv.id, conditions: [], actionType: "lead_ausliefern", actionConfig: {}, status: "aktiv" });
    const lead = await call("leadops.importLead", { categoryId: pv.id, firstName: "Peter", lastName: "Probe", phone: "+49 30 5551234", postcode: "10115", city: "Berlin" });
    const row = getStore().tables.leads.find((item) => item.publicId === lead.publicId)!;
    const deliveries = getStore().tables.leadDeliveries.filter((item) => item.leadId === row.id);
    expect(deliveries.length, JSON.stringify(deliveries.map((d) => [d.buyerName, d.result, d.orderId]))).toBeGreaterThan(0);
    expect(deliveries.some((item) => item.orderId === order.orderId), JSON.stringify(deliveries.map((d) => [d.buyerName, d.result, d.orderId]))).toBe(true);
    expect(getStore().tables.deliveryChains.some((chain) => chain.orderId === order.orderId)).toBe(true);
    expect(getStore().tables.integrationEvents.some((event) => event.leadId === row.id && event.endpointId)).toBe(true);
  });
});

describe("Integrations-Presets im Chat-Build", () => {
  it("speichert einen Endpoint als Preset und fügt ihn bei einem anderen Benutzer mit eigenen Schlüsseln hinzu", async () => {
    resetStore();
    const members = await call("leadops.listMembers");
    const a = members.find((m: any) => m.partnerType === "käufer"); const b = members.find((m: any) => m.partnerType === "käufer" && m.membershipId !== a.membershipId);
    const cat = (await call("leadops.listCategories"))[0];
    const endpoint = await call("leadops.saveDeliveryEndpoint", { membershipId: a.membershipId, categoryId: cat.id, enabled: true, method: "POST", url: "https://crm.example/leads", sourceFilterMode: "alle", sourceSupplierIds: [], fieldFilters: [], headers: [{ name: "Authorization", value: "Bearer key-a" }], authEnabled: false, auth: null, bodyTemplate: '{ "name": "{{first_name}}" }', omitAutoFields: false, rotate: false, valueMappings: [] });
    const preset = await call("leadops.saveEndpointPreset", { membershipId: a.membershipId, endpointId: endpoint.id, name: "CRM Standard", includeSecrets: false });
    const listed = await call("leadops.listIntegrationPresets");
    expect(listed.find((row: any) => row.id === preset.id)).toMatchObject({ kind: "endpoint", hasSecrets: false, usageCount: 0 });
    const req = await call("leadops.integrationPresetRequirements", { presetId: preset.id });
    expect(req.headers).toEqual([{ name: "Authorization", missing: true }]);
    await expect(call("leadops.applyIntegrationPreset", { presetId: preset.id, membershipId: b.membershipId })).rejects.toThrow("fehlenden Schlüssel");
    const applied = await call("leadops.applyIntegrationPreset", { presetId: preset.id, membershipId: b.membershipId, headers: [{ name: "Authorization", value: "Bearer key-b" }], url: "https://crm-b.example/leads" });
    const integration = await call("leadops.getMemberIntegration", { membershipId: b.membershipId });
    expect(integration.endpoints.find((row: any) => row.id === applied.id)).toMatchObject({ url: "https://crm-b.example/leads", headers: [{ name: "Authorization", value: "Bearer key-b" }], bodyTemplate: '{ "name": "{{first_name}}" }' });
    expect((await call("leadops.listIntegrationPresets")).find((row: any) => row.id === preset.id).usageCount).toBe(1);
    await call("leadops.applyAroundhomePreset", { membershipId: a.membershipId });
    const mappingPreset = await call("leadops.saveResponseMappingPreset", { membershipId: a.membershipId, name: "Aroundhome Codes" });
    const mapped = await call("leadops.applyIntegrationPreset", { presetId: mappingPreset.id, membershipId: b.membershipId });
    expect(mapped.count).toBe(5);
    expect((await call("leadops.getMemberIntegration", { membershipId: b.membershipId })).rules).toHaveLength(5);
    await call("leadops.deleteIntegrationPreset", { id: preset.id });
    expect((await call("leadops.listIntegrationPresets")).some((row: any) => row.id === preset.id)).toBe(false);
  });
});

describe("Kategorie Hörgeräte und eigener Zeitraum im Chat-Build", () => {
  beforeAll(() => resetStore());

  it("liefert Hörgeräte als Kategorie mit Fachfeldern, Leads, Bestellung, Lieferkette und Meta-Formular", async () => {
    const categories = await call("leadops.listCategories");
    const hoe = categories.find((row: any) => row.shortcode === "HÖR");
    expect(hoe).toMatchObject({ name: "Hörgeräte", status: "aktiv" });
    const fields = await call("leadops.listCategoryFields", { categoryId: hoe.id });
    expect(fields.map((row: any) => row.fieldKey)).toEqual(["bauform", "hoertest", "bereits_hoergeraet", "krankenkasse", "fuer_wen"]);
    const store = getStore().tables;
    expect(store.leads.filter((row: any) => row.categoryId === hoe.id).length).toBeGreaterThanOrEqual(4);
    expect(store.orders.some((row: any) => row.categoryId === hoe.id && row.name === "Hörgeräte Aurora")).toBe(true);
    expect(store.deliveryChains.some((row: any) => row.categoryId === hoe.id)).toBe(true);
    expect(store.leadDeliveries.some((row: any) => store.leads.find((lead: any) => lead.id === row.leadId)?.categoryId === hoe.id)).toBe(true);
    const forms = await call("leadops.metaForms");
    expect(forms.find((row: any) => row.id === "form-hoe")).toMatchObject({ name: "Hörgeräte – Kostenloser Hörtest", categoryId: hoe.id });
    const now = Date.now();
    expect(store.orders.every((row: any) => new Date(row.createdAt).getTime() <= now)).toBe(true); // keine Bestelldaten in der Zukunft
    expect(store.deliveryChains.every((row: any) => new Date(row.createdAt).getTime() <= now)).toBe(true);
  });

  it("beachtet im Stundenverlauf das Enddatum des eigenen Zeitraums", async () => {
    const all = await call("leadops.hourlyDeliverySeries", { from: new Date(0) });
    const total = (series: any[]) => series.reduce((sum, bucket) => sum + bucket.offered + bucket.accepted + bucket.rejected, 0);
    expect(total(all)).toBeGreaterThan(0);
    const cutoff = new Date(Date.now() - 5 * 86_400_000);
    const older = await call("leadops.hourlyDeliverySeries", { from: new Date(0), until: cutoff });
    const newer = await call("leadops.hourlyDeliverySeries", { from: cutoff });
    expect(total(older)).toBeLessThan(total(all));
    expect(total(older) + total(newer)).toBe(total(all));
  });
});

describe("Automatische Gesprächsnotizen im Chat-Build", () => {
  beforeAll(() => resetStore());
  const connectAndEnd = async (publicId: string, seconds: number) => {
    const placed = await call("leadops.placeManualCall", { publicId });
    getStore().tables.dialerCalls.find((row) => row.id === placed.callId)!.startedAt = new Date(Date.now() - 5000);
    await call("leadops.currentDialerSession");
    await call("leadops.markCallConsent", { callId: placed.callId });
    await call("leadops.endDialerCall", { callId: placed.callId, durationSeconds: seconds });
    await new Promise((resolve) => setTimeout(resolve, 20)); // Bewertung läuft asynchron
    return placed.callId as number;
  };

  it("liefert die Beispiel-Anrufe mit Notiz an Karte, Verlauf und Anrufliste", async () => {
    const seeded = getStore().tables.dialerCalls.filter((row) => row.summary);
    expect(seeded.length).toBeGreaterThanOrEqual(2);
    expect(seeded[0].summary).toContain("Gesprächsnotiz (automatisch)");
    const lead = getStore().tables.leads.find((row) => row.id === seeded[0].leadId)!;
    const notes = await call("leadops.listPipelineNotes", { publicId: lead.publicId });
    expect(notes.some((note: any) => note.source === "gespraech" && note.text === seeded[0].summary)).toBe(true);
    expect(getStore().tables.leadStatusEvents.some((row) => row.leadId === lead.id && String(row.note).startsWith("📞 Gesprächsnotiz"))).toBe(true);
    const log = await call("leadops.listDialerCalls", {});
    expect(log.find((row: any) => row.id === seeded[0].id).summary).toBe(seeded[0].summary);
  });

  it("schreibt nach einem simulierten Gespräch eine Notiz und ergänzt sie um das Ergebnis", async () => {
    const found = await call("leadops.searchPhoneNumbers", { country: "DE", type: "lokal" });
    await call("leadops.purchasePhoneNumber", { e164: found[0].e164, country: "DE", type: found[0].type, region: found[0].region, monthlyPrice: found[0].monthlyPrice, currency: found[0].currency });
    const cat = (await call("leadops.listCategories"))[0];
    expect((await call("leadops.getTelephonySettings")).autoCallNotes).toBe(true);
    await call("leadops.startDialerSession", { campaignId: null, mode: "manuell", connection: "browser", agentPhone: null });
    expect((await call("leadops.currentDialerSession")).autoNotes).toBe(true);
    const lead = await call("leadops.importLead", { categoryId: cat.id, firstName: "Notiz", lastName: "Kunde", phone: "+49 40 555 0009", city: "Hamburg" });
    const callId = await connectAndEnd(lead.publicId, 150);
    const afterEnd = await call("leadops.getDialerCall", { callId });
    expect(afterEnd.status).toBe("beendet"); expect(afterEnd.autoNotes).toBe(true);
    expect(afterEnd.summary).toContain("Gesprächsnotiz (automatisch)");
    expect(afterEnd.summary).toContain("Kunde: ");
    expect(afterEnd.summary).toContain("Kontakt durch Fachbetrieb erlaubt");
    const withResult = await call("leadops.setCallDisposition", { callId, disposition: "interessiert", notes: "Will Angebot bis Freitag" });
    expect(withResult.summary).toContain("Ergebnis: Interessiert – Angebot gewünscht");
    expect(withResult.summary).toContain("Notiz des Agenten: Will Angebot bis Freitag");
    const notes = await call("leadops.listPipelineNotes", { publicId: lead.publicId });
    expect(notes.filter((note: any) => note.source === "gespraech")).toHaveLength(1); // eine Notiz je Anruf, aktualisiert statt verdoppelt
    expect(notes[0].text).toBe(withResult.summary);
    await call("leadops.updateDialerSession", { status: "offline" });
  });

  it("lässt sich im Dialer, je Kampagne und global ausschalten", async () => {
    const cat = (await call("leadops.listCategories"))[0];
    await call("leadops.setAutoCallNotes", { scope: "global", enabled: false });
    expect((await call("leadops.getTelephonySettings")).autoCallNotes).toBe(false);
    await call("leadops.startDialerSession", { campaignId: null, mode: "manuell", connection: "browser", agentPhone: null });
    expect((await call("leadops.currentDialerSession")).autoNotes).toBe(false);
    const lead = await call("leadops.importLead", { categoryId: cat.id, firstName: "Ohne", lastName: "Notiz", phone: "+49 40 555 0019", city: "Hamburg" });
    const callId = await connectAndEnd(lead.publicId, 90);
    await call("leadops.setCallDisposition", { callId, disposition: "wiedervorlage" });
    expect((await call("leadops.getDialerCall", { callId })).summary).toBeNull();
    expect((await call("leadops.listPipelineNotes", { publicId: lead.publicId })).length).toBe(0);
    await call("leadops.updateDialerSession", { status: "offline" });
    // Kampagne überschreibt den globalen Standard
    const campaign = await call("leadops.saveDialerCampaign", { name: "Notiz-Test", mode: "power", leadFilter: { categoryIds: [cat.id], statuses: [] }, callerNumberId: null, maxAttempts: 2, retryMinutes: 30, wrapUpSeconds: 0, pacingRatio: null, callWindow: null, script: "", autoNotes: true });
    await call("leadops.startDialerSession", { campaignId: campaign.id, mode: "power", connection: "browser", agentPhone: null });
    expect((await call("leadops.currentDialerSession")).autoNotes).toBe(true);
    await call("leadops.setAutoCallNotes", { scope: "kampagne", campaignId: campaign.id, enabled: false });
    expect((await call("leadops.currentDialerSession")).autoNotes).toBe(false);
    await call("leadops.setAutoCallNotes", { scope: "kampagne", campaignId: campaign.id, enabled: null });
    expect((await call("leadops.currentDialerSession")).autoNotes).toBe(false); // zurück auf Standard (global aus)
    await call("leadops.setAutoCallNotes", { scope: "global", enabled: true });
    expect((await call("leadops.currentDialerSession")).autoNotes).toBe(true);
    await call("leadops.updateDialerSession", { status: "offline" });
    // Anrufkampagne aus der Kaltakquise übernimmt den Schalter
    const started = await call("leadops.startCallCampaign", { listName: "Dachdecker Hessen", mode: "power", autoNotes: false });
    expect(getStore().tables.dialerCampaigns.find((row) => row.id === started.campaignId)!.autoNotes).toBe(false);
  });
});


describe("Dialer in der Vertriebspipeline (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("wählt direkt aus der Pipeline mit der Seed-Rufnummer und schreibt die Notiz an die Karte", async () => {
    expect((await call("leadops.getTelephonySettings")).numbers.length).toBeGreaterThanOrEqual(1); // ohne Kauf sofort wählbar
    const overview = await call("leadops.pipelineOverview", { source: "kaltakquise" });
    const stage = overview.stages.find((item: any) => item.key === "neu");
    const lead = stage.leads.find((item: any) => item.phone && /[4-9]$/.test(String(item.phone).replace(/\D/g, "")));
    expect(lead).toBeTruthy();
    await call("leadops.startDialerSession", { campaignId: null, mode: "manuell", connection: "browser", agentPhone: null });
    const placed = await call("leadops.placeManualCall", { publicId: lead.publicId });
    expect(placed.connection).toBe("simulation");
    getStore().tables.dialerCalls.find((row) => row.id === placed.callId)!.startedAt = new Date(Date.now() - 5000);
    expect((await call("leadops.currentDialerSession")).call.status).toBe("verbunden");
    await call("leadops.markCallConsent", { callId: placed.callId });
    await call("leadops.endDialerCall", { callId: placed.callId, durationSeconds: 120 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const result = await call("leadops.setCallDisposition", { callId: placed.callId, disposition: "interessiert", notes: "Aus der Pipeline angerufen" });
    expect(result.summary).toContain("Ergebnis: Interessiert – Angebot gewünscht");
    const notes = await call("leadops.listPipelineNotes", { publicId: lead.publicId });
    expect(notes.some((note: any) => note.source === "gespraech" && note.text.includes("Aus der Pipeline angerufen"))).toBe(true);
    await call("leadops.movePipelineStage", { publicId: lead.publicId, stage: "qualifiziert", note: "Anruf-Ergebnis: Interessiert – Angebot gewünscht" });
    const after = await call("leadops.pipelineOverview", { source: "kaltakquise" });
    expect(after.stages.find((item: any) => item.key === "qualifiziert").leads.some((item: any) => item.publicId === lead.publicId)).toBe(true);
    await call("leadops.updateDialerSession", { status: "offline" });
  });
});

describe("Listen-Dialer in der Pipeline, Aufzeichnung ohne Abfrage, Kategorie-Emojis (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("legt aus Pipeline-Karten eine Kampagne an (nur diese Leads) und telefoniert sie als Power-Liste ab", async () => {
    const overview = await call("leadops.pipelineOverview", { source: "kaltakquise" });
    const stage = overview.stages.find((item: any) => item.key === "neu");
    const ids = stage.leads.filter((item: any) => item.phone).map((item: any) => item.id);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const campaign = await call("leadops.saveDialerCampaign", { name: "Pipeline: Neu · Test", mode: "power", leadFilter: { leadIds: ids, statuses: [] }, callerNumberId: null, maxAttempts: 3, retryMinutes: 240, wrapUpSeconds: 0, pacingRatio: null, autoNotes: null, callWindow: { weekdays: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" }, script: "" });
    const built = await call("leadops.buildDialerQueue", { campaignId: campaign.id });
    expect(built.added).toBe(ids.length); // keine anderen Leads
    expect((await call("leadops.listDialerQueue", { campaignId: campaign.id })).every((item: any) => ids.includes(item.leadId))).toBe(true);
    await call("leadops.setDialerCampaignStatus", { id: campaign.id, status: "aktiv" });
    await call("leadops.startDialerSession", { campaignId: campaign.id, mode: "power", connection: "browser", agentPhone: null });
    let dialed = 0; let answered = 0;
    for (let n = 0; n < ids.length + 1; n += 1) {
      const next = await call("leadops.nextDialerCall");
      if (next.done) break;
      dialed += 1;
      getStore().tables.dialerCalls.find((row) => row.id === next.instruction.callId)!.startedAt = new Date(Date.now() - 5000);
      const state = await call("leadops.currentDialerSession");
      if (state.call?.status === "verbunden") { answered += 1; await call("leadops.markCallConsent", { callId: next.instruction.callId }); await call("leadops.endDialerCall", { callId: next.instruction.callId, durationSeconds: 60 }); await new Promise((resolve) => setTimeout(resolve, 20)); const result = await call("leadops.setCallDisposition", { callId: next.instruction.callId, disposition: "wiedervorlage", notes: "Power-Liste" }); expect(result.summary).toContain("Gesprächsnotiz (automatisch)"); }
      else { const after = await call("leadops.getDialerCall", { callId: next.instruction.callId }); expect(["besetzt", "keine_antwort", "anrufbeantworter"]).toContain(after.status); await call("leadops.setCallDisposition", { callId: next.instruction.callId, disposition: "nicht_erreicht" }); }
    }
    expect(dialed).toBe(ids.length); expect(answered).toBeGreaterThanOrEqual(1);
    const queue = await call("leadops.listDialerQueue", { campaignId: campaign.id });
    expect(queue.every((item: any) => item.status === "wiederholen")).toBe(true); // Wiedervorlage/nicht erreicht → später erneut
    await call("leadops.updateDialerSession", { status: "offline" });
    await call("leadops.setDialerCampaignStatus", { id: campaign.id, status: "beendet" });
  });

  it("zeichnet mit der Einstellung „ohne Einwilligungsabfrage“ ohne Klick auf und erstellt die Notiz aus dem Transkript", async () => {
    const settings = await call("leadops.getTelephonySettings");
    expect(settings.recordWithoutConsent).toBe(false);
    await call("leadops.saveTelephonySettings", { ...settings, recordWithoutConsent: true, pacingRatio: Number(settings.pacingRatio), maxAbandonRate: Number(settings.maxAbandonRate) });
    expect((await call("leadops.getTelephonySettings")).recordWithoutConsent).toBe(true);
    const cat = (await call("leadops.listCategories"))[0];
    await call("leadops.startDialerSession", { campaignId: null, mode: "manuell", connection: "browser", agentPhone: null });
    const lead = await call("leadops.importLead", { categoryId: cat.id, firstName: "Ohne", lastName: "Abfrage", phone: "+49 40 555 0029", city: "Hamburg" });
    const placed = await call("leadops.placeManualCall", { publicId: lead.publicId });
    getStore().tables.dialerCalls.find((row) => row.id === placed.callId)!.startedAt = new Date(Date.now() - 5000);
    await call("leadops.currentDialerSession");
    await call("leadops.endDialerCall", { callId: placed.callId, durationSeconds: 90 }); // kein markCallConsent
    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = await call("leadops.getDialerCall", { callId: placed.callId });
    expect(after.consentAt).toBeNull(); expect(after.evaluation).toBeTruthy();
    const record = getStore().tables.callRecords.find((row) => row.id === after.callRecordId)!;
    expect(record.consent).toBe(true); expect(String(record.consentSource)).toContain("ohne Abfrage"); expect(record.transcript).toBeTruthy();
    expect(after.summary).toContain("Kunde: ");
    await call("leadops.setCallDisposition", { callId: placed.callId, disposition: "interessiert" });
    await call("leadops.saveTelephonySettings", { ...settings, recordWithoutConsent: false, pacingRatio: Number(settings.pacingRatio), maxAbandonRate: Number(settings.maxAbandonRate) });
    await call("leadops.updateDialerSession", { status: "offline" });
  });

  it("führt Emojis an den Kategorien (Seed, Vorschlag, eigene Wahl)", async () => {
    const categories = await call("leadops.listCategories");
    expect(categories.find((row: any) => row.shortcode === "HÖR").emoji).toBe("🦻");
    expect(categories.find((row: any) => row.shortcode === "PV").emoji).toBe("☀️");
    const created = await call("leadops.createCategory", { shortcode: "DACH", name: "Dachdecker", defaultLeadPrice: "30.00", geocodingRequired: false, marketplaceEnabled: false, status: "aktiv" });
    expect((await call("leadops.listCategories")).find((row: any) => row.id === created.id).emoji).toBe("🏠");
    await call("leadops.updateCategory", { id: created.id, emoji: "🧱" });
    expect((await call("leadops.listCategories")).find((row: any) => row.id === created.id).emoji).toBe("🧱");
    const overview = await call("leadops.pipelineOverview", { source: "kaltakquise" });
    expect(overview.stages.flatMap((stage: any) => stage.leads).some((lead: any) => lead.categoryEmoji)).toBe(true);
  });
});

describe("Pipeline-Erweiterungen (Chat-Build): Wiedervorlagen, Termine, Angebotswerte, Nachrichten, Team, Automatik, E-Mail-Details", () => {
  beforeAll(() => resetStore());
  const coldLead = async (name: string) => { const overview = await call("leadops.pipelineOverview", { source: "kaltakquise" }); return overview.stages.flatMap((stage: any) => stage.leads).find((lead: any) => lead.name.includes(name)); };

  it("zeigt eingeschlafene Karten, Angebotswerte und Aufgaben an den Karten und rechnet den Pipeline-Wert (ohne Punkte)", async () => {
    const overview = await call("leadops.pipelineOverview", { source: "alle", limitPerStage: 1000 });
    const leads = overview.stages.flatMap((stage: any) => stage.leads);
    expect(leads.every((lead: any) => !("score" in lead) && !("scoreLabel" in lead))).toBe(true); // Scoring wurde entfernt
    expect(overview.staleCount).toBeGreaterThan(0); expect(overview.staleDays).toBe(5); expect(leads.filter((lead: any) => lead.stale).length).toBe(overview.staleCount);
    expect(leads.filter((lead: any) => lead.dealValue).length).toBeGreaterThanOrEqual(10); expect(overview.value.openValue).toBeGreaterThan(0); expect(overview.value.wonValue).toBeGreaterThan(0); expect(overview.value.byOwner.length).toBeGreaterThanOrEqual(2);
    expect(leads.filter((lead: any) => lead.openTasks > 0 && lead.nextTask).length).toBeGreaterThanOrEqual(4); expect(overview.dueToday).toBeGreaterThanOrEqual(3);
    expect(leads.filter((lead: any) => lead.appointmentAt).length).toBe(4);
  });

  it("legt Wiedervorlagen an, listet sie unter „Heute“, erledigt und verschiebt sie", async () => {
    const lead = await coldLead("Brandt"); expect(lead).toBeTruthy();
    const dueAt = new Date(); dueAt.setHours(15, 0, 0, 0);
    const created = await call("leadops.createPipelineTask", { publicId: lead.publicId, kind: "anruf", title: "Rückruf wegen Angebot", dueAt });
    expect(created.title).toBe("Rückruf wegen Angebot");
    const due = await call("leadops.pipelineDueList", {}); const mine = due.tasks.find((task: any) => task.id === created.id);
    expect(mine).toMatchObject({ kind: "anruf", lead: { publicId: lead.publicId } }); expect(due.appointments.length).toBeGreaterThanOrEqual(3);
    expect(getStore().tables.leads.find((row) => row.publicId === lead.publicId)!.followUpAt?.getTime()).toBe(dueAt.getTime());
    const later = new Date(dueAt.getTime() + 3 * 86_400_000); await call("leadops.snoozePipelineTask", { id: created.id, dueAt: later });
    expect(getStore().tables.leads.find((row) => row.publicId === lead.publicId)!.followUpAt?.getTime()).toBe(later.getTime());
    await call("leadops.completePipelineTask", { id: created.id });
    expect((await call("leadops.listPipelineTasks", { publicId: lead.publicId })).length).toBe(0);
    expect(getStore().tables.leads.find((row) => row.publicId === lead.publicId)!.followUpAt).toBeNull();
    expect((await call("leadops.pipelineHistory", { publicId: lead.publicId })).some((event: any) => event.toStage === "erledigt")).toBe(true);
  });

  it("setzt Termine (Stufe „Termin“, Kalendereintrag, Einladung) und Angebotswerte", async () => {
    const lead = await coldLead("Vogt"); expect(lead.pipelineStage).toBe("neu");
    const when = new Date(Date.now() + 2 * 86_400_000); when.setHours(14, 30, 0, 0);
    const result = await call("leadops.setPipelineAppointment", { publicId: lead.publicId, appointmentAt: when, location: "Vor Ort", note: "Dach prüfen", sendInvitation: true });
    expect(result.invitation.status).toBe("simuliert");
    const row = getStore().tables.leads.find((item) => item.publicId === lead.publicId)!;
    expect(row.pipelineStage).toBe("termin"); expect(row.appointmentAt?.getTime()).toBe(when.getTime()); expect(row.followUpAt?.getTime()).toBe(when.getTime());
    expect(getStore().tables.pipelineTasks.some((task) => task.leadId === row.id && task.kind === "termin" && task.source === "termin")).toBe(true);
    expect(getStore().tables.outboundMessages.some((message) => message.leadId === row.id && message.templateKey === "termin_einladung")).toBe(true);
    const value = await call("leadops.setPipelineDealValue", { publicId: lead.publicId, dealValue: 12500.5 }); expect(value.dealValue).toBe(12500.5);
    const overview = await call("leadops.pipelineOverview", { source: "kaltakquise" }); const card = overview.stages.find((stage: any) => stage.key === "termin").leads.find((item: any) => item.publicId === lead.publicId);
    expect(card.dealValue).toBe(12500.5); expect(card.appointmentAt).toBeTruthy(); expect("score" in card).toBe(false);
    await call("leadops.setPipelineAppointment", { publicId: lead.publicId, appointmentAt: null });
    expect(getStore().tables.leads.find((item) => item.publicId === lead.publicId)!.appointmentAt).toBeNull();
  });

  it("schickt SMS, WhatsApp-Link und Einzel-E-Mail aus der Karte und zieht die Karte aus „Neu“", async () => {
    const lead = await coldLead("Reuter"); expect(lead.pipelineStage).toBe("neu");
    const sms = await call("leadops.sendLeadMessage", { publicId: lead.publicId, channel: "sms", text: "Guten Tag {{anrede}} {{nachname}}, hier {{absender}}.", templateKey: "frei" });
    expect(sms.status).toBe("simuliert"); expect(sms.text).toBe("Guten Tag Frau Reuter, hier Tanesco.");
    expect(getStore().tables.leads.find((item) => item.publicId === lead.publicId)!.pipelineStage).toBe("kontaktiert");
    const wa = await call("leadops.sendLeadMessage", { publicId: lead.publicId, channel: "whatsapp", text: "Kurze Frage, {{vorname}}?" });
    expect(wa.status).toBe("link"); expect(wa.link).toContain("https://wa.me/49561555");
    const nodes = await call("leadops.emailSendNodes"); expect(nodes.length).toBeGreaterThanOrEqual(6); const template = nodes.find((node: any) => node.isTemplate);
    const mail = await call("leadops.sendLeadMessage", { publicId: lead.publicId, channel: "email", text: "", campaignId: template.campaignId, nodeId: template.nodeId });
    expect(mail.status).toBe("simuliert"); expect(mail.subject).toContain("Reuter Dach & Fassade");
    const messages = await call("leadops.listLeadMessages", { publicId: lead.publicId }); expect(messages.map((item: any) => item.channel).sort()).toEqual(["email", "sms", "whatsapp"]);
    await expect(call("leadops.sendLeadMessage", { publicId: lead.publicId, channel: "sms", text: "x".repeat(600) })).rejects.toThrow(/zu lang/);
  });

  it("verzahnt Stufe, Anruf-Ergebnis und Antwort mit E-Mail-Serien und Wiedervorlagen (Automatik)", async () => {
    const settings = await call("leadops.pipelineSettings"); expect(settings.stageCampaigns.angebot).toBeTruthy(); expect(settings.replyStage).toBe("kontaktiert");
    const lead = await coldLead("Koch"); const before = getStore().tables.emailCampaignRecipients.filter((row) => row.leadId === lead.id).length;
    const moved = await call("leadops.movePipelineStage", { publicId: lead.publicId, stage: "angebot", note: "Angebot raus" });
    expect(moved.series).toBe("Nachfassen nach Angebot");
    expect(getStore().tables.emailCampaignRecipients.filter((row) => row.leadId === lead.id).length).toBe(before + 1);
    expect((await call("leadops.pipelineHistory", { publicId: lead.publicId })).some((event: any) => event.toStage === "serie")).toBe(true);
    // Anruf-Ergebnis „Wiedervorlage“ → Aufgabe unter Heute; „Interessiert“ → Serie + Aufgabe
    const brandt = await coldLead("Brandt");
    await call("leadops.startDialerSession", { campaignId: null, mode: "manuell", connection: "browser", agentPhone: null });
    const placed = await call("leadops.placeManualCall", { publicId: brandt.publicId }); getStore().tables.dialerCalls.find((row) => row.id === placed.callId)!.startedAt = new Date(Date.now() - 5000);
    await call("leadops.endDialerCall", { callId: placed.callId, durationSeconds: 60 }); await new Promise((resolve) => setTimeout(resolve, 20));
    await call("leadops.setCallDisposition", { callId: placed.callId, disposition: "wiedervorlage", followUpMinutes: 120 });
    const tasks = await call("leadops.listPipelineTasks", { publicId: brandt.publicId }); expect(tasks.some((task: any) => task.source === "dialer" && task.kind === "anruf")).toBe(true);
    await call("leadops.updateDialerSession", { status: "offline" });
    // Antwort im Posteingang → Stufe laut Einstellung (nur vorwärts)
    const stadler = getStore().tables.leads.find((row) => row.email === "info@stadler-solar.de")!; expect(stadler.pipelineStage).toBe("neu");
    await call("leadops.storeInboxMessage", { fromEmail: "info@stadler-solar.de", subject: "Re: Mehr Anfragen", bodyText: "Gern, rufen Sie mich an." });
    expect(getStore().tables.leads.find((row) => row.id === stadler.id)!.pipelineStage).toBe("kontaktiert");
    await call("leadops.savePipelineSettings", { ...settings, replyStage: null });
    await call("leadops.storeInboxMessage", { fromEmail: "info@stadler-solar.de", subject: "Re: nochmal", bodyText: "…" });
    expect(getStore().tables.leads.find((row) => row.id === stadler.id)!.pipelineStage).toBe("kontaktiert");
    await call("leadops.savePipelineSettings", settings);
  });

  it("weckt eingeschlafene Karten per Serie auf und erinnert an Termine (Automatik-Lauf)", async () => {
    const run = await call("leadops.runPipelineAutomations"); expect(run.enrolled).toBeGreaterThan(0); expect(run.reminders).toBeGreaterThanOrEqual(1);
    const wake = getStore().tables.emailCampaigns.find((row) => row.name === "Eingeschlafene Kontakte aufwecken")!; expect(wake.status).toBe("aktiv");
    expect(getStore().tables.emailCampaignRecipients.filter((row) => row.campaignId === wake.id).length).toBe(run.enrolled);
    expect(getStore().tables.outboundMessages.filter((row) => row.templateKey === "erinnerung").length).toBe(run.reminders);
    const again = await call("leadops.runPipelineAutomations"); expect(again.enrolled).toBe(0); expect(again.reminders).toBe(0); // je Karte nur einmal
  });

  it("verteilt neue Leads nach Regeln (PLZ, Auslastung) und zählt Ziele je Vertriebler", async () => {
    const team = await call("leadops.pipelineTeamOverview", { from: new Date(Date.now() - 30 * 86_400_000), until: new Date() });
    expect(team.rows.length).toBe(2); expect(team.rows.every((row: any) => row.target.calls === 40)).toBe(true); expect(team.rows.some((row: any) => row.revenue > 0 || row.openValue > 0)).toBe(true);
    const imported = await call("leadops.importColdList", { listName: "Regel-Test", rows: [{ firstName: "Nord", lastName: "Hessen", phone: "+49 69 1", postcode: "60311", city: "Frankfurt" }, { firstName: "Süd", lastName: "Bayern", phone: "+49 89 1", postcode: "80331", city: "München" }] });
    const [north, south] = imported.leadIds.map((id: number) => getStore().tables.leads.find((row) => row.id === id)!);
    const taner = getStore().tables.users.find((row) => row.email === "taner@tanesco.digital")!; const francesco = getStore().tables.users.find((row) => row.email === "francesco@tanesco.digital")!;
    expect(north.ownerUserId).toBe(taner.id); expect(south.ownerUserId).toBe(francesco.id);
    const settings = await call("leadops.pipelineSettings"); await call("leadops.savePipelineSettings", { ...settings, distribution: { ...settings.distribution, mode: "aus" } });
    const manual = await call("leadops.importColdList", { listName: "Regel-Test", rows: [{ firstName: "Ohne", lastName: "Regel", phone: "+49 40 1", postcode: "20095", city: "Hamburg" }] });
    expect(getStore().tables.leads.find((row) => row.id === manual.leadIds[0])!.ownerUserId).toBeFalsy();
    const forced = await call("leadops.distributePipelineByRules", { publicIds: [getStore().tables.leads.find((row) => row.id === manual.leadIds[0])!.publicId] }); expect(forced.assigned).toBe(1); // reihum, wenn aus
    await call("leadops.savePipelineSettings", settings);
  });

  it("verschiebt mehrere Karten auf einmal und exportiert die Pipeline als CSV", async () => {
    const overview = await call("leadops.pipelineOverview", { source: "kaltakquise" }); const ids = overview.stages.find((stage: any) => stage.key === "neu").leads.slice(0, 2).map((lead: any) => lead.publicId); expect(ids.length).toBe(2);
    const moved = await call("leadops.bulkMovePipelineStage", { publicIds: ids, stage: "qualifiziert" }); expect(moved).toMatchObject({ moved: 2, label: "Qualifiziert" });
    const csv = await call("leadops.exportPipelineCsv", { source: "kaltakquise" }); expect(csv.fileName).toMatch(/^vertriebspipeline-kaltakquise-/); expect(csv.csv.split("\n")[0]).toContain("Lead-ID;Name;Firma"); expect(csv.rows).toBeGreaterThanOrEqual(8);
  });

  it("führt A/B-Betreff, Versandfenster, Link-Bedingung, Vorlagen und Sperrliste in den E-Mail-Kampagnen", async () => {
    const list = await call("leadops.listEmailCampaigns"); const dach = list.find((row: any) => row.name.startsWith("Dachdecker")); expect(dach.abTest).toBe(true); expect(dach.sendWindow.enabled).toBe(true); expect(dach.stats.abTest.a.sent + dach.stats.abTest.b.sent).toBe(5);
    expect(list.filter((row: any) => row.isTemplate).length).toBe(1);
    const copy = await call("leadops.duplicateEmailCampaign", { id: dach.id, asTemplate: true, name: "Vorlage: Dachdecker" }); expect(getStore().tables.emailCampaigns.find((row) => row.id === copy.id)!.isTemplate).toBe(true);
    await expect(call("leadops.startEmailCampaign", { id: copy.id })).rejects.toThrow(/Vorlage/);
    const fromTemplate = await call("leadops.duplicateEmailCampaign", { id: copy.id, name: "Dachdecker 2" }); expect(getStore().tables.emailCampaigns.find((row) => row.id === fromTemplate.id)!.isTemplate).toBe(false);
    // Sperrliste: Bounce stoppt die Serie und hält die Adresse aus neuen Zielgruppen
    const detail = await call("leadops.getEmailCampaign", { id: dach.id }); const recipient = detail.recipients.find((row: any) => row.status === "wartet");
    const bounced = await call("leadops.markEmailBounced", { recipientId: recipient.id, kind: "bounce" }); expect(bounced.email).toBe(recipient.email);
    expect(getStore().tables.emailCampaignRecipients.find((row) => row.id === recipient.id)!.status).toBe("bounce");
    expect((await call("leadops.listEmailSuppressions")).items.some((row: any) => row.email === recipient.email)).toBe(true);
    const audience = await call("leadops.previewEmailAudience", { source: "liste", listName: "Dachdecker Hessen" }); expect(audience.sample.some((row: any) => row.email === recipient.email)).toBe(false);
    const sup = (await call("leadops.listEmailSuppressions")).items.find((row: any) => row.email === recipient.email); await call("leadops.removeEmailSuppression", { id: sup.id });
    // Link-Bedingung: Klick auf /termin → Dann-Zweig
    const starter = await call("leadops.emailCampaignStarter", { kind: "kaltakquise" }); const cond = starter.tree.nodes.find((node: any) => node.type === "condition"); cond.check = "clicked"; cond.url = "/termin";
    const saved = await call("leadops.saveEmailCampaign", { id: null, name: "Link-Test", fromName: "T", fromEmail: "t@t.de", replyTo: null, audience: { source: "liste", listName: "Regel-Test" }, tree: starter.tree, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" }, abSplit: 30 });
    getStore().tables.leads.filter((row) => row.listName === "Regel-Test").forEach((row) => { row.email = `${row.publicId.toLowerCase()}@beispiel.de`; });
    const started = await call("leadops.startEmailCampaign", { id: saved.id }); expect(started.added).toBe(3);
    const recipients = getStore().tables.emailCampaignRecipients.filter((row) => row.campaignId === saved.id); expect(recipients.every((row) => row.variant === null)).toBe(true); // kein Betreff B → kein A/B
    for (const row of recipients) { row.nextActionAt = new Date(Date.now() - 1000); }
    await call("leadops.simulateEmailEvent", { recipientId: recipients[0].id, kind: "geklickt", url: "https://tanesco.digital/termin" }); await call("leadops.simulateEmailEvent", { recipientId: recipients[1].id, kind: "geklickt", url: "https://tanesco.digital/preise" });
    await call("leadops.runEmailCampaigns");
    const events = getStore().tables.emailCampaignEvents.filter((row) => row.campaignId === saved.id && row.kind === "verzweigt");
    expect(events.find((row) => row.recipientId === recipients[0].id)!.note).toContain("ja → Dann-Zweig"); expect(events.find((row) => row.recipientId === recipients[1].id)!.note).toContain("nein → Sonst-Zweig");
  });
});

describe("Dialer für Leads aus dem Posteingang & KI-Vorlagen-Builder (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("übernimmt die Telefonnummer aus der E-Mail, sonst lässt sie sich an der Karte nachtragen – dann ist der Dialer nutzbar", async () => {
    const inbox = await call("leadops.listInbox", { filter: "alle" }); const mayer = inbox.items.find((item: any) => item.fromEmail === "m.mayer@solartechnik-mayer.de");
    expect(mayer.phoneHint).toBe("+499115550199"); // aus der Signatur erkannt
    const created = await call("leadops.createLeadFromInbox", { messageId: mayer.id, pipeline: "email", stage: "qualifiziert", company: "Solartechnik Mayer" });
    const lead = getStore().tables.leads.find((row) => row.publicId === created.publicId)!; expect(lead.phone).toBe("+499115550199");
    const overview = await call("leadops.pipelineOverview", { source: "email" }); expect(overview.stages.find((stage: any) => stage.key === "qualifiziert").leads.find((item: any) => item.publicId === created.publicId).phone).toBe("+499115550199");
    // Lead ohne Nummer: Nummer nachtragen → Verlauf, Pipeline-Karte mit Telefon
    const koch = getStore().tables.leads.find((row) => row.email === "kontakt@koch-dach.de")!; koch.phone = null;
    await expect(call("leadops.setPipelineContact", { publicId: koch.publicId, phone: "abc" })).rejects.toThrow(/gültige Telefonnummer/);
    const saved = await call("leadops.setPipelineContact", { publicId: koch.publicId, phone: "0611 5550102" }); expect(saved.phone).toBe("0611 5550102");
    expect((await call("leadops.pipelineHistory", { publicId: koch.publicId }))[0]).toMatchObject({ toStage: "kontakt" });
    await call("leadops.startDialerSession", { campaignId: null, mode: "manuell", connection: "browser", agentPhone: null });
    const placed = await call("leadops.placeManualCall", { publicId: koch.publicId }); expect(placed.callId).toBeTruthy(); await call("leadops.endDialerCall", { callId: placed.callId, durationSeconds: 5 }); await call("leadops.updateDialerSession", { status: "offline" });
  });

  it("baut E-Mails, Serien und kurze Texte aus einer Beschreibung (ohne KI-Freigabe regelbasiert)", async () => {
    const single = await call("leadops.draftEmailWithAi", { brief: "Nachfass-Mail nach Angebot für Dachdecker, freundlich, Terminlink", abTest: true });
    expect(single.source).toBe("vorlage"); expect(single.draft.subject).toContain("Angebot"); expect(single.draft.subjectB).toBeTruthy(); expect(single.draft.blocks.length).toBeGreaterThanOrEqual(5);
    const series = await call("leadops.draftEmailSeriesWithAi", { brief: "Erstkontakt für PV-Betriebe in Bayern", count: 3, waitDays: 4, stopWhen: "replied" });
    expect(series.tree.nodes.filter((node: any) => node.type === "send")).toHaveLength(3); expect(series.series.name).toContain("PV-Betriebe");
    const saved = await call("leadops.saveEmailCampaign", { id: null, name: series.series.name, fromName: "Tanesco", fromEmail: "vertrieb@tanesco.digital", replyTo: null, audience: { source: "liste", listName: "Dachdecker Hessen" }, tree: series.tree, design: {} });
    const started = await call("leadops.startEmailCampaign", { id: saved.id }); expect(started.added).toBeGreaterThanOrEqual(3);
    const detail = await call("leadops.getEmailCampaign", { id: saved.id }); expect(detail.events.filter((event: any) => event.kind === "gesendet").length).toBe(started.added);
    const sms = await call("leadops.draftMessageWithAi", { brief: "Rückruf wegen Angebot", channel: "sms" }); expect(sms.text.length).toBeLessThanOrEqual(480); expect(sms.text).toContain("{{nachname}}");
  });

  it("schreibt Vorlagen vor: ausgewählte Vorschläge landen als Vorlagen (E-Mail oder Serie) unter „Vorlagen“", async () => {
    const before = (await call("leadops.listEmailCampaigns")).filter((row: any) => row.isTemplate).length;
    const result = await call("leadops.createEmailTemplatesWithAi", { keys: ["erstkontakt", "angebot", "willkommen", "unbekannt"], category: "Wärmepumpe", sender: "Taner" });
    expect(result.created).toHaveLength(3); expect(result.created.map((row: any) => row.name)).toEqual(["Vorlage: Erstkontakt Kaltakquise – Wärmepumpe", "Vorlage: Nachfassen nach Angebot – Wärmepumpe", "Vorlage: Willkommen nach Anfrage – Wärmepumpe"]);
    const list = await call("leadops.listEmailCampaigns"); const templates = list.filter((row: any) => row.isTemplate); expect(templates.length).toBe(before + 3);
    const series = await call("leadops.getEmailCampaign", { id: result.created[0].id }); expect(series.isTemplate).toBe(true); expect(series.tree.nodes.filter((node: any) => node.type === "send")).toHaveLength(3); expect(series.audience).toEqual({ source: "alle" });
    const single = await call("leadops.getEmailCampaign", { id: result.created[2].id }); expect(single.tree.nodes.filter((node: any) => node.type === "send")).toHaveLength(1); expect(single.audience).toEqual({ source: "stufe", stage: "neu" }); expect(single.tree.nodes[0].subject).toContain("Willkommen");
    // Vorlage → Kampagne daraus anlegen → startbar
    const copy = await call("leadops.duplicateEmailCampaign", { id: result.created[1].id, name: "Nachfassen WP" }); expect(copy.name).toBe("Nachfassen WP"); expect((await call("leadops.getEmailCampaign", { id: copy.id })).isTemplate).toBeFalsy();
  });
});

describe("Trennung Verkaufs-Leads/Vertriebskontakte, Sperrliste mit Unterlisten, Posteingang sperren, Lead-Fenster (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("hält Leads zum Verkauf und Vertriebskontakte strikt auseinander", async () => {
    const all = getStore().tables.leads; const prospects = all.filter((row) => row.kind === "vertrieb"); const sales = all.filter((row) => row.kind !== "vertrieb");
    expect(prospects.length).toBeGreaterThan(20); expect(sales.length).toBeGreaterThan(20);
    expect(prospects.every((row) => row.pipelineStage && row.adPlatform)).toBe(true); expect(sales.every((row) => !row.adPlatform)).toBe(true);
    // Lead-Operations sehen nur Leads zum Verkauf
    const listed = await call("leadops.listLeads", {}); expect(listed.some((row: any) => row.kind === "vertrieb")).toBe(false); expect(listed.length).toBe(sales.length);
    const paged = await call("leadops.listLeadsPaged", { page: 1, pageSize: 500 }); expect((paged.items ?? paged.rows ?? paged).some?.((row: any) => row.kind === "vertrieb") ?? false).toBe(false);
    const csv = await call("leadops.exportLeadsCsv", {}); expect(csv.split("\n").length - 1).toBe(sales.length);
    const search = await call("leadops.search", { query: prospects[0].lastName }); expect(search.filter((row: any) => row.type === "Lead").some((row: any) => row.label.includes(prospects[0].publicId))).toBe(false);
    // Pipeline sieht nur Vertriebskontakte
    const overview = await call("leadops.pipelineOverview", { source: "alle" }); const cardIds = new Set(overview.stages.flatMap((stage: any) => stage.leads.map((lead: any) => lead.publicId)));
    expect(sales.some((row) => cardIds.has(row.publicId))).toBe(false); expect(prospects.filter((row) => cardIds.has(row.publicId)).length).toBeGreaterThan(20);
    // Verkaufs-Lead lässt sich nicht in die Pipeline schieben – Vertriebskontakt nicht als Verkaufs-Lead bearbeiten
    await expect(call("leadops.movePipelineStage", { publicId: sales[0].publicId, stage: "kontaktiert" })).rejects.toThrow(/Lead zum Verkauf/);
    await expect(call("leadops.updateLeadStatus", { publicId: prospects[0].publicId, status: "genehmigt" })).rejects.toThrow(/Vertriebskontakt/);
    // Zielgruppen der E-Mail-Kampagnen bestehen nur aus Vertriebskontakten – auch „alle“
    const preview = await call("leadops.previewEmailAudience", { source: "alle" }); const blockedMails = new Set(getStore().tables.emailSuppressions.map((row) => String(row.email).toLowerCase()));
    const expectedAudience = prospects.filter((row) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(row.email ?? "")) && !blockedMails.has(String(row.email).toLowerCase())).length;
    expect(preview.count).toBeGreaterThan(0); expect(preview.count).toBe(expectedAudience);
    // Posteingang: Absender mit der E-Mail eines Verkaufs-Leads wird nicht mit ihm verknüpft
    const prospectMails = new Set(prospects.map((row) => String(row.email ?? "").toLowerCase())); const sold = sales.find((row) => row.email && !prospectMails.has(String(row.email).toLowerCase())) ?? { ...sales[0], email: "nur-verkauf@beispiel.de" }; if (!sales.some((row) => row.email === sold.email)) sales[0].email = sold.email; const stored = await call("leadops.storeInboxMessage", { fromEmail: sold.email, fromName: "Kunde", subject: "Frage", bodyText: "Hallo, ich habe eine Frage." }); expect(stored.leadId).toBeNull();
    // Callcenter-Dialer baut Warteschlangen nur aus Leads zum Verkauf
    const campaign = await call("leadops.saveDialerCampaign", { name: "Trennungstest", mode: "power", leadFilter: { categoryIds: [], statuses: ["neu"], tagIds: [], supplierIds: [] } }); const queue = await call("leadops.buildDialerQueue", { campaignId: campaign.id }); const queued = await call("leadops.listDialerQueue", { campaignId: campaign.id }); void queue;
    const queuedIds = new Set(queued.map((row: any) => row.leadId)); expect(prospects.some((row) => queuedIds.has(row.id))).toBe(false);
  });

  it("führt Bounces, Abmeldungen, Beschwerden, Posteingang-Sperren und manuelle Einträge als Unterlisten mit Quelle", async () => {
    const list = await call("leadops.listEmailSuppressions");
    expect(list.counts).toMatchObject({ alle: list.items.length }); for (const key of ["bounce", "abgemeldet", "beschwerde", "gesperrt", "manuell"]) expect(list.counts[key]).toBeGreaterThanOrEqual(1);
    expect(list.items.every((row: any) => row.source)).toBe(true); expect(list.items.find((row: any) => row.reason === "gesperrt").source).toBe("Posteingang");
    const csv = await call("leadops.exportEmailSuppressions"); expect(csv.split("\n")[0]).toContain("Quelle"); expect(csv.split("\n").length).toBe(list.items.length + 1);
    // Bounce aus einer Kampagne trägt die Kampagne als Quelle
    const recipientRow = getStore().tables.emailCampaignRecipients.find((row) => (row.status === "wartet" || row.status === "laeuft" || row.status === "fertig") && row.sentCount > 0)!; const active = getStore().tables.emailCampaigns.find((row) => row.id === recipientRow.campaignId)!; const recipient = recipientRow;
    const bounced = await call("leadops.markEmailBounced", { recipientId: recipient.id, kind: "bounce" }); expect(bounced.email).toBe(recipient.email);
    const after = await call("leadops.listEmailSuppressions"); expect(after.items.find((row: any) => row.email === recipient.email)).toMatchObject({ reason: "bounce", source: `Kampagne „${active.name}“` }); expect(after.counts.bounce).toBe(list.counts.bounce + 1);
  });

  it("sperrt Antworten direkt im Posteingang, erkennt Abmeldungen und blockt gesperrte Absender", async () => {
    const inbox = await call("leadops.listInbox", { filter: "alle" }); const hansen = inbox.items.find((row: any) => row.fromEmail === "info@hansen-bedachungen.de");
    expect(inbox.counts.gesperrt).toBeGreaterThanOrEqual(1); expect(inbox.items.some((row: any) => row.blocked)).toBe(false);
    // Filter je Kampagne
    expect(inbox.campaigns.length).toBeGreaterThanOrEqual(1); const firstCampaign = inbox.campaigns[0]; expect(firstCampaign.count).toBeGreaterThanOrEqual(1);
    const perCampaign = await call("leadops.listInbox", { filter: "alle", campaignId: firstCampaign.id }); expect(perCampaign.items.length).toBe(firstCampaign.count); expect(perCampaign.items.every((row: any) => row.campaignId === firstCampaign.id)).toBe(true); expect(perCampaign.counts.alle).toBe(inbox.counts.alle);
    expect((await call("leadops.listInbox", { filter: "unbekannt", campaignId: firstCampaign.id })).items.every((row: any) => row.campaignId === firstCampaign.id && !row.lead)).toBe(true);
    // Abmeldung im Seed erkannt → Hinweis + Sperrliste
    const roth = inbox.items.find((row: any) => row.fromEmail === "office@bedachungen-roth.example"); expect(roth.optOut).toBe(true); expect(roth.suppressed).toBe(true);
    // Sperren: Sperrliste (Posteingang), Nachricht unter „Gesperrt“, laufende Serie gestoppt, kein Lead mehr anlegbar
    const blocked = await call("leadops.blockInboxSender", { messageId: hansen.id }); expect(blocked).toMatchObject({ email: "info@hansen-bedachungen.de", messages: 1 });
    const entry = (await call("leadops.listEmailSuppressions")).items.find((row: any) => row.email === "info@hansen-bedachungen.de"); expect(entry).toMatchObject({ reason: "gesperrt", source: "Posteingang" }); expect(entry.note).toContain("Im Posteingang gesperrt");
    expect((await call("leadops.listInbox", { filter: "alle" })).items.some((row: any) => row.id === hansen.id)).toBe(false);
    const gesperrt = await call("leadops.listInbox", { filter: "gesperrt" }); expect(gesperrt.items.find((row: any) => row.id === hansen.id)).toMatchObject({ blocked: true, suppressed: true });
    await expect(call("leadops.createLeadFromInbox", { messageId: hansen.id, pipeline: "email", stage: "kontaktiert" })).rejects.toThrow(/gesperrt/);
    expect(getStore().tables.emailCampaignRecipients.filter((row) => row.email === "info@hansen-bedachungen.de").every((row) => row.status !== "wartet" && row.status !== "laeuft")).toBe(true);
    // neue Mail vom gesperrten Absender landet direkt unter „Gesperrt“
    const again = await call("leadops.storeInboxMessage", { fromEmail: "info@hansen-bedachungen.de", fromName: "Peter Hansen", subject: "Noch was", bodyText: "Hallo nochmal" });
    expect(getStore().tables.inboxMessages.find((row) => row.id === again.id)).toMatchObject({ blocked: true, isRead: true }); expect((await call("leadops.listInbox", { filter: "gesperrt" })).items.length).toBeGreaterThanOrEqual(3);
    // Entsperren: Sperrliste bereinigt, Nachrichten zurück
    const freed = await call("leadops.unblockInboxSender", { messageId: hansen.id }); expect(freed.messages).toBe(2);
    expect((await call("leadops.listEmailSuppressions")).items.some((row: any) => row.email === "info@hansen-bedachungen.de")).toBe(false); expect((await call("leadops.listInbox", { filter: "alle" })).items.some((row: any) => row.id === hansen.id)).toBe(true);
    // Abmeldung in einer neuen Antwort wird automatisch erkannt → Unterliste „Abmeldungen“, Empfänger abgemeldet
    const koch = getStore().tables.emailCampaignRecipients.find((row) => row.email === "kontakt@koch-dach.de")!; getStore().tables.emailCampaignRecipients.filter((row) => row.email === koch.email).forEach((row) => { row.status = "wartet"; });
    const optOut = await call("leadops.storeInboxMessage", { fromEmail: "kontakt@koch-dach.de", fromName: "Sabine Koch", subject: "Re: Haben Sie meine E-Mail gesehen?", bodyText: "Bitte keine weiteren E-Mails an uns.\n\nMfG" });
    expect(getStore().tables.inboxMessages.find((row) => row.id === optOut.id)).toMatchObject({ optOut: true, blocked: false });
    const abgemeldet = (await call("leadops.listEmailSuppressions")).items.find((row: any) => row.email === "kontakt@koch-dach.de"); expect(abgemeldet).toMatchObject({ reason: "abgemeldet" }); expect(abgemeldet.source).toContain("Antwort");
    expect(getStore().tables.emailCampaignRecipients.filter((row) => row.email === koch.email).every((row) => row.status === "abgemeldet")).toBe(true);
    expect((await call("leadops.previewEmailAudience", { source: "liste", listName: "Dachdecker Hessen" })).sample.some((row: any) => row.email === "kontakt@koch-dach.de")).toBe(false);
  });

  it("KI-Einordnung beim Abholen: Beschwerde automatisch gesperrt, unsichere Fälle unter „Prüfen“, Abwesenheit nur markiert; Zeitraum-Filter", async () => {
    const settings = await call("leadops.getMailSettings"); expect(settings).toMatchObject({ imapEnabled: true, replyAiEnabled: true, replyAiAutoBlock: true, replyAiInterest: true, replyAiAvailable: true });
    const before = (await call("leadops.listInbox", { filter: "alle" })).items.length;
    const result = await call("leadops.syncInbox"); expect(result.added).toBe(3); expect(result.blocked).toBe(1); expect(result.flagged).toBe(1);
    expect((await call("leadops.syncInbox")).added).toBe(0); // zweites Abholen holt nichts doppelt
    // Beschwerde → Unterliste „Beschwerden“, Nachricht unter „Gesperrt“, Serie gestoppt
    const blocked = (await call("leadops.listInbox", { filter: "gesperrt" })).items.find((row: any) => row.ai?.kind === "beschwerde" && row.ai?.action === "gesperrt"); expect(blocked).toBeTruthy(); expect(blocked.blocked).toBe(true); expect(blocked.ai.quote).toContain("Hören Sie");
    const entry = (await call("leadops.listEmailSuppressions")).items.find((row: any) => row.email === blocked.fromEmail); expect(entry).toMatchObject({ reason: "beschwerde" }); expect(entry.note).toContain("automatisch gesperrt"); expect(entry.note).toMatch(/Beschwerde \(\d+ %\)/);
    expect(getStore().tables.emailCampaignRecipients.filter((row) => row.email === blocked.fromEmail).every((row) => row.status !== "wartet" && row.status !== "laeuft")).toBe(true);
    // unsicher → Ordner „Prüfen“, nicht gesperrt; „In Ordnung“ nimmt den Fall aus dem Ordner
    const check = await call("leadops.listInbox", { filter: "pruefen" }); expect(check.counts.pruefen).toBe(1); const vogel = check.items[0]; expect(vogel).toMatchObject({ fromEmail: "kontakt@elektro-vogel.example", blocked: false }); expect(vogel.ai).toMatchObject({ kind: "beschwerde", action: "pruefen" }); expect(vogel.ai.confidence).toBeLessThan(80);
    expect((await call("leadops.listEmailSuppressions")).items.some((row: any) => row.email === vogel.fromEmail)).toBe(false);
    await call("leadops.resolveInboxCheck", { id: vogel.id }); expect((await call("leadops.listInbox", { filter: "pruefen" })).items.length).toBe(0); expect((await call("leadops.listInbox", { filter: "alle" })).items.find((row: any) => row.id === vogel.id).ai.action).toBe("geprueft");
    // Abwesenheitsnotiz: markiert, Empfänger nicht als „geantwortet“ gezählt wird nicht verlangt – aber nie gesperrt
    const away = (await call("leadops.listInbox", { filter: "alle" })).items.find((row: any) => row.ai?.kind === "abwesenheit"); expect(away).toBeTruthy(); expect(away.blocked).toBe(false); expect(away.ai.action).toBe("markiert");
    const visible = (await call("leadops.listInbox", { filter: "alle" })).items; expect(visible.length).toBeGreaterThanOrEqual(before + 1); expect(visible.some((row: any) => row.fromEmail === blocked.fromEmail)).toBe(false); // alle Nachrichten des Beschwerde-Absenders liegen unter „Gesperrt“
    // Seed-Beschwerde (Dachdecker Brandt) steht als automatisch gesperrt in der Sperrliste
    expect((await call("leadops.listEmailSuppressions")).items.some((row: any) => row.email === "info@dachdecker-brandt.example" && row.reason === "beschwerde")).toBe(true);
    // Zeitraum-Filter: nur heute (die drei neuen Antworten), eigener Zeitraum in der Vergangenheit ohne die neuen
    const today = new Date(); const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const onlyToday = await call("leadops.listInbox", { filter: "alle", from: start, to: new Date(start.getTime() + 86_400_000) }); expect(onlyToday.items.every((row: any) => new Date(row.receivedAt) >= start)).toBe(true); expect(onlyToday.items.some((row: any) => row.id === vogel.id)).toBe(true);
    const past = await call("leadops.listInbox", { filter: "alle", from: new Date(start.getTime() - 10 * 86_400_000), to: new Date(start.getTime() - 86_400_000) }); expect(past.items.some((row: any) => row.id === vogel.id)).toBe(false); expect(past.items.every((row: any) => new Date(row.receivedAt) < start)).toBe(true);
    // Filter nach KI-Einordnung
    const onlyAway = await call("leadops.listInbox", { filter: "alle", aiKind: "abwesenheit" }); expect(onlyAway.items.length).toBeGreaterThanOrEqual(1); expect(onlyAway.items.every((row: any) => row.ai?.kind === "abwesenheit")).toBe(true);
    const autoBlocked = await call("leadops.listInbox", { filter: "gesperrt", aiKind: "auto-gesperrt" }); expect(autoBlocked.items.length).toBeGreaterThanOrEqual(1); expect(autoBlocked.items.every((row: any) => row.ai?.action === "gesperrt")).toBe(true);
    expect((await call("leadops.listInbox", { filter: "alle", aiKind: "interessiert" })).items.every((row: any) => row.ai?.kind === "interessiert")).toBe(true);
    expect((await call("leadops.listInbox", { filter: "alle", aiKind: "beschwerde" })).items.some((row: any) => row.id === vogel.id)).toBe(true); // geprüft, aber die Art bleibt
    // Auto-Sperre aus → Beschwerde wird nur zur Prüfung markiert
    await call("leadops.saveMailSettings", { ...settings, password: "", imapPassword: "", replyAiAutoBlock: false });
    const manual = await call("leadops.storeInboxMessage", { fromEmail: "chef@wuetend.example", fromName: "Wütend", subject: "Re: Serie", bodyText: "Unverschämt! Lassen Sie mich in Ruhe, sonst schalte ich meinen Anwalt ein." });
    expect(getStore().tables.inboxMessages.find((row) => row.id === manual.id)).toMatchObject({ blocked: false, aiKind: "beschwerde", aiAction: "pruefen" });
    await call("leadops.saveMailSettings", { ...settings, password: "", imapPassword: "", replyAiAutoBlock: true });
  });

  it("Lead-Seite: Stammdaten bearbeiten (mit Verlauf), Kategorie wechseln, Kontakt löschen – nur Vertriebskontakte", async () => {
    const overview = await call("leadops.pipelineOverview", { source: "kaltakquise" }); const card = overview.stages.flatMap((stage: any) => stage.leads).find((lead: any) => lead.name.includes("Vogt"));
    expect(card.categoryShortcode).toBe("PV");
    await expect(call("leadops.updatePipelineLead", { publicId: card.publicId, phone: "abc" })).rejects.toThrow(/gültige Telefonnummer/);
    await expect(call("leadops.updatePipelineLead", { publicId: card.publicId, firstName: "", lastName: "" })).rejects.toThrow(/Vor- oder Nachname/);
    const categories = await call("leadops.listCategories"); const wp = categories.find((row: any) => row.shortcode === "WP");
    const saved = await call("leadops.updatePipelineLead", { publicId: card.publicId, salutation: "frau", firstName: "Lena", lastName: "Vogt-Berger", company: "Vogt Solar GmbH", phone: "+49 641 7777777", email: "info@vogt-solar.de", postcode: "35392", city: "Gießen", categoryId: wp.id });
    expect(saved.changed).toBeGreaterThanOrEqual(5);
    const detail = await call("leadops.pipelineLeadDetail", { publicId: card.publicId });
    expect(detail).toMatchObject({ firstName: "Lena", lastName: "Vogt-Berger", company: "Vogt Solar GmbH", phone: "+49 641 7777777", email: "info@vogt-solar.de", postcode: "35392", salutation: "frau", categoryName: wp.name });
    expect(detail.history[0]).toMatchObject({ toStage: "kontakt" }); expect(detail.history[0].note).toContain("Kategorie:"); expect(detail.history[0].note).toContain("Name: Lena Vogt-Berger");
    expect((await call("leadops.updatePipelineLead", { publicId: card.publicId, company: "Vogt Solar GmbH" })).changed).toBe(0); // nichts geändert → kein Verlaufseintrag
    // Löschen: Verkaufs-Lead verweigert, Vertriebskontakt samt Aufgaben/Verlauf weg, Posteingang behält die Nachricht ohne Verknüpfung
    await expect(call("leadops.deletePipelineLead", { publicId: getStore().tables.leads.find((row) => row.kind !== "vertrieb")!.publicId })).rejects.toThrow(/Lead zum Verkauf/);
    const leadId = getStore().tables.leads.find((row) => row.publicId === card.publicId)!.id;
    await call("leadops.createPipelineTask", { publicId: card.publicId, kind: "anruf", title: "Rückruf", dueAt: new Date() });
    const inboxBefore = getStore().tables.inboxMessages.filter((row) => row.leadId === leadId).length;
    const removed = await call("leadops.deletePipelineLead", { publicId: card.publicId }); expect(removed.name).toContain("Lena");
    expect(getStore().tables.leads.some((row) => row.id === leadId)).toBe(false); expect(getStore().tables.pipelineTasks.some((row) => row.leadId === leadId)).toBe(false); expect(getStore().tables.pipelineEvents.some((row) => row.leadId === leadId)).toBe(false);
    expect(getStore().tables.inboxMessages.filter((row) => row.leadId === leadId).length).toBe(0); expect(getStore().tables.inboxMessages.length).toBeGreaterThanOrEqual(inboxBefore);
    await expect(call("leadops.pipelineLeadDetail", { publicId: card.publicId })).rejects.toThrow();
  });

  it("öffnet das ausführliche Lead-Fenster mit allen Bereichen und neuen Kürzeln (ohne Punkte)", async () => {
    const overview = await call("leadops.pipelineOverview", { source: "kaltakquise" }); const card = overview.stages.flatMap((stage: any) => stage.leads).find((lead: any) => lead.name.includes("Yilmaz"));
    const detail = await call("leadops.pipelineLeadDetail", { publicId: card.publicId });
    expect(detail).toMatchObject({ publicId: card.publicId, adPlatform: "kaltakquise", categoryName: "Photovoltaik", categoryEmoji: "☀️", categoryColor: "#eab308" });
    expect(Array.isArray(detail.history) && detail.history.length).toBeTruthy(); expect(Array.isArray(detail.tasks)).toBe(true); expect(Array.isArray(detail.calls)).toBe(true); expect(Array.isArray(detail.campaigns)).toBe(true); expect(Array.isArray(detail.inbox)).toBe(true); expect("score" in detail).toBe(false); // Scoring entfernt
    await expect(call("leadops.pipelineLeadDetail", { publicId: getStore().tables.leads.find((row) => row.kind !== "vertrieb")!.publicId })).rejects.toThrow(/Lead zum Verkauf/);
    const categories = await call("leadops.listCategories"); const byCode = Object.fromEntries(categories.map((row: any) => [row.shortcode, row]));
    expect(byCode["WTG"]).toMatchObject({ name: "Wintergärten", emoji: "🌿", color: "#22c55e" }); expect(byCode["ERS"]).toMatchObject({ name: "Elektrorollstühle", emoji: "♿" }); expect(byCode["HÖR"]).toMatchObject({ name: "Hörgeräte", emoji: "🦻" }); expect(byCode["TRL"]).toMatchObject({ name: "Treppenlifte", emoji: "🛗" });
    expect(["WG", "ER", "HG", "TL"].some((code) => byCode[code])).toBe(false);
    const created = await call("leadops.createCategory", { shortcode: "hör-test", name: "Hörtest" }); expect(created.shortcode ?? (await call("leadops.listCategories")).find((row: any) => row.name === "Hörtest").shortcode).toBe("HÖR-TEST");
  });
});

describe("E-Mail-Verlauf am Lead (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("speichert Antworten aus dem Posteingang, verknüpft beim Anlegen alle Mails des Absenders und zeigt den Verlauf samt Vorgeschichte", async () => {
    const inbox = await call("leadops.listInbox", { filter: "alle" });
    const mayer = inbox.items.find((item: any) => item.fromEmail === "m.mayer@solartechnik-mayer.de" && String(item.subject).startsWith("Anfrage")); expect(mayer).toBeTruthy();
    // Antwort aus dem Posteingang wird gespeichert – noch ohne Lead, als „Re: …“ an den Absender
    await expect(call("leadops.replyInboxMessage", { messageId: mayer.id, text: "   " })).rejects.toThrow(/Text/);
    await call("leadops.replyInboxMessage", { messageId: mayer.id, text: "Gerne – das Angebot kommt morgen." });
    const stored = getStore().tables.outboundMessages.find((row) => row.inboxMessageId === mayer.id); expect(stored).toMatchObject({ channel: "email", toAddress: "m.mayer@solartechnik-mayer.de", leadId: null, subject: "Re: Anfrage: Leads für Photovoltaik im Raum Nürnberg", status: "simuliert" });
    stored!.createdAt = new Date(Date.now() - 60_000); // Antwort lag eine Minute zurück (sonst fällt sie auf dieselbe Millisekunde wie das Anlegen)
    // Lead anlegen → beide eingegangenen Mails und beide Antworten hängen am Lead
    const created = await call("leadops.createLeadFromInbox", { messageId: mayer.id, pipeline: "email", stage: "qualifiziert" });
    expect(created.linked).toEqual({ incoming: 2, replies: 2 });
    expect(getStore().tables.inboxMessages.filter((row) => row.fromEmail === "m.mayer@solartechnik-mayer.de").every((row) => row.leadId === created.leadId)).toBe(true);
    expect(getStore().tables.outboundMessages.filter((row) => row.toAddress === "m.mayer@solartechnik-mayer.de").every((row) => row.leadId === created.leadId)).toBe(true);
    // Verlauf: älteste zuerst, Vorgeschichte (Frage → unsere Antwort) vor der neuen Anfrage, alles vor dem Anlegen
    const thread = await call("leadops.leadEmailThread", { publicId: created.publicId });
    expect(thread.email).toBe("m.mayer@solartechnik-mayer.de"); expect(thread.before).toBe(4); expect(thread.leadCreatedAt).toBeTruthy();
    expect(thread.items.map((item: any) => item.kind)).toEqual(["eingang", "antwort", "eingang", "antwort"]);
    expect(thread.items.map((item: any) => item.direction)).toEqual(["ein", "aus", "ein", "aus"]);
    expect(thread.items[0]).toMatchObject({ subject: "Frage zu Ihren Leistungen", who: "Markus Mayer", status: "gelesen" }); expect(thread.items[1].who).toBe("Taner Tanesco"); expect(thread.items[3].text).toContain("Angebot kommt morgen");
    for (let index = 1; index < thread.items.length; index += 1) expect(new Date(thread.items[index].at).getTime()).toBeGreaterThanOrEqual(new Date(thread.items[index - 1].at).getTime());
    // Einzel-E-Mail aus der Karte erscheint ebenfalls – als eigener Eintrag nach dem Anlegen
    await call("leadops.sendLeadMessage", { publicId: created.publicId, channel: "email", subject: "Ihr Angebot", text: "Anbei das Angebot wie besprochen." });
    const after = await call("leadops.leadEmailThread", { publicId: created.publicId }); expect(after.items.length).toBe(5); expect(after.items[4]).toMatchObject({ kind: "einzel", direction: "aus", subject: "Ihr Angebot" }); expect(after.before).toBe(4);
    const detail = await call("leadops.pipelineLeadDetail", { publicId: created.publicId }); expect(detail.inbox.length).toBe(2);
    // Serien-Versand im Verlauf: Hansen hat eine Serien-Mail bekommen und geantwortet
    const hansen = getStore().tables.leads.find((row) => row.email === "info@hansen-bedachungen.de")!;
    const hansenThread = await call("leadops.leadEmailThread", { publicId: hansen.publicId });
    expect(hansenThread.items.some((item: any) => item.kind === "serie" && item.campaignName)).toBe(true); expect(hansenThread.items.some((item: any) => item.kind === "eingang" && item.aiKind === "interessiert")).toBe(true);
    expect(hansenThread.items.findIndex((item: any) => item.kind === "serie")).toBeLessThan(hansenThread.items.findIndex((item: any) => item.kind === "eingang"));
    // Kontakt ohne E-Mail-Verkehr: leerer Verlauf, kein Fehler
    const other = getStore().tables.leads.find((row) => row.kind === "vertrieb" && row.email && row.email !== hansen.email && !getStore().tables.inboxMessages.some((m) => m.fromEmail === row.email) && !getStore().tables.emailCampaignRecipients.some((r) => r.leadId === row.id))!;
    expect((await call("leadops.leadEmailThread", { publicId: other.publicId })).items).toEqual([]);
    expect(await call("leadops.leadEmailThread", { publicId: "GIBT-ES-NICHT" })).toEqual({ items: [], email: null, before: 0, leadCreatedAt: null });
  });
});

describe("Liste direkt im Kampagnen-Editor hochladen, Standard-Versandfenster (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("Excel/CSV → Kontakte erkannt → Liste hochladen → als Zielgruppe mit Empfängerzahl; neue Kampagne mit Standardfenster 7:30–17:00", async () => {
    const csv = "Vorname;Nachname;Firma;Telefon;E-Mail;PLZ;Ort\nKarl;Weber;Weber Solar;0911 5550101;karl@weber-solar.example;90402;Nürnberg\nIna;Roth;Roth Dach;;ina@roth-dach.example;60311;Frankfurt\nOhne;Mail;Nur Telefon;069 5550199;;60313;Frankfurt\n";
    const parsed = await call("leadops.parseColdList", { csv }); expect(parsed.count).toBe(3); expect(parsed.rows.filter((row: any) => row.email).length).toBe(2);
    const owners = await call("leadops.pipelineOwners");
    const imported = await call("leadops.importColdList", { listName: "Mailing Oktober", categoryId: null, ownerUserIds: owners.map((owner: any) => owner.userId), rows: parsed.rows });
    expect(imported.created).toBe(3); expect(imported.listName).toBe("Mailing Oktober");
    const lists = await call("leadops.listColdLists"); const list = lists.find((row: any) => row.listName === "Mailing Oktober"); expect(list).toMatchObject({ contacts: 3, withEmail: 2 });
    const audience = await call("leadops.previewEmailAudience", { source: "liste", listName: "Mailing Oktober" }); expect(audience.count).toBe(2); // nur Kontakte mit E-Mail
    // Kampagne mit dem Standardfenster speichern: eingeschaltet, werktags 7:30–17:00
    const starter = await call("leadops.emailCampaignStarter", { kind: "kaltakquise" });
    const saved = await call("leadops.saveEmailCampaign", { id: null, name: "Mailing Oktober", fromName: "Tanesco", fromEmail: "vertrieb@tanesco.digital", replyTo: null, audience: { source: "liste", listName: "Mailing Oktober" }, tree: starter.tree, design: starter.design, sendWindow: { enabled: true, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" }, isTemplate: false, abSplit: 50 });
    const campaign = await call("leadops.getEmailCampaign", { id: saved.id }); expect(campaign.sendWindow).toMatchObject({ enabled: true, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" });
    // ältere Kampagne ohne gespeichertes Fenster: rund um die Uhr (nichts bleibt hängen)
    const legacy = getStore().tables.emailCampaigns.find((row) => row.sendWindow === null)!; expect((await call("leadops.getEmailCampaign", { id: legacy.id })).sendWindow.enabled).toBe(false);
  });
});

describe("Spalten zuordnen und Platzhalter aus der Liste (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("unbekannte Spalten werden Platzhalter, Zuordnung von Hand, Felder am Kontakt, in der Liste und in der gerenderten E-Mail", async () => {
    const csv = "Name;Betrieb;Mail;Branche;Anzahl Mitarbeiter\nHansen;Hansen Dach;hansen@platzhalter-test.example;Dachdecker;12\nKoch;Koch Solar;koch@platzhalter-test.example;Photovoltaik;5\n";
    const auto = await call("leadops.parseColdList", { csv });
    expect(auto.mapping).toEqual(["lastName", "company", "email", "platzhalter", "platzhalter"]); expect(auto.placeholders).toEqual(["branche", "anzahl_mitarbeiter"]);
    // von Hand: „Betrieb“ nicht übernehmen
    const manual = await call("leadops.parseColdList", { csv, mapping: ["lastName", "ignorieren", "email", "platzhalter", "platzhalter"] });
    expect(manual.rows[0]).toMatchObject({ lastName: "Hansen", email: "hansen@platzhalter-test.example", extra: { branche: "Dachdecker", anzahl_mitarbeiter: "12" } }); expect(manual.rows[0].company).toBeUndefined();
    const imported = await call("leadops.importColdList", { listName: "Platzhalter-Test", categoryId: null, ownerUserIds: [], rows: auto.rows });
    expect(imported.created).toBe(2);
    const lead = getStore().tables.leads.find((row) => row.email === "hansen@platzhalter-test.example")!; expect((lead.metadata as any).felder).toEqual({ branche: "Dachdecker", anzahl_mitarbeiter: "12" });
    const list = (await call("leadops.listColdLists")).find((row: any) => row.listName === "Platzhalter-Test"); expect(list.fields).toEqual([{ key: "branche", sample: "Dachdecker" }, { key: "anzahl_mitarbeiter", sample: "12" }]);
    // Lead-Seite und Karte zeigen die Felder
    expect((await call("leadops.pipelineLeadDetail", { publicId: lead.publicId })).fields).toEqual({ branche: "Dachdecker", anzahl_mitarbeiter: "12" });
    const overview = await call("leadops.pipelineOverview", { source: "kaltakquise" }); expect(overview.stages.flatMap((stage: any) => stage.leads).find((card: any) => card.publicId === lead.publicId).fields).toEqual({ branche: "Dachdecker", anzahl_mitarbeiter: "12" });
    // Einzel-E-Mail aus der Karte: Platzhalter aus der Liste werden gefüllt
    const mail = await call("leadops.sendLeadMessage", { publicId: lead.publicId, channel: "email", subject: "Für {{branche}} mit {{anzahl_mitarbeiter}} Leuten", text: "Hallo {{nachname}}, als {{branche}}-Betrieb …" });
    expect(mail.subject).toBe("Für Dachdecker mit 12 Leuten"); expect(mail.text).toContain("als Dachdecker-Betrieb");
    const sms = await call("leadops.sendLeadMessage", { publicId: getStore().tables.leads.find((row) => row.email === "koch@platzhalter-test.example")!.publicId, channel: "email", subject: "{{branche}}", text: "{{anzahl_mitarbeiter}} Mitarbeiter" });
    expect(sms.subject).toBe("Photovoltaik"); expect(sms.text).toBe("5 Mitarbeiter");
  });
});

describe("Dublettenschutz, Tags, Listen ansehen und Gesendet (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("Derselbe Kontakt wird beim zweiten Hochladen aktualisiert statt doppelt angelegt", async () => {
    const erste = await call("leadops.importColdList", { listName: "PV Hessen", rows: [{ firstName: "Anna", lastName: "Berg", company: "Berg Solar", email: "anna@berg-solar.de", phone: "06111234", city: "Wiesbaden" }], tagNames: ["PV", "Hessen"] });
    expect(erste.created).toBe(1);
    const zweite = await call("leadops.importColdList", { listName: "PV Hessen", rows: [{ firstName: "Anna", lastName: "Berg", company: "Berg Solar GmbH", email: "anna@berg-solar.de", postcode: "65183", city: "Wiesbaden", extra: { branche: "Photovoltaik" } }] });
    expect(zweite.created).toBe(0);
    expect(zweite.updated).toBe(1);
    const inhalt = await call("leadops.coldListContacts", { listName: "PV Hessen" });
    expect(inhalt.contacts).toHaveLength(1); // kein zweiter Eintrag
    expect(inhalt.contacts[0].postcode).toBe("65183"); // leeres Feld wurde ergänzt
    expect(inhalt.contacts[0].company).toBe("Berg Solar"); // Vorhandenes wird nicht überschrieben
    expect(inhalt.columns).toContain("branche");
    expect(inhalt.contacts[0].felder.branche).toBe("Photovoltaik");
  });
  it("Tags aus dem Upload stehen als Filter in der Pipeline", async () => {
    await call("leadops.importColdList", { listName: "PV Hessen", rows: [{ lastName: "Berg", email: "anna@berg-solar.de" }], tagNames: ["PV"] });
    await call("leadops.importColdList", { listName: "Dach Bayern", rows: [{ lastName: "Huber", email: "huber@dach.de" }], tagNames: ["Dach"] });
    const overview = await call("leadops.pipelineOverview", { source: "kaltakquise" });
    const pv = overview.tags.find((tag: { name: string }) => tag.name === "PV");
    expect(pv).toBeTruthy();
    const gefiltert = await call("leadops.pipelineOverview", { source: "kaltakquise", tagId: pv.id });
    expect(gefiltert.totals.leads).toBe(1);
  });
  it("Gesendet zeigt Kampagnen-Mails und Einzel-E-Mails und lässt sich filtern", async () => {
    const sent = await call("leadops.listSent", {});
    expect(Array.isArray(sent.items)).toBe(true);
    expect(sent.counts.alle).toBe(sent.counts.kampagne + sent.counts.antwort + sent.counts.einzel);
    const nurKampagnen = await call("leadops.listSent", { kind: "kampagne" });
    expect(nurKampagnen.items.every((item: { kind: string }) => item.kind === "kampagne")).toBe(true);
    const ohneTreffer = await call("leadops.listSent", { search: "gibtesnicht-xyz" });
    expect(ohneTreffer.items).toHaveLength(0);
  });
});

describe("Kopieren im Builder und Fußzeile nachträglich übernehmen (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("Fußzeile aus den Einstellungen landet in bestehenden Kampagnen", async () => {
    await call("leadops.updateTenantSettings", { companyFooter: "Tanesco Digital GbR · Schultheißweg 44 · 55252 Wiesbaden", websiteUrl: "tanescodigital.de", appointmentUrl: "https://cal.com/tanesco" });
    const ergebnis = await call("leadops.applyFooterToCampaigns", {});
    expect(ergebnis.updated).toBeGreaterThan(0);
    expect(ergebnis.footerText).toContain("tanescodigital.de");
    expect(ergebnis.footerText).toContain("cal.com/tanesco");
    const liste = await call("leadops.listEmailCampaigns");
    const campaign = await call("leadops.getEmailCampaign", { id: liste[0].id });
    expect(campaign.design.footerText).toContain("cal.com/tanesco");
    const nochmal = await call("leadops.applyFooterToCampaigns", {});
    expect(nochmal.updated).toBe(0); // nichts doppelt schreiben
  });
});

describe("Listen löschen (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("Liste löschen entfernt ihre Kontakte, Kunden bleiben erhalten", async () => {
    await call("leadops.importColdList", { listName: "Testliste", rows: [
      { firstName: "Anna", lastName: "Berg", email: "anna@test-a.de" },
      { firstName: "Bernd", lastName: "Call", email: "bernd@test-b.de" },
    ] });
    const vorher = await call("leadops.coldListContacts", { listName: "Testliste" });
    expect(vorher.contacts).toHaveLength(2);
    // Einen davon zum Kunden machen – der muss die Löschung überleben
    await call("leadops.movePipelineStage", { publicId: vorher.contacts[0].publicId, stage: "kunde" });
    const ergebnis = await call("leadops.deleteColdList", { listName: "Testliste" });
    expect(ergebnis.deleted).toBe(1);
    expect(ergebnis.keptCustomers).toBe(1);
    const listen = await call("leadops.listColdLists");
    expect(listen.some((list: { listName: string }) => list.listName === "Testliste")).toBe(false);
  });
  it("Eine Liste, die es nicht gibt, meldet einen Fehler", async () => {
    await expect(call("leadops.deleteColdList", { listName: "Gibt es nicht" })).rejects.toThrow();
  });
});

describe("Kontakte der E-Mail-Akquise (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("Zeigt je Kontakt Herkunft, Kampagne und die letzte Reaktion", async () => {
    const daten = await call("leadops.emailLeads", {});
    expect(daten.items.length).toBeGreaterThan(0);
    expect(daten.counts.alle).toBe(daten.items.length <= 200 ? daten.total : daten.counts.alle);
    const mitKampagne = daten.items.find((item: { campaigns: unknown[] }) => item.campaigns.length > 0);
    expect(mitKampagne).toBeTruthy();
    expect(["gesendet", "geoeffnet", "geklickt", "geantwortet", "abgemeldet", "bounce", "ohne"]).toContain(mitKampagne.activity);
    expect(daten.lists.length).toBeGreaterThan(0);
    expect(daten.campaigns.length).toBeGreaterThan(0);
  });
  it("Filter nach Kampagne, Liste und Reaktion grenzen ein", async () => {
    const alle = await call("leadops.emailLeads", {});
    const kampagne = alle.campaigns[0];
    const nurKampagne = await call("leadops.emailLeads", { campaignId: kampagne.id });
    expect(nurKampagne.items.every((item: { campaigns: Array<{ id: number }> }) => item.campaigns.some((c) => c.id === kampagne.id))).toBe(true);
    const liste = alle.lists[0];
    const nurListe = await call("leadops.emailLeads", { listName: liste });
    expect(nurListe.items.every((item: { listName: string }) => item.listName === liste)).toBe(true);
    const ohneTreffer = await call("leadops.emailLeads", { search: "gibtesnicht-xyz" });
    expect(ohneTreffer.items).toHaveLength(0);
  });
});
