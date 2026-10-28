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
    expect(before.length).toBe(2); expect(before.find((batch: any) => batch.name.startsWith("Messe")).counts.duplikat).toBe(1); // Messe-Liste + abtelefonierte Liste „Handwerk Rhein-Main“
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
    const seeded = before.find((batch: any) => batch.name.startsWith("Messe")); // die Messe-Liste hat noch offene Kontakte
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

  it("zeigt eingeschlafene Karten, Angebotswerte, Aufgaben und die Temperatur an den Karten und rechnet den Pipeline-Wert", async () => {
    const overview = await call("leadops.pipelineOverview", { source: "alle", limitPerStage: 1000 });
    const leads = overview.stages.flatMap((stage: any) => stage.leads);
    expect(leads.every((lead: any) => typeof lead.score === "number" && ["heiss", "warm", "kalt"].includes(lead.temperature) && Array.isArray(lead.scoreReasons))).toBe(true); // heiße Phasen: jede Karte hat Punkte und Temperatur
    expect(overview.hotCount).toBe(leads.filter((lead: any) => lead.temperature === "heiss" && lead.scoreLabel !== "Kunde").length);
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
    expect(card.dealValue).toBe(12500.5); expect(card.appointmentAt).toBeTruthy(); expect(card.score).toBeGreaterThanOrEqual(60); expect(card.temperature).toBe("heiss"); expect(card.scoreReasons.some((reason: string) => reason.startsWith("Termin am"))).toBe(true); expect(card.scoreReasons.some((reason: string) => reason.includes("Angebot über"))).toBe(true);
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
    const csv = await call("leadops.exportPipelineCsv", { source: "kaltakquise" }); expect(csv.fileName).toMatch(/^vertriebspipeline-kaltakquise-/); expect(csv.csv.split("\n")[0]).toContain("Lead-ID;Name;Firma"); expect(csv.csv.split("\n")[0]).toContain("Einschätzung;Punkte"); expect(csv.rows).toBeGreaterThanOrEqual(8);
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
  it("Leadsparte: eingetragen oder aus dem Namen erkannt – Entwürfe und Vorlage passen zur Sparte (kein Wort zu Wärmepumpen)", async () => {
    const { starterBlocks } = await import("../../../../shared/email-design");
    await call("leadops.importColdList", { listName: "Notruf-Demo", rows: [{ firstName: "Nora", lastName: "Notruf", company: "Notruf Süd GmbH", email: "nora@notruf-demo.example" }] });
    const base = { id: null, fromName: "T", fromEmail: "t@t.de", replyTo: null, audience: { source: "liste", listName: "Notruf-Demo" }, tree: { start: "m1", nodes: [{ id: "m1", type: "send", label: "Erste", subject: "Erste", blocks: starterBlocks("kaltakquise"), next: null }] }, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" }, abSplit: 50, kiModus: "freigabe", kiAnsatz: "frei" };
    const saved = await call("leadops.saveEmailCampaign", { ...base, name: "Notruf-Demo", leadSparte: "Hausnotruf" });
    const listed = (await call("leadops.listEmailCampaigns")).find((row: any) => row.id === saved.id);
    expect(listed.sparte).toMatchObject({ label: "Hausnotruf", source: "eingetragen" });
    await call("leadops.startEmailCampaign", { id: saved.id }); await call("leadops.runEmailCampaigns");
    const row = getStore().tables.emailCampaignRecipients.find((item) => item.campaignId === saved.id)!;
    expect(String(row.draftText)).toContain("für Hausnotruf"); expect(String(row.draftText)).not.toMatch(/Photovoltaik|Wärmepumpe/);
    const named = await call("leadops.saveEmailCampaign", { ...base, name: "Alarmanlage • Erstkontakt" });
    expect((await call("leadops.getEmailCampaign", { id: named.id })).sparte).toMatchObject({ label: "Alarmanlage", source: "erkannt" });
    // Zahl der Fragen je Sparte: Hausnotruf sechs, Alarmanlage acht – Vorlage beim Speichern angepasst, Entwurf mit der richtigen Zahl
    expect(saved.fixedQuestions).toBe(true); expect(named.fixedQuestions).toBe(true);
    expect(JSON.stringify((await call("leadops.getEmailCampaign", { id: saved.id })).tree)).toContain("anhand von sechs Fragen");
    expect(JSON.stringify((await call("leadops.getEmailCampaign", { id: named.id })).tree)).toContain("anhand von acht Fragen");
    expect(String(row.draftText)).toContain("sechs Fragen"); expect(String(row.draftText)).not.toContain("zehn Fragen");
    const pv = await call("leadops.saveEmailCampaign", { ...base, name: "PV & WP • Erstkontakt" }); expect(pv.fixedQuestions).toBe(true); // Zahl bleibt, der Teaser in Klammern kommt dazu
    expect(JSON.stringify((await call("leadops.getEmailCampaign", { id: pv.id })).tree)).toContain("zehn Fragen (z. B. Eigentum, Dach und Heizung sowie Stromverbrauch)");
    expect(JSON.stringify((await call("leadops.getEmailCampaign", { id: saved.id })).tree)).toContain("sechs Fragen (z. B. Krankenkasse, Pflegegrad und Wohnsituation)");
    expect(JSON.stringify((await call("leadops.getEmailCampaign", { id: named.id })).tree)).toContain("acht Fragen (z. B. Objekt und Fläche, Anzahl der Fenster sowie Art der Alarmanlage)");
    expect(String(row.draftText)).toContain("sechs Fragen (z. B. Krankenkasse, Pflegegrad und Wohnsituation)"); // Entwurf mit Teaser
    const pvTree = (await call("leadops.getEmailCampaign", { id: pv.id })).tree;
    expect((await call("leadops.saveEmailCampaign", { ...base, id: pv.id, name: "PV & WP • Erstkontakt", tree: pvTree })).fixedQuestions).toBe(false); // schon angepasst
  });
  it("Zustellung (Demo): gesendete E-Mails zeigen „zugestellt“ – je Kampagne und in „Gesendet“; der Versand gilt als eingerichtet", async () => {
    const { starterBlocks } = await import("../../../../shared/email-design");
    await call("leadops.importColdList", { listName: "Zustell-Demo", rows: [{ firstName: "Zoe", lastName: "Zustell", company: "Zustell GmbH", email: "zoe@zustell-demo.example" }] });
    const saved = await call("leadops.saveEmailCampaign", { id: null, name: "Zustell-Demo", fromName: "T", fromEmail: "t@t.de", replyTo: null, audience: { source: "liste", listName: "Zustell-Demo" }, tree: { start: "m1", nodes: [{ id: "m1", type: "send", label: "Erste", subject: "Erste", blocks: starterBlocks("kaltakquise"), next: null }] }, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" }, abSplit: 50, kiModus: "aus" });
    await call("leadops.startEmailCampaign", { id: saved.id }); await call("leadops.runEmailCampaigns");
    const listed = (await call("leadops.listEmailCampaigns")).find((row: any) => row.id === saved.id);
    expect(listed.delivery).toMatchObject({ total: 1, zugestellt: 1, probleme: 0 });
    const mails = await call("leadops.listSent", { campaignId: saved.id }); expect(mails.items[0].delivery).toMatchObject({ status: "zugestellt" });
    expect((await call("leadops.campaignDailyStatus")).mail).toEqual({ ready: true, simulated: false });
    const detail = await call("leadops.getEmailCampaign", { id: saved.id }); expect(detail.stats.delivery).toMatchObject({ total: 1, zugestellt: 1 }); expect(detail.recipients[0].delivery).toMatchObject({ status: "zugestellt" });
    expect((await call("leadops.listSent", { campaignId: saved.id, delivery: "zugestellt" })).items).toHaveLength(1); expect((await call("leadops.listSent", { campaignId: saved.id, delivery: "probleme" })).items).toHaveLength(0);
  });
  it("KI-Ansatz umgestellt: offene Entwürfe folgen dem gewählten Ansatz, die Builder-Vorschau zeigt nur diesen", async () => {
    const { starterBlocks } = await import("../../../../shared/email-design");
    await call("leadops.importColdList", { listName: "Ansatz-Demo", rows: [{ firstName: "Ansgar", lastName: "Ansatz", company: "Ansatz Solar", email: "ansgar@ansatz-demo.example" }] });
    const base = { id: null, name: "Ansatz-Demo", fromName: "T", fromEmail: "t@t.de", replyTo: null, audience: { source: "liste", listName: "Ansatz-Demo" }, tree: { start: "m1", nodes: [{ id: "m1", type: "send", label: "Erste", subject: "Erste", blocks: starterBlocks("kaltakquise"), next: null }] }, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" }, abSplit: 50, kiModus: "freigabe", kiAnsatz: "drittanbieter" };
    const saved = await call("leadops.saveEmailCampaign", base); await call("leadops.startEmailCampaign", { id: saved.id }); await call("leadops.runEmailCampaigns");
    const row = () => getStore().tables.emailCampaignRecipients.find((item) => item.campaignId === saved.id)!;
    expect(row()).toMatchObject({ draftState: "entwurf", draftApproach: "drittanbieter" });
    expect((row().draftOptions as Array<{ key: string }>).map((item) => item.key)).toEqual(["frei", "drittanbieter"]); // nur noch zwei Vorschläge
    expect((await call("leadops.saveEmailCampaign", { ...base, id: saved.id, kiAnsatz: "frei" })).realigned).toBe(1);
    expect(row()).toMatchObject({ draftState: "entwurf", draftApproach: "frei", draftSource: "vorlage" }); expect(String(row().draftText)).not.toContain("Zwischenhändler");
    expect((await call("leadops.getEmailCampaign", { id: saved.id })).kiAnsatz).toBe("frei");
    const samples = await call("leadops.campaignDraftSamples", { campaignId: saved.id }); expect(samples.map((item: any) => item.approach)).toContain("frei");
    expect((await call("leadops.saveEmailCampaign", { ...base, id: saved.id, kiAnsatz: "individuell" })).realigned).toBe(0); // alter Wert gilt als frei
    // alter individueller Entwurf: unter „Freigeben“ ohne den alten Ansatz
    Object.assign(row(), { draftApproach: "individuell", draftOptions: [{ key: "individuell", label: "Individueller Ansatz", subject: "Alt", text: "Alt" }, ...(row().draftOptions as unknown[])] });
    const queue = await call("leadops.campaignReviewQueue", { campaignId: saved.id }); expect(queue.items[0].draftApproach).toBeNull(); expect(queue.items[0].draftOptions.map((item: any) => item.key)).toEqual(["frei", "drittanbieter"]);
  });
  it("Übersicht: wann die nächsten Follow-ups rausgehen (nach der Wartezeit, pausiert ohne Zeiten)", async () => {
    const { starterBlocks } = await import("../../../../shared/email-design");
    await call("leadops.importColdList", { listName: "Follow-up-Demo", rows: [1, 2, 3].map((n) => ({ firstName: `Fia${n}`, lastName: "Folge", company: `Folge ${n} GmbH`, email: `fia${n}@folge-demo.example` })) });
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send", label: "Erste", subject: "Erste", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait", hours: 72, next: "m2" }, { id: "m2", type: "send", label: "Nachfrage", subject: "Nachfrage", blocks: starterBlocks("nachfassen"), next: "e1" }, { id: "e1", type: "end", label: "Ende" }] };
    const saved = await call("leadops.saveEmailCampaign", { id: null, name: "Follow-up-Demo", fromName: "T", fromEmail: "t@t.de", replyTo: null, audience: { source: "liste", listName: "Follow-up-Demo" }, tree, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" }, abSplit: 50 });
    expect((await call("leadops.startEmailCampaign", { id: saved.id })).added).toBe(3); await call("leadops.runEmailCampaigns");
    const listed = () => call("leadops.listEmailCampaigns").then((rows: any[]) => rows.find((row) => row.id === saved.id));
    const plan = (await listed()).followUps;
    expect(plan.total).toBe(3); expect(plan.paused).toBe(false); expect(plan.days).toHaveLength(1); expect(plan.days[0].count).toBe(3);
    const wait = new Date(plan.days[0].first).getTime() - Date.now(); expect(wait).toBeGreaterThan(71.9 * 3_600_000); expect(wait).toBeLessThan(72.1 * 3_600_000); // nach 72 Stunden Wartezeit
    expect((await call("leadops.getEmailCampaign", { id: saved.id })).followUps.total).toBe(3); // auch oben in der Kampagne
    await call("leadops.setEmailCampaignStatus", { id: saved.id, status: "pausiert" });
    expect((await listed()).followUps).toMatchObject({ paused: true, total: 3, days: [] });
  });
  it("Wartezeit: Leads stehen am Warten-Schritt, Ablaufänderungen gelten für Wartende, keine E-Mail doppelt", async () => {
    const { starterBlocks } = await import("../../../../shared/email-design");
    await call("leadops.importColdList", { listName: "Warte-Demo", rows: [{ firstName: "Wanda", lastName: "Wartet", company: "Wartet Dach", email: "wanda@warte-demo.example" }] });
    const before = { start: "m1", nodes: [{ id: "m1", type: "send", label: "Erste", subject: "Erste", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait", hours: 1, next: "e1" }, { id: "e1", type: "end", label: "Ende" }] };
    const base = { id: null, name: "Warte-Demo", fromName: "T", fromEmail: "t@t.de", replyTo: null, audience: { source: "liste", listName: "Warte-Demo" }, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" }, abSplit: 50 };
    const saved = await call("leadops.saveEmailCampaign", { ...base, tree: before }); expect((await call("leadops.startEmailCampaign", { id: saved.id })).added).toBe(1); await call("leadops.runEmailCampaigns");
    const row = () => getStore().tables.emailCampaignRecipients.find((item) => item.campaignId === saved.id)!;
    expect(row()).toMatchObject({ sentCount: 1, status: "wartet", nodeId: "w1" }); // wartet AM Warten-Schritt
    const detail = await call("leadops.getEmailCampaign", { id: saved.id }); expect(detail.recipients[0].nodeId).toBe("w1");
    // Während sie wartet, kommt hinter das Warten eine Nachfrage → nach der Wartezeit bekommt sie die Nachfrage (statt direkt ans Ende)
    const after = { start: "m1", nodes: [before.nodes[0], { id: "w1", type: "wait", hours: 1, next: "m2" }, { id: "m2", type: "send", label: "Kurze Nachfrage", subject: "Kurze Nachfrage", blocks: starterBlocks("nachfassen"), next: "e1" }, before.nodes[2]] };
    await call("leadops.saveEmailCampaign", { ...base, id: saved.id, tree: after });
    await call("leadops.runEmailCampaigns"); expect(row().sentCount).toBe(1); // Wartezeit läuft noch
    row().nextActionAt = new Date(Date.now() - 1000); await call("leadops.runEmailCampaigns");
    expect(row()).toMatchObject({ sentCount: 2, status: "fertig" }); expect(getStore().tables.emailCampaignEvents.filter((event) => event.recipientId === row().id && event.kind === "gesendet").map((event) => event.nodeId)).toEqual(["m1", "m2"]);
    // Doppelversand-Schutz: wieder vor die Erste gesetzt → übersprungen, keine zweite „Erste“
    getStore().tables.emailCampaigns.find((item) => item.id === saved.id)!.status = "aktiv"; row().nodeId = "m1"; row().status = "laeuft"; row().nextActionAt = null; await call("leadops.runEmailCampaigns");
    expect(row().sentCount).toBe(2); expect(row()).toMatchObject({ status: "wartet", nodeId: "w1" }); expect(getStore().tables.emailCampaignEvents.some((event) => event.recipientId === row().id && event.kind === "verzweigt" && /^Übersprungen/.test(event.note ?? ""))).toBe(true);
    const log = await call("leadops.emailRecipientLog", { recipientId: row().id }); expect(log.events.map((event: any) => event.label)).toContain("E-Mail übersprungen (schon gesendet)");
  });
  it("KI-Versand (Demo): Freigabe je Schritt, Ansatz der Kampagne, Auto-Modus sendet sofort", async () => {
    const { starterBlocks } = await import("../../../../shared/email-design");
    await call("leadops.importColdList", { listName: "KI-Demo", rows: [{ firstName: "Kim", lastName: "Kette", company: "Kette Klima", email: "kim@ki-demo.example" }] });
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send", label: "Erste", subject: "Erste an {{firma}}", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait", hours: 1, next: "m2" }, { id: "m2", type: "send", label: "Kurze Nachfrage", subject: "Nachfrage", blocks: starterBlocks("nachfassen"), next: null }] };
    const base = { id: null, fromName: "T", fromEmail: "t@t.de", replyTo: null, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" }, abSplit: 50 };
    const saved = await call("leadops.saveEmailCampaign", { ...base, name: "KI-Demo", audience: { source: "liste", listName: "KI-Demo" }, tree, kiModus: "freigabe", kiAnsatz: "drittanbieter" });
    await call("leadops.startEmailCampaign", { id: saved.id }); await call("leadops.runEmailCampaigns");
    const row = () => getStore().tables.emailCampaignRecipients.find((item) => item.campaignId === saved.id)!;
    expect(row().sentCount).toBe(0); expect(row().draftState).toBe("entwurf"); expect(row().draftNodeId).toBe("m1"); expect(row().draftApproach).toBe("drittanbieter"); expect(String(row().draftText)).toContain("Zwischenhändler");
    const queue1 = await call("leadops.campaignReviewQueue", { campaignId: saved.id }); expect(queue1.items[0].nodeLabel).toBe("Erste"); expect(queue1.items[0].followUp).toBe(false);
    await call("leadops.saveCampaignDraft", { recipientId: row().id, subject: "Persönlich 1", text: "Guten Tag Frau Kette,\n\npersönliche erste Mail.", approve: true });
    await call("leadops.runEmailCampaigns");
    expect(row()).toMatchObject({ sentCount: 1, nodeId: "w1", draftState: null });
    row().nextActionAt = new Date(Date.now() - 1000); await call("leadops.runEmailCampaigns");
    expect(row()).toMatchObject({ sentCount: 1, nodeId: "m2", draftState: "entwurf", draftNodeId: "m2" }); // Nachfass-Mail wartet wieder auf Freigabe
    // „Alle freigeben“ / „Alle wieder prüfen“ / „Alle neu schreiben“
    expect(await call("leadops.approveAllCampaignDrafts", { campaignId: saved.id, approve: true })).toMatchObject({ approved: 1 }); expect(row().draftState).toBe("freigegeben");
    expect(await call("leadops.approveAllCampaignDrafts", { campaignId: saved.id, approve: false })).toMatchObject({ reverted: 1 }); expect(row().draftState).toBe("entwurf");
    expect(await call("leadops.resetCampaignDrafts", { campaignId: saved.id })).toMatchObject({ reset: 1 }); expect(row().draftState).toBeNull();
    const queue2 = await call("leadops.campaignReviewQueue", { campaignId: saved.id }); expect(queue2.items[0].nodeLabel).toBe("Kurze Nachfrage"); expect(queue2.items[0].followUp).toBe(true);
    await call("leadops.saveCampaignDraft", { recipientId: row().id, subject: "Persönlich 2", text: "Guten Tag Frau Kette,\n\nkurze Nachfrage.", approve: true });
    await call("leadops.runEmailCampaigns");
    expect(row()).toMatchObject({ sentCount: 2, status: "fertig" });
    expect(getStore().tables.emailCampaignEvents.filter((event) => event.recipientId === row().id && event.kind === "gesendet").map((event) => event.subject)).toEqual(["Persönlich 1", "Persönlich 2"]);
    // Auto-Modus: Demo schreibt die persönliche Fassung selbst und sendet sofort
    await call("leadops.importColdList", { listName: "KI-Demo-Auto", rows: [{ firstName: "Udo", lastName: "Auto", company: "Auto Solar", email: "udo@ki-demo-auto.example" }] });
    const auto = await call("leadops.saveEmailCampaign", { ...base, name: "KI-Demo-Auto", audience: { source: "liste", listName: "KI-Demo-Auto" }, tree: { start: "a1", nodes: [{ id: "a1", type: "send", label: "Erste", subject: "Hallo {{firma}}", blocks: starterBlocks("kaltakquise"), next: null }] }, kiModus: "auto", kiAnsatz: "frei" });
    await call("leadops.startEmailCampaign", { id: auto.id }); await call("leadops.runEmailCampaigns");
    const udo = getStore().tables.emailCampaignRecipients.find((item) => item.campaignId === auto.id)!;
    expect(udo.sentCount).toBe(1); expect(udo.status).toBe("fertig");
    const sentAuto = getStore().tables.emailCampaignEvents.find((event) => event.recipientId === udo.id && event.kind === "gesendet");
    expect(String(sentAuto?.subject)).toContain("Auto Solar"); // persönliche Fassung je Kontakt
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
    const settings = await call("leadops.getMailSettings"); expect(settings).toMatchObject({ imapEnabled: true, replyAiEnabled: true, replyAiAutoBlock: true, replyAiInterest: true, replyAiAvailable: true, imapScope: "bekannte" });
    await call("leadops.saveMailSettings", { provider: settings.provider, fromName: settings.fromName, fromEmail: settings.fromEmail, enabled: true, imapEnabled: true, imapHost: settings.imapHost, imapUsername: settings.imapUsername, imapScope: "alle" }); // für diesen Test alles holen, auch Fremde
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

  it("öffnet das ausführliche Lead-Fenster mit allen Bereichen, neuen Kürzeln und der Einschätzung (heiße Phasen)", async () => {
    const overview = await call("leadops.pipelineOverview", { source: "kaltakquise" }); const card = overview.stages.flatMap((stage: any) => stage.leads).find((lead: any) => lead.name.includes("Yilmaz"));
    const detail = await call("leadops.pipelineLeadDetail", { publicId: card.publicId });
    expect(detail).toMatchObject({ publicId: card.publicId, adPlatform: "kaltakquise", categoryName: "Photovoltaik", categoryEmoji: "☀️", categoryColor: "#eab308" });
    expect(Array.isArray(detail.history) && detail.history.length).toBeTruthy(); expect(Array.isArray(detail.tasks)).toBe(true); expect(Array.isArray(detail.calls)).toBe(true); expect(Array.isArray(detail.campaigns)).toBe(true); expect(Array.isArray(detail.inbox)).toBe(true); expect(typeof detail.score).toBe("number"); expect(["heiss", "warm", "kalt"]).toContain(detail.temperature); expect(detail.scoreReasons.length).toBeGreaterThan(0); // heiße Phasen: Einschätzung mit Begründung
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
    // Kampagne mit eigenem Fenster speichern: eingeschaltet, werktags 7:30–17:00 – bleibt so
    const starter = await call("leadops.emailCampaignStarter", { kind: "kaltakquise" });
    const saved = await call("leadops.saveEmailCampaign", { id: null, name: "Mailing Oktober", fromName: "Tanesco", fromEmail: "vertrieb@tanesco.digital", replyTo: null, audience: { source: "liste", listName: "Mailing Oktober" }, tree: starter.tree, design: starter.design, sendWindow: { enabled: true, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" }, isTemplate: false, abSplit: 50 });
    const campaign = await call("leadops.getEmailCampaign", { id: saved.id }); expect(campaign.sendWindow).toMatchObject({ enabled: true, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" });
    // bestehende Kampagnen (vor dem Update gespeichert) laufen einmalig auf die zwei Zeitfenster um – Drip bleibt
    const legacy = getStore().tables.emailCampaigns.find((row) => row.name === "Dachdecker Hessen – Erstkontakt")!; expect((await call("leadops.getEmailCampaign", { id: legacy.id })).sendWindow).toMatchObject({ enabled: true, from: "09:00", to: "16:30", pauseFrom: "11:30", pauseTo: "14:00" });
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

describe("Pipeline „E-Mail-Kampagne“: Spalte „Versendet“ und Filter nach Liste (Chat-Build)", () => {
  beforeAll(() => resetStore());
  it("Kampagnen-E-Mail raus → neue Kontakte stehen in „Versendet“, weitergeschobene bleiben; Board nach Liste filtern", async () => {
    const { starterBlocks } = await import("../../../../shared/email-design");
    await call("leadops.importColdList", { listName: "Versendet-Probe", toPipeline: false, rows: [{ firstName: "Vera", lastName: "Neu", company: "Neu Dach", email: "vera@versendet-probe.example" }, { firstName: "Karl", lastName: "Weiter", company: "Weiter Dach", email: "karl@versendet-probe.example" }], ownerUserIds: [] });
    const kontakte = (await call("leadops.emailLeads", { listName: "Versendet-Probe" })).items as Array<{ id: number; email: string }>;
    const karl = kontakte.find((item) => item.email.startsWith("karl"))!; const vera = kontakte.find((item) => item.email.startsWith("vera"))!;
    await call("leadops.pushLeadsToPipeline", { leadIds: [karl.id], target: "email", stage: "kontaktiert" }); // schon weitergeschoben
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send", label: "Erste", subject: "Hallo {{firma}}", blocks: starterBlocks("kaltakquise"), next: "e1" }, { id: "e1", type: "end", label: "Ende" }] };
    const saved = await call("leadops.saveEmailCampaign", { id: null, name: "Versendet-Probe", fromName: "T", fromEmail: "t@t.de", replyTo: null, audience: { source: "liste", listName: "Versendet-Probe" }, tree, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" }, abSplit: 50 });
    expect((await call("leadops.startEmailCampaign", { id: saved.id })).added).toBe(2); await call("leadops.runEmailCampaigns");
    const lead = (id: number) => getStore().tables.leads.find((row) => row.id === id)!;
    expect((await call("leadops.pipelineStages", { source: "email" })).some((stage: { key: string }) => stage.key === "versendet")).toBe(true);
    expect(lead(vera.id)).toMatchObject({ inPipeline: true, adPlatform: "email", pipelineStage: "versendet" });
    expect(lead(karl.id)).toMatchObject({ inPipeline: true, adPlatform: "email", pipelineStage: "kontaktiert" });
    const board = await call("leadops.pipelineOverview", { source: "email", listName: "Versendet-Probe" });
    expect(board.totals.leads).toBe(2); expect(board.lists.some((item: { name: string; count: number }) => item.name === "Versendet-Probe" && item.count === 2)).toBe(true);
    expect(board.stages.find((stage: { key: string }) => stage.key === "versendet").leads.map((row: { id: number }) => row.id)).toEqual([vera.id]);
    expect(board.stages.find((stage: { key: string }) => stage.key === "versendet").total).toBe(1);
  });
});

describe("Früheren Stand wiederherstellen (Chat-Build)", () => {
  beforeAll(() => resetStore());
  it("Versehentlich übernommene Kontakte: Vorschau zeigt „Nur E-Mail-Akquise“, Zurücksetzen holt sie zurück, Übernehmen hat Rückgängig", async () => {
    await call("leadops.importColdList", { listName: "Zurücksetzen-Probe", toPipeline: false, rows: [{ firstName: "Anke", lastName: "Alt", email: "anke@zuruecksetzen.example" }, { firstName: "Bodo", lastName: "Bleib", email: "bodo@zuruecksetzen.example" }], ownerUserIds: [] });
    const kontakte = await call("leadops.emailLeads", { listName: "Zurücksetzen-Probe" });
    const offen = kontakte.items.filter((item: { inPipeline: boolean }) => item.inPipeline === false);
    expect(offen).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 5)); const at = new Date(); await new Promise((resolve) => setTimeout(resolve, 5));
    const pushed = await call("leadops.pushLeadsToPipeline", { leadIds: offen.map((item: { id: number }) => item.id), target: "email", stage: "neu" });
    expect(pushed.undoId).toBeGreaterThan(0);
    const ids = offen.map((item: { id: number }) => item.id);
    const vorschau = await call("leadops.pipelineStateAt", { at });
    const meine = vorschau.items.filter((item: { leadId: number }) => ids.includes(item.leadId));
    expect(meine.map((item: { leadId: number }) => item.leadId).sort()).toEqual([...ids].sort());
    expect(meine.every((item: { then: { pipeline: string }; now: { pipeline: string } }) => item.then.pipeline === "Nur E-Mail-Akquise" && item.now.pipeline === "E-Mail-Kampagne")).toBe(true);
    expect(vorschau.groups.some((group: { label: string }) => group.label.includes("übernommen"))).toBe(true);
    const ergebnis = await call("leadops.restorePipelineState", { at, leadIds: offen.map((item: { id: number }) => item.id) });
    expect(ergebnis.restored).toBe(2); expect(ergebnis.undoId).toBeGreaterThan(0);
    const danach = await call("leadops.emailLeads", {});
    expect(danach.items.filter((item: { id: number }) => offen.some((row: { id: number }) => row.id === item.id)).every((item: { inPipeline: boolean }) => item.inPipeline === false)).toBe(true);
    expect((await call("leadops.pipelineStateAt", { at })).items.some((item: { leadId: number }) => ids.includes(item.leadId))).toBe(false);
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

describe("Kampagnen-Upload bleibt vorerst außerhalb der Pipeline (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("Upload ohne Pipeline-Übergabe taucht nicht im Board auf, danach auf Knopfdruck schon", async () => {
    const vorher = await call("leadops.pipelineOverview", { source: "kaltakquise" });
    const ergebnis = await call("leadops.importColdList", { listName: "Nur E-Mail", toPipeline: false, rows: [{ firstName: "Nina", lastName: "Roth", email: "nina@roth-solar.de" }] });
    expect(ergebnis.created).toBe(1);
    const dazwischen = await call("leadops.pipelineOverview", { source: "kaltakquise" });
    expect(dazwischen.totals.leads).toBe(vorher.totals.leads); // nichts Neues auf dem Board
    const kontakte = await call("leadops.emailLeads", { listName: "Nur E-Mail" });
    expect(kontakte.items).toHaveLength(1);
    expect(kontakte.items[0].inPipeline).toBe(false);
    const emailBoardVorher = await call("leadops.pipelineOverview", { source: "email" });
    const uebernommen = await call("leadops.pushLeadsToPipeline", { leadIds: [kontakte.items[0].id] });
    expect(uebernommen.moved).toBe(1); expect(uebernommen.stage).toBe("neu");
    const nachher = await call("leadops.pipelineOverview", { source: "kaltakquise" });
    expect(nachher.totals.leads).toBe(vorher.totals.leads); // Kaltakquise-Board unverändert …
    const emailBoard = await call("leadops.pipelineOverview", { source: "email" });
    expect(emailBoard.totals.leads).toBe(emailBoardVorher.totals.leads + 1); // … der Kontakt steht in der Pipeline „E-Mail-Kampagne“
    const nochmal = await call("leadops.pushLeadsToPipeline", { leadIds: [kontakte.items[0].id] });
    expect(nochmal.moved).toBe(0); // zweimal übernehmen ändert nichts
  });
});

describe("Upload-Verlauf und Rückgängig (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("Jeder Upload steht im Verlauf und lässt sich zurücknehmen", async () => {
    const vorher = await call("leadops.listImportHistory", {});
    await call("leadops.importColdList", { listName: "Probelauf", rows: [
      { firstName: "Tim", lastName: "Keller", email: "tim@keller-pv.de" },
      { firstName: "Ute", lastName: "Mohr", email: "ute@mohr-dach.de" },
    ] });
    const verlauf = await call("leadops.listImportHistory", {});
    expect(verlauf.length).toBe(vorher.length + 1);
    const eintrag = verlauf[0];
    expect(eintrag.listName).toBe("Probelauf");
    expect(eintrag.created).toBe(2);
    expect(eintrag.stillThere).toBe(2);
    expect(eintrag.undoneAt).toBeFalsy();

    const zurueck = await call("leadops.undoListImport", { id: eintrag.id });
    expect(zurueck.deleted).toBe(2);
    const inhalt = await call("leadops.coldListContacts", { listName: "Probelauf" });
    expect(inhalt.contacts).toHaveLength(0);
    const danach = await call("leadops.listImportHistory", {});
    const upload = danach.find((row: any) => row.id === eintrag.id); expect(upload.undoneAt).toBeTruthy();
    expect(upload.stillThere).toBe(0);
    expect(danach.find((row: any) => row.kind === "loeschung" && row.listName === "Probelauf")).toMatchObject({ kind: "loeschung", listName: "Probelauf", rowCount: 2 }); // die Rücknahme steht als Löschung im Verlauf
    await expect(call("leadops.undoListImport", { id: eintrag.id })).rejects.toThrow(); // kein zweites Mal
  });
  it("Kontakte, die beim Upload nur aktualisiert wurden, bleiben beim Rückgängig erhalten", async () => {
    await call("leadops.importColdList", { listName: "Erst", rows: [{ firstName: "Ben", lastName: "Alt", email: "ben@alt.de" }] });
    await call("leadops.importColdList", { listName: "Zweit", rows: [{ firstName: "Ben", lastName: "Alt", email: "ben@alt.de", city: "Mainz" }] });
    const verlauf = await call("leadops.listImportHistory", {});
    const zweiter = verlauf.find((row: { listName: string }) => row.listName === "Zweit");
    expect(zweiter.created).toBe(0);
    expect(zweiter.updated).toBe(1);
    const zurueck = await call("leadops.undoListImport", { id: zweiter.id });
    expect(zurueck.deleted).toBe(0); // der Kontakt gehörte zum ersten Upload
    const inhalt = await call("leadops.coldListContacts", { listName: "Zweit" });
    expect(inhalt.contacts).toHaveLength(1);
  });
});

describe("Kontakte löschen in der E-Mail-Akquise (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("Ausgewählte Kontakte löschen, Kunden bleiben", async () => {
    await call("leadops.importColdList", { listName: "Löschprobe", toPipeline: false, rows: [
      { firstName: "Ali", lastName: "Eins", email: "ali@eins.de" },
      { firstName: "Bea", lastName: "Zwei", email: "bea@zwei.de" },
    ] });
    const liste = await call("leadops.emailLeads", { listName: "Löschprobe" });
    expect(liste.items).toHaveLength(2);
    const ergebnis = await call("leadops.deleteEmailLeads", { leadIds: liste.items.map((item: { id: number }) => item.id) });
    expect(ergebnis.deleted).toBe(2);
    const danach = await call("leadops.emailLeads", { listName: "Löschprobe" });
    expect(danach.items).toHaveLength(0);
  });
});

describe("Gesendet mit Tracking je Mail und Kontakt-Link (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("Jede Kampagnen-Mail trägt Öffnung/Klick/Antwort mit Zeit, Filter nach Reaktion, Kontakt verlinkt", async () => {
    const sent = await call("leadops.listSent", { kind: "kampagne" });
    expect(sent.items.length).toBeGreaterThan(0);
    expect(sent.items.every((item: { tracking: unknown }) => item.tracking !== null)).toBe(true);
    expect(sent.reactions.geoeffnet + sent.reactions.geklickt + sent.reactions.geantwortet + sent.reactions.ohne + sent.reactions.bounce + sent.reactions.abgemeldet).toBe(sent.counts.kampagne);
    const geoeffnet = sent.items.find((item: { tracking: { openedAt: Date | null } }) => item.tracking.openedAt);
    expect(geoeffnet).toBeTruthy();
    expect(geoeffnet.lead?.publicId).toMatch(/^KALT-/);
    const nurGeoeffnet = await call("leadops.listSent", { reaction: "geoeffnet" });
    expect(nurGeoeffnet.items.length).toBe(sent.reactions.geoeffnet);
    expect(nurGeoeffnet.items.every((item: { tracking: { reaction: string } }) => item.tracking.reaction === "geoeffnet")).toBe(true);
    const vorschau = await call("leadops.sentMailPreview", { id: geoeffnet.id });
    expect(vorschau.html).toContain("<");
    expect(vorschau.to).toBe(geoeffnet.to);
  });
  it("Filter nach Datum und Uhrzeit: Zeitraum (bis ausschließlich), Uhrzeit an jedem Tag in deutscher Zeit, Zähler passend", async () => {
    const sent = await call("leadops.listSent", { kind: "kampagne" });
    const mail = sent.items[0]; const at = new Date(mail.at);
    const hm = (value: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false }).format(value);
    // genau die Minute der Mail als Uhrzeit-Fenster → dabei; eine Minute später beginnend → nicht dabei
    const exakt = await call("leadops.listSent", { kind: "kampagne", timeFrom: hm(at), timeTo: hm(at) });
    expect(exakt.items.some((item: { id: string }) => item.id === mail.id)).toBe(true);
    expect(exakt.items.every((item: { at: string }) => hm(new Date(item.at)) === hm(at))).toBe(true);
    const spaeter = await call("leadops.listSent", { kind: "kampagne", timeFrom: hm(new Date(at.getTime() + 60_000)), timeTo: hm(new Date(at.getTime() + 120_000)) });
    expect(spaeter.items.some((item: { id: string }) => item.id === mail.id)).toBe(false);
    // Zeitraum: „bis“ genau zur Sendezeit schließt die Mail aus, eine Minute danach schließt sie ein
    expect((await call("leadops.listSent", { kind: "kampagne", to: at })).items.some((item: { id: string }) => item.id === mail.id)).toBe(false);
    const fenster = await call("leadops.listSent", { kind: "kampagne", from: new Date(at.getTime() - 60_000), to: new Date(at.getTime() + 60_000) });
    expect(fenster.items.some((item: { id: string }) => item.id === mail.id)).toBe(true);
    expect(fenster.total).toBe(fenster.items.length); expect(fenster.counts.kampagne).toBe(fenster.total);
    // Zähler beziehen sich auf den Zeitraum: Summe der Reaktionen = Mails im Zeitraum
    const r = fenster.reactions; expect(r.geoeffnet + r.geklickt + r.geantwortet + r.ohne + r.bounce + r.abgemeldet).toBe(fenster.counts.kampagne);
    // Kampagne gewählt: Auswahlliste enthält trotzdem alle Kampagnen
    const eine = await call("leadops.listSent", { campaignId: mail.campaignId });
    expect(eine.campaigns.map((item: { id: number }) => item.id).sort()).toEqual(sent.campaigns.map((item: { id: number }) => item.id).sort());
    expect(eine.items.every((item: { campaignId: number }) => item.campaignId === mail.campaignId)).toBe(true);
  });
  it("Kontakte: Filter „Gesendet“ zeigt alle, die eine E-Mail bekommen haben; je Kontakt die gesendeten E-Mails mit Zeit", async () => {
    const alle = await call("leadops.emailLeads", {});
    const gesendet = await call("leadops.emailLeads", { activity: "angeschrieben" });
    const erwartet = alle.items.filter((item: { mails: number; lastSentAt: unknown }) => item.mails > 0 || item.lastSentAt).length;
    expect(gesendet.counts.angeschrieben).toBe(erwartet); expect(gesendet.total).toBe(erwartet); expect(erwartet).toBeGreaterThan(0);
    expect(gesendet.items.every((item: { mails: number }) => item.mails > 0)).toBe(true);
    // mehr als „Nicht geöffnet“: auch Geöffnete und Geantwortete stehen unter „Gesendet“
    expect(gesendet.items.some((item: { activity: string }) => item.activity !== "gesendet")).toBe(true);
    const zeiten = gesendet.items.map((item: { lastSentAt: string }) => new Date(item.lastSentAt).getTime()); expect([...zeiten].sort((a, b) => b - a)).toEqual(zeiten); // zuletzt angeschrieben oben
    const kontakt = gesendet.items[0];
    const mails = await call("leadops.listSent", { leadId: kontakt.id, email: kontakt.email });
    expect(mails.total).toBeGreaterThan(0); expect(mails.items.every((item: { to: string }) => item.to.toLowerCase() === String(kontakt.email).toLowerCase())).toBe(true);
  });
});

describe("Übernahme in die Pipeline „E-Mail-Kampagne“ mit Stufe (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("Kontakte landen in der E-Mail-Pipeline in der gewählten Stufe – ohne Vertriebler-Verteilung", async () => {
    await call("leadops.importColdList", { listName: "Stufenprobe", toPipeline: false, rows: [{ firstName: "Carla", lastName: "Drei", email: "carla@drei.de" }, { firstName: "Dirk", lastName: "Vier", email: "dirk@vier.de" }] });
    const liste = await call("leadops.emailLeads", { listName: "Stufenprobe" });
    const ergebnis = await call("leadops.pushLeadsToPipeline", { leadIds: liste.items.map((item: { id: number }) => item.id), stage: "kontaktiert" });
    expect(ergebnis.moved).toBe(2); expect(ergebnis.stage).toBe("kontaktiert");
    const leads = getStore().tables.leads.filter((row) => row.listName === "Stufenprobe");
    expect(leads.every((row) => row.inPipeline === true && row.adPlatform === "email" && row.pipelineStage === "kontaktiert")).toBe(true);
    const board = await call("leadops.pipelineOverview", { source: "email" });
    expect(board.totals.leads).toBeGreaterThanOrEqual(2);
    const nochmal = await call("leadops.pushLeadsToPipeline", { leadIds: liste.items.map((item: { id: number }) => item.id), stage: "kontaktiert" });
    expect(nochmal.moved).toBe(0); expect(nochmal.already).toBe(2); expect(nochmal.targetName).toBe("E-Mail-Kampagne");
    // andere Stufe → nur umgestuft
    const umgestuft = await call("leadops.pushLeadsToPipeline", { leadIds: [liste.items[0].id], stage: "qualifiziert" });
    expect(umgestuft).toMatchObject({ moved: 0, switched: 0, restaged: 1, already: 0, stage: "qualifiziert" });
  });
  it("Kontakte, die schon in der Kaltakquise stehen, lassen sich in die E-Mail-Kampagne verschieben – und zurück in die Kaltakquise", async () => {
    // Upload direkt in die Pipeline (Kaltakquise) – so wie es vor dem Reiter „Kontakte“ immer war
    await call("leadops.importColdList", { listName: "Kalt-Liste", toPipeline: true, rows: [{ firstName: "Emil", lastName: "Fünf", email: "emil@fuenf.de", phone: "+49 170 5555555" }] });
    const kontakte = await call("leadops.emailLeads", { listName: "Kalt-Liste" });
    expect(kontakte.items[0].inPipeline).toBe(true); expect(kontakte.items[0].adPlatform).toBe("kaltakquise");
    const emailBefore = (await call("leadops.pipelineOverview", { source: "email" })).totals.leads; const kaltBefore = (await call("leadops.pipelineOverview", { source: "kaltakquise" })).totals.leads;
    const verschoben = await call("leadops.pushLeadsToPipeline", { leadIds: [kontakte.items[0].id], stage: "kontaktiert" });
    expect(verschoben).toMatchObject({ moved: 0, switched: 1, restaged: 0, already: 0, stage: "kontaktiert", target: "email", targetName: "E-Mail-Kampagne" });
    const lead = getStore().tables.leads.find((row) => row.id === kontakte.items[0].id)!;
    expect(lead.adPlatform).toBe("email"); expect(lead.pipelineStage).toBe("kontaktiert"); expect(lead.inPipeline).toBe(true);
    expect((await call("leadops.pipelineOverview", { source: "email" })).totals.leads).toBe(emailBefore + 1); expect((await call("leadops.pipelineOverview", { source: "kaltakquise" })).totals.leads).toBe(kaltBefore - 1);
    const verlauf = getStore().tables.pipelineEvents.filter((row) => row.leadId === lead.id).map((row) => String(row.note ?? ""));
    expect(verlauf).toContain("Aus der Pipeline „Kaltakquise“ in die Pipeline „E-Mail-Kampagne“ verschoben");
    // Ziel-Pipeline wählbar: zurück in die Kaltakquise, unbekannte Stufe fällt auf die erste Stufe der Ziel-Pipeline
    const zurueck = await call("leadops.pushLeadsToPipeline", { leadIds: [lead.id], stage: "gibt-es-nicht", target: "kaltakquise" });
    expect(zurueck).toMatchObject({ switched: 1, target: "kaltakquise", targetName: "Kaltakquise", stage: "neu" });
    expect(getStore().tables.leads.find((row) => row.id === lead.id)!.adPlatform).toBe("kaltakquise");
    // Kontakte-Reiter der E-Mail-Akquise zeigt, in welcher Pipeline der Kontakt steht (adPlatform) – Glocke hat den Umzug
    const feed = await call("leadops.activityFeed", { days: 1 });
    expect(JSON.stringify(feed)).toContain("aus anderen Pipelines verschoben");
  });
});

describe("Glocke: Tagesverlauf der Plattform (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("Zeigt die letzten Tage zusammengefasst, zählt Neues seit dem letzten Öffnen und schreibt bei Aktionen mit", async () => {
    const feed = await call("leadops.activityFeed", { days: 14 });
    expect(feed.days.length).toBeGreaterThanOrEqual(3);
    expect(feed.days[0].label).toBe("Heute");
    expect(feed.days[0].summary).toMatch(/·/);
    const gestern = feed.days.find((day: { label: string }) => day.label === "Gestern");
    expect(gestern.groups.some((group: { kind: string }) => group.kind === "bestellung")).toBe(true);
    const vorher = feed.total;
    await call("leadops.importColdList", { listName: "Glockenprobe", toPipeline: true, rows: [{ firstName: "Emil", lastName: "Fünf", phone: "+49 69 55555", email: "emil@fuenf.de" }, { firstName: "Frieda", lastName: "Sechs", phone: "+49 69 66666" }] });
    const danach = await call("leadops.activityFeed", { days: 14, since: new Date(Date.now() - 60_000) });
    expect(danach.total).toBe(vorher + 1);
    expect(danach.newCount).toBeGreaterThanOrEqual(1);
    const heute = danach.days[0];
    const kontakte = heute.groups.find((group: { kind: string }) => group.kind === "kontakt_neu");
    expect(kontakte.entries[0].title).toContain("Glockenprobe");
    expect(kontakte.entries[0].count).toBe(2);
    const order = await call("leadops.createOrder", { buyerName: "Glocken GmbH", categoryId: getStore().tables.leadCategories[0].id, quantity: 10, unitPrice: 40, status: "offen" });
    expect(order.orderNumber).toMatch(/^ORD-/);
    const mitBestellung = await call("leadops.activityFeed", { days: 1 });
    expect(mitBestellung.days[0].groups.find((group: { kind: string }) => group.kind === "bestellung").entries[0].title).toContain("Glocken GmbH");
    const seit = await call("leadops.activityFeed", { days: 1, since: new Date(Date.now() + 60_000) });
    expect(seit.newCount).toBe(0);
  });

  it("Gespräch abhören landet im Verlauf", async () => {
    const callRow = getStore().tables.callRecords[0];
    await call("leadops.markCallListened", { callId: callRow.id });
    const feed = await call("leadops.activityFeed", { days: 1 });
    expect(feed.days[0].groups.some((group: { kind: string }) => group.kind === "gespraech_abgehoert")).toBe(true);
  });
});

describe("Vertriebspipeline: Reiter „Kontakte“ und Karten löschen (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("Kontakte je Pipeline als Liste – auch ohne E-Mail, mit Stufen-Filter", async () => {
    const kalt = await call("leadops.emailLeads", { source: "kaltakquise", inPipeline: true, withoutEmail: true });
    const board = await call("leadops.pipelineOverview", { source: "kaltakquise", from: new Date(2000, 0, 1) });
    expect(kalt.total).toBe(board.totals.leads);
    expect(kalt.items.some((item: { email: string | null; phone: string | null }) => !item.email && item.phone)).toBe(true);
    expect(kalt.items.every((item: { adPlatform: string }) => item.adPlatform === "kaltakquise")).toBe(true);
    const ads = await call("leadops.emailLeads", { source: "ads", inPipeline: true, withoutEmail: true });
    expect(ads.items.every((item: { adPlatform: string | null }) => item.adPlatform !== "kaltakquise" && item.adPlatform !== "email")).toBe(true);
    expect(ads.items.some((item: { adCampaignName: string | null }) => item.adCampaignName)).toBe(true);
    const termin = await call("leadops.emailLeads", { source: "kaltakquise", inPipeline: true, withoutEmail: true, stage: "termin" });
    expect(termin.items.every((item: { stage: string }) => item.stage === "termin")).toBe(true);
    expect(termin.items.length).toBeGreaterThan(0);
  });

  it("Mehrere Karten auf einmal löschen – Verlauf, Aufgaben und Notizen gehen mit, Verkaufs-Leads bleiben", async () => {
    const before = await call("leadops.emailLeads", { source: "kaltakquise", inPipeline: true, withoutEmail: true });
    const victims = before.items.slice(0, 2).map((item: { publicId: string }) => item.publicId);
    const notesBefore = getStore().tables.pipelineNotes.length;
    const ids = getStore().tables.leads.filter((row) => victims.includes(row.publicId)).map((row) => row.id);
    const ownNotes = getStore().tables.pipelineNotes.filter((row) => ids.includes(row.leadId)).length;
    const ergebnis = await call("leadops.deletePipelineLeads", { publicIds: [...victims, "GIBTESNICHT"] });
    expect(ergebnis).toMatchObject({ deleted: 2, skipped: 1 });
    expect(getStore().tables.leads.some((row) => victims.includes(row.publicId))).toBe(false);
    expect(getStore().tables.pipelineNotes.length).toBe(notesBefore - ownNotes);
    const after = await call("leadops.emailLeads", { source: "kaltakquise", inPipeline: true, withoutEmail: true });
    expect(after.total).toBe(before.total - 2);
    const sale = getStore().tables.leads.find((row) => row.kind !== "vertrieb")!;
    await expect(call("leadops.deletePipelineLeads", { publicIds: [sale.publicId] })).rejects.toThrow(/Verkaufs-Leads/);
    const feed = await call("leadops.activityFeed", { days: 1 });
    expect(feed.days[0].groups.some((group: { kind: string }) => group.kind === "sonstiges")).toBe(true);
  });
});

describe("Posteingang: nur bekannte Kontakte holen, aufräumen, Absender übernehmen (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("Standard „nur bekannte Kontakte“: Mails von Fremden werden beim Abholen übersprungen", async () => {
    const result = await call("leadops.syncInbox");
    expect(result.added).toBe(2); expect(result.skipped).toBe(1);
    expect(getStore().tables.inboxMessages.some((row) => row.fromEmail === "kontakt@elektro-vogel.example")).toBe(false);
  });

  it("Aufräumen: erst nur Fremde (ohne Lead und Kampagne), dann alles – Sperrliste bleibt", async () => {
    const alle = getStore().tables.inboxMessages.length;
    const fremde = getStore().tables.inboxMessages.filter((row) => !row.leadId && !row.campaignRecipientId).length;
    expect(fremde).toBeGreaterThan(0);
    const sperrliste = (await call("leadops.listEmailSuppressions")).items.length;
    const erst = await call("leadops.clearInbox", { scope: "fremde" });
    expect(erst).toEqual({ deleted: fremde, scope: "fremde" });
    expect(getStore().tables.inboxMessages.length).toBe(alle - fremde);
    expect(getStore().tables.inboxMessages.every((row) => row.leadId || row.campaignRecipientId)).toBe(true);
    const dann = await call("leadops.clearInbox", { scope: "alle" });
    expect(dann.deleted).toBe(alle - fremde);
    expect(getStore().tables.inboxMessages).toHaveLength(0);
    expect((await call("leadops.listEmailSuppressions")).items.length).toBe(sperrliste);
    expect((await call("leadops.activityFeed", { days: 1 })).days[0].groups.some((group: { kind: string }) => group.kind === "sonstiges")).toBe(true);
  });

  it("Absender aus den Einstellungen auf alle Kampagnen übernehmen", async () => {
    const settings = await call("leadops.getMailSettings");
    await call("leadops.saveMailSettings", { provider: settings.provider, fromName: "Vertrieb Tanesco", fromEmail: "vertrieb@tanescodigital.de", enabled: true, imapEnabled: true, imapHost: settings.imapHost, imapUsername: "vertrieb@tanescodigital.de" });
    const result = await call("leadops.applySenderToCampaigns");
    expect(result.fromEmail).toBe("vertrieb@tanescodigital.de"); expect(result.updated).toBe(getStore().tables.emailCampaigns.length);
    expect(getStore().tables.emailCampaigns.every((row) => row.fromEmail === "vertrieb@tanescodigital.de" && row.fromName === "Vertrieb Tanesco")).toBe(true);
  });
});

describe("Jede Pipeline mit eigenen Stufen (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("Standard gilt für alle – eigene Stufen nur für die Kaltakquise, Meta Ads bleibt beim Standard, Zurücksetzen holt den Standard zurück", async () => {
    const standard = await call("leadops.pipelineStages", { source: "alle" });
    expect((await call("leadops.pipelineStages", { source: "kaltakquise" })).map((s: { key: string }) => s.key)).toEqual(standard.map((s: { key: string }) => s.key));
    expect((await call("leadops.pipelineStageSetup", { source: "kaltakquise" })).own).toBe(false);
    const eigene = [{ key: "neu", label: "Liste", hint: "", fixed: "entry" }, { key: "angerufen", label: "Angerufen", hint: "Erster Anruf" }, { key: "interessiert", label: "Interessiert", hint: "" }, { key: "kunde", label: "Kunde", hint: "", fixed: "won" }, { key: "verloren", label: "Verloren", hint: "", fixed: "lost" }];
    const saved = await call("leadops.savePipelineStages", { stages: eigene, source: "kaltakquise" });
    expect(saved.source).toBe("kaltakquise");
    expect((await call("leadops.pipelineStages", { source: "kaltakquise" })).map((s: { label: string }) => s.label)).toEqual(["Liste", "Angerufen", "Interessiert", "Kunde", "Verloren"]);
    expect((await call("leadops.pipelineStages", { source: "ads" })).map((s: { key: string }) => s.key)).toEqual(standard.map((s: { key: string }) => s.key));
    expect((await call("leadops.pipelineStageSetup", { source: "kaltakquise" })).own).toBe(true);
    // Board der Kaltakquise zeigt die eigenen Stufen, Meta Ads die Standard-Stufen; Karten in weggefallenen Stufen sind auf dem Eingang
    const kalt = await call("leadops.pipelineOverview", { source: "kaltakquise", from: new Date(2000, 0, 1) });
    expect(kalt.stageDefs.map((s: { label: string }) => s.label)).toEqual(["Liste", "Angerufen", "Interessiert", "Kunde", "Verloren"]);
    expect(kalt.stages.every((stage: { key: string }) => ["neu", "angerufen", "interessiert", "kunde", "verloren"].includes(stage.key))).toBe(true);
    const ads = await call("leadops.pipelineOverview", { source: "ads", from: new Date(2000, 0, 1) });
    expect(ads.stageDefs.map((s: { key: string }) => s.key)).toEqual(standard.map((s: { key: string }) => s.key));
    // Verschieben prüft gegen die Stufen der Pipeline des Leads
    const kaltLead = getStore().tables.leads.find((row) => row.adPlatform === "kaltakquise" && row.kind === "vertrieb")!;
    await call("leadops.movePipelineStage", { publicId: kaltLead.publicId, stage: "angerufen" });
    expect(getStore().tables.leads.find((row) => row.id === kaltLead.id)!.pipelineStage).toBe("angerufen");
    await expect(call("leadops.movePipelineStage", { publicId: kaltLead.publicId, stage: "termin" })).rejects.toThrow(/Unbekannte Stufe/);
    const detail = await call("leadops.pipelineLeadDetail", { publicId: kaltLead.publicId });
    expect(detail.source).toBe("kaltakquise"); expect(detail.stages.map((s: { key: string }) => s.key)).toContain("angerufen");
    // Zurücksetzen → wieder Standard, Karte rutscht auf den Eingang
    await call("leadops.resetPipelineStages", { source: "kaltakquise" });
    expect((await call("leadops.pipelineStageSetup", { source: "kaltakquise" })).own).toBe(false);
    expect(getStore().tables.leads.find((row) => row.id === kaltLead.id)!.pipelineStage).toBe("neu");
  });
});

describe("Antworten mit Signatur und Anhang (Chat-Build)", () => {
  beforeAll(() => resetStore());

  it("Signatur speichern, Vorschau zeigt Name, Firma und Logo; Antwort mit Anhang wird im Verlauf mit Dateiname festgehalten", async () => {
    const settings = await call("leadops.getMailSettings");
    expect(settings.signature).toMatchObject({ enabled: true, name: "Thomas Kutzbach" });
    const vorschau = await call("leadops.mailSignaturePreview", { signature: { name: "Taner Tanesco", role: "Vertrieb" } });
    expect(vorschau.html).toContain("Taner Tanesco"); expect(vorschau.html).toContain("Vertrieb"); expect(vorschau.html).toContain("Tanesco Digital GbR"); expect(vorschau.html).not.toContain("tanesco-logo-mail.png"); // Logo standardmäßig aus (weniger Spam)
    expect((await call("leadops.mailSignaturePreview", { signature: { name: "Taner Tanesco", showLogo: true } })).html).toContain("tanesco-logo-mail.png"); // zuschaltbar
    await call("leadops.saveMailSettings", { provider: settings.provider, fromName: settings.fromName, fromEmail: settings.fromEmail, enabled: true, imapEnabled: true, imapHost: settings.imapHost, imapUsername: settings.imapUsername, signature: { ...settings.signature, name: "Taner Tanesco", showLogo: false } });
    const danach = await call("leadops.getMailSettings"); expect(danach.signature.name).toBe("Taner Tanesco"); expect(danach.signature.showLogo).toBe(false);
    expect((await call("leadops.mailSignaturePreview", {})).html).not.toContain("<img");
    const message = getStore().tables.inboxMessages[0];
    const ergebnis = await call("leadops.replyInboxMessage", { messageId: message.id, text: "Anbei unser Angebot.", attachments: [{ filename: "Angebot.pdf", contentType: "application/pdf", contentBase64: "JVBERi0xLjQK", size: 12 }] });
    expect(ergebnis.attachments).toBe(1);
    const gesendet = await call("leadops.listSent", { kind: "antwort" });
    const row = gesendet.items.find((item: { to: string; attachments?: Array<{ filename: string }> }) => item.to === message.fromEmail && item.attachments?.length);
    expect(row.attachments[0].filename).toBe("Angebot.pdf");
    await expect(call("leadops.replyInboxMessage", { messageId: message.id, text: "zu groß", attachments: [{ filename: "riesig.zip", contentType: "application/zip", contentBase64: "", size: 9 * 1024 * 1024 }] })).rejects.toThrow(/zu groß/);
  });
});

describe("sipgate als Telefonie-Anbieter (Chat-Build)", () => {
  beforeAll(() => resetStore());
  it("Token speichern, Verbindung prüfen, Rufnummern übernehmen, Webhook eintragen, Sitzung mit sipgate-Gerät – Predictive geht nicht", async () => {
    const before = await call("leadops.getTelephonySettings");
    const base = { ...before, credentials: before.credentials, addressSid: "", bundleSids: before.bundleSids, announcement: before.announcement ?? "", pacingRatio: Number(before.pacingRatio), maxAbandonRate: Number(before.maxAbandonRate), callWindow: { weekdays: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } };
    await expect(call("leadops.saveTelephonySettings", { ...base, provider: "sipgate", agentConnection: "sipgate", sipgate: { tokenId: "", token: "" } })).rejects.toThrow(/Token-ID und Token/);
    await call("leadops.saveTelephonySettings", { ...base, provider: "sipgate", agentConnection: "sipgate", sipgate: { tokenId: "token-demo", token: "geheim", smsId: "s0", deviceId: "" } });
    const saved = await call("leadops.getTelephonySettings");
    expect(saved.provider).toBe("sipgate"); expect(saved.sipgate).toMatchObject({ tokenId: "token-demo", token: "••••••••", smsId: "s0" }); expect(saved.webhooks.sipgateEvents).toContain("/api/telephony/sipgate/events");
    const check = await call("leadops.sipgateCheck");
    expect(check).toMatchObject({ ok: true, userId: "w0", system: "classic" }); expect(check.devices.map((device: { id: string }) => device.id)).toEqual(["e0", "e1", "x0"]); expect(check.numbers.every((number: { imported: boolean }) => !number.imported)).toBe(true); expect(check.webhooks.configured).toBe(false);
    expect(await call("leadops.sipgateDevices")).toHaveLength(3);
    const imported = await call("leadops.sipgateImportNumbers"); expect(imported).toEqual({ imported: 2, total: 2 });
    expect((await call("leadops.sipgateCheck")).numbers.every((number: { imported: boolean }) => number.imported)).toBe(true);
    expect((await call("leadops.getTelephonySettings")).numbers.some((number: { provider: string; e164: string }) => number.provider === "sipgate" && number.e164 === "+496119851230")).toBe(true);
    const hook = await call("leadops.sipgateSetupWebhooks"); expect(hook.url).toContain("/api/telephony/sipgate/events");
    expect((await call("leadops.sipgateCheck")).webhooks.configured).toBe(true);
    await expect(call("leadops.startDialerSession", { campaignId: null, mode: "predictive", connection: "sipgate", agentDeviceId: "e0" })).rejects.toThrow(/Predictive/);
    await expect(call("leadops.startDialerSession", { campaignId: null, mode: "manuell", connection: "browser", agentPhone: null })).rejects.toThrow(/sipgate-Gerät/);
    const session = await call("leadops.startDialerSession", { campaignId: null, mode: "manuell", connection: "browser", agentPhone: null, agentDeviceId: "e1" });
    expect(session.connection).toBe("sipgate"); expect(session.agentDeviceId).toBe("e1");
    expect((await call("leadops.softphoneToken")).provider).toBe("sipgate");
    // Live-Bild: der angemeldete Agent steht drin, Pause/Bereit per Teamleiter
    const live = await call("leadops.dialerLiveBoard");
    expect(live.provider).toBe("sipgate"); expect(live.agents.some((agent: { userId: number; device: string | null }) => agent.userId === session.userId && agent.device === "e1")).toBe(true); expect(typeof live.totals.callsToday).toBe("number"); expect(Array.isArray(live.recent)).toBe(true);
    await call("leadops.dialerSupervise", { userId: session.userId, action: "pause" }); expect((await call("leadops.currentDialerSession")).status).toBe("pause");
    await call("leadops.dialerSupervise", { userId: session.userId, action: "bereit" }); expect((await call("leadops.currentDialerSession")).status).toBe("bereit");
    await call("leadops.updateDialerSession", { status: "offline" });
    await call("leadops.saveTelephonySettings", { ...base, provider: "simulation", agentConnection: "browser" });
    expect((await call("leadops.getTelephonySettings")).sipgate.tokenId).toBe("token-demo"); // Token bleibt gespeichert, auch wenn gerade simuliert wird
  });
});


describe("Agenten-Auswertung und Rohdaten je Kategorie (Chat-Build)", () => {
  beforeAll(() => resetStore());
  it("Gespräche → Agenten: drei Agenten mit Anrufen, Erreicht-Quote, Terminen und Ø Punkten; Zeitraum und Kampagne filtern; Liste nach Agent", async () => {
    const report = await call("leadops.dialerAgentReport", { period: "30" });
    const names = report.agents.map((agent: any) => agent.name);
    expect(names).toEqual(expect.arrayContaining(["Taner Tanesco", "Francesco Rossi", "Lena Vogt"]));
    const taner = report.agents.find((agent: any) => agent.name === "Taner Tanesco");
    expect(taner.calls).toBeGreaterThanOrEqual(8); expect(taner.appointments).toBeGreaterThanOrEqual(3); expect(taner.averageScore).toBeGreaterThan(60); expect(taner.reachRate).not.toBeNull();
    expect(report.agents[0].name).toBe("Taner Tanesco"); // meiste Termine zuerst
    const lena = report.agents.find((agent: any) => agent.name === "Lena Vogt");
    expect(lena.notReached).toBeGreaterThanOrEqual(1); expect(lena.interested).toBeGreaterThanOrEqual(2);
    expect(report.totals.calls).toBe(report.agents.reduce((sum: number, agent: any) => sum + agent.calls, 0));
    expect(report.totals.appointments).toBeGreaterThanOrEqual(4);
    const today = await call("leadops.dialerAgentReport", { period: "heute" });
    expect(today.totals.calls).toBeLessThan(report.totals.calls); // nur die Gespräche von heute
    const live = report.campaigns.find((campaign: any) => campaign.name === "Dachdecker Hessen – Nachfassen");
    const perCampaign = await call("leadops.dialerAgentReport", { period: "alle", campaignId: live.id });
    expect(perCampaign.totals.calls).toBe(4); // drei beendete + das laufende Gespräch
    expect(perCampaign.agents.some((agent: any) => agent.name === "Lena Vogt")).toBe(false);
    const calls = await call("leadops.listCalls", { agentName: "Francesco Rossi" });
    expect(calls.length).toBeGreaterThanOrEqual(4); expect(calls.every((row: any) => row.agentName === "Francesco Rossi")).toBe(true);
  });
  it("Rohdaten: je Kategorie Kontakte → angerufen → erreicht → Ergebnisse → Leads → verkauft, auch nur für eine Liste", async () => {
    const report = await call("leadops.rawCategoryReport", {});
    const pv = report.categories.find((row: any) => row.shortcode === "PV");
    expect(pv.total).toBeGreaterThanOrEqual(13); expect(pv.angerufen).toBeGreaterThanOrEqual(8); expect(pv.erreicht).toBeGreaterThanOrEqual(6);
    expect(pv.termine).toBe(2); expect(pv.leads).toBe(5); expect(pv.leadVerkauft).toBe(2); expect(pv.leadRate).not.toBeNull(); expect(pv.saleRate).toBe(40);
    const fen = report.categories.find((row: any) => row.shortcode === "FEN");
    expect(fen).toMatchObject({ total: 4, leads: 2, leadReklamiert: 1, keinInteresse: 1, nichtErreicht: 1 });
    expect(report.totals.total).toBe(report.categories.reduce((sum: number, row: any) => sum + row.total, 0));
    expect(report.totals.duplikat).toBeGreaterThanOrEqual(3);
    const batches = await call("leadops.listRawBatches");
    const worked = batches.find((batch: any) => batch.name === "Handwerk Rhein-Main 10-2026.csv");
    expect(worked.counts).toMatchObject({ total: 20, konvertiert: 8, duplikat: 2 });
    const only = await call("leadops.rawCategoryReport", { batchId: worked.id });
    expect(only.totals.total).toBe(20); expect(only.totals.leads).toBe(8); expect(only.totals.leadVerkauft).toBe(3); expect(only.totals.termine).toBe(3);
    const messe = batches.find((batch: any) => batch.name === "Messe Hannover 09-2026.xlsx");
    expect((await call("leadops.rawCategoryReport", { batchId: messe.id })).totals.angerufen).toBe(0);
  });
});

describe("Anrufzähler, Vertriebler und Verteilung beim Upload (Chat-Build)", () => {
  beforeAll(() => resetStore());
  it("zählt Anrufversuche an der Karte: Neu → In Bearbeitung beim ersten Versuch, erreicht → Kontaktiert, Rückruf als Aufgabe, Dialer zählt mit", async () => {
    const overview = await call("leadops.pipelineOverview", { source: "kaltakquise" });
    expect(overview.stageDefs.map((stage: any) => stage.key).slice(0, 3)).toEqual(["neu", "in_bearbeitung", "kontaktiert"]);
    const klaus = overview.stages.find((stage: any) => stage.key === "in_bearbeitung").leads.find((lead: any) => lead.name.includes("Brandt"));
    expect(klaus.calls).toMatchObject({ count: 2, reached: 0, lastResult: "mailbox" }); // aus dem Seed
    const lena = overview.stages.find((stage: any) => stage.key === "neu").leads.find((lead: any) => lead.name.includes("Vogt"));
    expect(lena.calls.count).toBe(0);
    const first = await call("leadops.logCallAttempt", { publicId: lena.publicId, result: "nicht_erreicht", note: "Niemand ran" });
    expect(first).toMatchObject({ count: 1, moved: "in_bearbeitung" });
    const second = await call("leadops.logCallAttempt", { publicId: lena.publicId, result: "rueckruf", followUpAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(second).toMatchObject({ count: 2, reached: 1, moved: "kontaktiert" }); // Rückruf vereinbart = erreicht
    const attempts = await call("leadops.callAttempts", { publicId: lena.publicId });
    expect(attempts.attempts.map((item: any) => item.result)).toEqual(["rueckruf", "nicht_erreicht"]); expect(attempts.attempts[0].by).toBeTruthy();
    const tasks = await call("leadops.listPipelineTasks", { publicId: lena.publicId });
    expect(tasks.some((task: any) => task.title === "Rückruf wie vereinbart")).toBe(true);
    const history = await call("leadops.pipelineHistory", { publicId: lena.publicId });
    expect(history.some((event: any) => event.toStage === "anruf" && /Anruf 1: nicht erreicht – Niemand ran/.test(event.note))).toBe(true);
    const after = await call("leadops.pipelineOverview", { source: "kaltakquise" });
    expect(after.stages.find((stage: any) => stage.key === "kontaktiert").leads.find((lead: any) => lead.publicId === lena.publicId).calls.count).toBe(2);
    await expect(call("leadops.logCallAttempt", { publicId: lena.publicId, result: "irgendwas" })).rejects.toThrow(/Ergebnis/);
    // Dialer: Anruf an einer Karte beenden → zählt automatisch (Endziffer 4 → Mensch), Ergebnis zieht nach
    const anja = after.stages.flatMap((stage: any) => stage.leads).find((lead: any) => lead.name.includes("Reuter"));
    const before = anja.calls.count;
    await call("leadops.startDialerSession", { campaignId: null, mode: "manuell", connection: "browser", agentPhone: null });
    const instruction = await call("leadops.placeManualCall", { publicId: anja.publicId });
    getStore().tables.dialerCalls.find((row) => row.id === instruction.callId)!.startedAt = new Date(Date.now() - 5000); // Simulation: nach 5 s verbunden
    expect((await call("leadops.currentDialerSession")).call.status).toBe("verbunden");
    await call("leadops.endDialerCall", { callId: instruction.callId, durationSeconds: 30 });
    await call("leadops.setCallDisposition", { callId: instruction.callId, disposition: "wiedervorlage" });
    await call("leadops.updateDialerSession", { status: "offline" });
    const dialed = await call("leadops.callAttempts", { publicId: anja.publicId });
    expect(dialed.count).toBe(before + 1); expect(dialed.attempts[0]).toMatchObject({ fromDialer: true, result: "rueckruf" });
    // Kontakte-Reiter zeigt den Zähler
    const kontakte = await call("leadops.emailLeads", { source: "kaltakquise", withoutEmail: true, inPipeline: true });
    expect(kontakte.items.find((item: any) => item.publicId === lena.publicId).calls.count).toBe(2);
  });
  it("Vertriebler: Taner und Francesco sind da, neue anlegen (mit/ohne Login), umbenennen, pausieren – pausierte bekommen nichts", async () => {
    const reps = await call("leadops.listSalesReps");
    expect(reps.map((rep: any) => rep.firstName)).toEqual(expect.arrayContaining(["Taner", "Francesco"]));
    expect((await call("leadops.ensureDefaultSalesReps")).created).toEqual([]);
    const lisa = await call("leadops.createSalesRep", { name: "Lisa Neu" }); expect(lisa).toMatchObject({ created: true, hasLogin: false });
    await expect(call("leadops.createSalesRep", { name: "lisa neu" })).rejects.toThrow(/gibt es schon/);
    await expect(call("leadops.createSalesRep", { name: "Paul", email: "paul@example.de", password: "kurz" })).rejects.toThrow(/8 Zeichen/);
    const paul = await call("leadops.createSalesRep", { name: "Paul Login", email: "paul@example.de", password: "geheim-12345" }); expect(paul.hasLogin).toBe(true);
    expect((await call("leadops.pipelineOwners")).map((owner: any) => owner.name)).toEqual(expect.arrayContaining(["Lisa", "Paul"]));
    await call("leadops.updateSalesRep", { userId: lisa.userId, name: "Lisa Neumann", active: false });
    expect((await call("leadops.listSalesReps")).find((rep: any) => rep.userId === lisa.userId)).toMatchObject({ name: "Lisa Neumann", active: false, initials: "LN" });
    expect((await call("leadops.pipelineOwners")).some((owner: any) => owner.userId === lisa.userId)).toBe(false);
  });
  it("Antwort-Stopp: Antwort beendet jede laufende Serie an den Kontakt (ohne Verzweigung im Ablauf), Abwesenheitsnotiz nicht, Knopf „Geantwortet“ stoppt ebenfalls", async () => {
    const { REPLY_STOP_NOTE } = await import("../../../../shared/email-campaigns"); const { starterBlocks } = await import("../../../../shared/email-design");
    await call("leadops.importColdList", { listName: "Antwort-Stopp", rows: [["Anna", "anna@stopp-test.example"], ["Bernd", "bernd@stopp-test.example"], ["Dirk", "dirk@stopp-test.example"]].map(([firstName, email]) => ({ firstName, lastName: "Test", company: `${firstName} GmbH`, email })) });
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send", label: "Erste", subject: "Erste Mail", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait", hours: 1, next: "m2" }, { id: "m2", type: "send", label: "Zweite", subject: "Zweite Mail", blocks: starterBlocks("nachfassen"), next: "m3" }, { id: "m3", type: "send", label: "Dritte", subject: "Dritte Mail", blocks: starterBlocks("nachfassen"), next: null }] };
    const base = { id: null, fromName: "T", fromEmail: "t@t.de", replyTo: null, audience: { source: "liste", listName: "Antwort-Stopp" }, tree, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" }, abSplit: 30 };
    const a = await call("leadops.saveEmailCampaign", { ...base, name: "Stopp A" }); const b = await call("leadops.saveEmailCampaign", { ...base, name: "Stopp B" });
    expect((await call("leadops.startEmailCampaign", { id: a.id })).added).toBe(3); expect((await call("leadops.startEmailCampaign", { id: b.id })).added).toBe(3);
    const rowsOf = (email: string) => getStore().tables.emailCampaignRecipients.filter((row) => row.email === email && (row.campaignId === a.id || row.campaignId === b.id));
    expect(rowsOf("anna@stopp-test.example").every((row) => row.status === "wartet" && row.sentCount === 1)).toBe(true);
    // Anna antwortet → A und B für Anna beendet, Vermerk im Verlauf
    const reply = await call("leadops.storeInboxMessage", { fromEmail: "anna@stopp-test.example", fromName: "Anna Test", subject: "Re: Erste Mail", bodyText: "Ja gerne, rufen Sie an." }); expect(reply.replied).toBe(true);
    expect(rowsOf("anna@stopp-test.example").every((row) => row.status === "fertig" && row.repliedAt && !row.nextActionAt)).toBe(true);
    expect(getStore().tables.emailCampaignEvents.filter((row) => rowsOf("anna@stopp-test.example").some((item) => item.id === row.recipientId) && row.kind === "beendet" && row.note === REPLY_STOP_NOTE)).toHaveLength(2);
    // Bernd: nur Abwesenheitsnotiz → läuft weiter
    const away = await call("leadops.storeInboxMessage", { fromEmail: "bernd@stopp-test.example", fromName: "Bernd Test", subject: "Automatische Antwort: Erste Mail", bodyText: "Ich bin bis zum 30.10. im Urlaub und erst danach wieder erreichbar." }); expect(away.replied).toBe(false);
    expect(rowsOf("bernd@stopp-test.example").every((row) => row.status === "wartet" && !row.repliedAt)).toBe(true);
    // Dirk: Knopf „Geantwortet“ in Serie A → stoppt A und B
    const dirkA = rowsOf("dirk@stopp-test.example").find((row) => row.campaignId === a.id)!; expect((await call("leadops.markEmailReplied", { recipientId: dirkA.id })).stopped).toBe(2);
    expect(rowsOf("dirk@stopp-test.example").every((row) => row.status === "fertig" && row.repliedAt)).toBe(true);
    // Zeitplaner: nur Bernd bekommt Mail 2 und 3
    for (const row of getStore().tables.emailCampaignRecipients.filter((row) => row.campaignId === a.id || row.campaignId === b.id)) row.nextActionAt = new Date(Date.now() - 1000);
    await call("leadops.runEmailCampaigns");
    expect(rowsOf("bernd@stopp-test.example").every((row) => row.status === "fertig" && row.sentCount === 3)).toBe(true);
    expect(rowsOf("anna@stopp-test.example").every((row) => row.sentCount === 1)).toBe(true); expect(rowsOf("dirk@stopp-test.example").every((row) => row.sentCount === 1)).toBe(true);
    // Nur Zeitstempel gesetzt (ohne Stopp-Lauf) → der Zeitplaner beendet statt zu senden
    const c = await call("leadops.saveEmailCampaign", { ...base, name: "Stopp C" }); expect((await call("leadops.startEmailCampaign", { id: c.id })).added).toBe(3);
    const berndC = getStore().tables.emailCampaignRecipients.find((row) => row.campaignId === c.id && row.email === "bernd@stopp-test.example")!; berndC.repliedAt = new Date(); berndC.nextActionAt = new Date(Date.now() - 1000);
    await call("leadops.runEmailCampaigns"); expect(berndC.status).toBe("fertig"); expect(berndC.sentCount).toBe(1);
    expect(getStore().tables.emailCampaignEvents.some((row) => row.recipientId === berndC.id && row.kind === "beendet" && row.note === REPLY_STOP_NOTE)).toBe(true);
    const detail = await call("leadops.getEmailCampaign", { id: a.id }); expect(detail.stats.replied).toBe(2); expect(detail.stopOnReply).toBe(true);
    // Schalter „Bei Antwort anhalten“ aus → Annas Antwort stoppt diese Serie nicht, alle Mails gehen raus
    const d = await call("leadops.saveEmailCampaign", { ...base, name: "Stopp D (aus)", stopOnReply: false }); expect((await call("leadops.listEmailCampaigns")).find((row: any) => row.id === d.id).stopOnReply).toBe(false);
    expect((await call("leadops.startEmailCampaign", { id: d.id })).added).toBe(3);
    const annaD = getStore().tables.emailCampaignRecipients.find((row) => row.campaignId === d.id && row.email === "anna@stopp-test.example")!; expect(annaD.sentCount).toBe(1);
    await call("leadops.storeInboxMessage", { fromEmail: "anna@stopp-test.example", fromName: "Anna Test", subject: "Re: Erste Mail", bodyText: "Nochmal ja." }); expect(annaD.status).toBe("wartet"); expect(annaD.repliedAt).toBeTruthy();
    annaD.nextActionAt = new Date(Date.now() - 1000); await call("leadops.runEmailCampaigns"); expect(annaD.status).toBe("fertig"); expect(annaD.sentCount).toBe(3);
    // Schalter nachträglich an → Sicherheitsnetz beendet alte Einträge (vor der Antwort angelegt) vor dem nächsten Lauf
    const e = await call("leadops.saveEmailCampaign", { ...base, name: "Stopp E", stopOnReply: false }); expect((await call("leadops.startEmailCampaign", { id: e.id })).added).toBe(3);
    const dirkE = getStore().tables.emailCampaignRecipients.find((row) => row.campaignId === e.id && row.email === "dirk@stopp-test.example")!; expect(dirkE.status).toBe("wartet");
    dirkE.createdAt = new Date(Date.now() - 3 * 3_600_000); dirkE.nextActionAt = new Date(Date.now() - 1000);
    await call("leadops.saveEmailCampaign", { ...base, id: e.id, name: "Stopp E", stopOnReply: true }); await call("leadops.runEmailCampaigns");
    expect(dirkE.status).toBe("fertig"); expect(dirkE.sentCount).toBe(1);
  });
  it("Upload-Verlauf zeigt Löschungen, Lead-Log je Empfänger, Karten prozentual verteilen, Mehrfach-Durchlauf", async () => {
    const { REPLY_STOP_NOTE } = await import("../../../../shared/email-campaigns"); const { starterBlocks } = await import("../../../../shared/email-design");
    // Löschungen im Verlauf
    await call("leadops.importColdList", { listName: "Verlauf Demo", rows: [["Udo", "udo@verlauf-demo.example"], ["Vera", "vera@verlauf-demo.example"], ["Willi", "willi@verlauf-demo.example"]].map(([firstName, email]) => ({ firstName, lastName: "Test", company: `${firstName} GmbH`, email })) });
    const contacts = (await call("leadops.emailLeads", { listName: "Verlauf Demo" })).items; expect(contacts.length).toBe(3);
    await call("leadops.deleteEmailLeads", { leadIds: [contacts[0].id] });
    let history = await call("leadops.listImportHistory", { limit: 100 }); const deletion = history.find((row: any) => row.kind === "loeschung" && row.listName === "Verlauf Demo"); expect(deletion).toBeTruthy(); expect(deletion.rowCount).toBe(1); expect(deletion.note).toContain("von Hand gelöscht"); expect(deletion.actorName).toBeTruthy();
    await call("leadops.deleteColdList", { listName: "Verlauf Demo" }); history = await call("leadops.listImportHistory", { limit: 100 });
    expect(history.filter((row: any) => row.kind === "loeschung" && row.listName === "Verlauf Demo").length).toBe(2); expect(history.some((row: any) => row.kind === "loeschung" && /komplett gelöscht/.test(row.note ?? ""))).toBe(true);
    // Lead-Log
    await call("leadops.importColdList", { listName: "Log Demo", rows: [["Lena", "lena@log-demo.example"], ["Max", "max@log-demo.example"], ["Nora", "nora@log-demo.example"]].map(([firstName, email]) => ({ firstName, lastName: "Log", company: `${firstName} GmbH`, email })) });
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send", label: "Erste", subject: "Erste Mail", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait", hours: 48, next: "c1" }, { id: "c1", type: "condition", check: "opened", yes: "e1", no: "m2" }, { id: "m2", type: "send", label: "Zweite", subject: "Zweite Mail", blocks: starterBlocks("nachfassen"), next: null }, { id: "e1", type: "end", label: "Hat geöffnet" }] };
    const base = { id: null, fromName: "T", fromEmail: "t@t.de", replyTo: null, audience: { source: "liste", listName: "Log Demo" }, tree, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" }, abSplit: 30 };
    const log = await call("leadops.saveEmailCampaign", { ...base, name: "Log-Serie" }); expect((await call("leadops.startEmailCampaign", { id: log.id })).added).toBe(3);
    const detail = await call("leadops.getEmailCampaign", { id: log.id }); expect(detail.recipients.every((row: any) => row.lead?.label === "Neu")).toBe(true);
    const lena = detail.recipients.find((row: any) => row.email === "lena@log-demo.example"); const lenaLog = await call("leadops.emailRecipientLog", { recipientId: lena.id });
    expect(lenaLog.steps.map((step: any) => step.state)).toEqual(["erledigt", "aktuell", "offen", "offen"]); // steht während der Wartezeit am Warten-Schritt expect(lenaLog.waiting).toMatch(/wartet noch/); expect(lenaLog.lead.stage.label).toBe("Neu"); expect(lenaLog.events.map((event: any) => event.kind)).toEqual(["gesendet", "gewartet"]);
    const max = getStore().tables.emailCampaignRecipients.find((row) => row.id === detail.recipients.find((item: any) => item.email === "max@log-demo.example").id)!; max.status = "fehler"; max.nextActionAt = null; (max as any).lastError = "SMTP: 550 Mailbox unavailable";
    const maxLog = await call("leadops.emailRecipientLog", { recipientId: max.id }); expect(maxLog.errors.map((item: any) => item.note)).toContain("SMTP: 550 Mailbox unavailable"); expect((await call("leadops.listEmailCampaigns")).find((row: any) => row.id === log.id).stats.failed).toBe(1);
    await call("leadops.storeInboxMessage", { fromEmail: "nora@log-demo.example", fromName: "Nora Log", subject: "Re: Erste Mail", bodyText: "Ja, gern." });
    const nora = detail.recipients.find((row: any) => row.email === "nora@log-demo.example"); const noraLog = await call("leadops.emailRecipientLog", { recipientId: nora.id }); expect(noraLog.recipient.status).toBe("fertig"); expect(noraLog.events.some((event: any) => event.note === REPLY_STOP_NOTE)).toBe(true); expect(noraLog.events.map((event: any) => event.label)).toContain("Antwort erhalten");
    // Karten verteilen 70/30
    const reps = await call("leadops.pipelineOwners"); const cards = detail.recipients.map((row: any) => row.lead.publicId);
    expect((await call("leadops.distributePipelineOwners", { publicIds: cards, userIds: [reps[0].userId, reps[1].userId], shares: [{ userId: reps[0].userId, value: 70 }, { userId: reps[1].userId, value: 30 }], mode: "prozent" })).updated).toBe(3);
    const owned = getStore().tables.leads.filter((row) => row.listName === "Log Demo"); expect(owned.filter((row) => row.ownerUserId === reps[0].userId).length).toBe(2); expect(owned.filter((row) => row.ownerUserId === reps[1].userId).length).toBe(1);
    // Mehrfach-Durchlauf
    const lenaRow = getStore().tables.emailCampaignRecipients.find((row) => row.id === lena.id)!; lenaRow.status = "fertig"; lenaRow.nextActionAt = null;
    expect(await call("leadops.startEmailCampaign", { id: log.id })).toMatchObject({ added: 1, repeated: 1, skipped: 2, maxRuns: 1 }); // Standard: nur Max (Versandfehler zählt nicht) erneut
    await call("leadops.saveEmailCampaign", { ...base, id: log.id, name: "Log-Serie", maxRuns: 2 }); expect((await call("leadops.listEmailCampaigns")).find((row: any) => row.id === log.id).maxRuns).toBe(2);
    expect(await call("leadops.startEmailCampaign", { id: log.id })).toMatchObject({ added: 1, repeated: 1, skipped: 2 }); // Lena erneut (2. Durchlauf), Max läuft, Nora hat geantwortet
    expect(getStore().tables.emailCampaignRecipients.filter((row) => row.campaignId === log.id && row.email === "lena@log-demo.example").length).toBe(2);
    expect((await call("leadops.emailRecipientLog", { recipientId: lena.id })).runs.length).toBe(2);
  });
  it("Gebietskarte: fünf Kunden im Seed, Überschneidungen je Kategorie, Gebiet anlegen/ändern/löschen", async () => {
    const list = await call("leadops.listTerritories"); expect(list.length).toBe(5); expect(list.map((row: any) => row.customerName)).toContain("Aurora Home Solar"); expect(list.every((row: any) => row.postcodes.length > 0 && /^#[0-9a-f]{6}$/i.test(row.color))).toBe(true);
    const overlaps = await call("leadops.territoryOverlaps"); expect(overlaps.customers).toBe(5); expect(overlaps.totalOverlapPlz).toBeGreaterThan(50);
    const pv = overlaps.groups.find((group: any) => group.categoryName === "Photovoltaik"); expect(pv.maxCustomers).toBe(3); expect(pv.items.some((item: any) => item.count === 3 && item.plz.startsWith("60"))).toBe(true); expect(pv.pairs.length).toBeGreaterThanOrEqual(3);
    expect(overlaps.groups.find((group: any) => group.categoryName === "Wärmepumpe").overlapPlz).toBe(0); // nur ein WP-Kunde → keine Überschneidung trotz gleicher PLZ wie PV (andere Kategorie)
    const created = await call("leadops.saveTerritory", { customerName: "Test Kunde", categoryId: list[0].categoryId, postcodes: ["60311", "60313", "xx"] }); expect(created).toMatchObject({ created: true, postcodes: 2 });
    expect((await call("leadops.listTerritories")).length).toBe(6);
    expect(await call("leadops.saveTerritory", { id: created.id, customerName: "Test Kunde", categoryId: list[0].categoryId, postcodes: ["60311"] })).toMatchObject({ created: false, postcodes: 1 });
    await expect(call("leadops.saveTerritory", { customerName: "Leer", postcodes: ["abc"] })).rejects.toThrow(/Keine gültige PLZ/);
    expect((await call("leadops.deleteTerritory", { id: created.id })).customerName).toBe("Test Kunde"); expect((await call("leadops.listTerritories")).length).toBe(5);
    // Kunde ausschalten → zählt nicht mehr; SonnenKraft liegt im Umkreis 25 km um Frankfurt (Seed per Umkreis)
    const sonne = list.find((row: any) => row.customerName === "SonnenKraft Rhein-Main"); expect(sonne.postcodes.length).toBeGreaterThan(30); expect(sonne.postcodes.every((plz: string) => /^6[0-5]/.test(plz))).toBe(true);
    expect((await call("leadops.setTerritoryActive", { id: sonne.id, active: false })).active).toBe(false);
    const paused = await call("leadops.territoryOverlaps"); expect(paused.inactive).toBe(1); expect(paused.groups.find((group: any) => group.categoryName === "Photovoltaik").maxCustomers).toBe(2);
    await call("leadops.setTerritoryActive", { id: sonne.id, active: true }); expect((await call("leadops.territoryOverlaps")).groups.find((group: any) => group.categoryName === "Photovoltaik").maxCustomers).toBe(3);
  });
  it("Listen-Upload verteilt prozentual (70/30 → 7/3, im Wechsel) oder nach Anzahl (Rest bleibt offen)", async () => {
    const reps = await call("leadops.listSalesReps"); const taner = reps.find((rep: any) => rep.firstName === "Taner"); const francesco = reps.find((rep: any) => rep.firstName === "Francesco");
    const rows = Array.from({ length: 10 }, (_, index) => ({ firstName: `Test${index}`, lastName: "Verteilt", company: `Firma ${index}`, phone: `+49 69 4400${100 + index}` }));
    const result = await call("leadops.importColdList", { listName: "Verteil-Test", rows, ownerShares: [{ userId: taner.userId, value: 70 }, { userId: francesco.userId, value: 30 }], shareMode: "prozent" });
    expect(result.created).toBe(10);
    const leads = getStore().tables.leads.filter((row) => row.listName === "Verteil-Test");
    expect(leads.filter((row) => row.ownerUserId === taner.userId).length).toBe(7); expect(leads.filter((row) => row.ownerUserId === francesco.userId).length).toBe(3);
    expect(leads.slice(0, 3).map((row) => row.ownerUserId)).not.toEqual([taner.userId, taner.userId, taner.userId]); // abwechselnd
    const byCount = await call("leadops.importColdList", { listName: "Verteil-Test 2", rows: rows.map((row) => ({ ...row, phone: row.phone.replace("4400", "4401") })), ownerShares: [{ userId: francesco.userId, value: 2 }], shareMode: "anzahl" });
    expect(byCount.created).toBe(10);
    const second = getStore().tables.leads.filter((row) => row.listName === "Verteil-Test 2");
    expect(second.filter((row) => row.ownerUserId === francesco.userId).length).toBe(2); expect(second.filter((row) => !row.ownerUserId).length).toBe(8);
  });

  it("Verteilung je Pipeline: 50/50 Taner/Francesco nur in der Kaltakquise – greift beim Übernehmen aus der E-Mail-Akquise", async () => {
    const taner = getStore().tables.users.find((row) => row.email === "taner@tanesco.digital")!; const francesco = getStore().tables.users.find((row) => row.email === "francesco@tanesco.digital")!;
    const settings = await call("leadops.pipelineSettings");
    const saved = await call("leadops.savePipelineSettings", { ...settings, distribution: { mode: "aus", rules: [], fallback: "reihum", shares: [], perPipeline: { kaltakquise: { mode: "anteile", shares: [{ userId: taner.id, percent: 50 }, { userId: francesco.id, percent: 50 }] }, email: { mode: "standard", shares: [] } } } });
    expect(Object.keys(saved.distribution.perPipeline)).toEqual(["kaltakquise"]);
    const imported = await call("leadops.importColdList", { listName: "Verteil-Mail", toPipeline: false, ownerUserIds: [], rows: [1, 2, 3, 4].map((n) => ({ firstName: `Kontakt${n}`, lastName: "Verteil", email: `kontakt${n}@verteil.example` })) }); expect(imported.created).toBe(4);
    const kontakte = (await call("leadops.emailLeads", { listName: "Verteil-Mail" })).items; expect(kontakte).toHaveLength(4);
    const inEmail = await call("leadops.pushLeadsToPipeline", { leadIds: [kontakte[0].id], stage: "neu", target: "email" }); expect(inEmail).toMatchObject({ moved: 1, assigned: 0 }); // E-Mail-Pipeline: Verteilung aus
    const inKalt = await call("leadops.pushLeadsToPipeline", { leadIds: kontakte.map((item: { id: number }) => item.id), stage: "neu", target: "kaltakquise" }); expect(inKalt).toMatchObject({ moved: 3, switched: 1, assigned: 4 });
    const rows = getStore().tables.leads.filter((row) => row.listName === "Verteil-Mail");
    expect(rows.filter((row) => row.ownerUserId === taner.id)).toHaveLength(2); expect(rows.filter((row) => row.ownerUserId === francesco.id)).toHaveLength(2);
    expect(getStore().tables.pipelineEvents.some((event) => event.leadId === kontakte[1].id && /Anteil 50 % \(Kaltakquise\)/.test(String(event.note)))).toBe(true);
    expect(await call("leadops.pushLeadsToPipeline", { leadIds: kontakte.map((item: { id: number }) => item.id), stage: "kontaktiert", target: "kaltakquise" })).toMatchObject({ restaged: 4, assigned: 0 }); // schon zugeteilt → bleibt
    await call("leadops.savePipelineSettings", settings);
  });

  it("Gebietskarte: KI-Erkennung einer Datei (Demo über Regeln) – Kunden, PLZ, Orte, Umkreise, Kategorie je Spalte, Entwürfe je Kunde", async () => {
    const categories = await call("leadops.listCategories"); const pv = categories.find((category: { name: string }) => /photovoltaik/i.test(category.name)) ?? categories[0];
    const result = await call("leadops.analyzeTerritoryFile", { fileName: "kunden.xlsx", rows: [["Kunde", "Kategorie", "PLZ", "Ort", "Umkreis km"], ["Nordlicht", pv.name, "20095", "Hamburg", ""], ["", "", "20097", "", ""], ["Aurora", "", "", "Frankfurt am Main", "25"], ["Helios", "Gibt es nicht", "63065", "", ""]] });
    expect(result.source).toBe("regeln"); expect(result.plan.layout).toBe("zeilen"); expect(result.summary).toContain("Kunde:");
    expect(result.drafts.map((draft: { customerName: string; lines: string[] }) => [draft.customerName, draft.lines])).toEqual([["Nordlicht", ["20095", "Hamburg", "20097"]], ["Aurora", ["Frankfurt am Main 25 km Umkreis"]], ["Helios", ["63065"]]]);
    expect(result.drafts[0].categoryId).toBe(pv.id); expect(result.drafts[2].warnings[0]).toContain("Gibt es nicht");
    const spalten = await call("leadops.analyzeTerritoryFile", { fileName: "spalten.csv", rows: [["Nordlicht", "Aurora"], ["20095", "60311"], ["20097", "60313"]] });
    expect(spalten.plan.layout).toBe("kunden-als-spalten"); expect(spalten.drafts.map((draft: { customerName: string }) => draft.customerName)).toEqual(["Nordlicht", "Aurora"]);
    await expect(call("leadops.analyzeTerritoryFile", { rows: [[""]] })).rejects.toThrow("leer");
  });

  it("Upload umbenennen: zwei Dateien versehentlich unter demselben Listennamen – der zweite Upload wird zur eigenen Liste", async () => {
    await call("leadops.importColdList", { listName: "Trojaner M. PV", rows: [{ company: "Erste GmbH", phone: "+49 30 111" }] });
    const zweite = await call("leadops.importColdList", { listName: "Trojaner M. PV", rows: [{ company: "Zweite GmbH", phone: "+49 30 222" }, { company: "Dritte GmbH", phone: "+49 30 333" }] });
    const history = await call("leadops.listImportHistory", { limit: 50 });
    const upload = history.find((row: { listName: string; created: number }) => row.listName === "Trojaner M. PV" && row.created === 2);
    const result = await call("leadops.renameListImport", { id: upload.id, listName: "Eigene Kontakte" });
    expect(result).toMatchObject({ renamed: 2, from: "Trojaner M. PV", listName: "Eigene Kontakte" });
    const leadsOf = (name: string) => getStore().tables.leads.filter((row) => row.listName === name).map((row) => row.lastName ?? row.company);
    expect(leadsOf("Eigene Kontakte").sort()).toEqual(["Dritte GmbH", "Zweite GmbH"]); expect(leadsOf("Trojaner M. PV")).toEqual(["Erste GmbH"]);
    const overview = await call("leadops.pipelineOverview", { source: "kaltakquise" });
    expect(overview.campaigns.map((campaign: { campaignName: string }) => campaign.campaignName)).toEqual(expect.arrayContaining(["Liste: Trojaner M. PV", "Liste: Eigene Kontakte"]));
    expect(zweite.created).toBe(2);
  });

  it("E-Mail-Kampagne: mehrere hochgeladene Listen, „Liste hinzufügen“ nimmt Kontakte in die laufende Kampagne auf", async () => {
    const rows = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ firstName: `${prefix}${i}`, lastName: "Test", company: `${prefix} GmbH ${i}`, email: `${prefix.toLowerCase()}${i}@listen-test.de` }));
    await call("leadops.importColdList", { listName: "Messe Nord", categoryId: null, toPipeline: false, rows: rows("Nord", 3) });
    await call("leadops.importColdList", { listName: "Messe Süd", categoryId: null, toPipeline: false, rows: rows("Sued", 2) });
    await call("leadops.importColdList", { listName: "Messe West", categoryId: null, toPipeline: false, rows: rows("West", 4) });
    // Zwei Listen zugleich als Zielgruppe
    expect((await call("leadops.previewEmailAudience", { source: "liste", listName: "Messe Nord", listNames: ["Messe Nord", "Messe Süd"] })).count).toBe(5);
    const starter = await call("leadops.emailCampaignStarter", { kind: "kaltakquise" });
    const saved = await call("leadops.saveEmailCampaign", { id: null, name: "Messe-Serie", fromName: "T", fromEmail: "t@t.de", replyTo: null, audience: { source: "liste", listName: "Messe Nord", listNames: ["Messe Nord", "Messe Süd"] }, tree: starter.tree, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" } });
    expect((await call("leadops.startEmailCampaign", { id: saved.id })).added).toBe(5);
    // Laufende Kampagne: dritte Liste hinzufügen → sofort aufgenommen
    const result = await call("leadops.addListsToEmailCampaign", { id: saved.id, listNames: ["Messe West"] });
    expect(result.running).toBe(true); expect(result.added).toBe(4); expect(result.lists).toEqual(["Messe Nord", "Messe Süd", "Messe West"]);
    const detail = await call("leadops.getEmailCampaign", { id: saved.id });
    expect(detail.recipients).toHaveLength(9); expect(detail.recipients.filter((row: any) => row.lead?.listName === "Messe West")).toHaveLength(4);
    // Noch einmal dieselbe Liste: niemand doppelt
    const again = await call("leadops.addListsToEmailCampaign", { id: saved.id, listNames: ["Messe West"] }); expect(again.added).toBe(0); expect(again.skipped).toBe(4);
    // Entwurf: nur zur Zielgruppe, Aufnahme erst beim Start
    const draft = await call("leadops.saveEmailCampaign", { id: null, name: "Entwurf-Serie", fromName: "T", fromEmail: "t@t.de", replyTo: null, audience: { source: "alle" }, tree: starter.tree, design: {} });
    const drafted = await call("leadops.addListsToEmailCampaign", { id: draft.id, listNames: ["Messe Süd"] }); expect(drafted.running).toBe(false); expect(drafted.added).toBe(0);
    expect((await call("leadops.startEmailCampaign", { id: draft.id })).added).toBe(2);
    // Laufende Kampagne im Editor: Liste dazu → beim Speichern sofort aufgenommen
    const resaved = await call("leadops.saveEmailCampaign", { id: draft.id, name: "Entwurf-Serie", fromName: "T", fromEmail: "t@t.de", replyTo: null, audience: { source: "liste", listName: "Messe Süd", listNames: ["Messe Süd", "Messe Nord"] }, tree: starter.tree, design: {} });
    expect(resaved.enrolled).toBe(3); expect((await call("leadops.getEmailCampaign", { id: draft.id })).recipients).toHaveLength(5);
    // Neue Kontakte in eine Liste einer laufenden Kampagne → automatisch aufgenommen; „warten“-Zähler und „Jetzt aufnehmen“
    const more = await call("leadops.importColdList", { listName: "Messe Nord", categoryId: null, toPipeline: false, rows: [...rows("Nord", 3), { firstName: "Neu", lastName: "Kontakt", company: "Neu GmbH", email: "neu@listen-test.de" }, { firstName: "Ohne", lastName: "Mail", company: "Ohne GmbH", phone: "+49 30 123456" }] });
    expect(more.campaigns.map((row: any) => [row.name, row.added])).toEqual(expect.arrayContaining([["Entwurf-Serie", 1]]));
    const listed = (await call("leadops.listEmailCampaigns")).find((row: any) => row.id === draft.id); expect(listed.audienceInfo).toMatchObject({ pending: 0, noEmail: 1 });
    getStore().tables.emailCampaignRecipients.splice(0, getStore().tables.emailCampaignRecipients.length, ...getStore().tables.emailCampaignRecipients.filter((row) => !(row.campaignId === draft.id && row.email === "neu@listen-test.de")));
    expect((await call("leadops.getEmailCampaign", { id: draft.id })).audienceInfo.pending).toBe(1);
    expect((await call("leadops.syncEmailCampaignAudience", { id: draft.id })).added).toBe(1);
    expect((await call("leadops.getEmailCampaign", { id: draft.id })).audienceInfo.pending).toBe(0);
    // Liste entfernen → Empfänger dieser Liste sind wirklich raus; einzelner Empfänger entfernen
    const before = (await call("leadops.getEmailCampaign", { id: saved.id })).recipients.length;
    const removed = await call("leadops.removeListsFromEmailCampaign", { id: saved.id, listNames: ["Messe West"] }); expect(removed.removed).toBe(4); expect(removed.lists).toEqual(["Messe Nord", "Messe Süd"]);
    const afterRemove = await call("leadops.getEmailCampaign", { id: saved.id }); expect(afterRemove.recipients).toHaveLength(before - 4); expect(afterRemove.recipients.some((row: any) => row.lead?.listName === "Messe West")).toBe(false);
    expect((await call("leadops.removeEmailRecipients", { campaignId: saved.id, recipientIds: [afterRemove.recipients[0].id] })).removed).toBe(1);
    expect((await call("leadops.getEmailCampaign", { id: saved.id })).recipients).toHaveLength(before - 5);
    // Letzte Listen entfernen → Zielgruppe leer, niemals „alle Kontakte“
    await call("leadops.removeListsFromEmailCampaign", { id: saved.id, listNames: ["Messe Nord", "Messe Süd"] });
    const empty = await call("leadops.getEmailCampaign", { id: saved.id }); expect(empty.recipients).toHaveLength(0); expect(empty.audienceInfo).toMatchObject({ total: 0, pending: 0 });
    expect((await call("leadops.syncEmailCampaignAudience", { id: saved.id })).added).toBe(0);
    expect((await call("leadops.previewEmailAudience", { source: "liste", listName: null, listNames: [] })).count).toBe(0);
    // Einzelne Kontakte aus der Kontaktliste in eine Kampagne (auch Entwurf)
    const westLeads = (await call("leadops.emailLeads", { listName: "Messe West" })).items; expect(westLeads.length).toBeGreaterThanOrEqual(2);
    const one = await call("leadops.addLeadsToEmailCampaign", { id: saved.id, leadIds: [westLeads[0].id] }); expect(one).toMatchObject({ added: 1, already: 0 });
    expect((await call("leadops.getEmailCampaign", { id: saved.id })).recipients.map((row: any) => row.email)).toEqual([westLeads[0].email]);
    const draft2 = await call("leadops.saveEmailCampaign", { id: null, name: "Einzel-Entwurf", fromName: "T", fromEmail: "t@t.de", replyTo: null, audience: { source: "liste", listName: null, listNames: [] }, tree: starter.tree, design: {} });
    expect(await call("leadops.addLeadsToEmailCampaign", { id: draft2.id, leadIds: [westLeads[1].id] })).toMatchObject({ added: 1, status: "entwurf" });
    // Entwurf ohne Liste + von Hand aufgenommen → Zielgruppe „Nur ausgewählte Kontakte“: Zahlen passen zusammen, Start nimmt genau diese
    const picked = await call("leadops.getEmailCampaign", { id: draft2.id }); expect(picked.audience.source).toBe("auswahl"); expect(picked.audienceInfo).toMatchObject({ total: 1, picked: true, outside: 0 });
    expect((await call("leadops.previewEmailAudience", { source: "auswahl", campaignId: draft2.id })).count).toBe(1);
    expect((await call("leadops.previewEmailAudience", { source: "auswahl" })).count).toBe(0);
    // Alte Daten: Entwurf „Liste ohne Liste“ mit Empfängern wird beim Laden repariert
    getStore().tables.emailCampaigns.find((row) => row.id === draft2.id)!.audience = { source: "liste", listName: null, listNames: [] };
    expect((await call("leadops.listEmailCampaigns")).find((row: any) => row.id === draft2.id).audienceInfo).toMatchObject({ total: 1, picked: true });
    expect((await call("leadops.startEmailCampaign", { id: draft2.id })).added).toBe(1);
    expect((await call("leadops.getEmailCampaign", { id: draft2.id })).recipients).toHaveLength(1); // niemand kommt automatisch dazu
    await call("leadops.importColdList", { listName: "Messe West", categoryId: null, toPipeline: false, rows: [{ firstName: "Spaet", lastName: "Dran", company: "Spaet GmbH", email: "spaet@listen-test.de" }] });
    expect((await call("leadops.getEmailCampaign", { id: draft2.id })).recipients).toHaveLength(1);
    // Von Hand aufgenommene bleiben fest drin, auch wenn später Listen dazukommen: nie „nicht mehr in der Liste“, Start zählt sie mit
    const mix = await call("leadops.saveEmailCampaign", { id: null, name: "Mix", fromName: "T", fromEmail: "t@t.de", replyTo: null, audience: { source: "liste", listName: null, listNames: [] }, tree: starter.tree, design: {} });
    const suedLeads = (await call("leadops.emailLeads", { listName: "Messe Süd" })).items; expect(await call("leadops.addLeadsToEmailCampaign", { id: mix.id, leadIds: [suedLeads[0].id] })).toMatchObject({ added: 1 });
    expect((await call("leadops.getEmailCampaign", { id: mix.id })).recipients[0].picked).toBe(true);
    await call("leadops.addListsToEmailCampaign", { id: mix.id, listNames: ["Messe Nord"] }); // Liste dazu → Zielgruppe Liste, der Hand-Kontakt bleibt
    const mixed = (await call("leadops.listEmailCampaigns")).find((row: any) => row.id === mix.id); expect(mixed.audience.source).toBe("liste"); expect(mixed.audienceInfo).toMatchObject({ outside: 0, handPicked: 1 }); expect(mixed.audienceInfo.pending).toBeGreaterThan(0);
    const mixStart = await call("leadops.startEmailCampaign", { id: mix.id }); expect(mixStart.added).toBe(mixed.audienceInfo.pending + 1); expect(mixStart.skipped).toBe(0);
    // Entwurf ohne Liste und ohne Kontakte lässt sich nicht starten – mit klarem Hinweis
    const draft3 = await call("leadops.saveEmailCampaign", { id: null, name: "Leer", fromName: "T", fromEmail: "t@t.de", replyTo: null, audience: { source: "auswahl" }, tree: starter.tree, design: {} });
    await expect(call("leadops.startEmailCampaign", { id: draft3.id })).rejects.toThrow(/Noch keine Kontakte ausgewählt/);
  });

  it("E-Mail-Kampagne archivieren (Demo): läuft → beendet + archiviert, nimmt niemanden mehr auf, Automatik überspringt sie, Wiederherstellen", async () => {
    const seeded = (await call("leadops.listEmailCampaigns")).find((row: any) => row.name === "Elektriker NRW – Frühjahr");
    expect(seeded.archivedAt).toBeTruthy(); expect(seeded.status).toBe("beendet"); expect(seeded.stats.total).toBe(6); // Seed: abgeschlossene Kampagne im Archiv, Zahlen bleiben
    await call("leadops.importColdList", { listName: "Archiv-Test", categoryId: null, toPipeline: false, rows: [{ firstName: "Arne", lastName: "Archiv", company: "Archiv GmbH", email: "arne@archiv-test.de" }, { firstName: "Bea", lastName: "Box", company: "Box GmbH", email: "bea@archiv-test.de" }] });
    const starter = await call("leadops.emailCampaignStarter", { kind: "kaltakquise" });
    const saved = await call("leadops.saveEmailCampaign", { id: null, name: "Archiv-Serie", fromName: "T", fromEmail: "t@t.de", replyTo: null, audience: { source: "liste", listName: "Archiv-Test", listNames: ["Archiv-Test"] }, tree: starter.tree, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" } });
    expect((await call("leadops.startEmailCampaign", { id: saved.id })).added).toBe(2);
    // Laufende Kampagne archivieren → beendet, mit Datum; Empfänger und Zahlen bleiben
    const archived = await call("leadops.archiveEmailCampaign", { id: saved.id, archived: true }); expect(archived).toMatchObject({ archived: true, status: "beendet" });
    const row = (await call("leadops.listEmailCampaigns")).find((item: any) => item.id === saved.id); expect(row.archivedAt).toBeTruthy(); expect(row.status).toBe("beendet"); expect(row.stats.total).toBe(2);
    expect((await call("leadops.getEmailCampaign", { id: saved.id })).recipients).toHaveLength(2);
    // Archiviert nimmt niemanden mehr auf – weder von Hand noch durch Listen, Start oder Fortsetzen
    await expect(call("leadops.addListsToEmailCampaign", { id: saved.id, listNames: ["Archiv-Test"] })).rejects.toThrow(/Archiv/);
    await expect(call("leadops.startEmailCampaign", { id: saved.id })).rejects.toThrow(/Archiv/);
    await expect(call("leadops.setEmailCampaignStatus", { id: saved.id, status: "aktiv" })).rejects.toThrow(/Archiv/);
    const westLeads = (await call("leadops.emailLeads", { listName: "Archiv-Test" })).items; await expect(call("leadops.addLeadsToEmailCampaign", { id: saved.id, leadIds: [westLeads[0].id] })).rejects.toThrow(/Archiv/);
    // Automatik (Stufe → Kampagne) überspringt archivierte Kampagnen
    const settings = await call("leadops.pipelineSettings"); await call("leadops.savePipelineSettings", { ...settings, stageCampaigns: { ...(settings.stageCampaigns ?? {}), angebot: saved.id } });
    const lead = (await call("leadops.emailLeads", { listName: "Archiv-Test" })).items[1]; const moved = await call("leadops.movePipelineStage", { publicId: lead.publicId, stage: "angebot" });
    expect((await call("leadops.getEmailCampaign", { id: saved.id })).recipients).toHaveLength(2); expect(moved.series ?? null).toBeNull();
    // Noch einmal archivieren ändert nichts; Vorlagen gehen nicht
    expect(await call("leadops.archiveEmailCampaign", { id: saved.id, archived: true })).toMatchObject({ archived: true });
    const template = (await call("leadops.listEmailCampaigns")).find((item: any) => item.isTemplate); await expect(call("leadops.archiveEmailCampaign", { id: template.id, archived: true })).rejects.toThrow(/Vorlagen/);
    // Wiederherstellen: zurück in die Übersicht, bleibt beendet, „Weiterer Durchlauf“/Starten geht wieder
    expect(await call("leadops.archiveEmailCampaign", { id: saved.id, archived: false })).toMatchObject({ archived: false, status: "beendet" });
    const back = (await call("leadops.listEmailCampaigns")).find((item: any) => item.id === saved.id); expect(back.archivedAt).toBeNull(); expect(back.status).toBe("beendet");
    expect((await call("leadops.addListsToEmailCampaign", { id: saved.id, listNames: ["Archiv-Test"] })).running).toBe(true);
  });

  it("Verträge (Demo): anlegen, senden, Kundenansicht, unterschreiben mit Nachweis, PDF, Vorlage, Stornieren", async () => {
    const seeded = await call("leadops.listContracts"); expect(seeded.length).toBe(3); expect(seeded.filter((row: any) => row.status === "unterschrieben")).toHaveLength(1);
    const signed = await call("leadops.getContract", { id: seeded.find((row: any) => row.status === "unterschrieben").id }); expect(signed.signatureImage).toMatch(/^data:image\/png/); expect(signed.events.map((event: any) => event.kind)).toEqual(["erstellt", "gesendet", "angesehen", "unterschrieben"]);
    const defaults = await call("leadops.contractDefaults"); expect(defaults.starter.blocks.some((block: any) => block.type === "signature" && block.party === "kunde")).toBe(true); expect(defaults.values.anbieterFirma).toContain("Tanesco");
    expect(defaults.starters.map((starter: any) => starter.kind)).toEqual(["leadliefervertrag", "testphase", "leer"]); expect(defaults.starter.blocks.some((block: any) => block.type === "field")).toBe(false); // Kunde füllt nichts aus
    const withDetails = (preis: string) => [...defaults.starter.blocks.map((block: any) => block.type === "detail" ? { ...block, value: block.key === "preis" ? preis : block.value || "Hessen" } : block), { id: "bUst", type: "field", key: "ustid", label: "USt-IdNr.", required: true }];
    const saved = await call("leadops.saveContract", { id: null, title: "Testvertrag", blocks: withDetails(""), values: { firma: "Test GmbH", name: "Tina Test", email: "tina@test.example", anbieterVertreter: "Taner" }, recipientEmail: "tina@test.example", recipientName: "Tina Test" });
    expect(saved.number).toMatch(/^V-\d{4}-0004$/);
    const draft = await call("leadops.getContract", { id: saved.id }); expect(draft.status).toBe("entwurf"); expect(draft.values.anbieterFirma).toContain("Tanesco"); expect(draft.values.firma).toBe("Test GmbH");
    const preview = await call("leadops.contractPreviewHtml", { id: saved.id, title: draft.title, blocks: draft.blocks, values: draft.ownValues }); expect(preview.html).toContain("Test GmbH"); expect(preview.html).toContain("füllt der Kunde aus"); expect(preview.html).toContain("noch eintragen");
    await expect(call("leadops.sendContract", { id: saved.id, recipientEmail: "tina@test.example" })).rejects.toThrow(/Preis je Lead/);
    await call("leadops.saveContract", { id: saved.id, title: "Testvertrag", blocks: withDetails("79 €"), values: { firma: "Test GmbH", name: "Tina Test", email: "tina@test.example", anbieterVertreter: "Taner" } });
    await expect(call("leadops.sendContract", { id: saved.id, recipientEmail: "kaputt" })).rejects.toThrow(/E-Mail/);
    const sent = await call("leadops.sendContract", { id: saved.id, recipientEmail: "tina@test.example", recipientName: "Tina Test", message: "Bitte prüfen" }); expect(sent.token).toHaveLength(48);
    const open = await call("leadops.getContract", { id: saved.id }); expect(open.status).toBe("gesendet"); expect(open.documentHash).toHaveLength(64);
    await expect(call("leadops.saveContract", { id: saved.id, title: "x", blocks: draft.blocks })).rejects.toThrow(/Kopie/); // gesendet = eingefroren
    const customer = await call("leadops.contractPreviewHtml", { id: saved.id, title: draft.title, blocks: draft.blocks, values: draft.ownValues }); expect(customer.html).toContain("Jetzt unterschreiben"); expect(customer.html).toContain(`data-token="${sent.token}"`); expect(customer.html).toContain('data-embedded="1"');
    // Unterschrift: Pflichtfelder, Name, Bild – danach Nachweis mit Prüfsummen
    await expect(call("leadops.signContractDemo", { token: sent.token, signerName: "Tina Test", fields: {}, signatureImage: "data:image/png;base64,iVBORw0KGgo=", method: "zeichnen" })).rejects.toThrow(/Bitte ausfüllen/);
    const ok = await call("leadops.signContractDemo", { token: sent.token, signerName: "Tina Test", fields: { ustid: "DE123456789" }, signatureImage: "data:image/png;base64,iVBORw0KGgo=", method: "zeichnen" }); expect(ok.success).toBe(true);
    const done = await call("leadops.getContract", { id: saved.id }); expect(done.status).toBe("unterschrieben"); expect(done.signerIp).toBeTruthy(); expect(done.signatureHash).toHaveLength(64); expect(done.values.ustid).toBe("DE123456789"); expect(done.blocks.find((block: any) => block.key === "preis").value).toBe("79 €"); expect(done.events.map((event: any) => event.kind)).toContain("unterschrieben");
    const proof = await call("leadops.contractPreviewHtml", { id: saved.id, title: done.title, blocks: done.blocks, values: done.ownValues }); expect(proof.html).toContain("Der Preis je geliefertem Lead beträgt 79 €"); expect(proof.html).toContain("Nachweis der elektronischen Unterschrift"); expect(proof.html).toContain(done.signatureHash);
    const pdf = await call("leadops.contractPdf", { id: saved.id }); expect(atob(pdf.base64).startsWith("%PDF")).toBe(true); expect(pdf.fileName).toContain(saved.number);
    await expect(call("leadops.deleteContract", { id: saved.id })).rejects.toThrow(/stornieren/);
    // Kunde aus den Kontakten wählen; eigene Unterschrift wird bei der Kopie entfernt
    const options = await call("leadops.contractLeadOptions", { query: "" }); expect(options.length).toBeGreaterThan(0); const someone = options.find((row: any) => row.company) ?? options[0];
    expect((await call("leadops.contractLeadOptions", { query: String(someone.company || someone.name).slice(0, 5) })).some((row: any) => row.id === someone.id)).toBe(true);
    const fromLead = await call("leadops.contractValuesFromLead", { leadId: someone.id }); expect(fromLead.firma).toBe(someone.company);
    const signedOwn = withDetails("70 €").map((block: any) => block.type === "signature" && block.party === "anbieter" ? { ...block, image: "data:image/png;base64,AAAA", signedName: "Taner Yilmaz", signedAt: new Date().toISOString() } : block);
    const own = await call("leadops.saveContract", { id: null, title: "Mit eigener Unterschrift", blocks: signedOwn, values: { firma: someone.company }, leadId: someone.id });
    const ownView = await call("leadops.contractPreviewHtml", { id: own.id, title: "Mit eigener Unterschrift", blocks: signedOwn, values: { firma: someone.company } }); expect(ownView.html).toContain("Taner Yilmaz"); expect(ownView.html).not.toContain("Noch nicht unterschrieben");
    const ownCopy = await call("leadops.duplicateContract", { id: own.id }); expect((await call("leadops.getContract", { id: ownCopy.id })).blocks.find((block: any) => block.type === "signature" && block.party === "anbieter").image).toBeFalsy();
    // KI-Vertrag: in der Chat-Demo ohne KI-Anbindung → passende Vorlage nach Stichworten
    const ai = await call("leadops.draftContractAi", { prompt: "Testphase für PV-Leads über 4 Wochen, die ersten 10 kostenlos" }); expect(ai.source).toBe("vorlage"); expect(ai.title).toContain("Testphase"); expect(ai.blocks.some((block: any) => block.type === "detail" && block.key === "dauer")).toBe(true);
    await expect(call("leadops.draftContractAi", { prompt: "kurz" })).rejects.toThrow(/beschreibe/);
    // Vorlage speichern und Kopie anlegen
    const template = await call("leadops.saveContractTemplate", { name: "Meine Vorlage", title: "Testvertrag", blocks: draft.blocks }); expect((await call("leadops.listContractTemplates")).some((row: any) => row.id === template.id)).toBe(true);
    const copy = await call("leadops.duplicateContract", { id: saved.id }); expect((await call("leadops.getContract", { id: copy.id })).status).toBe("entwurf");
    // Ablehnen und stornieren
    const second = await call("leadops.saveContract", { id: null, title: "Zweiter", blocks: withDetails("80 €"), values: { firma: "Zwei GmbH" } }); const sent2 = await call("leadops.sendContract", { id: second.id, recipientEmail: "zwei@test.example" });
    await call("leadops.declineContractDemo", { token: sent2.token, reason: "Preis zu hoch" }); expect((await call("leadops.getContract", { id: second.id })).declineReason).toBe("Preis zu hoch");
    const third = await call("leadops.saveContract", { id: null, title: "Dritter", blocks: withDetails("80 €"), values: {} }); await call("leadops.sendContract", { id: third.id, recipientEmail: "drei@test.example" }); await call("leadops.cancelContract", { id: third.id }); expect((await call("leadops.getContract", { id: third.id })).status).toBe("storniert");
  });

  it("Pipeline-Notiz bearbeiten: Text ändern, leer ablehnen", async () => {
    const overview = await call("leadops.pipelineOverview", { source: "kaltakquise" }); const lead = overview.stages.flatMap((stage: any) => stage.leads)[0];
    await call("leadops.addPipelineNote", { publicId: lead.publicId, text: "Erst Tippfeler", source: "text" });
    const note = (await call("leadops.listPipelineNotes", { publicId: lead.publicId })).find((row: any) => row.text === "Erst Tippfeler");
    await call("leadops.updatePipelineNote", { id: note.id, text: "Ohne Tippfehler" });
    expect((await call("leadops.listPipelineNotes", { publicId: lead.publicId })).some((row: any) => row.id === note.id && row.text === "Ohne Tippfehler")).toBe(true);
    await expect(call("leadops.updatePipelineNote", { id: note.id, text: "   " })).rejects.toThrow(/leer/);
  });

  it("Kontakt von Hand anlegen (Demo) – landet in der gewählten Stufe, Doppelte abgelehnt", async () => {
    const created = await call("leadops.createPipelineContact", { source: "kaltakquise", firstName: "Erika", lastName: "Demo", phone: "+49 89 1112233", stage: "neu", note: "Erste Notiz" });
    const board = await call("leadops.pipelineOverview", { source: "kaltakquise" });
    expect(board.stages.find((stage: any) => stage.key === "neu").leads.some((lead: any) => lead.publicId === created.publicId)).toBe(true);
    await expect(call("leadops.createPipelineContact", { source: "kaltakquise", firstName: "Zwilling", phone: "089 1112233" })).rejects.toThrow(/gibt es schon/);
  });

  it("Eigene Pipeline (Demo): anlegen, Liste hochladen, Karte verschieben, löschen", async () => {
    const created = await call("leadops.createCustomPipeline", { label: "Empfehlungen" });
    await call("leadops.importColdList", { pipeline: created.key, listName: "Empfehlungen Okt", categoryId: null, rows: [{ firstName: "Eva", lastName: "Empfohlen", phone: "+49 69 4440001" }] });
    const board = await call("leadops.pipelineOverview", { source: created.key }); const card = board.stages.flatMap((stage: any) => stage.leads)[0]; expect(card.name).toBe("Eva Empfohlen");
    expect((await call("leadops.moveLeadsToPipeline", { publicIds: [card.publicId], target: "kaltakquise" })).moved).toBe(1);
    expect((await call("leadops.pipelineOverview", { source: created.key })).stages.flatMap((stage: any) => stage.leads)).toHaveLength(0);
    expect((await call("leadops.deleteCustomPipeline", { key: created.key })).label).toBe("Empfehlungen");
    expect((await call("leadops.pipelineSettings")).customPipelines).toEqual([]);
  });

  it("Kontakt sperren (Demo): Sperrliste „Manuell“, Serie stoppt, Lead-Seite und Kontakte zeigen es, Sperre aufheben", async () => {
    const lead = getStore().tables.leads.find((row) => row.kind === "vertrieb" && row.email && getStore().tables.emailCampaignRecipients.some((item) => item.leadId === row.id && (item.status === "wartet" || item.status === "laeuft")))!;
    const result = await call("leadops.blockLeads", { leadIds: [lead.id], note: "Wettbewerber" });
    expect(result).toMatchObject({ blocked: 1, skipped: 0 }); expect(result.stopped).toBeGreaterThanOrEqual(1);
    expect(getStore().tables.emailSuppressions.find((row) => row.email === String(lead.email).toLowerCase())).toMatchObject({ reason: "manuell", note: "Wettbewerber" });
    expect((await call("leadops.pipelineLeadDetail", { publicId: lead.publicId })).suppression).toMatchObject({ reason: "manuell", label: "Von Hand gesperrt" });
    const blocked = await call("leadops.emailLeads", { blocked: true, withoutEmail: true }); expect(blocked.items.some((row: any) => row.id === lead.id && row.blocked && row.blockedNote === "Wettbewerber")).toBe(true);
    expect(getStore().tables.pipelineEvents.some((row) => row.leadId === lead.id && /gesperrt/.test(String(row.note)))).toBe(true);
    expect((await call("leadops.unblockLeads", { leadIds: [lead.id] })).unblocked).toBe(1);
    expect((await call("leadops.pipelineLeadDetail", { publicId: lead.publicId })).suppression).toBeNull();
  });

  it("Posteingang: mehrere Mails auswählen – gelesen, archivieren, sperren, löschen", async () => {
    const ids = getStore().tables.inboxMessages.filter((row) => !row.blocked && !row.archived).slice(0, 3).map((row) => row.id);
    expect((await call("leadops.inboxBulkAction", { ids, action: "ungelesen" })).count).toBe(3); expect(getStore().tables.inboxMessages.filter((row) => ids.includes(row.id)).every((row) => !row.isRead)).toBe(true);
    expect((await call("leadops.inboxBulkAction", { ids: ids.slice(0, 1), action: "archivieren" })).count).toBe(1); expect(getStore().tables.inboxMessages.find((row) => row.id === ids[0])?.archived).toBe(true);
    expect((await call("leadops.inboxBulkAction", { ids: ids.slice(1, 2), action: "sperren" })).count).toBe(1); expect(getStore().tables.inboxMessages.find((row) => row.id === ids[1])?.blocked).toBe(true);
    expect((await call("leadops.inboxBulkAction", { ids, action: "loeschen" })).count).toBe(3); expect(getStore().tables.inboxMessages.some((row) => ids.includes(row.id))).toBe(false);
  });
});
