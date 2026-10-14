import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { callProcedure, getStore, resetStore } from "../backend";
import { localDemoLink } from "../link";

const call = (path: string, input?: unknown) => callProcedure(path, input);
const ignorable = [/not wrapped in act/, /Warning: /, /validateDOMNesting/, /act\(/];

describe("Mutationen des Chat-Builds (minimale Eingaben wie im Client)", () => {
  beforeAll(() => resetStore());

  it("führt einen realistischen Arbeitsablauf ohne Fehler aus", async () => {
    const categories = (await call("leadops.listCategories")) as any[];
    const suppliers = (await call("leadops.listSuppliers")) as any[];
    const members = (await call("leadops.listMembers")) as any[];
    const leads = (await call("leadops.listLeadsPaged", { page: 1, pageSize: 25 })) as any;
    expect(categories.length).toBeGreaterThan(1); expect(leads.rows.length).toBeGreaterThan(5);
    const cat = categories[0]; const cat2 = categories[1]; const lead = leads.rows[0]; const lead2 = leads.rows[1]; const lead3 = leads.rows[2];
    const pid = (row: any) => row.publicId ?? row.id;

    // Leads
    const imported = await call("leadops.importLead", { categoryId: cat.id, firstName: "Test", lastName: "Person", email: "test.person@example.de", phone: "+49 30 1234567", postcode: "10115", city: "Berlin" }) as any;
    expect(imported).toBeTruthy();
    const batch = await call("leadops.startLeadImportBatch", { categoryId: cat.id, fileName: "import.csv", totalRows: 2 }) as any;
    await call("leadops.finishLeadImportBatch", { batchId: batch.batchId ?? batch.id, leadPublicIds: [imported.publicId ?? imported.lead?.publicId].filter(Boolean), importedRows: 1, errorRows: 1 });
    await call("leadops.listLeadImportBatches");
    await call("leadops.undoLeadImportBatch", { batchId: batch.batchId ?? batch.id });
    await call("leadops.updateLeadStatus", { publicId: pid(lead), status: "genehmigt" });
    await call("leadops.duplicateLeads", { publicIds: [pid(lead2)] });
    await call("leadops.deactivateLeads", { publicIds: [pid(lead3)] });
    expect(typeof (await call("leadops.exportSelectedLeadsCsv", { publicIds: [pid(lead), pid(lead2)] }))).toBe("string");
    expect(typeof (await call("leadops.exportLeadsCsv", {}))).toBe("string");
    await call("leadops.assignLeadsToSupplier", { publicIds: [pid(lead)], supplierId: suppliers[0].id });
    await call("leadops.assignLeadsToMember", { publicIds: [pid(lead)], userId: members[0].userId ?? members[0].user?.id ?? 1 });
    const rules = (await call("leadops.listAutomationRules")) as any[];
    await call("leadops.assignLeadsToAutomation", { publicIds: [pid(lead)], ruleId: rules[0].id });
    const chains = (await call("leadops.listDeliveryChains")) as any[];
    await call("leadops.assignLeadsToDeliveryChain", { publicIds: [pid(lead)], chainId: chains[0].id });
    const orders = (await call("leadops.listOrders")) as any[];
    await call("leadops.assignLeadsToOrder", { publicIds: [pid(lead)], orderId: (orders.find((order) => order.status === "aktiv" || order.status === "offen") ?? orders[0]).id });
    await call("leadops.getLeadAuditLog", { publicId: pid(lead) });
    await call("leadops.listLeadDeliveries", { publicId: pid(lead) });
    const delivered = await (call("leadops.deliverLead", { publicId: pid(lead2) }) as Promise<any>).catch((error: Error) => { expect(error.message).toMatch(/bereits an|Dublettenschutz|Keine aktive Lieferkette/); return { buyerName: "bereits ausgeliefert" }; });
    expect(delivered.buyerName).toBeTruthy();
    await call("leadops.runLeadAutomation", { publicId: pid(lead), triggerType: rules[0].triggerType ?? "lead_erstellt" }).catch(() => undefined);
    await call("leadops.globalSearch", { query: "Berlin" });
    await call("leadops.search", { query: "Berlin" }).catch(() => undefined);

    // Kategorien
    const created = await call("leadops.createCategory", { shortcode: "TEST", name: "Testkategorie" }) as any;
    const newCat = ((await call("leadops.listCategories")) as any[]).find((row) => row.shortcode === "TEST");
    expect(newCat).toBeTruthy();
    const field = await call("leadops.addCategoryField", { categoryId: newCat.id, label: "Dachfläche", fieldKey: "dachflaeche", fieldType: "zahl" }) as any;
    const fields = (await call("leadops.listCategoryFields", { categoryId: newCat.id })) as any[];
    expect(fields.length).toBeGreaterThan(0);
    await call("leadops.updateCategoryField", { id: fields[0].id, required: true });
    await call("leadops.addCategoryField", { categoryId: newCat.id, label: "Heizung", fieldKey: "heizung", fieldType: "auswahl", options: ["Gas", "Öl"] });
    await call("leadops.moveCategoryField", { id: fields[0].id, direction: "down" });
    await call("leadops.addCategoryFieldMapping", { categoryId: newCat.id, sourceField: "plz", targetFieldKey: "dachflaeche", mode: "uebernehmen" });
    const mappings = (await call("leadops.listCategoryFieldMappings", { categoryId: newCat.id })) as any[];
    await call("leadops.deleteCategoryFieldMapping", { id: mappings[0].id });
    await call("leadops.deleteCategoryField", { id: fields[0].id });
    await call("leadops.updateCategory", { id: newCat.id, name: "Testkategorie 2", marketplaceEnabled: true });
    await call("leadops.createCategoryTemplate", { sourceCategoryId: newCat.id, shortcode: "TEST-VORLAGE", name: "Testvorlage" });
    const templates = (await call("leadops.listCategoryTemplates")) as any[];
    expect(templates.length).toBeGreaterThan(0);
    await call("leadops.createPvCategoryTemplate");
    await call("leadops.createHeatPumpCategoryTemplate");
    await call("leadops.deactivateCategory", { id: newCat.id });
    await call("leadops.createCategoryFromBuilder", { draft: { name: "Builder-Kategorie", shortcode: "BLD", description: "Aus dem Builder", fields: [{ label: "Baujahr", fieldKey: "baujahr", fieldType: "zahl", required: false, options: [] }] } }).catch((error) => { throw new Error(`createCategoryFromBuilder: ${error.message}`); });
    void created;

    // Organisation
    const supplier = await call("leadops.createSupplier", { name: "Neuer Lieferant" }) as any;
    await call("leadops.updateSupplier", { id: supplier.id ?? suppliers[0].id, status: "inaktiv" });
    const profile = await call("leadops.createOrganizationProfile", { partnerType: "käufer", name: "Neuer Käufer" }) as any;
    const profiles = (await call("leadops.listOrganizationProfiles")) as any[];
    const newProfile = profiles.find((row) => row.name === "Neuer Käufer") ?? profiles[0];
    await call("leadops.updateOrganizationProfile", { id: newProfile.id, email: "kaeufer@example.de" });
    await call("leadops.getOrganizationProfileDependencies", { id: newProfile.id });
    await call("leadops.deleteOrganizationProfile", { id: newProfile.id });
    await call("leadops.listArchivedOrganizationProfiles");
    await call("leadops.restoreOrganizationProfile", { id: newProfile.id });
    await call("leadops.deleteOrganizationProfile", { id: newProfile.id });
    await call("leadops.permanentlyDeleteOrganizationProfile", { id: newProfile.id });
    void profile;
    const team = await call("leadops.createTeam", { name: "Team Nord" }) as any;
    const teams = (await call("leadops.listTeams")) as any[];
    const newTeam = teams.find((row) => row.name === "Team Nord") ?? teams[0];
    await call("leadops.updateTeam", { id: newTeam.id, description: "Norddeutschland" });
    const products = (await call("leadops.listProducts")) as any[];
    await call("leadops.setTeamProductAssignment", { teamId: newTeam.id, productId: products[0].id, assigned: true });
    await call("leadops.getTeamDetail", { teamId: newTeam.id });
    void team;
    await call("leadops.createTag", { name: "VIP" });
    const tags = (await call("leadops.listTags")) as any[];
    const vip = tags.find((row) => row.name === "VIP");
    expect(vip?.color).toBeTruthy();
    await call("leadops.updateTag", { id: vip.id, name: "VIP+" });
    await call("leadops.assignLeadTag", { publicId: pid(lead), tagId: vip.id });
    await call("leadops.listLeadTags", { publicId: pid(lead) });
    await call("leadops.removeLeadTag", { publicId: pid(lead), tagId: vip.id });
    const invite = await call("leadops.inviteUser", { email: "neu@example.de" }) as any;
    expect(invite.token?.length).toBeGreaterThan(19);
    const invitations = (await call("leadops.listInvitations")) as any[];
    expect(invitations.length).toBeGreaterThan(0);
    await call("leadops.acceptInvitation", { token: invite.token });
    const invite2 = await call("leadops.inviteUser", { email: "neu2@example.de", role: "manager", partnerType: "käufer" }) as any;
    await call("leadops.revokeInvitation", { id: invitations[0].id }).catch(() => undefined);
    void invite2;
    const memberships = (await call("leadops.listMembers")) as any[];
    await call("leadops.updateMembership", { id: memberships[1].membershipId ?? memberships[1].id, role: "vertrieb" });
    await call("leadops.getMemberOperationalSettings", { membershipId: memberships[1].membershipId ?? memberships[1].id });
    await call("leadops.updateMemberOperationalSettings", { membershipId: memberships[1].membershipId ?? memberships[1].id, emailNotifications: true, paymentMode: "standard", deliveryPaused: false, claimRefundMode: "standard", prepaidBalance: 100, uiRestricted: false });
    await call("leadops.updateNavigationPreferences", { hiddenPages: ["Rechnungen"] });
    await call("leadops.acceptTerms", { version: "2026-01" });
    await call("leadops.listTermsAcceptances");
    await call("leadops.updateTenantSettings", { leadDeactivationHours: 48, distributionOrder: "lifo" });
    await call("leadops.updateTenantBranding", { name: "Tanesco Leads Demo", primaryColor: "#8B5CF6" });
    await call("leadops.getTenantSettings");
    await call("leadops.createReclamationReason", { name: "Nicht erreichbar" });
    const reasons = (await call("leadops.listReclamationReasons")) as any[];
    await call("leadops.updateReclamationReason", { id: reasons[0].id, active: false });
    const token = await call("leadops.createApiToken", { name: "Zapier", scopes: ["leads:write"] }) as any;
    expect(token.token).toBeTruthy();
    const tokens = (await call("leadops.listApiTokens")) as any[];
    await call("leadops.rotateApiToken", { id: tokens[0].id });
    await call("leadops.revokeApiToken", { id: tokens[0].id });

    // Integrationen & Kooperationen
    await call("leadops.installStandardIntegrationTemplates");
    const integration = await call("leadops.createPartnerIntegration", { provider: "webhook", name: "Neuer Webhook", callbackUrl: "https://example.de/hook" }) as any;
    const integrations = (await call("leadops.listPartnerIntegrations")) as any[];
    const hook = integrations.find((row) => row.name === "Neuer Webhook") ?? integrations[0];
    await call("leadops.setPartnerIntegrationCredential", { id: hook.id, secret: "geheim-123" });
    await call("leadops.updatePartnerIntegration", { id: hook.id, status: "aktiv" });
    await call("leadops.recordIntegrationEvent", { integrationId: hook.id, eventType: "geliefert", amount: 45 });
    await call("leadops.exportLeadToPartnerIntegration", { integrationId: hook.id, publicId: pid(lead) });
    await call("leadops.sendIntegrationTestLead", { integrationId: hook.id, categoryId: cat.id });
    void integration;
    await call("leadops.createCooperation", { partnerTenantName: "Partner GmbH" });
    const cooperations = (await call("leadops.listCooperations")) as any[];
    const coop = cooperations.find((row) => row.partnerTenantName === "Partner GmbH") ?? cooperations[0];
    await call("leadops.updateCooperationStatus", { id: coop.id, status: "aktiv" });
    await call("leadops.updateCooperation", { id: coop.id, partnerTenantName: "Partner AG", direction: "beidseitig" });
    await call("leadops.setCooperationCategoryMapping", { cooperationId: coop.id, sourceCategoryId: cat.id, partnerCategoryName: "Solar" });
    await call("leadops.setCooperationFieldMapping", { cooperationId: coop.id, sourceField: "email", partnerField: "mail" });

    // Bestellungen & Lieferketten
    const order = await call("leadops.createOrder", { buyerName: "Neuer Käufer", categoryId: cat.id, quantity: 10, unitPrice: 55 }) as any;
    expect(order.orderId).toBeTruthy();
    await call("leadops.updateOrderStatus", { id: order.orderId, status: "aktiv" });
    const workspace = await call("leadops.getOrderWorkspace", { orderId: order.orderId }) as any;
    expect(workspace.config).toBeTruthy();
    await call("leadops.saveOrderWorkspace", { orderId: order.orderId, name: "Bestellung Nord", buyerName: "Neuer Käufer", categoryId: cat.id, categoryIds: [cat.id, cat2.id], quantity: 12, unitPrice: 60, supplierMode: "alle", supplierIds: [], buyerUserId: null, deliveryInterval: "täglich", compensateClaims: false, priority: 2, realtimeDelivery: true, startsAt: null, endsAt: null, ongoing: true, deliveryDays: ["Montag"], deliveryArea: "landesweit", pauses: null, advancedFilters: null });
    await call("leadops.setOrderWorkspaceActive", { orderId: order.orderId, active: false });
    await call("leadops.orderDeliveryStatistics");
    const chain = await call("leadops.createDeliveryChain", { categoryId: cat.id, name: "Kette Süd", orderId: order.orderId }) as any;
    const allChains = (await call("leadops.listDeliveryChains")) as any[];
    const newChain = allChains.find((row) => row.name === "Kette Süd") ?? allChains[0];
    await call("leadops.updateDeliveryChain", { id: newChain.id, priority: 5 });
    await call("leadops.addDeliveryStop", { chainId: newChain.id, buyerName: "Stopp 1", position: 1, unitPrice: 40 });
    const detailChain = ((await call("leadops.listDeliveryChains")) as any[]).find((row) => row.id === newChain.id);
    await call("leadops.updateDeliveryStop", { id: detailChain.stops[0].id, active: false });
    await call("leadops.getDeliveryChainMetrics", { chainId: newChain.id }).catch(() => undefined);
    void chain;
    await call("leadops.deleteOrder", { orderId: order.orderId });

    // Automatisierung
    await call("leadops.createAutomationRule", { name: "Regel Test", triggerType: rules[0].triggerType ?? "lead_erstellt", sourceCategoryId: cat.id, targetCategoryId: cat2.id, conditions: [] });
    const allRules = (await call("leadops.listAutomationRules")) as any[];
    const rule = allRules.find((row) => row.name === "Regel Test") ?? allRules[0];
    await call("leadops.updateAutomationRule", { id: rule.id, status: "pausiert" });
    await call("leadops.listAutomationExecutionLogs");
    await call("leadops.deleteAutomationRule", { id: rule.id });

    // Marktplatz & Reklamationen & Support
    const claims = (await call("leadops.listClaims")) as any[];
    await call("leadops.createClaim", { leadId: claims[0].leadId, reason: "Falsche Nummer" });
    const openClaim = ((await call("leadops.listClaims")) as any[]).find((row) => row.status === "offen");
    await call("leadops.updateClaimDeadline", { claimId: openClaim.id, dueAt: new Date(Date.now() + 86400000) });
    await call("leadops.listClaimEvents", { claimId: openClaim.id });
    await call("leadops.resolveClaim", { claimId: openClaim.id, status: "genehmigt" });
    const remaining = ((await call("leadops.listClaims")) as any[]).filter((row) => row.status === "offen" || row.status === "in_prüfung").map((row) => row.id);
    if (remaining.length) await call("leadops.bulkResolveClaims", { claimIds: remaining, status: "abgelehnt" });
    await call("leadops.createTicket", { subject: "Frage zur API", requesterName: "Max Muster" });
    const tickets = (await call("leadops.listTickets")) as any[];
    await call("leadops.updateTicketStatus", { id: tickets[0].id, status: "gelöst" });

    // Commerce & E-Mails
    await call("leadops.createProduct", { name: "Premium-Lead", price: 90 });
    const allProducts = (await call("leadops.listProducts")) as any[];
    const product = allProducts.find((row) => row.name === "Premium-Lead") ?? allProducts[0];
    await call("leadops.updateProduct", { id: product.id, status: "inaktiv" });
    await call("leadops.getProductOperationalConfig", { productId: product.id });
    await call("leadops.updateProductOperationalConfig", { productId: product.id, minQuantity: 1, maxQuantity: null, geoRequired: false });
    await call("leadops.createInvoice", { recipientName: "Kunde AG", amount: 1200 });
    const invoices = (await call("leadops.listInvoices")) as any[];
    await call("leadops.updateInvoiceStatus", { id: invoices[0].id, status: "bezahlt" });
    await call("leadops.createEmailTemplate", { name: "Willkommen", subject: "Willkommen bei Tanesco", bodyHtml: "<p>Hallo</p>" });
    const emailTemplates = (await call("leadops.listEmailTemplates")) as any[];
    await call("leadops.updateEmailTemplate", { id: emailTemplates[0].id, status: "aktiv" });
    await call("leadops.recordEmailEvent", { templateId: emailTemplates[0].id, recipientEmail: "kunde@example.de", subject: "Willkommen" });
    await call("leadops.listEmailEvents");

    // Löschen
    await call("leadops.deleteLeads", { publicIds: [pid(lead3)], reason: "Test" });
    await call("leadops.deleteCategoryTemplate", { id: templates[0].id });
    await call("leadops.deleteCategory", { id: newCat.id }).catch(() => undefined);

    // Abschließende Lesezugriffe
    await call("leadops.dashboard"); await call("leadops.statistics", {}); await call("leadops.statisticsDetails", {}); await call("leadops.hourlyDeliverySeries", {});
    await call("leadops.tenantContext"); await call("system.health"); await call("auth.me"); await call("auth.logout");
    expect(getStore().tables.leads.length).toBeGreaterThan(10);
  });

  describe("Seiten nach den Mutationen", () => {
    const errors: string[] = [];
    beforeAll(() => { vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { const text = args.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : String(arg))).join(" "); if (!ignorable.some((pattern) => pattern.test(text))) errors.push(text); }); });
    afterAll(() => { vi.restoreAllMocks(); });
    for (const route of ["page=Dashboard", "page=Statistik", "page=Leads", "page=Lead-Kategorien", "page=Tags", "page=Bestellungen", "page=Automatisierung", "page=Reklamationen", "page=Teams", "page=Benutzer", "page=Integrationen", "page=Kooperationen", "page=Support", "page=E-Mails", "page=Marktplatz", "page=Produkte", "page=Käufe", "page=Rechnungen", "page=Einstellungen"]) {
      it(`rendert ${route} mit veränderten Daten`, async () => {
        errors.length = 0;
        window.history.replaceState(null, "", `/?${route}`);
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const client = trpc.createClient({ links: [localDemoLink()] });
        const view = render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
        for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
        const failed = queryClient.getQueryCache().getAll().filter((query) => query.state.status === "error").map((query) => `${JSON.stringify(query.queryKey)} → ${(query.state.error as Error)?.message}`);
        expect(failed).toEqual([]);
        expect(view.container.innerHTML).not.toContain("An unexpected error occurred");
        expect(errors).toEqual([]);
        cleanup();
      });
    }
  });
});
