/**
 * Ende-zu-Ende-Prüfung der Server-Logik (server/routers.ts + server/publicApi.ts + server/lead-pipeline.ts)
 * gegen eine echte MySQL-8-Datenbank (Schema per drizzle-kit migrate).
 *
 * Ablauf: Benutzer → Lead-Kategorien → Bestellung/Lieferkette → Leads (manuell, CSV, REST-API)
 *         → Automatisierung (löst jetzt automatisch aus) → Auslieferung inkl. API-Übergabe an den Käufer.
 * Ausgehende HTTPS-Aufrufe werden über einen fetch-Stub aufgezeichnet (kein echter Partner nötig).
 *
 * Start:  DATABASE_URL=mysql://flux:flux@127.0.0.1:3308/fluxora_e2e JWT_SECRET=e2e-test-secret \
 *         pnpm exec drizzle-kit migrate && pnpm exec vitest run server/e2e-flow.verify.test.ts
 */
import express from "express";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
process.env.EMAIL_THROTTLE_OFF = "1"; // Drip und Tageslimit im Kernablauf aus – sonst ginge je Minute nur eine E-Mail raus (eigene Tests: campaign-drip.test.ts, Test 54)
import { undoLog, apiTokens, automationExecutionLogs, callRecords, claims, emailEvents, integrationEvents, leadCallAttempts, leadDeliveries, leadStatusEvents, leads, memberships, orders, suppliers, users, emailCampaignEvents, emailCampaignRecipients, mailSettings, emailCampaigns, emailSuppressions, inboxMessages, outboundMessages, pipelineEvents, pipelineTasks, dialerCalls, phoneNumbers, telephonySettings } from "../drizzle/schema";
import { handleSipgateEvent, reconcileSipgateRecordings, sipgateRecordingResponse, sipgateTestHooks, syncSipgateCalls } from "./dialer";
import { evaluateOrderEligibility } from "./lead-pipeline";
import { authenticateRequest, verifyPassword } from "./_core/auth";
import { intervalWindowOpen, runScheduledDeliveries } from "./delivery-scheduler";
import { buildProviderPayload } from "./lead-integration-export";

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(async (params: { messages: Array<{ role: string; content: unknown }> }) => {
    const text = String(params.messages.find((message) => message.role === "user")?.content ?? "").toLowerCase();
    const good = /gerne|einverstanden|eigentümer/.test(text); const bad = /nicht angerufen|löschen/.test(text);
    const score = bad ? 1 : good ? 9 : 5;
    const evaluation = { criteria: ["bedarf", "entscheider", "zeitrahmen", "budget", "kontaktdaten", "einwilligung"].map((key) => ({ key, score, evidence: `Beleg ${key}` })), summary: bad ? "Kunde lehnt Kontakt ab." : good ? "Klarer Bedarf, Weitergabe erlaubt." : "Offene Punkte.", redFlags: bad ? ["Kunde möchte nicht kontaktiert werden"] : [], nextStep: good ? "Übergeben" : "Rückruf", verdict: bad ? "nicht_verkaufbar" : good ? "verkaufbar" : "nachfassen" };
    return { id: "stub", created: 0, model: "stub", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(evaluation) }, finish_reason: "stop" }] };
  }),
}));
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "test-openai-key";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://flux:flux@127.0.0.1:3308/fluxora_e2e";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "e2e-test-secret";

const { appRouter } = await import("./routers");
const { registerPublicApiRoutes } = await import("./publicApi");

type Caller = ReturnType<typeof appRouter.createCaller>;
const db = drizzle(process.env.DATABASE_URL);
const outbound: Array<{ url: string; method: string; headers: Record<string, string>; body: any }> = [];
const realFetch = globalThis.fetch;

let owner: Caller; let invitee: Caller; let ownerUserId: number; let inviteeUserId: number;
let server: ReturnType<express.Express["listen"]>; let apiBase = "";
const S: Record<string, any> = {};

const leadRow = async (publicId: string) => (await db.select().from(leads).where(eq(leads.publicId, publicId)))[0];
const postLead = (token: string, body: Record<string, unknown>) => fetch(`${apiBase}/api/v1/leads`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

beforeAll(async () => {
  const run = Date.now().toString(36);
  await db.insert(users).values({ openId: `owner-${run}`, name: "Tanesco Digital", email: `owner-${run}@example.de`, role: "admin", lastSignedIn: new Date() });
  ownerUserId = (await db.select({ id: users.id }).from(users).where(eq(users.openId, `owner-${run}`)))[0].id;
  await db.insert(users).values({ openId: `partner-${run}`, name: "Partner Solar GmbH", email: `partner-${run}@example.de`, role: "user", lastSignedIn: new Date() });
  inviteeUserId = (await db.select({ id: users.id }).from(users).where(eq(users.openId, `partner-${run}`)))[0].id;
  owner = appRouter.createCaller({ user: { id: ownerUserId } } as never);
  invitee = appRouter.createCaller({ user: { id: inviteeUserId } } as never);

  const app = express(); app.use(express.json({ limit: "5mb", verify: (req, _res, buf) => { (req as unknown as { rawBody?: string }).rawBody = buf.toString("utf8"); } })); registerPublicApiRoutes(app);
  server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(apiBase)) return realFetch(input, init);
    const headers: Record<string, string> = {}; new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
    let parsedBody: unknown = null; try { parsedBody = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : init?.body ? { formData: true } : null; } catch { parsedBody = String(init?.body); }
    outbound.push({ url, method: init?.method ?? "GET", headers, body: parsedBody });
    if (url.endsWith("/login")) return new Response(JSON.stringify({ auth_token: "tok-12345" }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("aroundhome-d2d")) return new Response(JSON.stringify({ data: [{ uuid: "d2d-1", status: "qualified", sub_id: "D2D-TEST1", created_at: new Date().toISOString() }, { uuid: "d2d-2", status: "open", sub_id: "D2D-TEST1", created_at: new Date().toISOString() }, { uuid: "d2d-3", status: "cancelled", cancellation_reason: "Kunde nicht erreichbar", sub_id: "D2D-TEST2", created_at: new Date(Date.now() - 24 * 3_600_000).toISOString() }, { uuid: "d2d-4", status: "qualified", sub_id: "D2D-FREMD", created_at: new Date().toISOString() }] }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("aroundhome-export")) return new Response(JSON.stringify({ data: [{ uuid: S.aroundhomeRef ?? "none", status: "cancelled", cancellation_reason: "Kunde nicht erreichbar" }, { uuid: "ah-unbekannt", status: "cancelled", cancellation_reason: "Dublette" }, { uuid: "ah-ok", status: "confirmed" }] }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("recordings/")) return new Response(new Uint8Array([73, 68, 51, 3, 0, 0]), { status: 200, headers: { "content-type": "audio/mpeg" } });
    if (url.includes("api.openai.com/v1/audio/transcriptions")) return new Response(S.transcriptForStub ?? "Agent: Hallo. Kunde: Ja gerne, ich bin Eigentümer und einverstanden.", { status: 200, headers: { "content-type": "text/plain" } });
    if (url.includes("hlrlookup.com")) return new Response(JSON.stringify(url.includes("msisdn=491700000000") ? { status: "valid", network: "Telekom" } : { status: "invalid" }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.startsWith("https://nominatim.openstreetmap.org/")) return new Response(JSON.stringify([{ lat: "50.1109", lon: "8.6821", display_name: "Frankfurt am Main, Hessen, Deutschland" }]), { status: 200, headers: { "content-type": "application/json" } });
    if (url.startsWith("https://overpass-api.de/")) return new Response(JSON.stringify({ elements: [{ type: "node", id: 101, lat: 50.12, lon: 8.69, tags: { name: "Hansen Bedachungen GmbH", craft: "roofer", website: "https://hansen-test.de", phone: "+49 69 5550101", "addr:street": "Hauptstraße", "addr:housenumber": "5", "addr:postcode": "60311", "addr:city": "Frankfurt" } }, { type: "way", id: 202, center: { lat: 50.13, lon: 8.7 }, tags: { name: "Koch Dach e.K.", "addr:city": "Offenbach" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.startsWith("https://hansen-test.de")) return new Response(url.includes("impressum") ? "<p>Hansen Bedachungen GmbH<br>Geschäftsführer: Peter Hansen<br>E-Mail: info@hansen-test.de<br>HRB 12345 Amtsgericht Frankfurt · Umsatz 2025: ca. 3,2 Mio. €</p>" : "<html><body><p>Seit 1998 Dachdecker-Meisterbetrieb mit 24 Mitarbeitern. Wir sind tätig in Frankfurt und 50 km Umkreis. Photovoltaik und Dach.</p><a href=\"/impressum\">Impressum</a></body></html>", { status: 200, headers: { "content-type": "text/html" } });
    if (url.startsWith("https://graph.facebook.com/")) {
      const json = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
      const path = new URL(url).pathname.replace(/^\/v\d+\.\d+\//, "");
      if (path === "oauth/access_token") return json({ access_token: url.includes("fb_exchange_token") ? "EAAG-long-lived-token-1234567890" : "EAAG-short-token-1234567890", expires_in: 5_184_000 });
      if (path === "me/accounts") return json({ data: [{ id: "1029384756", name: "Tanesco Energie", access_token: "EAAG-page-token-from-oauth-123456" }, { id: "2039485766", name: "Zweite Seite", access_token: "EAAG-page-token-2" }] });
      if (path === "me/adaccounts") return json({ data: [{ id: "act_55512345", name: "Tanesco Ads", account_id: "55512345" }] });
      if (/^1029384756$/.test(path)) return json({ id: "1029384756", name: "Tanesco Energie" });
      if (path.endsWith("/subscribed_apps")) return json({ success: true });
      if (path.endsWith("/leadgen_forms")) return json({ data: [{ id: "form-pv", name: "Photovoltaik – Beratung", status: "ACTIVE", leads_count: 3 }] });
      if (/^act_55512345$/.test(path)) return json({ id: "act_55512345", name: "Tanesco Ads" });
      if (path.endsWith("/insights")) return json({ data: [{ date_start: new Date().toISOString().slice(0, 10), campaign_id: "cmp-1", campaign_name: "PV Süd", adset_id: "as-1", adset_name: "Eigenheim", ad_id: "ad-1", ad_name: "Video", spend: "120.50", impressions: "8000", clicks: "160", actions: [{ action_type: "lead", value: "2" }] }] });
      if (/^form-pv$/.test(path)) return json({ name: "Photovoltaik – Beratung" });
      if (/^lg-77[78]$/.test(path)) return json({ id: path, created_time: new Date().toISOString(), field_data: [{ name: "email", values: ["meta.lead@beispiel.de"] }, { name: "phone_number", values: ["+49 160 7777777"] }, { name: "full_name", values: ["Mia Meta"] }, { name: "zip_code", values: ["80331"] }, { name: "city", values: ["München"] }, { name: "hausbesitzer", values: ["Ja"] }], ad_id: "ad-1", ad_name: "Video", adset_id: "as-1", adset_name: "Eigenheim", campaign_id: "cmp-1", campaign_name: "PV Süd", form_id: "form-pv", platform: "instagram" });
      return json({ ok: true });
    }
    if (url.includes("secured") && headers["x-auth-token"] !== "tok-12345") return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    if (url.includes("duplicate")) return new Response(JSON.stringify({ code: 5, message: "Kunde existiert bereits" }), { status: 400, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(url.includes("crm") ? { uuid: `ah-${outbound.length}`, ok: true } : { ok: true }), { status: url.includes("reject") ? 422 : 200, headers: { "content-type": "application/json", "x-request-id": `req-${outbound.length}` } });
  });
});

afterAll(async () => { vi.unstubAllGlobals(); await new Promise((resolve) => server.close(resolve)); });

describe("Tanesco Leads – Kernablauf gegen das Backend (verdrahtete Pipeline)", () => {
  it("0. Anmeldung ohne Manus: erstes Konto, Login, Einladung, Passwort ändern und zurücksetzen", async () => {
    const run = Date.now().toString(36);
    const cookies: Record<string, string> = {};
    const webCaller = (userId?: number) => appRouter.createCaller({ user: userId ? { id: userId } : null, req: { headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") }, protocol: "http", hostname: "localhost" }, res: { cookie: (name: string, value: string) => { cookies[name] = value; }, clearCookie: (name: string) => { delete cookies[name]; } } } as never);
    const status = await webCaller().auth.registrationStatus();
    // In dieser Testdatenbank existieren bereits Benutzer (beforeAll) → Registrierung nur per Einladung
    expect(status.open).toBe(false);
    await expect(webCaller().auth.register({ name: "Fremd", email: `fremd-${run}@example.de`, password: "geheim-12345" })).rejects.toThrow("nur mit einer Einladung");
    await expect(webCaller().auth.login({ email: `owner-${run}@example.de`, password: "falsch" })).rejects.toThrow("nicht korrekt");

    // Einladung durch den Inhaber → Konto mit Einladungslink anlegen → Sitzungscookie → Einladung annehmen
    await owner.leadops.dashboard();
    const invitation = await owner.leadops.inviteUser({ email: `neu-${run}@example.de`, role: "vertrieb", partnerType: "intern" });
    await expect(webCaller().auth.register({ name: "Neu", email: `neu-${run}@example.de`, password: "kurz1" })).rejects.toThrow("mindestens 10 Zeichen");
    const registered = await webCaller().auth.register({ name: "Neu Mitglied", email: `NEU-${run}@example.de`, password: "sicher-2026-xyz", inviteToken: invitation.token });
    expect(registered.email).toBe(`neu-${run}@example.de`);
    expect(cookies.app_session_id).toBeTruthy();
    const sessionUser = await authenticateRequest({ headers: { cookie: `app_session_id=${cookies.app_session_id}` } } as never);
    expect(sessionUser.id).toBe(registered.id); expect(sessionUser.role).toBe("user");
    expect(await verifyPassword("sicher-2026-xyz", sessionUser.passwordHash)).toBe(true);
    const member = appRouter.createCaller({ user: { id: registered.id } } as never);
    await member.leadops.acceptInvitation({ token: invitation.token });
    expect((await member.leadops.tenantContext())?.tenant.id).toBe((await owner.leadops.dashboard()).tenant.id);

    // Login setzt eine neue Sitzung, Passwort ändern, Administrator setzt ein Einmal-Passwort
    delete cookies.app_session_id;
    await webCaller().auth.login({ email: `neu-${run}@example.de`, password: "sicher-2026-xyz" });
    expect(cookies.app_session_id).toBeTruthy();
    await webCaller(registered.id).auth.changePassword({ currentPassword: "sicher-2026-xyz", newPassword: "noch-sicherer-2026" });
    await expect(webCaller().auth.login({ email: `neu-${run}@example.de`, password: "sicher-2026-xyz" })).rejects.toThrow("nicht korrekt");
    const membership = (await db.select().from(memberships).where(and(eq(memberships.userId, registered.id), eq(memberships.status, "aktiv"))))[0];
    const reset = await owner.leadops.resetMemberPassword({ membershipId: membership.id });
    expect(reset.temporaryPassword).toHaveLength(12);
    await webCaller().auth.login({ email: `neu-${run}@example.de`, password: reset.temporaryPassword });
    await expect(member.leadops.resetMemberPassword({ membershipId: membership.id })).rejects.toThrow("vorbehalten");
    expect((await webCaller(registered.id).auth.me())?.passwordHash).toBeUndefined(); // Hash verlässt den Server nie
  });

  it("1. Benutzer: Inhaber-Mandant, Einladung eines Partners als Käufer, Profile für Käufer und Lieferant", async () => {
    const dashboard = await owner.leadops.dashboard();
    expect(dashboard.tenant.id).toBeGreaterThan(0); S.tenantId = dashboard.tenant.id;

    const invitation = await owner.leadops.inviteUser({ email: "partner@example.de", role: "manager", partnerType: "käufer" });
    expect(invitation.token).toHaveLength(32);
    await invitee.leadops.acceptInvitation({ token: invitation.token });
    S.membership = (await db.select().from(memberships).where(and(eq(memberships.tenantId, S.tenantId), eq(memberships.userId, inviteeUserId))))[0];
    expect(S.membership).toMatchObject({ role: "manager", partnerType: "käufer", status: "aktiv" });
    expect((await invitee.leadops.tenantContext())?.tenant.id).toBe(S.tenantId);

    await owner.leadops.createOrganizationProfile({ partnerType: "käufer", name: "Partner Solar GmbH", email: "einkauf@partner.example" });
    await owner.leadops.createOrganizationProfile({ partnerType: "lieferant", name: "Partner Solar GmbH", email: "leads@partner.example" });
    const profiles = await owner.leadops.listOrganizationProfiles();
    expect(profiles.filter((p) => p.name === "Partner Solar GmbH").map((p) => p.partnerType).sort()).toEqual(["käufer", "lieferant"]);
    S.supplierId = (await owner.leadops.listSuppliers()).find((s) => s.name === "Partner Solar GmbH")!.id; // Lieferantenprofil → Lieferant
    expect(S.supplierId).toBeGreaterThan(0);
  });

  it("2. Lead-Kategorien: PV-Vorlage und eigene Kategorie mit Feldern", async () => {
    await owner.leadops.createPvCategoryTemplate();
    await owner.leadops.createCategory({ shortcode: "WP-DEMO", name: "Wärmepumpe Endkunde", defaultLeadPrice: "45.00" });
    const categories = await owner.leadops.listCategories();
    S.pv = categories.find((c) => c.shortcode.toUpperCase().includes("PV")); S.wp = categories.find((c) => c.shortcode === "WP-DEMO");
    expect(S.pv).toBeTruthy(); expect(S.wp).toBeTruthy();
    expect(S.wp!.emoji).toBe("♨️"); // Emoji aus dem Namen vorgeschlagen
    await owner.leadops.updateCategory({ id: S.wp!.id, emoji: "🔥" }); expect((await owner.leadops.listCategories()).find((c) => c.id === S.wp!.id)?.emoji).toBe("🔥");
    await owner.leadops.updateCategory({ id: S.wp!.id, emoji: "♨️" });
    await owner.leadops.addCategoryField({ categoryId: S.wp.id, label: "Heizungsart", fieldKey: "heizungsart", fieldType: "auswahl", options: ["Gas", "Öl", "Strom"], required: true });
    await owner.leadops.addCategoryField({ categoryId: S.wp.id, label: "Wohnfläche (m²)", fieldKey: "wohnflaeche", fieldType: "zahl", required: false });
    expect((await owner.leadops.listCategoryFields({ categoryId: S.wp.id })).map((f) => f.fieldKey)).toEqual(["heizungsart", "wohnflaeche"]);
    expect((await owner.leadops.listCategoryFields({ categoryId: S.pv.id })).length).toBeGreaterThan(5);
  });

  it("3. Bestellung des Käufers mit operativer Konfiguration, Käufer-Integration und Lieferkette", async () => {
    const order = await owner.leadops.createOrder({ name: "WP-Leads Q4", buyerName: "Partner Solar GmbH", categoryId: S.wp.id, quantity: 50, unitPrice: 48, supplierId: S.supplierId, status: "aktiv" });
    S.orderId = order.orderId; S.orderNumber = order.orderNumber; expect(order.orderNumber).toMatch(/^ORD-/);
    await owner.leadops.saveOrderWorkspace({ orderId: S.orderId, name: "WP-Leads Q4", buyerName: "Partner Solar GmbH", buyerUserId: inviteeUserId, categoryId: S.wp.id, categoryIds: [S.wp.id], quantity: 50, unitPrice: 48, supplierId: S.supplierId, supplierMode: "ein", supplierIds: [S.supplierId], deliveryInterval: "täglich", compensateClaims: true, priority: 1, realtimeDelivery: true, startsAt: null, endsAt: null, ongoing: true, deliveryDays: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"], deliveryArea: "landesweit", pauses: [], advancedFilters: { minAgeDays: null, maxLeadPrice: null, postcodes: null } });
    const saved = await owner.leadops.getOrderWorkspace({ orderId: S.orderId });
    expect(saved.config.buyerUserId).toBe(inviteeUserId);
    expect(saved.config.supplierRestrictions).toMatchObject({ mode: "ein", allowedSupplierIds: [S.supplierId], blockUnknownSuppliers: true });

    // API-Integration des Käufers und Verknüpfung mit seiner Mitgliedschaft (Bestellung → Käufer → Integration)
    const integration = await owner.leadops.createPartnerIntegration({ provider: "custom_api", name: "Partner Solar CRM", callbackUrl: "https://crm.partner-solar.example/api/leads", config: { authMethod: "api_key", direction: "ausgehend" } });
    S.integrationId = integration.integrationId!;
    await owner.leadops.setPartnerIntegrationCredential({ id: S.integrationId, secret: "sk-partner-123" });
    await owner.leadops.updatePartnerIntegration({ id: S.integrationId, status: "aktiv" });
    await owner.leadops.updateMembership({ id: S.membership.id, integrationId: S.integrationId });

    await owner.leadops.createDeliveryChain({ orderId: S.orderId, categoryId: S.wp.id, name: "WP → Partner Solar", priority: 1, sellTarget: 1, distributionMode: "lieferketten_round_robin" });
    const chain = (await owner.leadops.listDeliveryChains()).find((c) => c.name === "WP → Partner Solar")!; S.chainId = chain.id;
    expect(chain.status).toBe("inaktiv"); // neue Ketten starten inaktiv
    await owner.leadops.addDeliveryStop({ chainId: S.chainId, buyerName: "Partner Solar GmbH", position: 1, unitPrice: 48 });
    await owner.leadops.updateDeliveryChain({ id: S.chainId, status: "aktiv" });
    const withStops = (await owner.leadops.listDeliveryChains()).find((c) => c.id === S.chainId)!;
    expect(withStops.stops).toHaveLength(1); expect(withStops.status).toBe("aktiv");
  });

  it("4. Leads anlegen: manuell, per CSV-Batch und über die öffentliche REST-API (Lieferant wird aufgelöst)", async () => {
    const manual = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Max", lastName: "Mustermann", email: "max@example.de", phone: "+49 69 1234567", postcode: "60311", city: "Frankfurt", supplierId: S.supplierId, supplierName: "Partner Solar GmbH", cost: 20, metadata: { heizungsart: "Gas", wohnflaeche: 140 } });
    S.leadA = manual.publicId; expect(S.leadA).toHaveLength(8);
    expect(manual.automation).toEqual({ executed: 0, duplicated: 0, delivered: 0 }); // noch keine Regeln

    const batch = await owner.leadops.startLeadImportBatch({ categoryId: S.wp.id, fileName: "leads.csv", totalRows: 2, errorDetails: [{ rowNumber: 2, reason: "E-Mail ungültig", values: { email: "kaputt" } }] });
    const csvLead = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Erika", lastName: "Musterfrau", email: "erika@example.de", postcode: "10115", city: "Berlin", supplierId: S.supplierId, metadata: { heizungsart: "Öl" } });
    await owner.leadops.finishLeadImportBatch({ batchId: batch.batchId, leadPublicIds: [csvLead.publicId], importedRows: 1, errorRows: 1 });
    S.leadB = csvLead.publicId;
    expect((await owner.leadops.listLeadImportBatches())[0]).toMatchObject({ fileName: "leads.csv", importedRows: 1, errorRows: 1 });

    const token = await owner.leadops.createApiToken({ name: "Partner Solar API", scopes: ["leads:write"] }); S.token = token.token;
    expect(token.token).toMatch(/^fx_/);
    expect((await postLead("falsch", { categoryId: S.wp.id, firstName: "X" })).status).toBe(401);
    const created = await postLead(S.token, { categoryId: S.wp.id, firstName: "Api", lastName: "Kunde", email: "api@example.de", phone: "+49 30 555", postcode: "20095", city: "Hamburg", supplierName: "partner solar gmbh", metadata: { heizungsart: "Strom", wohnflaeche: 95 } });
    expect(created.status).toBe(201);
    const payload = await created.json();
    expect(payload).toMatchObject({ status: "neu", supplierId: S.supplierId, automation: { executed: 0 } }); expect(payload.id).toMatch(/^API-/); S.leadC = payload.id;
    const tokenRow = (await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, createHash("sha256").update(S.token).digest("hex"))))[0];
    expect(tokenRow.lastUsedAt).toBeTruthy();

    const page = await owner.leadops.listLeadsPaged({ page: 1, pageSize: 50 });
    expect(page.rows.map((r) => r.publicId)).toEqual(expect.arrayContaining([S.leadA, S.leadB, S.leadC]));
    expect(page.rows.find((r) => r.publicId === S.leadC)!.supplierId).toBe(S.supplierId); // Lieferant per Name aufgelöst
  });

  it("5. Automatisierung löst bei Lead-Anlage automatisch aus: Bestellung zuordnen → Echtzeit-Auslieferung → API-Übergabe", async () => {
    await owner.leadops.createAutomationRule({ name: "WP-Leads Gas/Öl an Partner Solar", triggerType: "lead_erstellt", sourceCategoryId: S.wp.id, targetCategoryId: S.wp.id, conditionMode: "mindestens_eine", conditions: [{ field: "heizungsart", operator: "gleich", value: "Gas" }, { field: "heizungsart", operator: "gleich", value: "Öl" }], actionType: "lead_bestellung_zuordnen", actionConfig: { orderId: S.orderId }, status: "aktiv" });
    await owner.leadops.createAutomationRule({ name: "WP-Leads an Partner-CRM exportieren", triggerType: "lead_erstellt", sourceCategoryId: S.wp.id, targetCategoryId: S.wp.id, conditions: [], actionType: "integration_ausfuehren", actionConfig: { integrationId: S.integrationId }, status: "aktiv" });

    // 5a manuell angelegter Lead (Gas) → beide Regeln, Auslieferung an den Käufer inkl. API-Übergabe – ohne manuellen Aufruf
    const before = outbound.length;
    const leadD = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Doris", lastName: "Direkt", email: "doris@example.de", postcode: "80331", city: "München", supplierId: S.supplierId, cost: 25, metadata: { heizungsart: "Gas", wohnflaeche: 120 } });
    S.leadD = leadD.publicId;
    expect(leadD.automation).toEqual({ executed: 2, duplicated: 0, delivered: 1 });
    const rowD = await leadRow(S.leadD);
    expect(rowD.status).toBe("zugewiesen");
    expect(rowD.metadata).toMatchObject({ assignedOrderId: S.orderId, assignedOrderNumber: S.orderNumber });
    const deliveriesD = await db.select().from(leadDeliveries).where(eq(leadDeliveries.leadId, rowD.id));
    expect(deliveriesD).toHaveLength(1);
    expect(deliveriesD[0]).toMatchObject({ orderId: S.orderId, chainId: S.chainId, buyerName: "Partner Solar GmbH", result: "angenommen" });
    const calls = outbound.slice(before);
    expect(calls).toHaveLength(2); // 1× Auslieferung an die Käufer-Integration, 1× Export-Regel
    for (const call of calls) { expect(call.url).toBe("https://crm.partner-solar.example/api/leads"); expect(call.headers["x-api-key"]).toBe("sk-partner-123"); expect(call.body.lead.publicId).toBe(S.leadD); }
    expect(calls[0].headers["x-fluxora-lead-reference"]).toBe(`${S.orderNumber}/${S.leadD}`);
    expect(calls[0].body.lead.fields).toMatchObject({ heizungsart: "Gas", deliveredOrderNumber: S.orderNumber, deliveredUnitPrice: "48.00" });
    const logs = (await owner.leadops.listAutomationExecutionLogs()).filter((l) => l.sourceLeadId === rowD.id).map((l) => `${l.result}: ${l.summary}`).sort();
    expect(logs).toEqual([`ausgeführt: Bestellung ${S.orderNumber} zugeordnet; ausgeliefert an Partner Solar GmbH (API Partner Solar CRM: HTTP 200)`, "ausgeführt: Integration Partner Solar CRM: geliefert (HTTP 200)"]);
    expect((await db.select().from(orders).where(eq(orders.id, S.orderId)))[0].deliveredCount).toBe(1);

    // 5b Lead über die REST-API (Strom) → nur Export-Regel, keine Auslieferung
    const apiResponse = await postLead(S.token, { categoryId: S.wp.id, firstName: "Emil", lastName: "Extern", postcode: "50667", city: "Köln", supplierName: "Partner Solar GmbH", metadata: { heizungsart: "Strom" } });
    const apiPayload = await apiResponse.json(); S.leadE = apiPayload.id;
    expect(apiPayload.automation).toEqual({ executed: 1, duplicated: 0, delivered: 0 });
    expect((await leadRow(S.leadE)).status).toBe("neu");
    expect(outbound[outbound.length - 1].body.lead.publicId).toBe(S.leadE);

    // 5c manueller Regellauf für einen älteren Lead bleibt möglich
    const resultA = await owner.leadops.runLeadAutomation({ publicId: S.leadA, triggerType: "lead_erstellt" });
    expect(resultA).toEqual({ duplicated: 0, executed: 2, delivered: 1 });
    expect((await leadRow(S.leadA)).status).toBe("zugewiesen");

    // 5d Statuswechsel löst "status_geändert"-Regeln aus
    await owner.leadops.createAutomationRule({ name: "Reklamierte Leads prüfen", triggerType: "status_geändert", sourceCategoryId: S.wp.id, targetCategoryId: S.wp.id, conditions: [{ field: "status", operator: "gleich", value: "reklamiert" }], actionType: "lead_tags_setzen", actionConfig: {}, status: "aktiv" });
    const statusChange = await owner.leadops.updateLeadStatus({ publicId: S.leadE, status: "reklamiert" });
    expect(statusChange.automation).toEqual({ executed: 0, duplicated: 0, delivered: 0 }); // Regel läuft, aber ohne Tag-ID → übersprungen
    const logsE = (await owner.leadops.listAutomationExecutionLogs()).filter((l) => l.ruleName === "Reklamierte Leads prüfen");
    expect(logsE.map((l) => `${l.result}: ${l.summary}`)).toEqual(["übersprungen: Lead-Tag wurde nicht gefunden."]);
  });

  it("6. Manuelle Auslieferung beachtet Bestellung und Lieferantensperre; Export mit Zugangsdaten und Ablehnung", async () => {
    const before = outbound.length;
    const delivery = await owner.leadops.deliverLead({ publicId: S.leadB });
    expect(delivery).toMatchObject({ chainId: S.chainId, orderId: S.orderId, buyerName: "Partner Solar GmbH", unitPrice: "48.00", result: "angenommen", export: { integrationName: "Partner Solar CRM", eventType: "geliefert", responseStatus: 200 } });
    expect(outbound[before].headers["x-api-key"]).toBe("sk-partner-123");
    expect((await leadRow(S.leadB)).status).toBe("zugewiesen");

    // Lead ohne freigegebenen Lieferanten: Bestellung lehnt ab, Grund wird genannt
    const noSupplier = await (await postLead(S.token, { categoryId: S.wp.id, firstName: "Fremd", lastName: "Lieferung", postcode: "01067", city: "Dresden", metadata: { heizungsart: "Strom" } })).json();
    await expect(owner.leadops.deliverLead({ publicId: noSupplier.id })).rejects.toThrow("Lieferant für diese Bestellung nicht freigegeben");

    // Manueller Export über die Integrationsseite (mit Referenz) und Testlead
    const exported = await owner.leadops.exportLeadToPartnerIntegration({ integrationId: S.integrationId, publicId: S.leadA, externalReference: `${S.orderNumber}/${S.leadA}` });
    expect(exported).toMatchObject({ eventType: "geliefert", responseStatus: 200 });
    const call = outbound[outbound.length - 1];
    expect(call.headers["x-fluxora-lead-reference"]).toBe(`${S.orderNumber}/${S.leadA}`);
    expect(call.body.lead).toMatchObject({ publicId: S.leadA, firstName: "Max", postcode: "60311", fields: { heizungsart: "Gas", assignedOrderId: S.orderId } });
    const test = await owner.leadops.sendIntegrationTestLead({ integrationId: S.integrationId, categoryId: S.wp.id });
    expect(test.eventType).toBe("geliefert"); expect(test.publicId).toMatch(/^TEST-/);

    // Ablehnung des Partners → "abgelehnt", Ereignis protokolliert
    await owner.leadops.updatePartnerIntegration({ id: S.integrationId, callbackUrl: "https://crm.partner-solar.example/api/reject" });
    const rejected = await owner.leadops.exportLeadToPartnerIntegration({ integrationId: S.integrationId, publicId: S.leadC });
    expect(rejected).toMatchObject({ eventType: "abgelehnt", responseStatus: 422 });
    await owner.leadops.updatePartnerIntegration({ id: S.integrationId, callbackUrl: "https://crm.partner-solar.example/api/leads" });
    const events = await db.select().from(integrationEvents).where(eq(integrationEvents.integrationId, S.integrationId));
    expect(events.filter((e) => e.eventType === "geliefert").length).toBeGreaterThanOrEqual(6);
    expect(events.filter((e) => e.eventType === "abgelehnt").length).toBe(1);

    // Audit-Trail des automatisch gelieferten Leads
    const rowD = await leadRow(S.leadD);
    const notes = (await db.select().from(leadStatusEvents).where(eq(leadStatusEvents.leadId, rowD.id))).map((e) => e.note);
    expect(notes.length).toBe(4); expect(notes[0]).toBe("Lead manuell oder per Dateiimport angelegt."); expect(notes[1]).toBe(`Automatisierung: Bestellung zugeordnet (${S.orderNumber})`); expect(notes[2]).toContain("Auslieferung an Partner Solar GmbH"); expect(notes[3]).toContain("API-Übergabe an Partner Solar CRM: geliefert (HTTP 200)");
    expect(JSON.stringify(await owner.leadops.getLeadAuditLog({ publicId: S.leadD }))).toContain("Partner Solar CRM");
    expect((await owner.leadops.dashboard()).kpis.delivered).toBeGreaterThanOrEqual(1);
  });

  it("7. Frühere Befunde sind behoben", async () => {
    // (c) Provider-Mapping der Vorlagen wird angewendet (GoHighLevel: flache Kontaktstruktur, Location-ID, Header)
    await owner.leadops.installStandardIntegrationTemplates();
    const ghl = (await owner.leadops.listPartnerIntegrations()).find((i) => i.provider === "gohighlevel")!;
    await owner.leadops.setPartnerIntegrationCredential({ id: ghl.id, secret: "ghl-bearer-token" });
    await owner.leadops.updatePartnerIntegration({ id: ghl.id, publisherId: "loc_4711", status: "aktiv" });
    await owner.leadops.exportLeadToPartnerIntegration({ integrationId: ghl.id, publicId: S.leadA });
    const call = outbound[outbound.length - 1];
    expect(call.url).toBe("https://services.leadconnectorhq.com/contacts/");
    expect(call.headers.authorization).toBe("Bearer ghl-bearer-token");
    expect(call.headers.version).toBe("2021-07-28");
    expect(call.body).toMatchObject({ firstName: "Max", lastName: "Mustermann", email: "max@example.de", postalCode: "60311", locationId: "loc_4711", source: "Tanesco Leads" });
    expect(call.body.customFields).toEqual(expect.arrayContaining([{ key: "heizungsart", field_value: "Gas" }, { key: "wohnflaeche", field_value: "140" }]));
    expect(call.body.lead).toBeUndefined();

    // (d) Auslieferung folgt der Bestellzuordnung, auch wenn eine fremde Kette den niedrigeren Round-Robin-Zähler hat
    await owner.leadops.createDeliveryChain({ categoryId: S.wp.id, name: "Zweite Kette ohne Bestellung", priority: 1, sellTarget: 1, distributionMode: "lieferketten_round_robin" });
    const other = (await owner.leadops.listDeliveryChains()).find((c) => c.name === "Zweite Kette ohne Bestellung")!;
    await owner.leadops.addDeliveryStop({ chainId: other.id, buyerName: "Anderer Käufer", position: 1, unitPrice: 30 });
    await owner.leadops.updateDeliveryChain({ id: other.id, status: "aktiv" });
    const assigned = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Zuge", lastName: "Ordnet", supplierId: S.supplierId, metadata: { heizungsart: "Strom" } }); // Strom → keine Bestellregel
    await owner.leadops.assignLeadsToOrder({ publicIds: [assigned.publicId], orderId: S.orderId });
    const free = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Frei", lastName: "Verteilt", supplierId: S.supplierId, metadata: { heizungsart: "Strom" } });
    expect((await owner.leadops.deliverLead({ publicId: assigned.publicId })).chainId).toBe(S.chainId); // Bestellkette trotz höherem Zähler
    expect((await owner.leadops.deliverLead({ publicId: free.publicId })).chainId).toBe(other.id); // ohne Zuordnung: Round-Robin

    // (e) Rechteprüfung: Käufer (manager) darf keine Mandanteneinstellungen ändern, viewer darf nichts löschen
    await expect(invitee.leadops.updateTenantSettings({ leadDeactivationHours: 1 })).rejects.toThrow("steht Käufer-Zugängen nicht zur Verfügung");
    await invitee.leadops.updateNavigationPreferences({ hiddenPages: [] }); // Selbstverwaltung bleibt erlaubt
    const viewerInvite = await owner.leadops.inviteUser({ email: "viewer@example.de", role: "viewer", partnerType: "lieferant" });
    await db.insert(users).values({ openId: `viewer-${Date.now()}`, name: "Nur Lesen", email: "viewer@example.de", role: "user", lastSignedIn: new Date() });
    const viewerId = (await db.select({ id: users.id }).from(users).where(eq(users.name, "Nur Lesen")))[0].id;
    const viewer = appRouter.createCaller({ user: { id: viewerId } } as never);
    await viewer.leadops.acceptInvitation({ token: viewerInvite.token });
    expect((await viewer.leadops.listLeadsPaged({ page: 1, pageSize: 10 })).total).toBe(0); // Lieferanten-Partner ohne zugeordnetes Lieferantenprofil sieht keine Leads
    await expect(viewer.leadops.deleteLeads({ publicIds: [S.leadC], reason: "nicht erlaubt" })).rejects.toThrow("darf diese Aktion nicht ausführen");
    await expect(viewer.leadops.importLead({ categoryId: S.wp.id, firstName: "Nein" })).rejects.toThrow("darf diese Aktion nicht ausführen");
    S.viewerId = viewerId; S.viewerMembershipId = (await db.select().from(memberships).where(and(eq(memberships.tenantId, S.tenantId), eq(memberships.userId, viewerId))))[0].id;
    expect(await leadRow(S.leadC)).toBeTruthy();
    expect((await db.select().from(automationExecutionLogs).where(eq(automationExecutionLogs.tenantId, S.tenantId))).length).toBeGreaterThan(5);
  });

  it("9. Doppelauslieferung, Ablehnung mit Ausweichkette, automatische Reklamation (PrePing), leere Felder", async () => {
    // (a) Schutz vor Doppelauslieferung – ausdrückliche Wiederholung bleibt möglich
    await expect(owner.leadops.deliverLead({ publicId: S.leadB })).rejects.toThrow("bereits an Partner Solar GmbH ausgeliefert");
    const repeated = await owner.leadops.deliverLead({ publicId: S.leadB, allowRepeat: true });
    expect(repeated.buyerName).toBe("Anderer Käufer"); expect(repeated.result).toBe("angeboten"); // Dublettenschutz: nicht erneut an Partner Solar, sondern an die nächste Kette
    await expect(owner.leadops.deliverLead({ publicId: S.leadB, allowRepeat: true, orderId: S.orderId })).rejects.toThrow("Dublettenschutz");

    // (b) Käufer lehnt ab → Lieferung „abgelehnt“, Bestellzähler unverändert, Lead bleibt offen
    const beforeCount = (await db.select().from(orders).where(eq(orders.id, S.orderId)))[0].deliveredCount;
    await owner.leadops.updatePartnerIntegration({ id: S.integrationId, callbackUrl: "https://crm.partner-solar.example/api/reject" });
    const rejectedLead = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Rita", lastName: "Reject", email: "rita@example.de", postcode: "70173", city: "Stuttgart", supplierId: S.supplierId, metadata: { heizungsart: "Strom" } });
    await owner.leadops.assignLeadsToOrder({ publicIds: [rejectedLead.publicId], orderId: S.orderId });
    const rejected = await owner.leadops.deliverLead({ publicId: rejectedLead.publicId });
    expect(rejected.result).toBe("abgelehnt"); expect(rejected.attempts).toHaveLength(1); expect(rejected.attempts[0].reason).toContain("HTTP 422"); expect(rejected.claimId).toBeUndefined();
    const rejectedRow = await leadRow(rejectedLead.publicId);
    expect(rejectedRow.status).toBe("neu");
    expect((await db.select().from(leadDeliveries).where(eq(leadDeliveries.leadId, rejectedRow.id))).map((d) => d.result)).toEqual(["abgelehnt"]);
    expect((await db.select().from(orders).where(eq(orders.id, S.orderId)))[0].deliveredCount).toBe(beforeCount);

    // (c) PrePing: qualifizierte Ablehnung erzeugt automatisch eine Reklamation
    await owner.leadops.updateTenantSettings({ incomingPrePing: true });
    const prePing = await owner.leadops.deliverLead({ publicId: rejectedLead.publicId });
    expect(prePing.result).toBe("abgelehnt"); expect(prePing.claimId).toBeGreaterThan(0);
    expect((await db.select().from(claims).where(eq(claims.id, prePing.claimId!)))[0]).toMatchObject({ leadId: rejectedRow.id, reason: "Partnerablehnung", status: "offen" });
    expect((await leadRow(rejectedLead.publicId)).status).toBe("reklamiert");
    await owner.leadops.updateTenantSettings({ incomingPrePing: false });

    // (d) Ohne feste Zuordnung wird nach der Ablehnung auf die nächste Kette ausgewichen (zweite Kette, Priorität 2 → „angeboten“)
    const otherChain = (await owner.leadops.listDeliveryChains()).find((c) => c.name === "Zweite Kette ohne Bestellung")!;
    await owner.leadops.updateDeliveryChain({ id: otherChain.id, priority: 2 });
    const fallbackLead = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Fanny", lastName: "Fallback", email: "fanny@example.de", supplierId: S.supplierId, metadata: { heizungsart: "Strom" } });
    const fallback = await owner.leadops.deliverLead({ publicId: fallbackLead.publicId });
    expect(fallback.attempts.map((a) => `${a.chainName}: ${a.outcome}`)).toEqual(["WP → Partner Solar: abgelehnt", "Zweite Kette ohne Bestellung: angeboten"]);
    expect(fallback.buyerName).toBe("Anderer Käufer"); expect(fallback.result).toBe("angeboten");
    expect((await leadRow(fallbackLead.publicId)).status).toBe("zugewiesen");
    await owner.leadops.updateDeliveryChain({ id: otherChain.id, priority: 1 });
    await owner.leadops.updatePartnerIntegration({ id: S.integrationId, callbackUrl: "https://crm.partner-solar.example/api/leads" });

    // (e) Dublettenschutz pro Käufer: gleicher Kontakt wird nicht erneut an denselben Käufer geliefert
    const twin = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Max", lastName: "Zwilling", email: "max@example.de", supplierId: S.supplierId, metadata: { heizungsart: "Strom" } });
    await expect(owner.leadops.deliverLead({ publicId: twin.publicId, orderId: S.orderId })).rejects.toThrow("Dublettenschutz");
    await owner.leadops.updateTenantSettings({ outgoingDuplicateProtection: false });
    expect((await owner.leadops.deliverLead({ publicId: twin.publicId, orderId: S.orderId })).result).toBe("angenommen");
    await owner.leadops.updateTenantSettings({ outgoingDuplicateProtection: true });

    // (f) „Leere API-Felder auslassen“
    await owner.leadops.updateTenantSettings({ skipEmptyApiFields: true });
    await owner.leadops.exportLeadToPartnerIntegration({ integrationId: S.integrationId, publicId: twin.publicId });
    const sparse = outbound[outbound.length - 1].body;
    expect(sparse.lead).not.toHaveProperty("phone"); expect(sparse.lead).not.toHaveProperty("postcode"); expect(sparse.lead.email).toBe("max@example.de");
    await owner.leadops.updateTenantSettings({ skipEmptyApiFields: false });
  });

  it("10. Zeitplaner: tägliches Lieferintervall, Wiederholung nach Ablehnung, Aufgabe nach 3 Versuchen", async () => {
    const monday = new Date("2026-09-21T09:00:00+02:00"); const tuesday = new Date("2026-09-22T09:00:00+02:00");
    expect(intervalWindowOpen("täglich", undefined, monday)).toBe(true);
    expect(intervalWindowOpen("täglich", monday, new Date("2026-09-21T17:00:00+02:00"))).toBe(false);
    expect(intervalWindowOpen("wöchentlich", monday, tuesday)).toBe(false);
    expect(intervalWindowOpen("wöchentlich", monday, new Date("2026-09-28T09:00:00+02:00"))).toBe(true);
    expect(intervalWindowOpen("monatlich", monday, new Date("2026-10-01T09:00:00+02:00"))).toBe(true);

    // Bestellung mit täglichem Intervall (keine Echtzeit), Käufer ohne Integration
    const daily = await owner.leadops.createOrder({ name: "WP täglich", buyerName: "Tages-Käufer", categoryId: S.wp.id, quantity: 10, unitPrice: 40, status: "aktiv" });
    await owner.leadops.saveOrderWorkspace({ orderId: daily.orderId, name: "WP täglich", buyerName: "Tages-Käufer", buyerUserId: null, categoryId: S.wp.id, categoryIds: [S.wp.id], quantity: 10, unitPrice: 40, supplierId: null, supplierMode: "alle", supplierIds: [], deliveryInterval: "täglich", compensateClaims: false, priority: 1, realtimeDelivery: false, startsAt: null, endsAt: null, ongoing: true, deliveryDays: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"], deliveryArea: "landesweit", pauses: [], advancedFilters: { minAgeDays: null, maxLeadPrice: null, postcodes: null } });
    await owner.leadops.createDeliveryChain({ orderId: daily.orderId, categoryId: S.wp.id, name: "Tageskette", priority: 1, sellTarget: 1, distributionMode: "lieferketten_round_robin" });
    const dailyChain = (await owner.leadops.listDeliveryChains()).find((c) => c.name === "Tageskette")!;
    await owner.leadops.addDeliveryStop({ chainId: dailyChain.id, buyerName: "Tages-Käufer", position: 1, unitPrice: 40 });
    await owner.leadops.updateDeliveryChain({ id: dailyChain.id, status: "aktiv" });
    const first = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Tag", lastName: "Eins", supplierId: S.supplierId, metadata: { heizungsart: "Strom" } });
    const second = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Tag", lastName: "Zwei", supplierId: S.supplierId, metadata: { heizungsart: "Strom" } });
    await owner.leadops.assignLeadsToOrder({ publicIds: [first.publicId, second.publicId], orderId: daily.orderId });
    expect((await leadRow(first.publicId)).status).toBe("neu"); // keine Echtzeit → wartet auf den Zeitplaner

    const run1 = (await runScheduledDeliveries(db as never, { tenantId: S.tenantId, now: monday }))[0];
    expect(run1.delivered).toBe(2); // erstes Fenster des Tages: beide zugeordneten Leads
    const third = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Tag", lastName: "Drei", supplierId: S.supplierId, metadata: { heizungsart: "Strom" } });
    await owner.leadops.assignLeadsToOrder({ publicIds: [third.publicId], orderId: daily.orderId });
    const run2 = (await runScheduledDeliveries(db as never, { tenantId: S.tenantId, now: new Date("2026-09-21T17:00:00+02:00") }))[0];
    expect(run2.delivered).toBe(0); expect(run2.skipped).toBeGreaterThanOrEqual(1); // Tagesfenster bereits genutzt
    const run3 = (await runScheduledDeliveries(db as never, { tenantId: S.tenantId, now: tuesday }))[0];
    expect(run3.delivered).toBe(1);
    expect((await owner.leadops.runScheduledDeliveries()).tenantId).toBe(S.tenantId); // manueller Lauf per tRPC (Administrator)
    await expect(invitee.leadops.runScheduledDeliveries()).rejects.toThrow(/nicht zur Verfügung|vorbehalten/);

    // Wiederholung nach Ablehnung: Echtzeit-Bestellung, Käufer lehnt dauerhaft ab → nach 3 Versuchen aufgegeben
    await owner.leadops.updatePartnerIntegration({ id: S.integrationId, callbackUrl: "https://crm.partner-solar.example/api/reject" });
    const stubborn = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Stur", lastName: "Ablehnung", email: "stur@example.de", supplierId: S.supplierId, metadata: { heizungsart: "Gas" } }); // Gas → Regel ordnet Bestellung zu und versucht Echtzeit
    expect(stubborn.automation.delivered).toBe(0);
    expect((await leadRow(stubborn.publicId)).status).toBe("neu");
    const t0 = new Date(); // relativ zur echten Zeit des ersten Versuchs
    const retryEarly = (await runScheduledDeliveries(db as never, { tenantId: S.tenantId, now: new Date() }))[0];
    expect(retryEarly.rejected, JSON.stringify(retryEarly.details)).toBe(0); // Wiederholung frühestens nach 30 Minuten
    const retry1 = (await runScheduledDeliveries(db as never, { tenantId: S.tenantId, now: new Date(t0.getTime() + 24 * 3_600_000) }))[0];
    expect(retry1.rejected).toBe(1);
    const retry2 = (await runScheduledDeliveries(db as never, { tenantId: S.tenantId, now: new Date(t0.getTime() + 48 * 3_600_000) }))[0];
    expect(retry2.rejected).toBe(1);
    const stubbornRow = await leadRow(stubborn.publicId);
    expect((await db.select().from(leadDeliveries).where(eq(leadDeliveries.leadId, stubbornRow.id))).filter((d) => d.result === "abgelehnt")).toHaveLength(3);
    const giveUp = (await runScheduledDeliveries(db as never, { tenantId: S.tenantId, now: new Date(t0.getTime() + 72 * 3_600_000) }))[0];
    expect(giveUp.abandoned).toBe(1);
    expect((await leadRow(stubborn.publicId)).status).toBe("hängend");
    await owner.leadops.updatePartnerIntegration({ id: S.integrationId, callbackUrl: "https://crm.partner-solar.example/api/leads" });
  });

  it("11. Datensicht für Partner: Käufer sehen nur ihre gelieferten Leads, Lieferanten nur eigene; UI-Restriktionen", async () => {
    // Käufer (invitee, Bestellung S.orderId)
    const buyerView = await invitee.leadops.listLeadsPaged({ page: 1, pageSize: 100 });
    const buyerIds = buyerView.rows.map((r) => r.publicId);
    expect(buyerIds).toEqual(expect.arrayContaining([S.leadA, S.leadB, S.leadD]));
    expect(buyerIds).not.toContain(S.leadC); expect(buyerIds).not.toContain(S.leadE);
    expect(buyerView.total).toBe(buyerIds.length);
    expect((await invitee.leadops.dashboard()).leads.every((l) => buyerIds.includes(l.publicId))).toBe(true);
    expect(await invitee.leadops.getLeadAuditLog({ publicId: S.leadC })).toEqual([]); // fremder Lead ist unsichtbar
    expect((await invitee.leadops.exportLeadsCsv({}))).not.toContain(S.leadC);
    expect((await invitee.leadops.listClaims({})).every((c) => buyerIds.includes(c.leadPublicId!))).toBe(true);
    await expect(invitee.leadops.importLead({ categoryId: S.wp.id, firstName: "Nein" })).rejects.toThrow("steht Käufer-Zugängen nicht zur Verfügung");
    const claim = await invitee.leadops.createClaim({ leadId: (await leadRow(S.leadD)).id, reason: "Nicht erreichbar" });
    expect(claim.claimId).toBeGreaterThan(0);
    await expect(invitee.leadops.createClaim({ leadId: (await leadRow(S.leadC)).id, reason: "Fremder Lead" })).rejects.toThrow("nicht gefunden");

    // UI-Restriktionen: nur Reklamationen und Support
    const memberSettings = { membershipId: S.membership.id, emailNotifications: true, paymentMode: "standard" as const, deliveryPaused: false, claimRefundMode: "standard" as const, prepaidBalance: 0, individualLeadCommission: null, disabledCategoryIds: [] };
    await owner.leadops.updateMemberOperationalSettings({ ...memberSettings, uiRestricted: true });
    await expect(invitee.leadops.exportLeadsCsv({})).rejects.toThrow("eingeschränkt");
    expect((await invitee.leadops.createTicket({ subject: "Frage zur Lieferung", requesterName: "Partner Solar GmbH" })).ticketNumber).toMatch(/^SUP-/);
    await owner.leadops.updateMemberOperationalSettings({ ...memberSettings, uiRestricted: false });

    // Käufer-Einstellung „Auslieferung pausiert“ blockiert die Bestellung des Käufers
    await owner.leadops.updateMemberOperationalSettings({ ...memberSettings, uiRestricted: false, deliveryPaused: true });
    const paused = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Pause", lastName: "Test", supplierId: S.supplierId, metadata: { heizungsart: "Strom" } });
    await expect(owner.leadops.deliverLead({ publicId: paused.publicId, orderId: S.orderId })).rejects.toThrow("Auslieferung für diesen Käufer pausiert");
    await owner.leadops.updateMemberOperationalSettings({ ...memberSettings, uiRestricted: false, deliveryPaused: false });

    // Lieferant (viewer aus Test 7 → jetzt mit Lieferantenprofil per E-Mail verknüpft, Rolle manager)
    await owner.leadops.createOrganizationProfile({ partnerType: "lieferant", name: "Nur Lesen Lieferant", email: "viewer@example.de" });
    const supplier = (await owner.leadops.listSuppliers()).find((s) => s.name === "Nur Lesen Lieferant")!;
    await owner.leadops.updateMembership({ id: S.viewerMembershipId, role: "manager" });
    const supplierUser = appRouter.createCaller({ user: { id: S.viewerId } } as never);
    const own = await supplierUser.leadops.importLead({ categoryId: S.wp.id, firstName: "Eigener", lastName: "Lead", supplierId: S.supplierId, metadata: { heizungsart: "Strom" } }); // fremde supplierId wird durch das eigene Profil ersetzt
    expect((await leadRow(own.publicId)).supplierId).toBe(supplier.id);
    const supplierView = await supplierUser.leadops.listLeadsPaged({ page: 1, pageSize: 100 });
    expect(supplierView.rows.map((r) => r.publicId)).toEqual([own.publicId]);
    await expect(supplierUser.leadops.deliverLead({ publicId: own.publicId })).rejects.toThrow("steht Lieferanten-Zugängen nicht zur Verfügung");
  });

  it("12. Benutzerbereich: Konto anlegen, Reiter-Einstellungen, Lieferant mit Token/Mappings, PrePing, Guthaben, Impersonation", async () => {
    const created = await owner.leadops.createMember({ firstName: "Karla", lastName: "Kunde", company: "Kunde GmbH", phone: "+49 40 1", email: "karla@kunde.example", password: "sicher-2026-xyz", kind: "benutzer", status: "aktiv", billingStreet: "Musterstraße 12", billingPostalCode: "20095", billingCity: "Hamburg", billingCountry: "DE" });
    expect(created.membershipId).toBeGreaterThan(0);
    const detail = await owner.leadops.getMemberDetail({ membershipId: created.membershipId });
    expect(detail.user).toMatchObject({ email: "karla@kunde.example", firstName: "Karla", company: "Kunde GmbH", billingCity: "Hamburg" });
    expect((detail.user as { passwordHash?: string }).passwordHash).toBeUndefined();
    expect(detail.membership).toMatchObject({ role: "manager", partnerType: "käufer", status: "aktiv" });
    expect(detail.settings).toMatchObject({ reclamationPeriodHours: 24, notifyLeads: true, duplicateProtection: true, inboundPrePing: true });

    // Reiter speichern
    await owner.leadops.updateMemberProfile({ membershipId: created.membershipId, salutation: "Frau", phone: "+49 40 2", inboundPrePing: false });
    await owner.leadops.updateMemberClaimSettings({ membershipId: created.membershipId, reclamationPeriodHours: 48, autoAcceptApiClaims: true, blockedClaimCategoryIds: [S.wp.id], excludedClaimReasonIds: [] });
    await owner.leadops.updateMemberBillingSettings({ membershipId: created.membershipId, paymentMode: "auf_rechnung", billingInterval: "14_tage", paymentTermsDays: 30, taxRatePercent: null });
    await owner.leadops.updateMemberNotificationSettings({ membershipId: created.membershipId, notifyLeads: true, notifyLeadsEmail: "leads@kunde.example", notifyInvoices: false, notifyInvoicesEmail: null, notifySystem: true, notifySystemEmail: null });
    await owner.leadops.updateMemberVisibility({ membershipId: created.membershipId, visibleAreas: ["Bestellungen", "Reklamationen"], visibleCategoryIds: [S.wp.id] });
    await owner.leadops.updateMemberWebhook({ membershipId: created.membershipId, webhookUrl: "https://hooks.kunde.example/leads" });
    const webhookTest = await owner.leadops.sendMemberWebhookTest({ membershipId: created.membershipId, categoryId: S.wp.id });
    expect(webhookTest).toMatchObject({ ok: true, status: 200 });
    expect(outbound[outbound.length - 1].body).toMatchObject({ test: true, lead: { firstName: "Test" } });
    const balance = await owner.leadops.adjustMemberBalance({ membershipId: created.membershipId, kind: "aufladung", amount: 250, description: "Überweisung 22.09.2026" });
    expect(balance.prepaidBalance).toBe("250.00");
    await owner.leadops.adjustMemberBalance({ membershipId: created.membershipId, kind: "abbuchung", amount: 50 });
    const saved = await owner.leadops.getMemberDetail({ membershipId: created.membershipId });
    expect(saved.user.salutation).toBe("Frau");
    expect(saved.settings).toMatchObject({ reclamationPeriodHours: 48, autoAcceptApiClaims: true, blockedClaimCategoryIds: [S.wp.id], paymentMode: "auf_rechnung", billingInterval: "14_tage", paymentTermsDays: 30, notifyLeadsEmail: "leads@kunde.example", notifyInvoices: false, visibleAreas: ["Bestellungen", "Reklamationen"], webhookUrl: "https://hooks.kunde.example/leads", prepaidBalance: "200.00", inboundPrePing: false });
    expect(saved.transactions.map((row) => `${row.kind} ${row.amount}`)).toEqual(["abbuchung 50.00", "aufladung 250.00"]);

    // Lieferant: freischalten, Token, Kategorie-/Feld-/Wert-Mapping, Import über den persönlichen Token
    const supplier = await owner.leadops.updateSupplierSettings({ membershipId: created.membershipId, supplierActive: true, commissionOnEverySale: false, commissionRates: { [String(S.wp.id)]: { type: "fix", value: 5 } } });
    expect(supplier.supplierId).toBeGreaterThan(0);
    const issued = await owner.leadops.issueSupplierToken({ membershipId: created.membershipId });
    expect(issued.token).toMatch(/^fx_/);
    expect((await owner.leadops.revealSupplierToken({ membershipId: created.membershipId })).token).toBe(issued.token);
    await owner.leadops.saveSupplierInboundMappings({ membershipId: created.membershipId, kind: "kategorie", rows: [{ kind: "kategorie", sourceValue: "PV-WP", targetValue: String(S.wp.id) }] });
    await owner.leadops.saveSupplierInboundMappings({ membershipId: created.membershipId, kind: "feld", rows: [{ kind: "feld", sourceValue: "Heizung", targetValue: "heizungsart" }] });
    await owner.leadops.saveSupplierInboundMappings({ membershipId: created.membershipId, kind: "wert", categoryId: S.wp.id, rows: [{ kind: "wert", categoryId: S.wp.id, fieldKey: "heizungsart", sourceValue: "gas heating", targetValue: "Gas", strict: true }] });
    const imported = await postLead(issued.token, { lead_type_id: "pv-wp", first_name: "Token", last_name: "Import", email: "token@kunde.example", zip_code: "20095", city: "Hamburg", country_code: "DE", custom_data: { Heizung: "gas heating", wohnflaeche: 100 } });
    expect(imported.status).toBe(201);
    const importedBody = await imported.json();
    expect(importedBody.supplierId).toBe(supplier.supplierId);
    const importedRow = await leadRow(importedBody.id);
    expect(importedRow.metadata).toMatchObject({ heizungsart: "Gas", wohnflaeche: 100 }); // Feldname und Wert übersetzt
    expect(importedRow.supplierId).toBe(supplier.supplierId); expect(importedRow.postcode).toBe("20095");
    expect((await postLead(issued.token, { lead_type_id: "unbekannt", first_name: "X" })).status).toBe(422); // „Lead type not found“
    const strict = await (await postLead(issued.token, { lead_type_id: "PV-WP", first_name: "Strikt", custom_data: { Heizung: "Kohle" } })).json();
    expect((await db.select().from(leadStatusEvents).where(eq(leadStatusEvents.leadId, (await leadRow(strict.id)).id)))[0].note).toContain("Verworfen beim Import: heizungsart (invalid_value)");

    // PrePing: Dublette per persönlichem Token → 409, wenn Mandant und Lieferant PrePing aktiv haben
    await owner.leadops.updateTenantSettings({ incomingPrePing: true });
    expect((await postLead(issued.token, { lead_type_id: "PV-WP", first_name: "Token", email: "token@kunde.example" })).status).toBe(201); // Lieferant hat PrePing aus
    await owner.leadops.updateMemberProfile({ membershipId: created.membershipId, inboundPrePing: true });
    const duplicate = await postLead(issued.token, { lead_type_id: "PV-WP", first_name: "Token", email: "token@kunde.example" });
    expect(duplicate.status).toBe(409); expect((await duplicate.json()).error).toBe("duplicated lead");
    await owner.leadops.updateTenantSettings({ incomingPrePing: false });
    await owner.leadops.issueSupplierToken({ membershipId: created.membershipId });
    expect((await postLead(issued.token, { lead_type_id: "PV-WP", first_name: "Alt" })).status).toBe(401); // rotierter Token ist ungültig

    // Provisionen und Aktivität
    const rangeNow = new Date();
    const commissions = await owner.leadops.listSupplierCommissions({ membershipId: created.membershipId, from: new Date(rangeNow.getTime() - 3_600_000).toISOString(), to: new Date(rangeNow.getTime() + 3_600_000).toISOString() });
    expect(commissions.rows.length).toBe(0); // noch kein Verkauf der Token-Leads
    const activity = await owner.leadops.listMemberActivity({ membershipId: created.membershipId });
    expect(activity.some((event) => event.kind === "guthaben")).toBe(true); expect(activity.some((event) => event.kind === "lead")).toBe(true);
    await owner.leadops.setMemberPassword({ membershipId: created.membershipId, password: "neu-2026-abcdef" });
    const cookies: Record<string, string> = {};
    const web = appRouter.createCaller({ user: null, req: { headers: {}, protocol: "http", hostname: "localhost" }, res: { cookie: (name: string, value: string) => { cookies[name] = value; }, clearCookie: () => undefined } } as never);
    await web.auth.login({ email: "karla@kunde.example", password: "neu-2026-abcdef" });
    expect(cookies.app_session_id).toBeTruthy();

    // Als Benutzer einloggen (Impersonation) und Rechteprüfung
    const adminWeb = appRouter.createCaller({ user: { id: ownerUserId }, req: { headers: {}, protocol: "http", hostname: "localhost" }, res: { cookie: (name: string, value: string) => { cookies[name] = value; }, clearCookie: () => undefined } } as never);
    const impersonated = await adminWeb.auth.impersonate({ membershipId: created.membershipId });
    expect(impersonated.name).toBe("Karla Kunde");
    const asKarla = appRouter.createCaller({ user: null, req: { headers: { cookie: `app_session_id=${cookies.app_session_id}` }, protocol: "http", hostname: "localhost" }, res: { cookie: (name: string, value: string) => { cookies[name] = value; }, clearCookie: () => undefined } } as never);
    const me = await asKarla.auth.me();
    expect(me).toBeNull(); // Kontext wird vom Server aus dem Cookie aufgebaut – hier prüfen wir die Claims direkt
    const { verifySession } = await import("./_core/auth");
    const claims = await verifySession(cookies.app_session_id);
    expect(claims?.actorOpenId).toBeTruthy();
    await expect(invitee.leadops.getMemberDetail({ membershipId: created.membershipId })).rejects.toThrow("vorbehalten");
  });

  it("13. Integration: ausgehende API-Calls mit Vorlage, Anmeldung per Token, Response-Mapping, Rückgabe-Webhook und Reklamations-API", async () => {
    const { membership } = (await db.select({ membership: memberships }).from(memberships).where(and(eq(memberships.tenantId, S.tenantId), eq(memberships.userId, inviteeUserId))))[0];
    const membershipId = membership.id; // Käufer-Mitgliedschaft (Bestellung S.orderId)
    const before = await owner.leadops.getMemberIntegration({ membershipId });
    expect(before.endpoints).toHaveLength(0); expect(before.placeholders).toContain("first_name");

    // Endpoint mit Vorlage, Header, Werte-Mapping und Anmeldung per Token
    const endpoint = await owner.leadops.saveDeliveryEndpoint({ membershipId, categoryId: S.wp.id, enabled: true, method: "POST", url: "https://partner-crm.example/secured/leads", sourceFilterMode: "alle", sourceSupplierIds: [], fieldFilters: [], headers: [{ name: "X-Api-Version", value: "2" }], authEnabled: true, auth: { loginUrl: "https://partner-crm.example/login", credentials: [{ name: "user", value: "tanesco" }, { name: "pass", value: "geheim" }], tokenPath: "auth_token", headerName: "X-AUTH-TOKEN", prefix: "", ttlMinutes: 60 }, bodyTemplate: '{ "inquiry": { "contact": { "first_name": "{{first_name}}", "last_name": "{{last_name}}", "email": "{{email}}", "zip_code": "{{postal_code}}" }, "questions": { "heizung": "{{custom_data.heizungsart}}" }, "language_code": "de" } }', omitAutoFields: false, rotate: false, valueMappings: [{ field: "heizungsart", ourValue: "Gas", customerCode: "222" }] });
    expect(endpoint.id).toBeGreaterThan(0);
    const saved = (await owner.leadops.getMemberIntegration({ membershipId })).endpoints[0];
    expect(saved.auth?.credentials.map((pair) => pair.value)).toEqual(["••••••••", "••••••••"]); // Zugangsdaten werden maskiert ausgeliefert
    const test = await owner.leadops.testDeliveryEndpoint({ membershipId, id: endpoint.id });
    expect(test).toMatchObject({ ok: true, status: 200 });
    expect(JSON.parse(test.requestBody)).toMatchObject({ lead_id: expect.stringMatching(/^TEST-/), inquiry: { contact: { first_name: "Test" }, questions: { heizung: "222" } } }); // Beispielwert „Gas“ → Kunden-Code

    // Echte Auslieferung: Lead (Gas) → Regel ordnet Bestellung zu → Endpoint statt Partnerintegration; Anmeldung, Header, Mapping, Partner-Referenz
    const start = outbound.length;
    const lead = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Endpoint", lastName: "Kunde", email: "endpoint@example.de", postcode: "60486", city: "Frankfurt", supplierId: S.supplierId, metadata: { heizungsart: "Gas", wohnflaeche: 130 } });
    expect(lead.automation.delivered).toBe(1);
    const calls = outbound.slice(start);
    const login = outbound.find((call) => call.url.endsWith("/login")); const delivery = calls.find((call) => call.url.includes("secured/leads")); // Anmeldung erfolgte beim Test-Versand, Token ist zwischengespeichert
    expect(login?.body).toEqual({ user: "tanesco", pass: "geheim" });
    expect(delivery?.headers["x-auth-token"]).toBe("tok-12345"); expect(delivery?.headers["x-api-version"]).toBe("2");
    expect(delivery?.body).toMatchObject({ lead_id: lead.publicId, inquiry: { contact: { first_name: "Endpoint", zip_code: "60486" }, questions: { heizung: "222" } } });
    const row = await leadRow(lead.publicId);
    expect(row.status).toBe("zugewiesen"); expect(row.metadata).toMatchObject({ partnerReference: expect.stringMatching(/^ah-/) });
    expect((await db.select().from(leadDeliveries).where(eq(leadDeliveries.leadId, row.id)))[0].result).toBe("angenommen");
    expect((await db.select().from(leadStatusEvents).where(eq(leadStatusEvents.leadId, row.id))).some((event) => event.note?.startsWith("API-Übergabe an API-Call"))).toBe(true);

    // Response-Mapping: Partner antwortet mit code 5 → Reklamation „Dublette“, Weitergabe an die nächste Kette
    await owner.leadops.applyAroundhomePreset({ membershipId });
    const mapped = await owner.leadops.getMemberIntegration({ membershipId });
    expect(mapped.responseMappingEnabled).toBe(true); expect(mapped.rules).toHaveLength(5); expect(mapped.reasons.map((reason) => reason.name)).toEqual(expect.arrayContaining(["Falsche Telefonnummer", "Kontaktdaten fehlen", "Kein Partner", "Dublette", "Sperrliste"]));
    await owner.leadops.saveDeliveryEndpoint({ membershipId, id: endpoint.id, categoryId: S.wp.id, enabled: true, method: "POST", url: "https://partner-crm.example/duplicate/leads", sourceFilterMode: "alle", sourceSupplierIds: [], fieldFilters: [], headers: [], authEnabled: false, auth: null, bodyTemplate: "", omitAutoFields: false, rotate: false, valueMappings: [] });
    const other = (await owner.leadops.listDeliveryChains()).find((c) => c.name === "Zweite Kette ohne Bestellung")!;
    await owner.leadops.updateDeliveryChain({ id: other.id, priority: 2 });
    const dup = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Doppelt", lastName: "Kunde", email: "doppelt@example.de", postcode: "60487", supplierId: S.supplierId, metadata: { heizungsart: "Öl" } });
    const dupRow = await leadRow(dup.publicId);
    const dupDeliveries = await db.select().from(leadDeliveries).where(eq(leadDeliveries.leadId, dupRow.id));
    expect(dupDeliveries.map((item) => item.result)).toEqual(["reklamiert", "angeboten"]); // Käufer lehnt ab (Mapping → Reklamation, weitergeben) → Ausweichkette
    const dupClaim = (await db.select().from(claims).where(eq(claims.leadId, dupRow.id)))[0];
    expect(dupClaim).toMatchObject({ reason: "Dublette", status: "genehmigt", refundAmount: "48.00" });
    await owner.leadops.updateDeliveryChain({ id: other.id, priority: 1 });

    // Quell-Filter: Endpoint nur für Leads eines anderen Lieferanten → kein Endpoint passt → Partnerintegration (Fallback) übernimmt
    await owner.leadops.saveDeliveryEndpoint({ membershipId, id: endpoint.id, categoryId: S.wp.id, enabled: true, method: "POST", url: "https://partner-crm.example/secured/leads", sourceFilterMode: "nur", sourceSupplierIds: [999999], fieldFilters: [], headers: [], authEnabled: false, auth: null, bodyTemplate: "", omitAutoFields: false, rotate: false, valueMappings: [] });
    const fallbackStart = outbound.length;
    await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Filter", lastName: "Kunde", supplierId: S.supplierId, metadata: { heizungsart: "Gas" } });
    expect(outbound.slice(fallbackStart).some((call) => call.url === "https://crm.partner-solar.example/api/leads")).toBe(true);
    expect(outbound.slice(fallbackStart).some((call) => call.url.includes("secured/leads"))).toBe(false);
    await owner.leadops.deleteDeliveryEndpoint({ membershipId, id: endpoint.id });

    // Rückgabe-Webhook des Lieferanten (Karla ist Lieferant, Test 12): erschöpfter Lead → Benachrichtigung mit returned=true
    const karla = (await db.select({ id: memberships.id, userId: memberships.userId }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.tenantId, S.tenantId), eq(users.email, "karla@kunde.example"))))[0];
    const karlaSupplier = (await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.userId, karla.userId)))[0];
    await owner.leadops.saveSupplierReturnWebhook({ membershipId: karla.id, categoryId: S.wp.id, enabled: true, method: "POST", url: "https://lieferant.example/rueckgabe", headers: [], bodyTemplate: '{ "lead": "{{lead_id}}", "grund": "{{reclaim_reason}}", "name": "{{first_name}} {{last_name}}" }', omitAutoFields: true });
    expect((await owner.leadops.testSupplierReturnWebhook({ membershipId: karla.id, categoryId: S.wp.id })).ok).toBe(true);
    await owner.leadops.updatePartnerIntegration({ id: S.integrationId, callbackUrl: "https://crm.partner-solar.example/api/reject" });
    await owner.leadops.saveOrderWorkspace({ orderId: S.orderId, name: "WP-Leads Q4", buyerName: "Partner Solar GmbH", buyerUserId: inviteeUserId, categoryId: S.wp.id, categoryIds: [S.wp.id], quantity: 50, unitPrice: 48, supplierId: null, supplierMode: "alle", supplierIds: [], deliveryInterval: "täglich", compensateClaims: true, priority: 1, realtimeDelivery: true, startsAt: null, endsAt: null, ongoing: true, deliveryDays: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"], deliveryArea: "landesweit", pauses: [], advancedFilters: { minAgeDays: null, maxLeadPrice: null, postcodes: null } }); // Lieferantensperre lösen, damit Karlas Lead an die Bestellung darf
    const returned = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Zurück", lastName: "Geber", supplierId: karlaSupplier.id, metadata: { heizungsart: "Strom" } });
    await owner.leadops.assignLeadsToOrder({ publicIds: [returned.publicId], orderId: S.orderId });
    const failed = await owner.leadops.deliverLead({ publicId: returned.publicId });
    expect(failed.result).toBe("abgelehnt");
    const hookCall = outbound.filter((call) => call.url === "https://lieferant.example/rueckgabe").pop();
    expect(hookCall?.body).toMatchObject({ lead: returned.publicId, name: "Zurück Geber", returned: true });
    await owner.leadops.updatePartnerIntegration({ id: S.integrationId, callbackUrl: "https://crm.partner-solar.example/api/leads" });

    // Reklamations-API: persönlicher Token des Käufers, Grund-Key, lead_number, Fenster, Auto-Annahme mit Weiterreichen
    const buyerToken = await owner.leadops.issueSupplierToken({ membershipId });
    const reclaimed = await fetch(`${apiBase}/api/reclaim`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${buyerToken.token}` }, body: JSON.stringify({ reason: "duplikat", lead_number: row.id, comment: "Kunde bereits bekannt" }) });
    expect(reclaimed.status).toBe(200);
    const reclaimBody = await reclaimed.json();
    expect(reclaimBody).toMatchObject({ reinjected: false, refund_cents: 0, status: "open" }); // Standard: offen, Prüfung durch den Mandanten
    expect((await db.select().from(claims).where(eq(claims.id, reclaimBody.reclamation_id)))[0]).toMatchObject({ leadId: row.id, reason: "Dublette", status: "offen" });
    expect((await fetch(`${apiBase}/api/reclaim`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${buyerToken.token}` }, body: JSON.stringify({ reason: "duplikat", lead_number: row.id }) })).status).toBe(409);
    expect((await fetch(`${apiBase}/api/reclaim`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${buyerToken.token}` }, body: JSON.stringify({ reason: "gibt_es_nicht", lead_number: row.id }) })).status).toBe(422);
    expect((await fetch(`${apiBase}/api/reclaim`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${S.token}` }, body: JSON.stringify({ reason: "duplikat", lead_number: row.id }) })).status).toBe(403); // mandantenweiter Token wird abgelehnt
    expect((await fetch(`${apiBase}/api/reclaim`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${buyerToken.token}` }, body: JSON.stringify({ reason: "duplikat", lead_id: S.leadC }) })).status).toBe(404); // nicht an diesen Käufer geliefert
    await owner.leadops.updateMemberClaimSettings({ membershipId, reclamationPeriodHours: 48, autoAcceptApiClaims: true, blockedClaimCategoryIds: [], excludedClaimReasonIds: [] });
    const autoLead = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Auto", lastName: "Annahme", email: "auto@example.de", supplierId: S.supplierId, metadata: { heizungsart: "Gas" } });
    const autoRow = await leadRow(autoLead.publicId);
    const auto = await (await fetch(`${apiBase}/api/reclaim`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${buyerToken.token}` }, body: JSON.stringify({ reason: "duplikat", partner_lead_id: (autoRow.metadata as { partnerReference?: string }).partnerReference }) })).json();
    expect(auto).toMatchObject({ status: "approved", refund_cents: 4800, reinjected: true }); // per Partner-Referenz gefunden, genehmigt, an die Ausweichkette weitergereicht
    expect((await leadRow(autoLead.publicId)).status).toBe("zugewiesen");
    expect((await db.select().from(leadDeliveries).where(eq(leadDeliveries.leadId, autoRow.id))).map((item) => item.buyerName)).toEqual(["Partner Solar GmbH", "Anderer Käufer"]);
  });

  it("14. Einstellungen → Integrationen: Aroundhome-Abgleich mit Storno-Reklamation, WattFox-Tracking-URL, Telefonnummern-Prüfung, „Weitergeben“", async () => {
    // Reklamationsgrund-Schalter „Weitergeben“
    const reasons = await owner.leadops.listReclamationReasons();
    const dublette = reasons.find((reason) => reason.name === "Dublette")!;
    await owner.leadops.updateReclamationReason({ id: dublette.id, forwardToNextStop: false });
    expect((await owner.leadops.listReclamationReasons()).find((reason) => reason.id === dublette.id)!.forwardToNextStop).toBe(false);
    await owner.leadops.updateReclamationReason({ id: dublette.id, forwardToNextStop: true });

    // Aroundhome-Konto + Stornogrund-Zuordnung
    const account = await owner.leadops.saveAroundhomeAccount({ label: "Aroundhome PV", publisherId: "pub-4711", accessToken: "ah-token-secret", exportUrl: "https://partner.example/aroundhome-export", reclaimOnCancel: true, reclaimReasonId: null, enabled: true });
    const kontakt = reasons.find((reason) => reason.name === "Kontaktdaten fehlen")!;
    await owner.leadops.saveCancelRules({ provider: "aroundhome", rules: [{ matchOp: "enthaelt", matchValue: "nicht erreichbar", reasonId: kontakt.id }] });
    const listed = await owner.leadops.listPartnerAccounts();
    expect(listed.aroundhome[0]).toMatchObject({ label: "Aroundhome PV", publisherId: "pub-4711", accessToken: "••••••••cret", exportUrl: "https://partner.example/aroundhome-export" });
    expect(listed.cancelRules).toEqual([expect.objectContaining({ provider: "aroundhome", matchValue: "nicht erreichbar", reasonId: kontakt.id })]);
    // ein an Partner Solar gelieferter Lead mit Partner-Referenz → im Export storniert → Reklamation mit zugeordnetem Grund
    const delivered = (await db.select().from(leads).where(and(eq(leads.tenantId, S.tenantId), sql`JSON_EXTRACT(${leads.metadata}, '$.partnerReference') IS NOT NULL`))).find((lead) => lead.status === "zugewiesen")!;
    S.aroundhomeRef = (delivered.metadata as { partnerReference: string }).partnerReference;
    const sync = await owner.leadops.syncAroundhomeAccount({ id: account.id });
    expect(sync).toMatchObject({ rows: 3, matched: 1, cancelled: 1, claimsCreated: 1 });
    expect(outbound[outbound.length - 1].headers.authorization).toBe("Bearer ah-token-secret");
    const cancelClaim = (await db.select().from(claims).where(eq(claims.leadId, delivered.id)).orderBy(desc(claims.id)))[0];
    expect(cancelClaim).toMatchObject({ reason: "Kontaktdaten fehlen", status: "offen", details: expect.stringContaining("Kunde nicht erreichbar") });
    expect((await owner.leadops.syncAroundhomeAccount({ id: account.id })).claimsCreated).toBe(0); // kein Doppel
    expect((await owner.leadops.listPartnerAccounts()).aroundhome[0].lastSyncSummary).toContain("3 Vorgänge gelesen");

    // WattFox-Tracking-URL: Storno per GET → Reklamation über Code-Zuordnung; Info-Status → nur Verlaufseintrag
    const wattfox = await owner.leadops.createWattfoxAccount({ label: "WattFox WP", reclaimOnCancel: true, reclaimReasonId: null });
    await owner.leadops.saveCancelRules({ provider: "wattfox", rules: [{ matchOp: "gleich", matchValue: "dup", reasonId: dublette.id }] });
    const trackingUrl = (await owner.leadops.listPartnerAccounts()).wattfox.find((row) => row.id === wattfox.id)!.trackingUrl.replace(/^https?:\/\/[^/]+/, apiBase);
    const fresh = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Watt", lastName: "Fox", supplierId: S.supplierId, metadata: { heizungsart: "Strom" } });
    expect((await fetch(`${trackingUrl}?lead_id=${fresh.publicId}&status=accepted`)).status).toBe(200);
    const cancelled = await (await fetch(trackingUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lead_id: fresh.publicId, status: "cancelled", code: "dup" }) })).json();
    expect(cancelled).toMatchObject({ ok: true, cancelled: true, lead_id: fresh.publicId }); expect(cancelled.reclamation_id).toBeGreaterThan(0);
    expect((await db.select().from(claims).where(eq(claims.id, cancelled.reclamation_id)))[0]).toMatchObject({ reason: "Dublette", status: "offen" });
    expect((await fetch(`${trackingUrl}?lead_id=GIBTSNICHT&status=cancelled`)).status).toBe(404);
    expect((await fetch(`${apiBase}/api/partner/wattfox/falscher-token?lead_id=${fresh.publicId}`)).status).toBe(404);

    // Telefonnummern-Prüfung: Zugangsdaten, Verbindungstest, ungültige Nummer beim API-Import → fehlerhaft
    await owner.leadops.saveHlrLookup({ apiKey: "hlr-key", apiSecret: "hlr-pass", enabled: true });
    const hlrTest = await owner.leadops.testHlrLookup();
    expect(hlrTest.ok).toBe(true); expect(hlrTest.summary).toContain("Telekom");
    expect((await owner.leadops.listPartnerAccounts()).hlrlookup).toMatchObject({ enabled: true, apiKey: "••••••••-key", apiSecret: "••••••••" });
    const badPhone = await (await postLead(S.token, { categoryId: S.wp.id, firstName: "Falsche", lastName: "Nummer", phone: "+49 170 9999999", metadata: { heizungsart: "Strom" } })).json();
    const badRow = await leadRow(badPhone.id);
    expect(badRow.status).toBe("fehlerhaft"); expect(badRow.metadata).toMatchObject({ phoneCheck: { valid: false } });
    const goodPhone = await (await postLead(S.token, { categoryId: S.wp.id, firstName: "Gute", lastName: "Nummer", phone: "+49 170 0000000", metadata: { heizungsart: "Strom" } })).json();
    expect((await leadRow(goodPhone.id)).metadata).toMatchObject({ phoneCheck: { valid: true, network: "Telekom" } });
    await owner.leadops.saveHlrLookup({ apiKey: "••••••••-key", apiSecret: "••••••••", enabled: false });
    expect((await owner.leadops.listPartnerAccounts()).hlrlookup.enabled).toBe(false);
    await expect(invitee.leadops.listPartnerAccounts()).rejects.toThrow("vorbehalten");
  });

  it("15. Gesprächsbewertung: Dialer-Webhook, Einwilligung, Transkription, KI-Bewertung, automatische Freigabe/Ablehnung, manuelle Prüfung", async () => {
    const settings = await owner.leadops.getCallQaSettings();
    expect(settings.enabled).toBe(false); expect(settings.criteria).toHaveLength(6); expect(settings.webhookUrl).toContain("/api/partner/dialer/");
    const dialerUrl = settings.webhookUrl.replace(/^https?:\/\/[^/]+/, apiBase);
    expect((await fetch(dialerUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ call_id: "x" }) })).status).toBe(403); // noch deaktiviert
    await expect(owner.leadops.saveCallQaSettings({ ...settings, enabled: true, instructions: "", autoApproveThreshold: 50, autoRejectThreshold: 60, recordingAuthHeader: "" })).rejects.toThrow("Ablehnungs-Schwelle");
    await owner.leadops.saveCallQaSettings({ ...settings, enabled: true, instructions: "Mieter gelten nicht als verkaufbar.", recordingAuthHeader: "X-Recording-Key: geheim-77", transcriptionProvider: "auto" });
    expect((await owner.leadops.getCallQaSettings()).recordingAuthHeader).toBe("••••••••");

    // (a) Gespräch mit Einwilligung → Aufzeichnung geladen (mit Schlüssel), transkribiert, bewertet, Lead freigegeben und über die Regeln ausgeliefert
    const lead = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Anke", lastName: "Anruf", phone: "+49 40 777001", email: "anke@example.de", supplierId: S.supplierId, metadata: { heizungsart: "Strom" } });
    await owner.leadops.updateLeadStatus({ publicId: lead.publicId, status: "hängend" }); // wartet auf die Gesprächsbewertung
    await owner.leadops.createAutomationRule({ name: "Freigegebene Gespräche verkaufen", triggerType: "status_geändert", sourceCategoryId: S.wp.id, targetCategoryId: S.wp.id, conditions: [{ field: "status", operator: "gleich", value: "genehmigt" }], actionType: "lead_bestellung_zuordnen", actionConfig: { orderId: S.orderId }, status: "aktiv" });
    S.transcriptForStub = "Agent: Guten Tag Frau Anruf, es geht um Ihre Wärmepumpen-Anfrage. Kundin: Ja gerne, ich bin Eigentümerin und einverstanden, dass sich ein Fachbetrieb meldet. Agent: Passt ein Termin vor Ort in den nächsten Wochen? Kundin: Ja gerne, passt. Agent: Dürfen wir Sie vorher anrufen? Kundin: Ja, telefonisch bin ich gut erreichbar."; // Kampagnenfragen (Standard): Interesse, Termin, Kontaktaufnahme → freigegeben
    const before = outbound.length;
    const webhook = await fetch(dialerUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ call_id: "od-1001", lead_id: lead.publicId, phone: "+49 40 777001", agent: "Müller", campaign: "WP Herbst", started_at: "2026-09-23T10:15:00Z", duration: 312, recording_url: "https://dialer.example/recordings/1001.mp3", consent: true }) });
    expect(webhook.status).toBe(200);
    const result = await webhook.json();
    expect(result).toMatchObject({ ok: true, evaluated: true, score: 90, verdict: "verkaufbar", decision: "freigegeben", lead_id: lead.publicId });
    const recordingCall = outbound.slice(before).find((call) => call.url.includes("recordings/1001.mp3"));
    expect(recordingCall?.headers["x-recording-key"]).toBe("geheim-77");
    expect(outbound.slice(before).some((call) => call.url.includes("api.openai.com/v1/audio/transcriptions") && call.headers.authorization === "Bearer test-openai-key")).toBe(true);
    const row = await leadRow(lead.publicId);
    expect(row.status).toBe("zugewiesen"); // freigegeben → Regel → Bestellung → Echtzeit-Auslieferung
    expect(row.metadata).toMatchObject({ callScore: 90, callVerdict: "verkaufbar", callDecision: "freigegeben" });
    const notes = (await db.select().from(leadStatusEvents).where(eq(leadStatusEvents.leadId, row.id))).map((event) => event.note ?? "");
    expect(notes.some((note) => note.startsWith("Gesprächsbewertung 90/100"))).toBe(true);
    const calls = await owner.leadops.listCalls({});
    const call = calls.find((item) => item.externalCallId === "od-1001")!;
    expect(call).toMatchObject({ leadPublicId: lead.publicId, agentName: "Müller", campaign: "WP Herbst", durationSeconds: 312, consent: true, status: "bewertet", score: 90, decision: "freigegeben", decidedBy: "automatisch" });
    const detail = await owner.leadops.getCall({ callId: call.id });
    expect(detail.transcript).toContain("Eigentümerin"); expect(detail.criteria.every((criterion) => criterion.score === 9)).toBe(true); expect(detail.criteria[0].evidence).toBe("Beleg bedarf");
    expect((await fetch(dialerUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ call_id: "od-1001", lead_id: lead.publicId, consent: true }) })).status).toBe(200); // Duplikat wird nicht erneut bewertet
    expect((await owner.leadops.listCalls({})).filter((item) => item.externalCallId === "od-1001")).toHaveLength(1);

    // (b) ohne Einwilligung → nichts transkribiert (202), Verlaufseintrag am Lead
    const noConsent = await fetch(dialerUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ call_id: "od-1002", phone: "+49 40 777001", recording_url: "https://dialer.example/recordings/1002.mp3", consent: false }) });
    expect(noConsent.status).toBe(202); expect((await noConsent.json()).evaluated).toBe(false);
    expect((await owner.leadops.listCalls({ status: "ohne_einwilligung" }))[0]).toMatchObject({ externalCallId: "od-1002", leadPublicId: lead.publicId }); // Lead über die Telefonnummer gefunden
    await expect(owner.leadops.reevaluateCall({ callId: (await owner.leadops.listCalls({ status: "ohne_einwilligung" }))[0].id })).rejects.toThrow("Einwilligung");

    // (c) Warnsignal → zurückgewiesen, Lead fehlerhaft; Transkript kommt direkt vom Dialer
    const angry = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Bernd", lastName: "Böse", phone: "+49 40 777002", supplierId: S.supplierId, metadata: { heizungsart: "Strom" } });
    const rejected = await (await fetch(dialerUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ call_id: "od-1003", lead_id: angry.publicId, consent: true, transcript: "Agent: Hallo. Kunde: Ich möchte nicht angerufen werden, bitte meine Daten löschen." }) })).json();
    expect(rejected).toMatchObject({ evaluated: true, verdict: "nicht_verkaufbar", decision: "zurueckgewiesen" });
    expect((await leadRow(angry.publicId)).status).toBe("fehlerhaft");

    // (d) mittlere Bewertung → zur Prüfung; manuelle Freigabe verkauft den Lead
    const maybe = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Mia", lastName: "Mittel", phone: "+49 40 777003", supplierId: S.supplierId, metadata: { heizungsart: "Strom" } });
    const pending = await (await fetch(dialerUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ call_id: "od-1004", lead_id: maybe.publicId, consent: true, transcript: "Agent: Hallo. Kunde: Ich überlege noch." }) })).json();
    expect(pending).toMatchObject({ score: 50, verdict: "nachfassen", decision: "pruefen" });
    expect((await leadRow(maybe.publicId)).status).toBe("hängend");
    await owner.leadops.reviewCall({ callId: pending.call_id, decision: "freigegeben", note: "Rückruf war positiv." });
    expect((await leadRow(maybe.publicId)).status).toBe("zugewiesen");
    expect((await owner.leadops.getCall({ callId: pending.call_id }))).toMatchObject({ decision: "freigegeben", decidedBy: "manuell", reviewNote: "Rückruf war positiv." });

    // (e) Test-Bewertung ohne Dialer, Statistik, Token-Rotation, Aufbewahrung
    const simulated = await owner.leadops.simulateCall({ transcript: "Agent: Guten Tag. Kunde: Ja gerne, ich bin Eigentümer und einverstanden. Agent: Passt ein Termin vor Ort in den nächsten Wochen? Kunde: Ja gerne. Agent: Dürfen wir Sie vorher anrufen? Kunde: Ja, telefonisch erreichbar.", publicId: null, agentName: "Test" });
    expect(simulated).toMatchObject({ status: "bewertet", score: 90, decision: "freigegeben" });
    const stats = await owner.leadops.callStatistics();
    expect(stats).toMatchObject({ total: 5, evaluated: 4, approved: 3, rejected: 1, noConsent: 1 });
    const rotated = await owner.leadops.rotateCallQaToken();
    expect((await fetch(dialerUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ call_id: "od-1005", consent: true }) })).status).toBe(404);
    expect(rotated.webhookToken).toHaveLength(40);
    await owner.leadops.saveCallQaSettings({ ...settings, enabled: true, instructions: "", recordingAuthHeader: "••••••••", retentionDays: 1 });
    await db.update(callRecords).set({ createdAt: new Date(Date.now() - 3 * 24 * 3_600_000) }).where(eq(callRecords.externalCallId, "od-1001"));
    const { purgeExpiredCalls } = await import("./call-qa");
    expect((await purgeExpiredCalls(db as never)).purged).toBe(1);
    const purged = await owner.leadops.getCall({ callId: call.id });
    expect(purged.transcript).toBeNull(); expect(purged.recordingUrl).toBeNull(); expect(purged.score).toBe(90);
    await expect(invitee.leadops.getCallQaSettings()).rejects.toThrow("vorbehalten");
  });

  it("16. Telefonie: Rufnummern DE/AT/CH, Kampagnen, manueller Dialer, Power-Dialer, Predictive-Dialer, Ergebnisse und Übergabe an die Bewertung", async () => {
    const settings = await owner.leadops.getTelephonySettings();
    expect(settings.provider).toBe("simulation"); expect(settings.numbers).toHaveLength(0);
    await owner.leadops.saveTelephonySettings({ provider: "simulation", credentials: settings.credentials, addressSid: "", bundleSids: settings.bundleSids, defaultNumberId: null, agentConnection: "browser", announcement: settings.announcement ?? "", consentMode: "ansage", recordCalls: true, amdEnabled: true, maxAttempts: 2, retryMinutes: 60, wrapUpSeconds: 30, pacingRatio: 2, maxAbandonRate: 3, callWindow: { weekdays: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } });
    // Rufnummern suchen und kaufen (DE lokal, AT mobil, CH national)
    const de = await owner.leadops.searchPhoneNumbers({ country: "DE", type: "lokal", contains: "30" });
    expect(de.length).toBeGreaterThan(0); expect(de[0].e164.startsWith("+4930")).toBe(true); expect(de[0].monthlyPrice).toBe(1.15);
    const bought = await owner.leadops.purchasePhoneNumber({ e164: de[0].e164, country: "DE", type: "lokal", region: de[0].region, monthlyPrice: de[0].monthlyPrice, currency: "EUR" });
    const at = await owner.leadops.searchPhoneNumbers({ country: "AT", type: "mobil" }); await owner.leadops.purchasePhoneNumber({ e164: at[0].e164, country: "AT", type: "mobil" });
    const ch = await owner.leadops.searchPhoneNumbers({ country: "CH", type: "national" }); const swiss = await owner.leadops.purchasePhoneNumber({ e164: ch[0].e164, country: "CH", type: "national" });
    const withNumbers = await owner.leadops.getTelephonySettings();
    expect(withNumbers.numbers.map((number) => number.country)).toEqual(["DE", "AT", "CH"]); expect(withNumbers.defaultNumberId).toBe(bought.id);
    await owner.leadops.releasePhoneNumber({ id: swiss.id });
    expect((await owner.leadops.getTelephonySettings()).numbers).toHaveLength(2);
    await expect(owner.leadops.placeManualCall({ phone: "+49 170 1111114" })).rejects.toThrow("Sitzung");

    // Manueller Anruf (Simulation: Endziffer 4 → Mensch), Auflegen → Aufzeichnung → Bewertung → Ergebnis „verkauft“ → Lead genehmigt + Automatisierung
    const lead = await owner.leadops.importLead({ categoryId: S.wp.id, firstName: "Doris", lastName: "Dialer", phone: "+49 170 2222224", supplierId: S.supplierId, metadata: { heizungsart: "Strom" } });
    await owner.leadops.updateLeadStatus({ publicId: lead.publicId, status: "hängend" });
    const session = await owner.leadops.startDialerSession({ campaignId: null, mode: "manuell", connection: "browser" });
    expect(session).toMatchObject({ mode: "manuell", status: "bereit", campaign: null });
    const instruction = await owner.leadops.placeManualCall({ publicId: lead.publicId });
    expect(instruction).toMatchObject({ mode: "manuell", connection: "simulation" });
    const during = await owner.leadops.currentDialerSession();
    expect(during?.status).toBe("im_gespraech"); expect(during?.call).toMatchObject({ status: "verbunden", toNumber: "+491702222224", fromNumber: de[0].e164, amdResult: "human" });
    await expect(owner.leadops.placeManualCall({ phone: "+49 170 3333334" })).rejects.toThrow("bereits ein Anruf");
    S.transcriptForStub = "Agent: Guten Tag Frau Dialer. Kundin: Ja gerne, ich bin Eigentümerin und einverstanden. Agent: Termin vor Ort nächste Woche? Kundin: Ja gerne, passt. Agent: Dürfen wir Sie anrufen? Kundin: Ja, telefonisch erreichbar.";
    const ended = await owner.leadops.endDialerCall({ callId: instruction.callId, durationSeconds: 300 });
    expect(ended).toMatchObject({ status: "beendet", talkSeconds: 300, recordingUrl: expect.stringContaining("simulation.local/recordings/") });
    expect(ended?.evaluation).toMatchObject({ score: 90, verdict: "verkaufbar", decision: "freigegeben" }); // Ansage-Modus: Einwilligung dokumentiert → bewertet
    expect((await owner.leadops.currentDialerSession())?.status).toBe("nachbereitung");
    expect(ended?.autoNotes).toBe(true); expect(ended?.summary).toContain("📞 Gesprächsnotiz (automatisch)"); expect(ended?.summary).toContain("Termin besprochen"); // automatische Notiz direkt nach dem Gespräch (Transkript-Kurzfassung ohne KI-Schlüssel)
    const dispositioned = await owner.leadops.setCallDisposition({ callId: instruction.callId, disposition: "verkauft", notes: "Termin vereinbart" });
    expect(dispositioned?.disposition).toBe("verkauft");
    expect(dispositioned?.summary).toContain("Ergebnis: Verkauft / Termin"); expect(dispositioned?.summary).toContain("Notiz des Agenten: Termin vereinbart");
    const autoNotes = await owner.leadops.listPipelineNotes({ publicId: lead.publicId }); expect(autoNotes.filter((note) => note.source === "gespraech")).toHaveLength(1); expect(autoNotes[0].text).toBe(dispositioned?.summary); // eine Notiz je Anruf, aktualisiert statt verdoppelt
    expect((await db.select().from(leadStatusEvents).where(eq(leadStatusEvents.leadId, (await leadRow(lead.publicId)).id))).some((event) => String(event.note ?? "").startsWith("📞 Gesprächsnotiz"))).toBe(true); // auch im Verlauf des Leads
    expect((await leadRow(lead.publicId)).status).toBe("zugewiesen"); // genehmigt → Regel aus Test 15 → Bestellung → Auslieferung
    expect((await owner.leadops.currentDialerSession())?.status).toBe("bereit");

    // Aufzeichnung ohne Einwilligungsabfrage (Einstellung): kein Klick nötig, Bewertung läuft trotzdem, Quelle dokumentiert
    await owner.leadops.saveTelephonySettings({ provider: "simulation", credentials: settings.credentials, addressSid: "", bundleSids: settings.bundleSids, defaultNumberId: null, agentConnection: "browser", announcement: settings.announcement ?? "", consentMode: "agent_button", recordCalls: true, recordWithoutConsent: true, amdEnabled: true, maxAttempts: 2, retryMinutes: 60, wrapUpSeconds: 30, pacingRatio: 2, maxAbandonRate: 3, callWindow: { weekdays: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } });
    expect((await owner.leadops.getTelephonySettings()).recordWithoutConsent).toBe(true);
    const silentLead = await owner.leadops.importLead({ categoryId: S.pv.id, firstName: "Ohne", lastName: "Abfrage", phone: "+49 170 2222229", supplierId: S.supplierId, metadata: { dachtyp: "Satteldach", eigentuemer: "Ja" } });
    const silentCall = await owner.leadops.placeManualCall({ publicId: silentLead.publicId });
    S.transcriptForStub = "Agent: Guten Tag Herr Abfrage. Kunde: Ja, ich bin Eigentümer und einverstanden, ein Fachbetrieb darf sich melden. Agent: Danke.";
    const silentEnded = await owner.leadops.endDialerCall({ callId: silentCall.callId, durationSeconds: 120 });
    expect(silentEnded?.consentAt).toBeNull(); expect(silentEnded?.evaluation?.status).toBe("bewertet"); // ohne Agenten-Klick bewertet
    expect((await db.select().from(callRecords).where(eq(callRecords.id, silentEnded!.callRecordId!)))[0]).toMatchObject({ consent: true, consentSource: expect.stringContaining("ohne Abfrage") });
    expect(silentEnded?.summary).toContain("Eigentümer bestätigt");
    await owner.leadops.setCallDisposition({ callId: silentCall.callId, disposition: "interessiert" });
    await owner.leadops.saveTelephonySettings({ provider: "simulation", credentials: settings.credentials, addressSid: "", bundleSids: settings.bundleSids, defaultNumberId: null, agentConnection: "browser", announcement: settings.announcement ?? "", consentMode: "ansage", recordCalls: true, recordWithoutConsent: false, amdEnabled: true, maxAttempts: 2, retryMinutes: 60, wrapUpSeconds: 30, pacingRatio: 2, maxAbandonRate: 3, callWindow: { weekdays: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } });
    await owner.leadops.updateDialerSession({ status: "offline" }); await owner.leadops.startDialerSession({ campaignId: null, mode: "manuell", connection: "browser" });
    // Kampagne + Wählliste + Power-Dialer (nacheinander), Anrufbeantworter/besetzt → Wiederholung
    const leads: Array<{ publicId: string }> = []; for (const [firstName, phone] of [["Anna", "+49 170 4444440"], ["Bert", "+49 170 4444442"], ["Cem", "+49 170 4444445"]]) leads.push(await owner.leadops.importLead({ categoryId: S.wp.id, firstName, lastName: "Power", phone, supplierId: S.supplierId, metadata: { heizungsart: "Strom" } }));
    for (const item of leads) await owner.leadops.updateLeadStatus({ publicId: item.publicId, status: "hängend" });
    const campaign = await owner.leadops.saveDialerCampaign({ name: "WP Power", mode: "power", leadFilter: { categoryIds: [S.wp.id], statuses: ["hängend"], onlyWithoutCall: true }, callerNumberId: null, maxAttempts: null, retryMinutes: 1, wrapUpSeconds: 0, pacingRatio: null, callWindow: null, script: "Guten Tag, hier ist …" });
    const built = await owner.leadops.buildDialerQueue({ campaignId: campaign.id });
    expect(built.added).toBe(3);
    expect((await owner.leadops.buildDialerQueue({ campaignId: campaign.id })).added).toBe(0); // kein Doppel
    await expect(owner.leadops.nextDialerCall()).rejects.toThrow("Sitzung mit Kampagne");
    await owner.leadops.startDialerSession({ campaignId: campaign.id, mode: "power", connection: "browser" });
    await expect(owner.leadops.nextDialerCall()).rejects.toThrow("nicht aktiv");
    await owner.leadops.setDialerCampaignStatus({ id: campaign.id, status: "aktiv" });
    // Automatische Notiz: Schalter global aus → Kampagne an (gilt vor dem Standard) → im Dialer sichtbar
    await owner.leadops.setAutoCallNotes({ scope: "global", enabled: false }); expect((await owner.leadops.getTelephonySettings()).autoCallNotes).toBe(false); expect((await owner.leadops.currentDialerSession())?.autoNotes).toBe(false);
    await owner.leadops.setAutoCallNotes({ scope: "kampagne", campaignId: campaign.id, enabled: true }); expect((await owner.leadops.currentDialerSession())?.autoNotes).toBe(true);
    const first = await owner.leadops.nextDialerCall(); // Anna …0 → Anrufbeantworter
    expect(first.done).toBe(false);
    let current = await owner.leadops.currentDialerSession();
    expect(current?.status).toBe("bereit"); // Anrufbeantworter → sofort frei
    const queueAfterFirst = await owner.leadops.listDialerQueue({ campaignId: campaign.id });
    expect(queueAfterFirst.find((item) => item.name.startsWith("Anna"))).toMatchObject({ status: "wiederholen", attempts: 1, lastResult: "anrufbeantworter" });
    const second = await owner.leadops.nextDialerCall(); // Bert …2 → besetzt
    expect(second.done).toBe(false);
    expect((await owner.leadops.listDialerQueue({ campaignId: campaign.id })).find((item) => item.name.startsWith("Bert"))).toMatchObject({ status: "wiederholen", lastResult: "besetzt" });
    const third = await owner.leadops.nextDialerCall(); // Cem …5 → Mensch
    current = await owner.leadops.currentDialerSession();
    expect(current?.status).toBe("im_gespraech"); expect(current?.call?.lead?.name).toBe("Cem Power");
    await owner.leadops.setAutoCallNotes({ scope: "anruf", callId: third.instruction!.callId, enabled: false }); // für diesen Anruf ausgeschaltet
    await owner.leadops.endDialerCall({ callId: third.instruction!.callId, durationSeconds: 120 });
    const thirdResult = await owner.leadops.setCallDisposition({ callId: third.instruction!.callId, disposition: "wiedervorlage", notes: "Rückruf morgen", followUpMinutes: 1440 });
    expect(thirdResult?.autoNotes).toBe(false); expect(thirdResult?.summary).toBeNull(); expect((await owner.leadops.listPipelineNotes({ publicId: leads[2].publicId })).length).toBe(0);
    await owner.leadops.setAutoCallNotes({ scope: "global", enabled: true }); await owner.leadops.setAutoCallNotes({ scope: "kampagne", campaignId: campaign.id, enabled: null }); // zurück auf Standard an
    expect((await owner.leadops.listDialerQueue({ campaignId: campaign.id })).find((item) => item.name.startsWith("Cem"))).toMatchObject({ status: "wiederholen", lastResult: "wiedervorlage" });
    expect((await owner.leadops.nextDialerCall()).done).toBe(true); // alles wartet auf Wiederholung
    const stats = (await owner.leadops.listDialerCampaigns()).find((item) => item.id === campaign.id)!.stats;
    expect(stats).toMatchObject({ queue: 3, open: 3, calls: 3, connected: 1 });
    await owner.leadops.updateDialerSession({ status: "offline" });
    expect(await owner.leadops.currentDialerSession()).toBeNull();

    // Predictive: zwei bereite Agenten (Owner + Invitee), Wählfaktor 2 → bis zu 4 gleichzeitige Anrufe, Menschen werden an Agenten vermittelt, Überschuss abgebrochen
    await owner.leadops.createTag({ name: "Predictive-Test", color: "#7c6cff" }); const tag = (await owner.leadops.listTags()).find((row) => row.name === "Predictive-Test")!;
    for (const [firstName, phone] of [["P1", "+49 170 5555554"], ["P2", "+49 170 5555555"], ["P3", "+49 170 5555556"], ["P4", "+49 170 5555557"], ["P5", "+49 170 5555550"]]) { const created = await owner.leadops.importLead({ categoryId: S.wp.id, firstName, lastName: "Predictive", phone, supplierId: S.supplierId, metadata: { heizungsart: "Strom" } }); await owner.leadops.assignLeadTag({ publicId: created.publicId, tagId: tag.id }); }
    const predictiveLeads = null;
    void predictiveLeads;
    const predictive = await owner.leadops.saveDialerCampaign({ name: "WP Predictive", mode: "predictive", leadFilter: { categoryIds: [S.wp.id], statuses: ["neu"], tagIds: [tag.id] }, callerNumberId: null, maxAttempts: null, retryMinutes: null, wrapUpSeconds: 0, pacingRatio: 2, callWindow: null, script: "" });
    expect((await owner.leadops.buildDialerQueue({ campaignId: predictive.id })).added).toBe(5);
    await owner.leadops.setDialerCampaignStatus({ id: predictive.id, status: "aktiv" });
    // zweiter Agent: der interne Vertriebsnutzer aus Test 2 (Käufer-Zugänge dürfen nicht telefonieren)
    const agentUserId = (await db.select({ id: users.id }).from(users).where(eq(users.name, "Neu Mitglied")))[0].id;
    const agent = appRouter.createCaller({ user: { id: agentUserId } } as never);
    await expect(invitee.leadops.startDialerSession({ campaignId: predictive.id, mode: "predictive", connection: "browser" })).rejects.toThrow("Käufer");
    await owner.leadops.startDialerSession({ campaignId: predictive.id, mode: "predictive", connection: "browser" });
    await agent.leadops.startDialerSession({ campaignId: predictive.id, mode: "predictive", connection: "telefon", agentPhone: "+49 40 12345" });
    expect((await owner.leadops.listDialerSessions()).filter((row) => row.campaignId === predictive.id)).toHaveLength(2);
    const tick = await owner.leadops.runPredictiveTick();
    expect(tick.dialed).toBe(4); // 2 Agenten × Faktor 2
    const ownerSession = await owner.leadops.currentDialerSession(); const inviteeSession = await agent.leadops.currentDialerSession();
    expect([ownerSession?.status, inviteeSession?.status].filter((status) => status === "im_gespraech").length).toBe(2);
    const predictiveCalls = await owner.leadops.listDialerCalls({ campaignId: predictive.id });
    expect(predictiveCalls.filter((call) => call.status === "verbunden")).toHaveLength(2);
    expect(predictiveCalls.filter((call) => call.status === "wartet")).toHaveLength(2); // Menschen ohne freien Agenten warten
    const later = await owner.leadops.runPredictiveTick(); // Wartende > 5 s ohne Agent → abgebrochen (hier direkt, da Zeit simuliert wird)
    void later;
    S.transcriptForStub = "Agent: Hallo. Kunde: Ich möchte nicht angerufen werden, bitte meine Daten löschen."; // Bewertung: Warnsignal → zurückgewiesen
    const ownerEnded = await owner.leadops.endDialerCall({ callId: ownerSession!.call!.id, durationSeconds: 90 });
    expect(ownerEnded?.evaluation).toMatchObject({ verdict: "nicht_verkaufbar", decision: "zurueckgewiesen" });
    expect((await leadRow(ownerSession!.call!.lead!.publicId)).status).toBe("fehlerhaft");
    await owner.leadops.setCallDisposition({ callId: ownerSession!.call!.id, disposition: "kein_interesse" });
    expect((await leadRow(ownerSession!.call!.lead!.publicId)).status).toBe("deaktiviert");
    await owner.leadops.updateDialerSession({ status: "offline" }); await agent.leadops.updateDialerSession({ status: "offline" });
    expect((await owner.leadops.listDialerCalls({}))!.length).toBeGreaterThanOrEqual(8);
    await expect(invitee.leadops.getTelephonySettings()).rejects.toThrow("vorbehalten");
  });

  it("17. Gesprächsbewertung ausbauen: Entscheidungsregeln, Fragen an das Gespräch, Beispiele für die KI", async () => {
    // Gesprächsbewertung erweitert: Regel, Fragen an das Gespräch, Beispiele
    const qa = await owner.leadops.getCallQaSettings();
    await owner.leadops.saveCallQaSettings({ ...qa, enabled: true, instructions: "", recordingAuthHeader: "••••••••", decisionRules: [{ id: "r1", label: "Mieter prüfen", field: "transcript", op: "contains", value: "mieter", decision: "pruefen", active: true }], examples: [{ title: "Mieter", transcript: "Ich bin nur Mieter.", verdict: "nachfassen", reason: "Mieter dürfen nicht beauftragen." }], extractFields: [{ key: "dachflaeche", label: "Dachfläche", question: "Wie groß ist die Dachfläche?" }] });
    const extended = await owner.leadops.getCallQaSettings();
    expect(extended.decisionRules).toHaveLength(1); expect(extended.examples[0].title).toBe("Mieter"); expect(extended.extractFields[0].key).toBe("dachflaeche");
    const ruled = await owner.leadops.simulateCall({ transcript: "Agent: Hallo. Kunde: Ja gerne, ich bin Eigentümer und einverstanden, aber mein Mieter wohnt oben.", publicId: null });
    expect(ruled).toMatchObject({ score: 90, decision: "pruefen" }); // Regel schlägt die Schwelle
    expect((await owner.leadops.getCall({ callId: ruled.callId })).nextStep).toContain("Regel: Mieter prüfen");
    await owner.leadops.saveCallQaSettings({ ...extended, recordingAuthHeader: "••••••••", decisionRules: [] });
  });

  it("18. Rohdaten: Upload mit Doppelprüfung, Wählliste aus der Liste, Übernahme als Lead nur nach Qualifizierung (Ergebnis oder KI-Freigabe), Auslieferung über die Regeln", async () => {
    const leadsBefore = (await db.select({ id: leads.id }).from(leads).where(eq(leads.tenantId, S.tenantId))).length;
    const batch = await owner.leadops.createRawBatch({ name: "Messe Liste", categoryId: S.wp.id, sourceName: "Messe", mapping: { firstName: "Vorname" }, rows: [
      { firstName: "Roh", lastName: "Eins", phone: "030 7700 9004", city: "Berlin", data: { Dachform: "Satteldach" } }, // …4 → Mensch
      { firstName: "Roh", lastName: "Zwei", phone: "+49 30 7700 9005", email: "zwei@example.de" }, // …5 → Mensch
      { firstName: "Roh", lastName: "Drei", phone: "+49 30 7700 9006" }, // …6 → Mensch
      { firstName: "Anke", lastName: "Anruf", phone: "+49 40 777001" }, // gibt es schon als Lead (Test 15)
      { firstName: "Roh", lastName: "Doppel", phone: "+49 30 7700 9004" }, // doppelt in der Liste
      { firstName: "Ohne", lastName: "Kontakt" }, // weder Telefon noch E-Mail
    ] });
    expect(batch).toMatchObject({ imported: 5, duplicates: 2, skipped: 1, usable: 3 });
    expect((await db.select({ id: leads.id }).from(leads).where(eq(leads.tenantId, S.tenantId))).length).toBe(leadsBefore); // Upload erzeugt keine Leads
    const listed = await owner.leadops.listRawBatches();
    expect(listed[0]).toMatchObject({ name: "Messe Liste", categoryShortcode: S.wp.shortcode, counts: { total: 5, neu: 3, duplikat: 2 } });
    const contacts = await owner.leadops.listRawContacts({ batchId: batch.batchId });
    expect(contacts.find((row) => row.lastName === "Anruf")).toMatchObject({ status: "duplikat", note: "Bereits als Lead vorhanden" });
    expect(contacts.find((row) => row.lastName === "Eins")?.phone).toBe("+493077009004");

    // Wählliste nur aus der Rohdaten-Liste; Power-Dialer; Ergebnis „interessiert“ → Lead genehmigt → Regel → Bestellung → Auslieferung
    const campaign = await owner.leadops.saveDialerCampaign({ name: "Messe abtelefonieren", mode: "power", leadFilter: { leadsEnabled: false, rawBatchIds: [batch.batchId] }, callerNumberId: null, maxAttempts: 2, retryMinutes: 30, wrapUpSeconds: 0, pacingRatio: null, callWindow: null, script: "" });
    await owner.leadops.setDialerCampaignStatus({ id: campaign.id, status: "aktiv" });
    expect((await owner.leadops.buildDialerQueue({ campaignId: campaign.id })).added).toBe(3);
    expect((await owner.leadops.listDialerQueue({ campaignId: campaign.id })).map((item) => item.source)).toEqual(["rohdaten", "rohdaten", "rohdaten"]);
    expect((await owner.leadops.listRawContacts({ batchId: batch.batchId, status: "in_liste" })).length).toBe(3);
    await owner.leadops.startDialerSession({ campaignId: campaign.id, mode: "power", connection: "browser" });
    S.transcriptForStub = "Agent: Hallo Herr Eins. Kunde: Ich überlege noch."; // Bewertung: nachfassen → prüfen (kein Lead durch die KI)
    const first = await owner.leadops.nextDialerCall();
    const live = await owner.leadops.currentDialerSession();
    expect(live?.call).toMatchObject({ status: "verbunden", lead: null, rawContact: { name: "Roh Eins", status: "in_liste" } });
    await owner.leadops.endDialerCall({ callId: first.instruction!.callId, durationSeconds: 100 });
    expect((await owner.leadops.getDialerCall({ callId: first.instruction!.callId }))?.evaluation).toMatchObject({ decision: "pruefen" });
    expect((await owner.leadops.listRawContacts({ batchId: batch.batchId })).find((row) => row.lastName === "Eins")?.status).toBe("in_liste"); // noch kein Lead
    await owner.leadops.setCallDisposition({ callId: first.instruction!.callId, disposition: "interessiert", notes: "Will ein Angebot" });
    const converted = (await owner.leadops.listRawContacts({ batchId: batch.batchId })).find((row) => row.lastName === "Eins")!;
    expect(converted.status).toBe("konvertiert"); expect(converted.leadPublicId).toBeTruthy();
    const newLead = await leadRow(converted.leadPublicId!);
    expect(newLead.status).toBe("zugewiesen"); // genehmigt → Regel aus Test 15 → Bestellung → Echtzeit-Auslieferung
    expect(newLead.metadata).toMatchObject({ Dachform: "Satteldach", rawBatch: "Messe Liste", source: "Messe", lastCallDisposition: "interessiert" });
    expect(newLead.supplierName).toBe("Messe");
    expect((await owner.leadops.getDialerCall({ callId: first.instruction!.callId }))?.leadId).toBe(newLead.id);
    expect((await owner.leadops.listCalls({})).find((row) => row.externalCallId === `dialer-${first.instruction!.callId}`)).toMatchObject({ leadPublicId: converted.leadPublicId, rawContactName: "Roh Eins" });

    // KI-Freigabe macht den nächsten Kontakt direkt zum Lead (ohne Klick des Agenten)
    S.transcriptForStub = "Agent: Hallo Frau Zwei. Kundin: Ja gerne, ich bin Eigentümerin und einverstanden. Agent: Termin vor Ort nächste Woche? Kundin: Ja gerne, passt. Agent: Dürfen wir Sie anrufen? Kundin: Ja, telefonisch erreichbar.";
    const second = await owner.leadops.nextDialerCall();
    await owner.leadops.endDialerCall({ callId: second.instruction!.callId, durationSeconds: 80 });
    const zwei = (await owner.leadops.listRawContacts({ batchId: batch.batchId })).find((row) => row.lastName === "Zwei")!;
    expect(zwei.status).toBe("konvertiert"); expect(zwei.note).toContain("Gesprächsbewertung 90/100");
    expect((await leadRow(zwei.leadPublicId!)).status).toBe("zugewiesen");
    await owner.leadops.setCallDisposition({ callId: second.instruction!.callId, disposition: "verkauft" });

    // Ablehnung durch die KI verwirft den Kontakt
    S.transcriptForStub = "Agent: Hallo. Kunde: Ich möchte nicht angerufen werden, bitte meine Daten löschen.";
    const third = await owner.leadops.nextDialerCall();
    await owner.leadops.endDialerCall({ callId: third.instruction!.callId, durationSeconds: 20 });
    expect((await owner.leadops.listRawContacts({ batchId: batch.batchId })).find((row) => row.lastName === "Drei")).toMatchObject({ status: "verworfen", note: expect.stringContaining("nicht_verkaufbar") });
    await owner.leadops.setCallDisposition({ callId: third.instruction!.callId, disposition: "nicht_anrufen" });
    expect((await owner.leadops.nextDialerCall()).done).toBe(true);
    await owner.leadops.updateDialerSession({ status: "offline" });

    // manuelle Übernahme, Wiederaufnahme, Liste löschen (übernommene Leads bleiben)
    const doppel = (await owner.leadops.listRawContacts({ batchId: batch.batchId })).find((row) => row.lastName === "Doppel")!;
    await owner.leadops.restoreRawContact({ id: doppel.id });
    const manual = await owner.leadops.convertRawContact({ id: doppel.id, initialStatus: "neu", note: "bewusst übernommen" });
    expect(manual.alreadyConverted).toBe(false); expect((await leadRow(manual.publicId)).status).not.toBe("genehmigt");
    expect((await owner.leadops.convertRawContact({ id: doppel.id })).alreadyConverted).toBe(true);
    await expect(owner.leadops.discardRawContact({ id: doppel.id })).rejects.toThrow("bereits ein Lead");
    expect((await owner.leadops.listRawBatches())[0].counts).toMatchObject({ konvertiert: 3, verworfen: 1, duplikat: 1 });
    expect(await owner.leadops.deleteRawBatch({ batchId: batch.batchId })).toMatchObject({ keptConverted: 3 });
    expect((await owner.leadops.listRawContacts({ batchId: batch.batchId })).length).toBe(3);
    await expect(invitee.leadops.listRawBatches()).rejects.toThrow("vorbehalten");

    // mehrere Lead-Kategorien je Liste: Kategorie aus der Spalte, Auswahl beim Übernehmen bzw. beim Anruf-Ergebnis, sonst Standard
    const multi = await owner.leadops.createRawBatch({ name: "Multi-Liste", categoryId: S.wp.id, categoryIds: [S.wp.id, S.pv.id], rows: [{ firstName: "Multi", lastName: "Spalte", phone: "+49 30 6600 1114", category: S.pv.shortcode }, { firstName: "Multi", lastName: "Standard", phone: "+49 30 6600 1115" }, { firstName: "Multi", lastName: "Anruf", phone: "+49 30 6600 1116", category: "gibt es nicht" }] });
    expect(multi).toMatchObject({ imported: 3, categoryIds: [S.wp.id, S.pv.id], unmatchedCategories: 1 });
    expect((await owner.leadops.listRawBatches()).find((row) => row.name === "Multi-Liste")!.categories.map((item) => item.shortcode)).toEqual([S.wp.shortcode, S.pv.shortcode]);
    const multiRows = await owner.leadops.listRawContacts({ batchId: multi.batchId });
    expect(multiRows.find((row) => row.lastName === "Spalte")).toMatchObject({ categoryShortcode: S.pv.shortcode, batchCategoryIds: [S.wp.id, S.pv.id] });
    const spalte = await owner.leadops.convertRawContact({ id: multiRows.find((row) => row.lastName === "Spalte")!.id });
    expect((await leadRow(spalte.publicId)).categoryId).toBe(S.pv.id);
    const standard = await owner.leadops.convertRawContact({ id: multiRows.find((row) => row.lastName === "Standard")!.id });
    expect((await leadRow(standard.publicId)).categoryId).toBe(S.wp.id);
    await expect(owner.leadops.convertRawContact({ id: multiRows.find((row) => row.lastName === "Anruf")!.id, categoryId: 999999 })).rejects.toThrow("nicht freigegeben");
    const multiCampaign = await owner.leadops.saveDialerCampaign({ name: "Multi abtelefonieren", mode: "power", leadFilter: { leadsEnabled: false, rawBatchIds: [multi.batchId] }, callerNumberId: null, maxAttempts: 2, retryMinutes: 30, wrapUpSeconds: 0, pacingRatio: null, callWindow: null, script: "" });
    await owner.leadops.setDialerCampaignStatus({ id: multiCampaign.id, status: "aktiv" });
    expect((await owner.leadops.buildDialerQueue({ campaignId: multiCampaign.id })).added).toBe(1);
    await owner.leadops.startDialerSession({ campaignId: multiCampaign.id, mode: "power", connection: "browser" });
    S.transcriptForStub = "Agent: Hallo. Kunde: Ich überlege noch.";
    const multiCall = await owner.leadops.nextDialerCall();
    expect((await owner.leadops.currentDialerSession())?.call?.rawContact).toMatchObject({ name: "Multi Anruf", categoryIds: [S.wp.id, S.pv.id] });
    await owner.leadops.endDialerCall({ callId: multiCall.instruction!.callId, durationSeconds: 60 });
    await owner.leadops.setCallDisposition({ callId: multiCall.instruction!.callId, disposition: "interessiert", categoryId: S.pv.id }); // Agent wählt PV
    const anruf = (await owner.leadops.listRawContacts({ batchId: multi.batchId })).find((row) => row.lastName === "Anruf")!;
    expect(anruf.status).toBe("konvertiert"); expect((await leadRow(anruf.leadPublicId!)).categoryId).toBe(S.pv.id);
    await owner.leadops.updateDialerSession({ status: "offline" });
  });

  it("19. Haustür-Erfassung: Agenturen, Vertriebler mit Sub-ID, Erfassung → Lead → Aroundhome (Sub-ID im Payload), Tagesabgleich je Sub-ID, Übersicht und CSV", async () => {
    // Vertriebler und Agenturen
    const agency = await owner.leadops.saveD2dAgency({ name: "SolarDoor Test GmbH", contactName: "Nina", email: "nina@solardoor.example" });
    const rep1 = await owner.leadops.saveD2dRep({ name: "Ali Test", agencyId: agency.id, subId: "D2D-TEST1" });
    const rep2 = await owner.leadops.saveD2dRep({ name: "Mara Test", agencyId: agency.id, subId: "D2D-TESTB" });
    expect(rep2.subId).toBe("D2D-TESTB");
    const repNoSub = await owner.leadops.saveD2dRep({ name: "Ohne Sub", agencyId: agency.id }); expect(repNoSub.subId).toBeNull(); // Spezifikation: Sub-ID optional („Sub-ID fehlt“)
    await expect(owner.leadops.saveD2dRep({ name: "Doppel", subId: "D2D-TEST1" })).rejects.toThrow("bereits vergeben");
    await expect(owner.leadops.saveD2dRep({ name: "Falsch", subId: "ab c" })).rejects.toThrow("Sub-ID: nur Buchstaben");
    // Login für Vertriebler + Sperren, Agentur mit Agenturleiter-Login, Zuweisung, iFrame
    const withLogin = await owner.leadops.saveD2dRep({ name: "Lea Login", agencyId: agency.id, email: "lea@haustuer-test.example", createLogin: true, password: "Haustuer!2026" });
    expect((await owner.leadops.listD2dReps()).find((row) => row.id === withLogin.id)?.userId).toBeTruthy();
    await owner.leadops.setD2dRepActive({ id: withLogin.id, active: false }); expect((await owner.leadops.listD2dReps()).find((row) => row.id === withLogin.id)?.active).toBe(false);
    const agency2 = await owner.leadops.createD2dAgency({ name: "Leiter Test Agentur", leaderFirstName: "Lars", leaderLastName: "Leiter", leaderEmail: "lars@agentur-test.example", password: "Agentur!2026" });
    expect(agency2.code).toMatch(/^[A-Z0-9]{2,8}$/); expect(agency2.leaderUserId).toBeTruthy();
    await expect(owner.leadops.saveD2dSettings({ categoryId: null, buyerUserId: 1 })).rejects.toThrow("Für einen Käufer bitte auch eine Sparte wählen.");
    await expect(owner.leadops.saveD2dEmbed({ raw: "https://boese.example/script.js" })).rejects.toThrow("aroundhome.de");
    expect((await owner.leadops.saveD2dEmbed({ raw: '<script src="https://aaa.aroundhome.de/trck/ehtml/abc.js"></script>' })).embedScriptUrl).toBe("https://aaa.aroundhome.de/trck/ehtml/abc.js");
    expect((await owner.leadops.d2dContext()).role).toBe("admin");
    expect((await owner.leadops.listD2dAgencies()).find((row) => row.id === agency.id)).toMatchObject({ name: "SolarDoor Test GmbH" });
    const settings = await owner.leadops.getD2dSettings();
    expect(settings.consentText.length).toBeGreaterThan(20);

    // Aroundhome als Käufer: die Partnerintegration ist die Standard-Vorlage (mit sub_id im Payload), Bestellung S.orderId
    const integrationConfig = ((await owner.leadops.listPartnerIntegrations()).find((row) => row.id === S.integrationId)?.config ?? {}) as Record<string, unknown>;
    await owner.leadops.updatePartnerIntegration({ id: S.integrationId, callbackUrl: "https://crm.partner-solar.example/api/leads", config: { ...integrationConfig, payloadMapping: { publisher_id: "publisherId", sub_id: "d2d_sub_id", external_id: "publicId", first_name: "firstName", last_name: "lastName", phone: "phone", zip_code: "postcode", city: "city", custom_data: "metadata" } } });
    await owner.leadops.saveD2dSettings({ aroundhomeAccountId: null, orderId: S.orderId, supplierId: null, consentText: settings.consentText });
    await expect(owner.leadops.createD2dCapture({ repId: rep1.id, categoryId: S.wp.id, lastName: "Ohne", phone: "+49 30 1", consentGiven: false })).rejects.toThrow("Einwilligung");
    await expect(owner.leadops.createD2dCapture({ repId: rep1.id, categoryId: S.wp.id, lastName: "Ohne", consentGiven: true })).rejects.toThrow("Telefonnummer");
    const before = outbound.length;
    const capture = await owner.leadops.createD2dCapture({ repId: rep1.id, categoryId: S.wp.id, firstName: "Haus", lastName: "Tür", phone: "030 998877", street: "Ahornweg 3", postcode: "12163", city: "Berlin", country: "DE", notes: "Satteldach", consentGiven: true, extra: { heizungsart: "Strom" } });
    expect(capture).toMatchObject({ status: "uebermittelt", leadStatus: "zugewiesen" });
    expect(capture.partnerReference).toMatch(/^ah-/); // Referenz aus der Aroundhome-Antwort
    const lead = await leadRow(capture.publicId);
    expect(lead).toMatchObject({ status: "zugewiesen", supplierName: "Haustür: SolarDoor Test GmbH", phone: "+4930998877" });
    expect(lead.metadata).toMatchObject({ d2d_sub_id: "D2D-TEST1", d2d_rep: "Ali Test", d2d_agency: "SolarDoor Test GmbH", street: "Ahornweg 3", consent: true, source: "Haustür", partnerReference: capture.partnerReference });
    const sent = outbound.slice(before).find((call) => call.url === "https://crm.partner-solar.example/api/leads");
    expect(sent?.body).toMatchObject({ sub_id: "D2D-TEST1", external_id: capture.publicId, last_name: "Tür", zip_code: "12163" }); // Sub-ID geht mit an Aroundhome
    const notes = (await db.select().from(leadStatusEvents).where(eq(leadStatusEvents.leadId, lead.id))).map((event) => event.note ?? "");
    expect(notes.some((note) => note.startsWith("Haustür-Erfassung durch Ali Test"))).toBe(true);
    expect((await owner.leadops.listD2dCaptures({ repId: rep1.id }))[0]).toMatchObject({ status: "uebermittelt", leadPublicId: capture.publicId, subId: "D2D-TEST1", agencyName: "SolarDoor Test GmbH", name: "Haus Tür" });

    // Ablehnung durch Aroundhome → Erfassung „fehler“, erneut senden
    await owner.leadops.updatePartnerIntegration({ id: S.integrationId, callbackUrl: "https://crm.partner-solar.example/api/reject" });
    const failed = await owner.leadops.createD2dCapture({ repId: rep2.id, categoryId: S.wp.id, firstName: "Fehl", lastName: "Schlag", phone: "+49 30 998878", consentGiven: true, extra: { heizungsart: "Strom" } });
    expect(failed.status).toBe("fehler"); expect(failed.deliveryNote).toContain("abgelehnt");
    await owner.leadops.updatePartnerIntegration({ id: S.integrationId, callbackUrl: "https://crm.partner-solar.example/api/leads" });
    const retried = await owner.leadops.retryD2dCapture({ captureId: failed.captureId });
    expect(retried.status).toBe("uebermittelt");
    expect((await leadRow(failed.publicId)).status).toBe("zugewiesen");

    // Tagesabgleich je Sub-ID aus dem Aroundhome-Export
    const account = await owner.leadops.saveAroundhomeAccount({ label: "Aroundhome D2D", publisherId: "pub-d2d", accessToken: "tok", exportUrl: "https://partner.example/aroundhome-d2d", reclaimOnCancel: false, reclaimReasonId: null, enabled: true });
    await owner.leadops.saveD2dSettings({ aroundhomeAccountId: account.id, orderId: S.orderId, supplierId: null, consentText: settings.consentText });
    const sync = await owner.leadops.syncAroundhomeAccount({ id: account.id });
    expect(sync.dailyDays).toBe(3); expect(sync.summary).toContain("Sub-ID-Tage abgeglichen");
    const overview = await owner.leadops.d2dOverview({});
    expect(overview.kpis).toMatchObject({ captured: 2, submitted: 2, failed: 0, qualified: 1, open: 1, cancelled: 0 }); // D2D-FREMD und D2D-TEST2 zählen nicht (keine eigenen Vertriebler)
    expect(overview.topReps[0]).toMatchObject({ name: "Ali Test", subId: "D2D-TEST1", captured: 1, qualified: 1 });
    expect(overview.topAgencies[0]).toMatchObject({ agency: "SolarDoor Test GmbH", captured: 2, submitted: 2, qualified: 1 });
    expect(overview.days.length).toBe(7); expect(overview.days[overview.days.length - 1]).toMatchObject({ captured: 2, qualified: 1, open: 1 });
    const only = await owner.leadops.d2dOverview({ repId: rep2.id });
    expect(only.kpis).toMatchObject({ captured: 1, qualified: 0, cancelled: 0 }); // D2D-TEST2 gehört keinem Vertriebler → zählt nicht
    const csv = await owner.leadops.exportD2dCsv({});
    expect(csv.csv.split("\r\n")).toHaveLength(3); expect(csv.csv.startsWith("\uFEFF")).toBe(true); expect(csv.csv).toContain("Erfasst am;Nr.;Vertriebler;Sub-ID;Agentur;Anrede;Vorname;Nachname;Telefon;E-Mail;Straße;PLZ;Ort;Notiz"); expect(csv.csv).toContain("Ali Test;D2D-TEST1;SolarDoor Test GmbH"); expect(csv.filename).toMatch(/^haustuer_/);
    expect((await owner.leadops.deleteD2dRep({ id: rep1.id })).deactivated).toBe(true);
    await expect(invitee.leadops.listD2dReps()).rejects.toThrow("vorbehalten");
  });

  it("20. Kundenpfad ohne Handarbeit: Kunden-Benutzer anlegen → API-Integration am Benutzer → Bestellung → Leads verteilen (automatisch)", async () => {
    // 1) Kunde als Benutzer (Käufer)
    const created = await owner.leadops.createMember({ firstName: "Klara", lastName: "Kundin", company: "Kundin Solar GmbH", email: `klara-${Date.now().toString(36)}@kunde.example`, password: "Sicher!Passwort2026", kind: "benutzer", status: "aktiv" });
    const membershipId = created.membershipId;
    const detail = await owner.leadops.getMemberDetail({ membershipId });
    expect(detail.membership.partnerType).toBe("käufer"); expect(detail.membership.status).toBe("aktiv");
    // 2) API-Integration direkt am Benutzer (Reiter Integration): Endpoint für PV
    await owner.leadops.saveDeliveryEndpoint({ membershipId, categoryId: S.pv.id, enabled: true, method: "POST", url: "https://kundin-crm.example/api/leads", sourceFilterMode: "alle", sourceSupplierIds: [], fieldFilters: [], headers: [{ name: "Authorization", value: "Bearer kundin-key" }], authEnabled: false, auth: null, bodyTemplate: '{ "name": "{{first_name}} {{last_name}}", "phone": "{{phone}}", "zip": "{{postal_code}}", "heizung": "{{custom_data.heizungsart}}" }', omitAutoFields: false, rotate: false, valueMappings: [] });
    expect((await owner.leadops.getMemberIntegration({ membershipId })).endpoints).toHaveLength(1);
    // 3) Bestellung für diesen Käufer – ohne selbst eine Lieferkette anzulegen
    const order = await owner.leadops.createOrder({ name: "Kundin PV 50", buyerName: "Kundin Solar GmbH", categoryId: S.pv.id, quantity: 50, unitPrice: 39, status: "aktiv" });
    await owner.leadops.saveOrderWorkspace({ orderId: order.orderId, name: "Kundin PV 50", buyerName: "Kundin Solar GmbH", buyerUserId: detail.user.id, categoryId: S.pv.id, categoryIds: [S.pv.id], quantity: 50, unitPrice: 39, supplierId: null, supplierMode: "alle", supplierIds: [], deliveryInterval: "sofort", compensateClaims: true, priority: 1, realtimeDelivery: true, startsAt: null, endsAt: null, ongoing: true, deliveryDays: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"], deliveryArea: "landesweit", pauses: [], advancedFilters: { minAgeDays: null, maxLeadPrice: null, postcodes: null } });
    await owner.leadops.setOrderWorkspaceActive({ orderId: order.orderId, active: true });
    expect((await owner.leadops.listDeliveryChains()).filter((chain) => chain.orderId === order.orderId)).toHaveLength(0); // keine Lieferkette von Hand nötig
    // 4) Verteilung: eine Regel „Neuer PV-Lead → automatisch ausliefern“ (ohne feste Bestellung)
    await owner.leadops.createAutomationRule({ name: "PV automatisch ausliefern", triggerType: "lead_erstellt", sourceCategoryId: S.pv.id, targetCategoryId: S.pv.id, conditions: [], actionType: "lead_ausliefern", actionConfig: {}, status: "aktiv" });
    const before = outbound.length;
    const lead = await owner.leadops.importLead({ categoryId: S.pv.id, firstName: "Peter", lastName: "Probe", phone: "+49 30 5551234", postcode: "10115", city: "Berlin", supplierId: S.supplierId, metadata: { heizungsart: "Gas" } });
    expect(lead.automation.delivered).toBe(1);
    const row = await leadRow(lead.publicId);
    expect(row.status).toBe("zugewiesen");
    const delivery = (await db.select().from(leadDeliveries).where(eq(leadDeliveries.leadId, row.id)))[0];
    expect(delivery).toMatchObject({ buyerName: "Kundin Solar GmbH", orderId: order.orderId, result: "angenommen", unitPrice: "39.00" });
    const chains = (await owner.leadops.listDeliveryChains()).filter((chain) => chain.orderId === order.orderId);
    expect(chains).toHaveLength(1); expect(chains[0]).toMatchObject({ name: expect.stringContaining("Bestellung ORD-"), status: "aktiv" }); // Standard-Kette mit Stop wurde bei der ersten Auslieferung automatisch angelegt
    const sent = outbound.slice(before).find((call) => call.url === "https://kundin-crm.example/api/leads");
    expect(sent?.headers.authorization).toBe("Bearer kundin-key");
    expect(sent?.body).toMatchObject({ lead_id: lead.publicId, name: "Peter Probe", phone: "+49 30 5551234", zip: "10115", heizung: "Gas" }); // API-Call des Benutzers wurde genutzt
    expect((await owner.leadops.getOrderWorkspace({ orderId: order.orderId })).order.deliveredCount).toBe(1);
    // Käufer sieht seinen Lead, aber nicht die Callcenter-Bereiche
    const buyer = appRouter.createCaller({ user: { id: detail.user.id } } as never);
    expect((await buyer.leadops.listLeadsPaged({ page: 1, pageSize: 20 })).rows.some((item) => item.publicId === lead.publicId)).toBe(true);
    await expect(buyer.leadops.listRawBatches()).rejects.toThrow("vorbehalten");
    // Kundenbereich („MEIN BEREICH“): Zugang, sichtbare Seiten laut Tab „Ansicht“, Kennzahlen, eigene Leads/Bestellungen/Anbindung
    const access = await buyer.leadops.customerAccess();
    expect(access).toMatchObject({ membershipId, partnerType: "käufer", company: "Kundin Solar GmbH" });
    expect(access.pages).toEqual(["Dashboard", "Leads", "Bestellungen", "Reklamationen", "Integrationen", "Support", "Einstellungen"]);
    await owner.leadops.updateMemberVisibility({ membershipId, visibleAreas: ["Bestellungen", "Support"], visibleCategoryIds: null });
    expect((await buyer.leadops.customerAccess()).pages).toEqual(["Dashboard", "Leads", "Bestellungen", "Support", "Einstellungen"]);
    const home = await buyer.leadops.customerDashboard();
    expect(home.kpis).toMatchObject({ leadsTotal: 1, leadsThisMonth: 1, openClaims: 0, activeOrders: 1 }); expect(home.recent[0]).toMatchObject({ publicId: lead.publicId, unitPrice: "39.00" });
    expect((await buyer.leadops.customerLeads({})).map((item) => item.publicId)).toEqual([lead.publicId]);
    expect((await buyer.leadops.customerOrders()).map((item) => [item.orderNumber, item.deliveredCount])).toEqual([[order.orderNumber, 1]]);
    expect((await buyer.leadops.customerEndpoints()).endpoints.map((item) => item.url)).toEqual(["https://kundin-crm.example/api/leads"]);
    await expect(buyer.leadops.customerLeads({})).resolves.toBeTruthy(); await expect(buyer.leadops.chainOverview({ range: "heute" })).resolves.toBeTruthy(); // Abfragen bleiben erlaubt, Admin-Akten nicht
    await expect(buyer.leadops.getMemberDetail({ membershipId })).rejects.toThrow("vorbehalten");
    // Lead-Seite: alle relevanten Informationen auf einen Blick (auch für den Käufer selbst, eingeschränkt auf seine Leads)
    const page = await owner.leadops.getLeadDetail({ publicId: lead.publicId });
    expect(page).toMatchObject({ publicId: lead.publicId, status: "zugewiesen", category: { name: S.pv.name } });
    expect(page.deliveries[0]).toMatchObject({ buyerName: "Kundin Solar GmbH", unitPrice: "39.00", result: "angenommen" }); expect(page.deliveries[0].orderNumber).toBe(order.orderNumber);
    expect((await buyer.leadops.getLeadDetail({ publicId: lead.publicId })).publicId).toBe(lead.publicId);
    // E-Mail-Automatik: Willkommensmail sofort (ohne SMTP simuliert), Erinnerungen geplant; nach Anmeldung werden fällige Erinnerungen übersprungen
    const mails = await owner.leadops.emailOverview({});
    const mine = mails.events.filter((event) => event.membershipId === membershipId);
    expect(mine.map((event) => [event.kind, event.deliveryStatus]).sort()).toEqual([["erinnerung_1", "geplant"], ["erinnerung_2", "geplant"], ["willkommen", "simuliert"]]);
    expect(mine.find((event) => event.kind === "willkommen")!.bodyPreview).toContain("••••••••"); // Passwort wird nie im Protokoll gespeichert
    expect(mine.find((event) => event.kind === "willkommen")!.subject).toContain("Klara"); // Platzhalter (Vorname) ersetzt
    await db.update(emailEvents).set({ scheduledFor: new Date(Date.now() - 60_000) }).where(and(eq(emailEvents.membershipId, membershipId), eq(emailEvents.kind, "erinnerung_1")));
    await db.update(users).set({ lastSignedIn: new Date(Date.now() + 120_000) }).where(eq(users.id, (await owner.leadops.getMemberDetail({ membershipId })).user.id)); // deutlich nach dem Anlegen (Zeitzonen-/Sekundenrundung der DB)
    const queue = await owner.leadops.runEmailQueue(); expect(queue.skipped).toBeGreaterThanOrEqual(1);
    expect((await owner.leadops.emailOverview({})).events.find((event) => event.membershipId === membershipId && event.kind === "erinnerung_1")!.deliveryStatus).toBe("übersprungen");
    const templates = (await owner.leadops.emailOverview({})).templates; const welcome = templates.find((template) => template.kind === "willkommen")!;
    await owner.leadops.updateEmailTemplate({ id: welcome.id, subject: "Hallo {{vorname}} – willkommen!", delayDays: 0 });
    const test = await owner.leadops.sendTestEmail({ templateId: welcome.id }); expect(test.status).toBe("simuliert");
    await owner.leadops.resetEmailTemplate({ id: welcome.id }); expect((await owner.leadops.emailOverview({})).templates.find((template) => template.id === welcome.id)!.subject).toContain("Willkommen bei");
  });

  it("21. Integrations-Presets: Endpoint/Mapping/Rückgabe-Webhook als Preset sichern und bei anderen Benutzern hinzufügen", async () => {
    const buyer = (await db.select({ id: memberships.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.tenantId, S.tenantId), eq(users.name, "Klara Kundin"))))[0];
    const karla = (await db.select({ id: memberships.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.tenantId, S.tenantId), eq(users.email, "karla@kunde.example"))))[0];
    const endpoint = (await owner.leadops.getMemberIntegration({ membershipId: buyer.id })).endpoints[0];
    // Preset ohne Schlüssel → beim Hinzufügen werden sie abgefragt
    const preset = await owner.leadops.saveEndpointPreset({ membershipId: buyer.id, endpointId: endpoint.id, name: "Kundin-CRM Standard", description: "Body mit Heizungsart", includeSecrets: false });
    const listed = await owner.leadops.listIntegrationPresets();
    expect(listed.find((row) => row.id === preset.id)).toMatchObject({ kind: "endpoint", categoryShortcode: S.pv.shortcode, hasSecrets: false, summary: "POST https://kundin-crm.example/api/leads", createdBy: expect.any(String) });
    expect(await owner.leadops.integrationPresetRequirements({ presetId: preset.id })).toMatchObject({ kind: "endpoint", url: "https://kundin-crm.example/api/leads", headers: [{ name: "Authorization", missing: true }], authCredentials: [] });
    await expect(owner.leadops.applyIntegrationPreset({ presetId: preset.id, membershipId: karla.id })).rejects.toThrow("fehlenden Schlüssel");
    const applied = await owner.leadops.applyIntegrationPreset({ presetId: preset.id, membershipId: karla.id, categoryId: S.wp.id, url: "https://karla-crm.example/leads", headers: [{ name: "Authorization", value: "Bearer karla-key" }] });
    const karlaIntegration = await owner.leadops.getMemberIntegration({ membershipId: karla.id });
    expect(karlaIntegration.endpoints.find((row) => row.id === applied.id)).toMatchObject({ categoryId: S.wp.id, url: "https://karla-crm.example/leads", headers: [{ name: "Authorization", value: "Bearer karla-key" }], bodyTemplate: expect.stringContaining("custom_data.heizungsart") });
    expect((await owner.leadops.listIntegrationPresets()).find((row) => row.id === preset.id)?.usageCount).toBe(1);
    // Preset mit Schlüsseln → direkt übernehmbar
    const withSecrets = await owner.leadops.saveEndpointPreset({ membershipId: buyer.id, endpointId: endpoint.id, name: "Kundin-CRM inkl. Schlüssel", includeSecrets: true });
    expect((await owner.leadops.listIntegrationPresets()).find((row) => row.id === withSecrets.id)?.hasSecrets).toBe(true);
    const direct = await owner.leadops.applyIntegrationPreset({ presetId: withSecrets.id, membershipId: karla.id, categoryId: S.pv.id });
    expect((await owner.leadops.getMemberIntegration({ membershipId: karla.id })).endpoints.find((row) => row.id === direct.id)?.headers).toEqual([{ name: "Authorization", value: "Bearer kundin-key" }]);
    // Response-Mapping und Rückgabe-Webhook als Preset
    const inviteeMembership = (await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.tenantId, S.tenantId), eq(memberships.userId, inviteeUserId))))[0];
    const mappingPreset = await owner.leadops.saveResponseMappingPreset({ membershipId: inviteeMembership.id, name: "Aroundhome Fehlercodes" });
    const mapped = await owner.leadops.applyIntegrationPreset({ presetId: mappingPreset.id, membershipId: karla.id });
    expect(mapped.count).toBe(5); expect((await owner.leadops.getMemberIntegration({ membershipId: karla.id })).rules).toHaveLength(5);
    const hookPreset = await owner.leadops.saveReturnWebhookPreset({ membershipId: karla.id, categoryId: S.wp.id, name: "Rückgabe Standard", includeSecrets: true });
    await owner.leadops.applyIntegrationPreset({ presetId: hookPreset.id, membershipId: buyer.id, categoryId: S.pv.id, url: "https://kundin-crm.example/rueckgabe" });
    expect((await owner.leadops.getMemberIntegration({ membershipId: buyer.id })).returnWebhooks.find((row) => row.categoryId === S.pv.id)).toMatchObject({ enabled: true, url: "https://kundin-crm.example/rueckgabe" });
    await owner.leadops.updateIntegrationPreset({ id: preset.id, name: "Kundin-CRM (umbenannt)" });
    expect((await owner.leadops.listIntegrationPresets()).find((row) => row.id === preset.id)?.name).toBe("Kundin-CRM (umbenannt)");
    await owner.leadops.deleteIntegrationPreset({ id: withSecrets.id });
    expect((await owner.leadops.listIntegrationPresets()).some((row) => row.id === withSecrets.id)).toBe(false);
    await expect(invitee.leadops.listIntegrationPresets()).rejects.toThrow("vorbehalten");
  });

  it("22. Lieferkette (Wasserfall): Stops der Reihe nach, Skip mit Grund, Reklamationsfenster je Stop, Reklamation → weitergeben, erschöpft, Übersicht & Detail", async () => {
    const stamp = Date.now().toString(36);
    const first = await owner.leadops.createMember({ firstName: "Hanna", lastName: "Hyper", company: "Hyper Energy Solutions", email: `hyper-${stamp}@kunde.example`, password: "Sicher!Passwort2026", kind: "benutzer", status: "aktiv" });
    const second = await owner.leadops.createMember({ firstName: "Nils", lastName: "Nodes", company: "Leadnodes", email: `nodes-${stamp}@kunde.example`, password: "Sicher!Passwort2026", kind: "benutzer", status: "aktiv" });
    const firstUser = (await owner.leadops.getMemberDetail({ membershipId: first.membershipId })).user.id; const secondUser = (await owner.leadops.getMemberDetail({ membershipId: second.membershipId })).user.id;
    for (const [membershipId, url] of [[first.membershipId, "https://hyper-crm.example/contacts"], [second.membershipId, "https://leadnodes-crm.example/api/refunds"]] as const) await owner.leadops.saveDeliveryEndpoint({ membershipId, categoryId: S.pv.id, enabled: true, method: "POST", url, sourceFilterMode: "alle", sourceSupplierIds: [], fieldFilters: [], headers: [], authEnabled: false, auth: null, bodyTemplate: "", omitAutoFields: false, rotate: false, valueMappings: [] });
    // Kette + zwei Stops (Käufer-Konten), Stop 1 mit 240 h Fenster, Stop 2 sofort angenommen
    const created = await owner.leadops.createDeliveryChain({ categoryId: S.pv.id, name: "Ondialer PV: Hyper → Leadnodes", priority: 1, sellTarget: 1, status: "aktiv" });
    const chainId = created.chainId;
    await owner.leadops.updateDeliveryChain({ id: chainId, exhaustedAction: "return", country: "DE", supplierFilterMode: "include", supplierIds: [S.supplierId], dailyCap: null, totalCap: null });
    const stop1 = await owner.leadops.addChainStop({ chainId, buyerUserId: firstUser, unitPrice: 12, reclamationWindowHours: 240 });
    const stop2 = await owner.leadops.addChainStop({ chainId, buyerUserId: secondUser, unitPrice: 9, reclamationWindowHours: 0 });
    expect([stop1.position, stop2.position]).toEqual([1, 2]);
    await owner.leadops.reorderChainStops({ chainId, stopIds: [stop2.stopId, stop1.stopId] }); await owner.leadops.reorderChainStops({ chainId, stopIds: [stop1.stopId, stop2.stopId] });
    // Stop 1 nur für PLZ 60…, Reklamationsgrund „Dublette“ → weitergeben, andere enden hier, „Sperrliste“ nicht erlaubt
    await owner.leadops.updateChainStop({ id: stop1.stopId, geoCountry: "DE", geoMode: "plz", geoValues: ["60"] });
    const reasons = await owner.leadops.listReclamationReasons(); const dublette = reasons.find((reason) => reason.name === "Dublette")!;
    await owner.leadops.saveStopRules({ stopId: stop1.stopId, rules: reasons.map((reason) => ({ reasonId: reason.id, allowed: reason.name !== "Sperrliste", passOn: reason.id === dublette.id })) });
    // Alle anderen PV-Ketten pausieren, damit der Wasserfall allein greift
    const others = (await owner.leadops.listDeliveryChains()).filter((chain) => chain.categoryId === S.pv.id && chain.id !== chainId && chain.status === "aktiv");
    for (const chain of others) await owner.leadops.updateDeliveryChain({ id: chain.id, status: "inaktiv" });
    const autoRules = (await owner.leadops.listAutomationRules()).filter((rule) => rule.status === "aktiv" && rule.actionType === "lead_ausliefern");
    for (const rule of autoRules) await owner.leadops.updateAutomationRule({ id: rule.id, status: "pausiert" }); // Auto-Auslieferung aus Test 20 pausieren
    const restore = async () => { for (const chain of others) await owner.leadops.updateDeliveryChain({ id: chain.id, status: "aktiv" }); for (const rule of autoRules) await owner.leadops.updateAutomationRule({ id: rule.id, status: "aktiv" }); };
    try {
      // (a) Lead aus Berlin: Stop 1 übersprungen (PLZ), Stop 2 nimmt (0 h → sofort angenommen)
      const berlin = await owner.leadops.importLead({ categoryId: S.pv.id, firstName: "Bea", lastName: "Berlin", email: `bea-${stamp}@example.de`, postcode: "10115", city: "Berlin", supplierId: S.supplierId, metadata: { heizungsart: "Gas" } });
      const one = await owner.leadops.deliverLead({ publicId: berlin.publicId });
      expect(one.result).toBe("angenommen"); expect(one.buyerName).toBe("Leadnodes"); expect(one.unitPrice).toBe("9.00");
      expect(one.attempts.map((attempt) => attempt.outcome)).toEqual(["übersprungen", "angenommen"]); expect(one.attempts[0].reason).toContain("PLZ");
      const berlinRows = (await db.select().from(leadDeliveries).where(eq(leadDeliveries.leadId, (await leadRow(berlin.publicId)).id))).sort((a, b) => a.id - b.id);
      expect(berlinRows.map((row) => [row.result, row.skipReason ?? null])).toEqual([["übersprungen", "Geo-Targeting: PLZ passt nicht"], ["angenommen", null]]);
      expect(berlinRows[1].acceptedAt).not.toBeNull(); // 0 h Fenster = sofort angenommen
      // (b) Lead aus Frankfurt: Stop 1 nimmt, 240 h Fenster → reklamierbar; Reklamation „Dublette“ → weitergeben an Stop 2
      const frankfurt = await owner.leadops.importLead({ categoryId: S.pv.id, firstName: "Frank", lastName: "Frankfurt", email: `frank-${stamp}@example.de`, phone: "+49 69 5550000", postcode: "60311", city: "Frankfurt", supplierId: S.supplierId, metadata: { heizungsart: "Öl" } });
      const two = await owner.leadops.deliverLead({ publicId: frankfurt.publicId });
      expect(two.result).toBe("angenommen"); expect(two.buyerName).toBe("Hyper Energy Solutions"); expect(two.attempts).toHaveLength(1);
      const frankfurtRow = await leadRow(frankfurt.publicId);
      const inWindow = (await db.select().from(leadDeliveries).where(eq(leadDeliveries.leadId, frankfurtRow.id)))[0];
      expect(inWindow.acceptedAt).toBeNull(); expect(inWindow.windowEndsAt!.getTime() - inWindow.occurredAt.getTime()).toBe(240 * 3_600_000);
      const hyperToken = await owner.leadops.issueSupplierToken({ membershipId: first.membershipId });
      await owner.leadops.updateMemberClaimSettings({ membershipId: first.membershipId, reclamationPeriodHours: 24, autoAcceptApiClaims: true, blockedClaimCategoryIds: [], excludedClaimReasonIds: [] });
      const blocked = await fetch(`${apiBase}/api/reclaim`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${hyperToken.token}` }, body: JSON.stringify({ reason: "sperrliste", lead_number: frankfurtRow.id }) });
      expect(blocked.status).toBe(403); // Grund für diesen Stop nicht erlaubt
      const reclaimed = await fetch(`${apiBase}/api/reclaim`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${hyperToken.token}` }, body: JSON.stringify({ reason: "duplikat", lead_number: frankfurtRow.id, comment: "schon bekannt" }) });
      expect(reclaimed.status).toBe(200); expect(await reclaimed.json()).toMatchObject({ status: "approved", reinjected: true });
      const chainRows = (await db.select().from(leadDeliveries).where(eq(leadDeliveries.leadId, frankfurtRow.id))).sort((a, b) => a.id - b.id);
      expect(chainRows.map((row) => [row.stopId, row.result])).toEqual([[stop1.stopId, "reklamiert"], [stop1.stopId, "übersprungen"], [stop2.stopId, "angenommen"]]); // Dublette = weitergeben: Stop 1 wird als Dublette übersprungen → Stop 2
      expect(chainRows[0].claimId).toBeGreaterThan(0);
      // Stop 2 (0 h): keine Reklamation möglich
      const nodesToken = await owner.leadops.issueSupplierToken({ membershipId: second.membershipId });
      await owner.leadops.updateMemberClaimSettings({ membershipId: second.membershipId, reclamationPeriodHours: 24, autoAcceptApiClaims: true, blockedClaimCategoryIds: [], excludedClaimReasonIds: [] });
      const noWindow = await fetch(`${apiBase}/api/reclaim`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${nodesToken.token}` }, body: JSON.stringify({ reason: "duplikat", lead_number: frankfurtRow.id }) });
      expect(noWindow.status).toBe(403);
      // (c) Beide Käufer hatten den Kontakt bereits (reklamiert / angenommen) → Kette ist per Dublettenschutz nicht mehr zuständig
      await expect(owner.leadops.deliverLead({ publicId: frankfurt.publicId, chainId, allowRepeat: true })).rejects.toThrow("Dublettenschutz");
      expect((await leadRow(frankfurt.publicId)).status).toBe("zugewiesen");
      // (d) Lieferanten-Filter der Kette: ausgeschlossener Lieferant → Kette nicht zuständig
      await owner.leadops.updateDeliveryChain({ id: chainId, supplierFilterMode: "exclude", supplierIds: [S.supplierId] });
      const foreign = await owner.leadops.importLead({ categoryId: S.pv.id, firstName: "Fritz", lastName: "Fremd", email: `fritz-${stamp}@example.de`, postcode: "60313", city: "Frankfurt", supplierId: S.supplierId, metadata: { heizungsart: "Öl" } });
      await expect(owner.leadops.deliverLead({ publicId: foreign.publicId, chainId })).rejects.toThrow("Lieferant für diese Kette ausgeschlossen");
      await owner.leadops.updateDeliveryChain({ id: chainId, supplierFilterMode: "all", supplierIds: [] });
      // (e) Übersicht + Detail + Aktivität
      const overview = await owner.leadops.chainOverview({ range: "maximal" });
      const entry = overview.chains.find((chain) => chain.id === chainId)!;
      expect(entry).toMatchObject({ categoryName: S.pv.name, stops: 2, sellTarget: 1, status: "aktiv" }); expect(entry.stats.total).toBe(3); expect(entry.stats.rejected).toBe(1); expect(entry.stats.skipped).toBe(2);
      const detail = await owner.leadops.chainDetail({ chainId, range: "maximal" });
      expect(detail.chain).toMatchObject({ exhaustedAction: "return", country: "DE", supplierFilterMode: "all" });
      expect(detail.stops.map((stop) => [stop.position, stop.buyerCompany, stop.api, stop.reclamationWindowHours])).toEqual([[1, "Hyper Energy Solutions", true, 240], [2, "Leadnodes", true, 0]]);
      expect(detail.stops[0].rules.find((rule) => rule.reasonId === dublette.id)).toMatchObject({ allowed: true, passOn: true });
      expect(detail.stops[0].stats).toMatchObject({ total: 1, reclaimed: 1, rejected: 1, skipped: 2 }); expect(detail.stops[1].stats).toMatchObject({ total: 2, accepted: 2, skipped: 0, acceptanceRate: 100 });
      expect(detail.stops[1].activity.recent.map((row) => row.status)).toEqual(["angenommen", "angenommen"]); expect(detail.stops[0].activity.recent.map((row) => row.status)).toEqual(expect.arrayContaining(["reklamiert", "übersprungen"]));
      expect((await owner.leadops.listStopDeliveries({ stopId: stop2.stopId, range: "maximal" })).length).toBe(2);
      expect((await owner.leadops.chainOverview({ range: "heute" })).distributionMode).toBe("lieferketten_round_robin");
      await owner.leadops.setChainDistributionMode({ mode: "bestellungen_round_robin" }); expect((await owner.leadops.chainOverview({ range: "heute" })).distributionMode).toBe("bestellungen_round_robin"); await owner.leadops.setChainDistributionMode({ mode: "lieferketten_round_robin" });
      await owner.leadops.deleteChainStop({ stopId: stop2.stopId }); expect((await owner.leadops.chainDetail({ chainId, range: "maximal" })).stops).toHaveLength(1);
      await owner.leadops.deleteDeliveryChain({ chainId }); expect((await owner.leadops.chainOverview({ range: "maximal" })).chains.some((chain) => chain.id === chainId)).toBe(false);
    } finally { await restore(); }
  });

  it("8. Bestellkonfiguration (reine Logik): Zeitraum, Liefertage, Pausen, Menge, Lieferant, PLZ, Preis", () => {
    const base = { active: true, ongoing: true, startsAt: null, endsAt: null, deliveryDays: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"], pauses: [], requestedQuantity: 10, advancedFilters: null, supplierRestrictions: null };
    const lead = { supplierId: 7, postcode: "60311", cost: "20.00" };
    const monday = new Date("2026-09-21T10:00:00+02:00");
    expect(evaluateOrderEligibility(undefined, lead, 0, monday)).toEqual({ eligible: true });
    expect(evaluateOrderEligibility(base, lead, 0, monday)).toEqual({ eligible: true });
    expect(evaluateOrderEligibility({ ...base, active: false }, lead, 0, monday).reason).toMatch(/deaktiviert/);
    expect(evaluateOrderEligibility({ ...base, ongoing: false, endsAt: new Date("2026-09-01") }, lead, 0, monday).reason).toMatch(/abgelaufen/);
    expect(evaluateOrderEligibility({ ...base, deliveryDays: ["Dienstag"] }, lead, 0, monday).reason).toMatch(/Kein Liefertag/);
    expect(evaluateOrderEligibility({ ...base, pauses: [{ from: "2026-09-20", until: "2026-09-22" }] }, lead, 0, monday).reason).toMatch(/pausiert bis 2026-09-22/);
    expect(evaluateOrderEligibility(base, lead, 10, monday).reason).toMatch(/Bestellmenge erreicht/);
    expect(evaluateOrderEligibility({ ...base, supplierRestrictions: { blockUnknownSuppliers: true, allowedSupplierIds: [1] } }, lead, 0, monday).reason).toMatch(/Lieferant/);
    expect(evaluateOrderEligibility({ ...base, advancedFilters: { postcodes: "10, 20" } }, lead, 0, monday).reason).toMatch(/Postleitzahl/);
    expect(evaluateOrderEligibility({ ...base, advancedFilters: { postcodes: "60, 61" } }, lead, 0, monday)).toEqual({ eligible: true });
    expect(evaluateOrderEligibility({ ...base, advancedFilters: { maxLeadPrice: 15 } }, lead, 0, monday).reason).toMatch(/Leadpreis/);
    expect(buildProviderPayload({ publicId: "X1", categoryId: 1, firstName: "A", lastName: null, email: null, phone: "1", postcode: "2", city: null, country: "DE", metadata: { extra: 1 } }, { firstName: "firstName", lastName: "lastName", locationId: "publisherId", customFields: "metadata", extra: "extra" }, "loc")).toEqual({ firstName: "A", locationId: "loc", customFields: { extra: 1 }, extra: 1 });
  });

  it("23. Vertriebspipeline & Meta Lead Ads: Seiten-Token verbinden, Formular-Zuordnung, Webhook-Prüfung, neuer Lead per Webhook mit Kampagne, Kennzahlen, Stufen bis zum Kunden", async () => {
    const before = await owner.leadops.metaConnection(); expect(before.status).toBe("nicht_verbunden"); expect(before.webhookUrl).toContain("/api/meta/webhook"); expect(before.verifyToken).toMatch(/^tanesco-/);
    const connected = await owner.leadops.metaConnectWithToken({ pageId: "1029384756", pageAccessToken: "EAAG-test-page-token-1234567890", adAccountId: "55512345" });
    expect(connected).toMatchObject({ pageName: "Tanesco Energie", webhookSubscribed: true }); expect(connected.forms[0]).toMatchObject({ id: "form-pv", name: "Photovoltaik – Beratung" });
    const after = await owner.leadops.metaConnection(); expect(after).toMatchObject({ status: "verbunden", pageId: "1029384756", adAccountId: "act_55512345", adAccountName: "Tanesco Ads" });
    const pvCategory = (await owner.leadops.listCategories()).find((category) => category.shortcode === "PV") ?? (await owner.leadops.listCategories())[0];
    await owner.leadops.metaSaveFormMappings({ mappings: [{ formId: "form-pv", formName: "Photovoltaik – Beratung", categoryId: pvCategory.id }] });
    // Webhook-Prüfung (GET) und neuer Lead (POST)
    const verify = await fetch(`${apiBase}/api/meta/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(after.verifyToken)}&hub.challenge=abc123`); expect(verify.status).toBe(200); expect(await verify.text()).toBe("abc123");
    expect((await fetch(`${apiBase}/api/meta/webhook?hub.mode=subscribe&hub.verify_token=falsch&hub.challenge=x`)).status).toBe(403);
    const hook = await fetch(`${apiBase}/api/meta/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ object: "page", entry: [{ id: "1029384756", changes: [{ field: "leadgen", value: { leadgen_id: "lg-777", page_id: "1029384756", form_id: "form-pv", ad_id: "ad-1", adgroup_id: "as-1", campaign_id: "cmp-1", created_time: Math.floor(Date.now() / 1000) } }] }] }) });
    expect(hook.status).toBe(200); await new Promise((resolve) => setTimeout(resolve, 400));
    const metaLead = (await db.select().from(leads).where(eq(leads.leadgenId, "lg-777")))[0];
    expect(metaLead).toMatchObject({ firstName: "Mia", lastName: "Meta", email: "meta.lead@beispiel.de", postcode: "80331", city: "München", categoryId: pvCategory.id, supplierName: "Meta Ads", pipelineStage: "neu", adCampaignId: "cmp-1", adCampaignName: "PV Süd", adsetName: "Eigenheim", adName: "Video", adFormName: "Photovoltaik – Beratung", adPlatform: "instagram" });
    expect(metaLead.publicId).toMatch(/^META-[A-Z0-9]{7}$/);
    // Dublette per leadgen_id
    await fetch(`${apiBase}/api/meta/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ object: "page", entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "lg-777", page_id: "1029384756" } }] }] }) }); await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await db.select().from(leads).where(eq(leads.leadgenId, "lg-777"))).length).toBe(1);
    // Kennzahlen laden → Kampagne mit Ausgaben, Kosten je Lead
    const sync = await owner.leadops.metaSyncInsights({ days: 7 }); expect(sync.rows).toBe(1);
    const overview = await owner.leadops.pipelineOverview({});
    const campaign = overview.campaigns.find((row) => row.campaignId === "cmp-1")!; expect(campaign).toMatchObject({ campaignName: "PV Süd", spend: 120.5, impressions: 8000, clicks: 160, leads: 1, costPerLead: 120.5, customers: 0 }); expect(campaign.adsets).toEqual(["Eigenheim"]);
    expect(overview.funnel.steps[0].count).toBeGreaterThanOrEqual(1); expect(overview.stages.find((stage) => stage.key === "neu")!.leads.some((lead) => lead.publicId === metaLead.publicId)).toBe(true);
    // Stufen bis zum Kunden mit Verlauf
    for (const stage of ["kontaktiert", "qualifiziert", "termin", "angebot", "kunde"] as const) expect((await owner.leadops.movePipelineStage({ publicId: metaLead.publicId, stage, note: `→ ${stage}` })).to).toBe(stage);
    const history = await owner.leadops.pipelineHistory({ publicId: metaLead.publicId }); expect(history.map((event) => event.toStage)).toEqual(["kunde", "angebot", "termin", "qualifiziert", "kontaktiert", "neu"]); expect(history[0].actor).toBe("Tanesco Digital");
    const won = await owner.leadops.pipelineOverview({ campaignId: "cmp-1" }); expect(won.totals).toMatchObject({ leads: 1, customers: 1, spend: 120.5, costPerCustomer: 120.5 });
    // Testlead ohne Facebook und Trennen
    const test = await owner.leadops.metaCreateTestLead({ campaignName: "Testkampagne", firstName: "Max", lastName: "Muster", email: "max@beispiel.de" }); expect(test.publicId).toMatch(/^META-[A-Z0-9]{7}$/);
    await owner.leadops.metaDisconnect(); expect((await owner.leadops.metaConnection()).status).toBe("nicht_verbunden");
  });

  it("24. Kaltakquise & E-Mail-Kampagnen: Liste hochladen → Pipeline, Anrufkampagne (power) im Dialer, E-Mail-Serie starten, Öffnung per Pixel, Verzweigung Dann/Sonst", async () => {
    const parsed = await owner.leadops.parseColdList({ csv: "Vorname;Nachname;Firma;Telefon;E-Mail;PLZ;Ort\nPeter;Hansen;Hansen Bedachungen;+49 69 5550101;peter@hansen-test.de;60311;Frankfurt\nSabine;Koch;Koch Dach GmbH;+49 611 5550102;sabine@koch-test.example;65183;Wiesbaden\nKlaus;Brandt;Brandt Bedachung;+49 6421 5550105;;35037;Marburg" });
    expect(parsed.count).toBe(3);
    const imported = await owner.leadops.importColdList({ listName: "Dachdecker Test", rows: parsed.rows }); expect(imported).toMatchObject({ created: 3, duplicates: 0 });
    expect((await owner.leadops.importColdList({ listName: "Dachdecker Test", rows: parsed.rows })).duplicates).toBe(3);
    const lists = await owner.leadops.listColdLists(); expect(lists.find((list) => list.listName === "Dachdecker Test")).toMatchObject({ contacts: 3, withPhone: 3, withEmail: 2 });
    // Vertriebler: Zuteilung einzeln und 50/50-Verteilung
    const sellers = await owner.leadops.pipelineOwners(); expect(sellers.length).toBeGreaterThanOrEqual(1);
    const second = await owner.leadops.importColdList({ listName: "Dachdecker Verteilt", ownerUserIds: sellers.slice(0, 2).map((seller) => seller.userId), rows: [{ lastName: "Eins", phone: "+49 30 7770001" }, { lastName: "Zwei", phone: "+49 30 7770002" }, { lastName: "Drei", phone: "+49 30 7770003" }, { lastName: "Vier", phone: "+49 30 7770004" }] }); expect(second.created).toBe(4);
    const distributed = await owner.leadops.pipelineOverview({ source: "kaltakquise", campaignId: "liste-dachdecker-verteilt" }); const ownersUsed = distributed.stages.flatMap((stage) => stage.leads).map((lead) => lead.ownerUserId); expect(ownersUsed.every((id) => id !== null)).toBe(true); if (sellers.length >= 2) expect(new Set(ownersUsed).size).toBe(2);
    const firstLead = distributed.stages[0].leads[0]; const reassigned = await owner.leadops.assignPipelineOwner({ publicIds: [firstLead.publicId], ownerUserId: null }); expect(reassigned.updated).toBe(1);
    expect((await owner.leadops.pipelineOverview({ source: "kaltakquise", campaignId: "liste-dachdecker-verteilt", ownerUserId: "ohne" })).totals.leads).toBe(1);
    expect((await owner.leadops.pipelineHistory({ publicId: firstLead.publicId }))[0]).toMatchObject({ toStage: "besitzer", note: "Zuteilung entfernt" });
    const pipeline = await owner.leadops.pipelineOverview({ source: "kaltakquise", campaignId: "liste-dachdecker-test" }); expect(pipeline.totals.leads).toBe(3); expect(pipeline.stages[0].leads.every((lead) => lead.adPlatform === "kaltakquise")).toBe(true);
    expect((await owner.leadops.pipelineOverview({ source: "ads" })).stages.flatMap((stage) => stage.leads).some((lead) => lead.adPlatform === "kaltakquise")).toBe(false); // Meta-Pipeline enthält keine Kaltakquise
    const calls = await owner.leadops.startCallCampaign({ listName: "Dachdecker Test", mode: "power" }); expect(calls.mode).toBe("power"); expect(calls.queued).toBe(3);
    expect((await owner.leadops.listDialerCampaigns()).find((campaign) => campaign.id === calls.campaignId)).toMatchObject({ name: "Kaltakquise: Dachdecker Test", mode: "power", status: "aktiv" });
    // E-Mail-Serie
    const starter = await owner.leadops.emailCampaignStarter(); expect(starter.tree.nodes).toHaveLength(6);
    const saved = await owner.leadops.saveEmailCampaign({ name: "Dachdecker Serie", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Dachdecker Test" }, tree: starter.tree, design: starter.design as unknown as Record<string, unknown> });
    expect((await owner.leadops.previewEmailAudience({ source: "liste", listName: "Dachdecker Test" })).count).toBe(2); // nur mit E-Mail
    const started = await owner.leadops.startEmailCampaign({ id: saved.id }); expect(started.added).toBe(2); if (started.processed < 2) await owner.leadops.runEmailCampaigns(); // Versand kann im Hintergrund laufen
    let detail = await owner.leadops.getEmailCampaign({ id: saved.id }); expect(detail.status).toBe("aktiv"); expect(detail.stats).toMatchObject({ total: 2, sent: 2, opened: 0 }); expect(detail.recipients.every((recipient) => recipient.status === "wartet" && recipient.sentCount === 1)).toBe(true);
    const tokens = (await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, saved.id))).map((row) => ({ id: row.id, token: row.token }));
    await db.update(emailCampaignRecipients).set({ lastSentAt: new Date(Date.now() - 60_000) }).where(eq(emailCampaignRecipients.campaignId, saved.id)); // Aufrufe direkt nach dem Versand wären Scanner
    const pixel = await fetch(`${apiBase}/api/mail/o/${tokens[0].token}.gif`); expect(pixel.status).toBe(200); expect(pixel.headers.get("content-type")).toContain("image/gif");
    const click = await fetch(`${apiBase}/api/mail/c/${tokens[0].token}?u=${encodeURIComponent("https://tanesco.digital/termin")}`, { redirect: "manual" }); expect(click.status).toBe(302); expect(click.headers.get("location")).toBe("https://tanesco.digital/termin");
    detail = await owner.leadops.getEmailCampaign({ id: saved.id }); expect(detail.stats).toMatchObject({ opened: 1, clicked: 1 });
    // Wartezeit abgelaufen → Verzweigung: Empfänger 1 (geöffnet) bekommt den Dann-Zweig, Empfänger 2 den Sonst-Zweig
    await db.update(emailCampaignRecipients).set({ nextActionAt: new Date(Date.now() - 60_000) }).where(eq(emailCampaignRecipients.campaignId, saved.id));
    expect((await owner.leadops.runEmailCampaigns()).processed).toBe(2);
    detail = await owner.leadops.getEmailCampaign({ id: saved.id }); expect(detail.status).toBe("beendet"); expect(detail.stats.sent).toBe(2); expect(detail.recipients.every((recipient) => recipient.status === "fertig" && recipient.sentCount === 2)).toBe(true);
    const notes = detail.events.filter((event) => event.kind === "verzweigt").map((event) => event.note).sort(); expect(notes).toEqual(["Wenn geöffnet: ja → Dann-Zweig", "Wenn geöffnet: nein → Sonst-Zweig"]);
    expect(detail.events.filter((event) => event.kind === "gesendet").map((event) => event.subject).sort()).toEqual(["Haben Sie meine E-Mail gesehen, Sabine?", "Kurze Frage zu Ihrem Bedarf, Peter", "Mehr Anfragen für Hansen Bedachungen – ohne Risiko", "Mehr Anfragen für Koch Dach GmbH – ohne Risiko"].sort()); // Verlauf zeigt den gefüllten Betreff je Empfänger
    expect((await fetch(`${apiBase}/api/mail/u/${tokens[1].token}`)).status).toBe(200); expect((await owner.leadops.getEmailCampaign({ id: saved.id })).recipients.find((recipient) => recipient.id === tokens[1].id)?.status).toBe("abgemeldet");
    // Posteingang: Antwort eines Serien-Empfängers + unbekannte Anfrage → als Lead in die Pipeline
    const replyMail = await owner.leadops.storeInboxMessage({ fromEmail: "peter@hansen-test.de", fromName: "Peter Hansen", subject: "Re: Mehr Anfragen", bodyText: "Klingt gut, rufen Sie mich an.\n\nAm 02.10. schrieb Tanesco: > alte Mail" }); expect(replyMail.replied).toBe(true); expect((await owner.leadops.getEmailCampaign({ id: saved.id })).stats.replied).toBe(1); // Antwort erkannt → Empfänger „geantwortet“
    const unknownMail = await owner.leadops.storeInboxMessage({ fromEmail: "m.mayer@solartechnik-test.example", fromName: "Markus Mayer", subject: "Anfrage PV Leads", bodyText: "Bitte Angebot für 20 Leads." });
    const listed = await owner.leadops.listInbox({ filter: "alle" }); expect(listed.counts.alle).toBeGreaterThanOrEqual(2); expect(listed.items.find((item) => item.id === replyMail.id)?.campaignName).toBe("Dachdecker Serie"); expect(listed.items.find((item) => item.id === replyMail.id)?.lead?.publicId).toBeTruthy(); expect(listed.items.find((item) => item.id === unknownMail.id)?.lead).toBeNull();
    // Filter je Kampagne: Kampagnen-Chips mit Zähler, nur Antworten auf die gewählte Serie
    const replyCampaignId = listed.items.find((item) => item.id === replyMail.id)?.campaignId ?? 0; expect(replyCampaignId).toBeGreaterThan(0); expect(listed.campaigns.find((row) => row.id === replyCampaignId)).toMatchObject({ name: "Dachdecker Serie", count: expect.any(Number) });
    const perCampaign = await owner.leadops.listInbox({ filter: "alle", campaignId: replyCampaignId }); expect(perCampaign.items.length).toBeGreaterThanOrEqual(1); expect(perCampaign.items.every((item) => item.campaignId === replyCampaignId)).toBe(true); expect(perCampaign.items.some((item) => item.id === unknownMail.id)).toBe(false); expect(perCampaign.counts.alle).toBe(listed.counts.alle);
    expect((await owner.leadops.listInbox({ filter: "alle", campaignId: 999999 })).items).toEqual([]);
    expect((await owner.leadops.listInbox({ filter: "unbekannt" })).items.some((item) => item.id === unknownMail.id)).toBe(true);
    const createdLead = await owner.leadops.createLeadFromInbox({ messageId: unknownMail.id, pipeline: "ads", stage: "qualifiziert", ownerUserId: sellers[0]?.userId ?? null, company: "Solartechnik Mayer" }); expect(createdLead.created).toBe(true); expect(createdLead.publicId).toMatch(/^MAIL-/);
    const inPipeline = (await owner.leadops.pipelineOverview({ source: "ads" })).stages.find((stage) => stage.key === "qualifiziert")!.leads.find((lead) => lead.publicId === createdLead.publicId); expect(inPipeline).toMatchObject({ adPlatform: "posteingang", email: "m.mayer@solartechnik-test.example", company: "Solartechnik Mayer" });
    const moved = await owner.leadops.createLeadFromInbox({ messageId: replyMail.id, pipeline: "kaltakquise", stage: "termin" }); expect(moved.created).toBe(false); expect((await owner.leadops.pipelineOverview({ source: "kaltakquise" })).stages.find((stage) => stage.key === "termin")!.leads.some((lead) => lead.publicId === moved.publicId)).toBe(true);
    expect((await owner.leadops.listInbox({ filter: "ungelesen" })).items.some((item) => item.id === unknownMail.id)).toBe(false); // nach Übernahme gelesen
    await owner.leadops.archiveInboxMessage({ id: unknownMail.id, archived: true }); expect((await owner.leadops.listInbox({ filter: "archiv" })).items.some((item) => item.id === unknownMail.id)).toBe(true);
    expect((await owner.leadops.replyInboxMessage({ messageId: replyMail.id, text: "Gerne – ich rufe Sie morgen an." })).status).toBe("simuliert");
    // Strikte Trennung: ein Lead zum Verkauf bleibt draußen – eine Serie an „alle“ erreicht nur Vertriebskontakte, der Verkaufs-Lead wird weder Empfänger noch Pipeline-Karte
    const plainCategory = (await owner.leadops.listCategories())[0]; const plain = await owner.leadops.importLead({ categoryId: plainCategory.id, firstName: "Jürgen", lastName: "Stadler", email: "juergen@stadler-test.example", phone: "+49 89 5550201", postcode: "80331", city: "München" } as never); expect(plain).toBeTruthy();
    const emailSeries = await owner.leadops.saveEmailCampaign({ name: "PV-Betriebe Serie", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "alle" }, tree: starter.tree, design: starter.design as unknown as Record<string, unknown> });
    const seriesStart = await owner.leadops.startEmailCampaign({ id: emailSeries.id }); expect(seriesStart.added).toBeGreaterThan(0);
    expect((await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.campaignId, emailSeries.id), eq(emailCampaignRecipients.email, "juergen@stadler-test.example")))).length).toBe(0);
    expect((await owner.leadops.pipelineOverview({ source: "alle" })).stages.flatMap((stage) => stage.leads).some((lead) => lead.email === "juergen@stadler-test.example")).toBe(false);
    expect((await db.select().from(leads).where(eq(leads.email, "juergen@stadler-test.example")))[0]).toMatchObject({ kind: "verkauf", adPlatform: null, pipelineStage: null });
    // Antwort eines Vertriebskontakts aus der Serie → Stufe „Kontaktiert“ (Automatik), Verkaufs-Lead mit gleicher Adresse bleibt unberührt
    const seriesRecipients = await db.select({ recipient: emailCampaignRecipients, stage: leads.pipelineStage }).from(emailCampaignRecipients).innerJoin(leads, eq(leads.id, emailCampaignRecipients.leadId)).where(eq(emailCampaignRecipients.campaignId, emailSeries.id)); const seriesRecipient = seriesRecipients.find((row) => row.stage === "neu")!.recipient; expect(seriesRecipient.leadId).toBeTruthy();
    await db.update(emailCampaignRecipients).set({ sentCount: 1 }).where(eq(emailCampaignRecipients.id, seriesRecipient.id));
    await owner.leadops.storeInboxMessage({ fromEmail: seriesRecipient.email, fromName: seriesRecipient.name ?? "Kontakt", subject: "Re: Mehr Anfragen", bodyText: "Ja, bitte anrufen." });
    expect((await db.select().from(leads).where(eq(leads.id, seriesRecipient.leadId!)))[0].pipelineStage).toBe("kontaktiert");
    const inboxLead = await owner.leadops.createLeadFromInbox({ messageId: (await owner.leadops.storeInboxMessage({ fromEmail: "neu@firma-test.example", fromName: "Nina Neu", subject: "Interesse", bodyText: "Bitte Infos." })).id, pipeline: "email", stage: "qualifiziert" }); expect(inboxLead.created).toBe(true);
    expect((await owner.leadops.pipelineOverview({ source: "email" })).stages.find((stage) => stage.key === "qualifiziert")!.leads.find((lead) => lead.publicId === inboxLead.publicId)).toMatchObject({ adPlatform: "email", adCampaignName: "Posteingang" });
    // Stufen bearbeiten: neue Stufe „Nachfassen“ vor „Verloren“, „Angebot“ entfernen → Leads aus „Angebot“ rutschen auf „Neu“; Notiz an einer Karte
    const defaults = await owner.leadops.pipelineStages(); expect(defaults.map((stage) => stage.key)).toEqual(["neu", "in_bearbeitung", "kontaktiert", "qualifiziert", "termin", "angebot", "kunde", "verloren"]);
    const edited = await owner.leadops.savePipelineStages({ stages: [...defaults.filter((stage) => stage.key !== "angebot").map((stage) => stage.key === "termin" ? { ...stage, label: "Vor-Ort-Termin" } : stage), { label: "Nachfassen", hint: "Später erneut melden" }] });
    expect(edited.stages.map((stage) => stage.key)).toEqual(["neu", "in_bearbeitung", "kontaktiert", "qualifiziert", "termin", "kunde", "stufe_nachfassen", "verloren"]); expect(edited.stages.find((stage) => stage.key === "termin")?.label).toBe("Vor-Ort-Termin");
    await expect(owner.leadops.savePipelineStages({ stages: edited.stages.filter((stage) => stage.key !== "kunde") })).rejects.toThrow("Kunde");
    const customOverview = await owner.leadops.pipelineOverview({ source: "ads" }); expect(customOverview.stageDefs.map((stage) => stage.label)).toContain("Nachfassen"); expect(customOverview.stages.some((stage) => stage.key === "angebot")).toBe(false);
    await expect(owner.leadops.movePipelineStage({ publicId: inboxLead.publicId, stage: "angebot" })).rejects.toThrow("Unbekannte Stufe");
    expect((await owner.leadops.movePipelineStage({ publicId: inboxLead.publicId, stage: "stufe_nachfassen" })).to).toBe("stufe_nachfassen");
    await owner.leadops.addPipelineNote({ publicId: inboxLead.publicId, text: "Rückruf Dienstag 10 Uhr", source: "sprache" }); const pipelineNoteRows = await owner.leadops.listPipelineNotes({ publicId: inboxLead.publicId }); expect(pipelineNoteRows[0]).toMatchObject({ text: "Rückruf Dienstag 10 Uhr", source: "sprache" });
    await owner.leadops.savePipelineStages({ stages: defaults }); // zurück auf Standard
    // Lead-Finder: Suche (OpenStreetMap gestubbt) → Profil laden → in die Kaltakquise-Pipeline
    const found = await owner.leadops.findCompanies({ query: "Dachdecker", location: "Frankfurt", radiusKm: 25, limit: 20 }); expect(found).toMatchObject({ provider: "osm", found: 2, created: 2 }); expect((await owner.leadops.findCompanies({ query: "Dachdecker", location: "Frankfurt" })).created).toBe(0); // Dubletten
    const prospects = await owner.leadops.listProspects({ status: "neu" }); const hansen = prospects.find((row) => row.name === "Hansen Bedachungen GmbH")!; expect(hansen).toMatchObject({ phone: "+49 69 5550101", postcode: "60311", city: "Frankfurt", website: "https://hansen-test.de" });
    const enriched = await owner.leadops.enrichProspect({ id: hansen.id }); expect(enriched.profile).toMatchObject({ management: "Peter Hansen", employees: "24 Mitarbeiter", founded: "1998", registry: "HRB 12345" }); expect(enriched.profile?.emails).toEqual(["info@hansen-test.de"]); expect(enriched.profile?.revenue).toContain("3,2"); expect(enriched.profile?.serviceArea).toContain("Frankfurt");
    const taken = await owner.leadops.prospectsToPipeline({ ids: prospects.map((row) => row.id), ownerUserIds: sellers.slice(0, 2).map((seller) => seller.userId) }); expect(taken).toMatchObject({ created: 2, skipped: 0, listName: "Lead-Finder: Dachdecker Frankfurt" });
    const finderLeads = (await owner.leadops.pipelineOverview({ source: "kaltakquise", campaignId: "liste-lead-finder-dachdecker-frankfurt" })).stages.flatMap((stage) => stage.leads); expect(finderLeads).toHaveLength(2); expect(finderLeads.find((lead) => lead.company === "Hansen Bedachungen GmbH")).toMatchObject({ email: "info@hansen-test.de", phone: "+49 69 5550101" }); expect(finderLeads.every((lead) => lead.ownerUserId)).toBe(true);
    expect((await owner.leadops.listProspects({ status: "uebernommen" })).length).toBe(2);
  });

  it("25. Meta-Verbindung komplett: Facebook-Login (OAuth-Start und Rückruf), Seite + Werbekonto + Webhook-Abo, Signaturprüfung des Webhooks, Formulare, Kennzahlen, Trennen", async () => {
    process.env.META_APP_ID = "123456789012345"; process.env.META_APP_SECRET = "meta-test-secret"; process.env.APP_URL = apiBase;
    try {
      expect((await owner.leadops.metaConnection()).status).toBe("nicht_verbunden");
      const start = await owner.leadops.metaOauthUrl(); expect(start.url).toContain("https://www.facebook.com/v21.0/dialog/oauth?client_id=123456789012345"); expect(start.url).toContain(encodeURIComponent(`${apiBase}/api/meta/oauth/callback`)); expect(start.url).toContain("leads_retrieval"); expect(start.state).toBeTruthy();
      const callback = await fetch(`${apiBase}/api/meta/oauth/callback?code=AQD-test-code&state=${start.state}`, { redirect: "manual" }); expect(callback.status).toBe(302); expect(callback.headers.get("location")).toBe("/?page=Vertriebspipeline&meta=verbunden");
      const connected = await owner.leadops.metaConnection(); expect(connected).toMatchObject({ status: "verbunden", pageId: "1029384756", pageName: "Tanesco Energie", adAccountId: "act_55512345", adAccountName: "Tanesco Ads", webhookSubscribed: true, oauthReady: true }); expect(connected.tokenHint).toContain("EAAG-p"); expect(connected.tokenExpiresAt).toBeTruthy();
      expect((await fetch(`${apiBase}/api/meta/oauth/callback?code=x&state=kaputt`, { redirect: "manual" })).headers.get("location")).toBe("/?page=Vertriebspipeline&meta=fehler");
      // Webhook-Signatur: ohne/falsch → 401, richtig → 200 und Lead importiert
      const payload = JSON.stringify({ object: "page", entry: [{ id: "1029384756", changes: [{ field: "leadgen", value: { leadgen_id: "lg-778", page_id: "1029384756", form_id: "form-pv" } }] }] });
      const { createHmac } = await import("node:crypto"); const good = `sha256=${createHmac("sha256", "meta-test-secret").update(payload).digest("hex")}`;
      expect((await fetch(`${apiBase}/api/meta/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: payload })).status).toBe(401);
      expect((await fetch(`${apiBase}/api/meta/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" }, body: payload })).status).toBe(401);
      expect((await fetch(`${apiBase}/api/meta/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": good }, body: payload })).status).toBe(200); await new Promise((resolve) => setTimeout(resolve, 400));
      const imported = (await db.select().from(leads).where(eq(leads.leadgenId, "lg-778")))[0]; expect(imported).toMatchObject({ firstName: "Mia", lastName: "Meta", adCampaignName: "PV Süd", adPlatform: "instagram", pipelineStage: "neu" });
      const verify = await fetch(`${apiBase}/api/meta/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(connected.verifyToken)}&hub.challenge=ok-123`); expect(await verify.text()).toBe("ok-123");
      const forms = await owner.leadops.metaForms(); expect(forms[0]).toMatchObject({ id: "form-pv", name: "Photovoltaik – Beratung" });
      expect((await owner.leadops.metaSyncInsights({ days: 7 })).rows).toBe(1); expect((await owner.leadops.pipelineOverview({ source: "ads" })).campaigns.find((row) => row.campaignId === "cmp-1")).toMatchObject({ spend: 120.5, leads: 2 }); // lg-777 (Test 23) + lg-778
      await owner.leadops.metaDisconnect(); expect((await owner.leadops.metaConnection())).toMatchObject({ status: "nicht_verbunden", pageId: null, webhookSubscribed: false });
    } finally { delete process.env.META_APP_ID; delete process.env.META_APP_SECRET; delete process.env.APP_URL; }
  });

  it("26. Pipeline-Erweiterungen: Wiedervorlagen („Heute“), eingeschlafene Karten + Aufweck-Serie, Stufe/Anruf/Antwort → Serie, SMS/WhatsApp/E-Mail aus der Karte, Termine mit Einladung & Erinnerung, Angebotswerte, Verteilregeln & Team, A/B-Test, Versandfenster, Sperrliste/Bounce-Webhook, Vorlagen, Mehrfachauswahl, CSV, Lead-Punkte", async () => {
    const pipelineExtras = await import("./pipeline-extras");
    const sellers = await owner.leadops.pipelineOwners(); expect(sellers.length).toBeGreaterThanOrEqual(1);
    // Grunddaten: eigene Liste mit drei Kontakten
    const imported = await owner.leadops.importColdList({ listName: "Erweiterungen", rows: [{ firstName: "Erika", lastName: "Eins", company: "Eins GmbH", phone: "+49 69 8880001", email: "erika@eins-test.example", postcode: "60311", city: "Frankfurt", salutation: "frau" }, { firstName: "Zed", lastName: "Zwei", company: "Zwei GmbH", phone: "+49 89 8880002", email: "zed@zwei-test.example", postcode: "80331", city: "München" }, { firstName: "Dora", lastName: "Drei", phone: "+49 40 8880003", postcode: "20095", city: "Hamburg" }] }); expect(imported.created).toBe(3);
    const [eins, zwei, drei] = await Promise.all(imported.leadIds.map(async (id) => (await db.select().from(leads).where(eq(leads.id, id)))[0]));
    // 1) Wiedervorlagen: anlegen, „Heute“, verschieben, erledigen; Wiedervorlage-Datum am Lead
    const dueToday = new Date(); dueToday.setHours(16, 0, 0, 0);
    const task = await owner.leadops.createPipelineTask({ publicId: eins.publicId, kind: "anruf", title: "Rückruf Angebot", dueAt: dueToday });
    const due = await owner.leadops.pipelineDueList({}); expect(due.tasks.find((item) => item.id === task.id)).toMatchObject({ kind: "anruf", title: "Rückruf Angebot", lead: { publicId: eins.publicId, phone: "+49 69 8880001" } });
    expect((await leadRow(eins.publicId)).followUpAt?.getTime()).toBe(dueToday.getTime());
    const later = new Date(dueToday.getTime() + 2 * 86_400_000); await owner.leadops.snoozePipelineTask({ id: task.id, dueAt: later }); expect((await leadRow(eins.publicId)).followUpAt?.getTime()).toBe(later.getTime());
    await owner.leadops.completePipelineTask({ id: task.id }); expect((await leadRow(eins.publicId)).followUpAt).toBeNull(); expect((await owner.leadops.listPipelineTasks({ publicId: eins.publicId })).length).toBe(0); expect((await owner.leadops.listPipelineTasks({ publicId: eins.publicId, includeDone: true })).length).toBe(1);
    // 2) Automatik einstellen: Aufweck-Serie (5 Tage), Angebot → Nachfass-Serie, Interessiert → Serie, Antwort → Kontaktiert, Terminerinnerung per E-Mail, Verteilregeln, Tagesziele
    const offerStarter = await owner.leadops.emailCampaignStarter({ kind: "angebot" }); expect(offerStarter.name).toBe("Nachfassen nach Angebot"); expect(offerStarter.tree.nodes.find((node) => node.type === "condition")).toMatchObject({ check: "replied" });
    const offerSeries = await owner.leadops.saveEmailCampaign({ name: "Nachfassen nach Angebot", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "alle" }, tree: offerStarter.tree, design: offerStarter.design as unknown as Record<string, unknown> });
    const wakeStarter = await owner.leadops.emailCampaignStarter({ kind: "aufwecken" }); const wakeSeries = await owner.leadops.saveEmailCampaign({ name: "Aufwecken", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "alle" }, tree: wakeStarter.tree, design: wakeStarter.design as unknown as Record<string, unknown> });
    const settings = await owner.leadops.savePipelineSettings({ staleDays: 5, staleCampaignId: wakeSeries.id, stageCampaigns: { angebot: offerSeries.id }, dispositionCampaigns: { interessiert: offerSeries.id }, dispositionTasks: true, replyStage: "kontaktiert", appointmentReminder: "email", appointmentReminderHours: 24, distribution: { mode: "regeln", rules: [{ id: "r1", userId: sellers[0].userId, postcodePrefixes: ["6"], categoryIds: [], maxOpen: null }], fallback: "ohne" }, dailyTargets: { [String(sellers[0].userId)]: { calls: 30, appointments: 2, deals: 1 } } });
    expect(settings.stageCampaigns.angebot).toBe(offerSeries.id); expect((await owner.leadops.pipelineSettings()).distribution.rules[0].postcodePrefixes).toEqual(["6"]);
    // 3) Stufe „Angebot“ → Nachfass-Serie (Entwurf wird aktiv, erste Mail sofort), Anruf-Ergebnis „Interessiert“ → Aufgabe + Serie (kein Doppel), „Wiedervorlage“ → Aufgabe; Antwort → Kontaktiert nur vorwärts
    const moved = await owner.leadops.movePipelineStage({ publicId: zwei.publicId, stage: "angebot", note: "Angebot raus" }); expect(moved.series).toBe("Nachfassen nach Angebot");
    const enrolled = (await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, offerSeries.id))); expect(enrolled.map((row) => row.email)).toEqual(["zed@zwei-test.example"]); expect((await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, offerSeries.id)))[0].status).toBe("aktiv");
    expect((await owner.leadops.pipelineHistory({ publicId: zwei.publicId })).some((event) => event.toStage === "serie" && event.note?.includes("Stufe „Angebot“"))).toBe(true);
    await pipelineExtras.onDisposition(db, S.tenantId, { leadId: zwei.id, disposition: "interessiert", actorUserId: ownerUserId });
    expect((await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, offerSeries.id))).length).toBe(1); // bereits Empfänger → kein Doppel
    expect((await owner.leadops.listPipelineTasks({ publicId: zwei.publicId })).find((item) => item.source === "dialer")).toMatchObject({ kind: "email", title: "Angebot / Unterlagen schicken" });
    await pipelineExtras.onDisposition(db, S.tenantId, { leadId: drei.id, disposition: "wiedervorlage", followUpMinutes: 90, actorUserId: ownerUserId });
    const dreiTask = (await owner.leadops.listPipelineTasks({ publicId: drei.publicId }))[0]; expect(dreiTask).toMatchObject({ kind: "anruf", source: "dialer" }); expect(dreiTask.dueAt.getTime()).toBeGreaterThan(Date.now());
    expect(await pipelineExtras.onInboxReply(db, S.tenantId, { leadId: eins.id, subject: "Re: Angebot" })).toBe("kontaktiert"); expect((await leadRow(eins.publicId)).pipelineStage).toBe("kontaktiert");
    expect(await pipelineExtras.onInboxReply(db, S.tenantId, { leadId: zwei.id, subject: "Re" })).toBeNull(); expect((await leadRow(zwei.publicId)).pipelineStage).toBe("angebot"); // nie rückwärts
    // 4) Nachrichten aus der Karte: SMS (Simulation über die eigene Rufnummer), WhatsApp als Link, Einzel-E-Mail aus Kampagnen-Vorlage; erste Nachricht zieht aus „Neu“
    const sms = await owner.leadops.sendLeadMessage({ publicId: drei.publicId, channel: "sms", text: "Guten Tag {{anrede}} {{nachname}}, hier {{absender}} von Tanesco.", templateKey: "frei" }); expect(sms.status).toBe("simuliert"); expect(sms.text).toContain("Drei, hier"); expect(sms.to).toBe("+49408880003");
    expect((await leadRow(drei.publicId)).pipelineStage).toBe("kontaktiert");
    const wa = await owner.leadops.sendLeadMessage({ publicId: drei.publicId, channel: "whatsapp", text: "Kurze Frage, {{vorname}}?" }); expect(wa.status).toBe("link"); expect(wa.link).toContain("https://wa.me/49408880003?text=Kurze%20Frage%2C%20Dora%3F");
    const nodes = await owner.leadops.emailSendNodes(); const node = nodes.find((item) => item.campaignId === offerSeries.id)!; expect(node.label).toBe("Nachfassen 1");
    const mail = await owner.leadops.sendLeadMessage({ publicId: eins.publicId, channel: "email", text: "", campaignId: node.campaignId, nodeId: node.nodeId }); expect(mail.status).toBe("simuliert"); expect(mail.subject).toBe("Noch Fragen zu unserem Angebot, Erika?");
    const messages = await owner.leadops.listLeadMessages({ publicId: drei.publicId }); expect(messages.map((item) => item.channel).sort()).toEqual(["sms", "whatsapp"]);
    await expect(owner.leadops.sendLeadMessage({ publicId: drei.publicId, channel: "email", text: "x" })).rejects.toThrow("keine E-Mail-Adresse");
    // 5) Termine: Datum + Einladung (ICS, simuliert) + Stufe „Termin“ + Aufgabe; Erinnerung per Automatik (24 h vorher), nur einmal
    const when = new Date(Date.now() + 20 * 3_600_000); when.setSeconds(0, 0);
    const appointment = await owner.leadops.setPipelineAppointment({ publicId: eins.publicId, appointmentAt: when, location: "Vor Ort", note: "Dach prüfen", sendInvitation: true }); expect(appointment.invitation?.status).toBe("simuliert");
    expect((await leadRow(eins.publicId))).toMatchObject({ pipelineStage: "termin" }); expect((await leadRow(eins.publicId)).appointmentAt?.getTime()).toBe(when.getTime());
    expect((await db.select().from(outboundMessages).where(eq(outboundMessages.leadId, eins.id))).some((row) => row.templateKey === "termin_einladung" && row.subject?.startsWith("Terminbestätigung"))).toBe(true);
    expect((await db.select().from(pipelineTasks).where(eq(pipelineTasks.leadId, eins.id))).some((row) => row.kind === "termin" && row.source === "termin" && !row.doneAt)).toBe(true);
    const automation = await owner.leadops.runPipelineAutomations(); expect(automation.reminders).toBe(1);
    expect((await db.select().from(outboundMessages).where(eq(outboundMessages.leadId, eins.id))).some((row) => row.templateKey === "erinnerung")).toBe(true);
    expect((await owner.leadops.runPipelineAutomations()).reminders).toBe(0);
    // 6) Angebotswerte: Pipeline-Wert, Gewichtung, Umsatz je Vertriebler, Lead-Punkte, eingeschlafene Karten in der Übersicht
    expect((await owner.leadops.setPipelineDealValue({ publicId: eins.publicId, dealValue: 12500.5 })).dealValue).toBe(12500.5);
    await owner.leadops.setPipelineDealValue({ publicId: zwei.publicId, dealValue: 8000 }); await owner.leadops.movePipelineStage({ publicId: zwei.publicId, stage: "kunde" });
    await db.update(leads).set({ pipelineUpdatedAt: new Date(Date.now() - 9 * 86_400_000), createdAt: new Date(Date.now() - 12 * 86_400_000) }).where(eq(leads.id, drei.id)); await db.delete(pipelineEvents).where(eq(pipelineEvents.leadId, drei.id)); await db.delete(outboundMessages).where(eq(outboundMessages.leadId, drei.id));
    const overview = await owner.leadops.pipelineOverview({ source: "kaltakquise", campaignId: "liste-erweiterungen" }); const cards = overview.stages.flatMap((stage) => stage.leads);
    expect(cards.find((card) => card.publicId === eins.publicId)).toMatchObject({ dealValue: 12500.5, stale: false }); { const karte = cards.find((card) => card.publicId === eins.publicId)!; expect(typeof karte.score).toBe("number"); expect(["heiss", "warm", "kalt"]).toContain(karte.temperature); expect(karte.scoreReasons.some((reason: string) => reason.includes("Angebot über"))).toBe(true); }
    expect(cards.find((card) => card.publicId === drei.publicId)).toMatchObject({ stale: true, openTasks: 1 }); expect(cards.find((card) => card.publicId === drei.publicId)?.staleDays).toBeGreaterThanOrEqual(8); expect(overview.staleCount).toBe(1);
    expect(overview.value).toMatchObject({ openValue: 12500.5, wonValue: 8000, wonCount: 1, closeRateEuro: 100 }); expect(overview.value.weighted).toBe(Math.round(12500.5 * 0.74)); // Stufe „Termin“ = 74 % (5. von 6 offenen Stufen, seit „In Bearbeitung“)
    // eingeschlafene Karte → Aufweck-Serie (nur mit E-Mail; Drei hat keine → nicht aufgenommen, aber markiert)
    const woke = await owner.leadops.runPipelineAutomations(); expect(woke.enrolled).toBe(0); expect(JSON.stringify((await leadRow(drei.publicId)).metadata ?? {})).not.toContain("staleEnrolledAt"); // ohne E-Mail: nichts zu tun
    await db.update(leads).set({ email: "dora@drei-test.example" }).where(eq(leads.id, drei.id)); expect((await owner.leadops.runPipelineAutomations()).enrolled).toBe(1); expect(JSON.stringify((await leadRow(drei.publicId)).metadata)).toContain("staleEnrolledAt"); expect((await owner.leadops.runPipelineAutomations()).enrolled).toBe(0);
    expect((await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, wakeSeries.id))).map((row) => row.email)).toEqual(["dora@drei-test.example"]);
    // 7) Verteilung & Team: Regel PLZ 6 → Vertriebler 1, sonst offen; Team-Übersicht mit Zielen
    const auto = await owner.leadops.importColdList({ listName: "Erweiterungen", rows: [{ lastName: "Regel-Frankfurt", phone: "+49 69 8880004", postcode: "60486" }, { lastName: "Regel-Berlin", phone: "+49 30 8880005", postcode: "10115" }] }); expect(auto.created).toBe(2);
    const [frankfurt, berlin] = await Promise.all(auto.leadIds.map(async (id) => (await db.select().from(leads).where(eq(leads.id, id)))[0])); expect(frankfurt.ownerUserId).toBe(sellers[0].userId); expect(berlin.ownerUserId).toBeNull();
    const forced = await owner.leadops.distributePipelineByRules({ publicIds: [berlin.publicId] }); expect(forced).toMatchObject({ assigned: 0, skipped: 1 }); // keine Regel passt, „offen lassen“
    const team = await owner.leadops.pipelineTeamOverview({ from: new Date(Date.now() - 86_400_000), until: new Date() }); const me = team.rows.find((row) => row.userId === sellers[0].userId)!; expect(me.target).toEqual({ calls: 30, appointments: 2, deals: 1 }); expect(me.openCards).toBeGreaterThanOrEqual(1);
    // 8) E-Mail-Details: A/B-Betreff mit Anteil, Versandfenster, Link-Bedingung, Bounce-Webhook + Sperrliste, Vorlage duplizieren
    const abStarter = await owner.leadops.emailCampaignStarter({ kind: "kaltakquise" }); const abSend = abStarter.tree.nodes.find((n): n is Extract<typeof n, { type: "send" }> => n.type === "send")!; abSend.subjectB = "Variante B für {{firma}}"; const abCond = abStarter.tree.nodes.find((n): n is Extract<typeof n, { type: "condition" }> => n.type === "condition")!; abCond.check = "clicked"; abCond.url = "/termin";
    const ab = await owner.leadops.saveEmailCampaign({ name: "A/B-Serie", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Erweiterungen" }, tree: abStarter.tree, design: abStarter.design as unknown as Record<string, unknown>, sendWindow: { enabled: true, weekdays: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59", timezone: "Europe/Berlin" }, abSplit: 50 });
    const abList = (await owner.leadops.listEmailCampaigns()).find((row) => row.id === ab.id)!; expect(abList).toMatchObject({ abTest: true, abSplit: 50 }); expect(abList.sendWindow.enabled).toBe(true);
    const abStarted = await owner.leadops.startEmailCampaign({ id: ab.id }); expect(abStarted.added).toBe(3); if (abStarted.processed < 3) await owner.leadops.runEmailCampaigns();
    let abDetail = await owner.leadops.getEmailCampaign({ id: ab.id }); expect(abDetail.recipients.map((row) => row.variant).sort()).toEqual(["A", "A", "B"]); expect(abDetail.stats.abTest).toBeTruthy(); expect(abDetail.stats.abTest?.b.sent).toBe(1);
    expect(abDetail.events.filter((event) => event.kind === "gesendet").map((event) => event.subject).sort()).toEqual(["Mehr Anfragen für  – ohne Risiko", "Mehr Anfragen für Eins GmbH – ohne Risiko", "Variante B für Zwei GmbH"]); // gefüllte Betreffs (ein Empfänger ohne Firma)
    // Versandfenster „nachts zu“: fällige Mails warten
    await owner.leadops.saveEmailCampaign({ id: ab.id, name: "A/B-Serie", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Erweiterungen" }, tree: abStarter.tree, design: abStarter.design as unknown as Record<string, unknown>, sendWindow: { enabled: true, weekdays: [new Date().getDay() === 0 ? 1 : 0], from: "01:00", to: "01:30", timezone: "Europe/Berlin" } });
    const abRecipients = await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, ab.id)); const [clicker, other, third] = abRecipients;
    await db.update(emailCampaignRecipients).set({ lastSentAt: new Date(Date.now() - 60_000) }).where(eq(emailCampaignRecipients.campaignId, ab.id)); // Aufrufe direkt nach dem Versand wären Scanner
    await fetch(`${apiBase}/api/mail/c/${clicker.token}?u=${encodeURIComponent("https://tanesco.digital/termin")}`, { redirect: "manual" }); await fetch(`${apiBase}/api/mail/c/${other.token}?u=${encodeURIComponent("https://tanesco.digital/preise")}`, { redirect: "manual" });
    expect((await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, clicker.id)))[0].clickedUrls).toEqual(["https://tanesco.digital/termin"]);
    await db.update(emailCampaignRecipients).set({ nextActionAt: new Date(Date.now() - 60_000) }).where(eq(emailCampaignRecipients.campaignId, ab.id)); await owner.leadops.runEmailCampaigns();
    abDetail = await owner.leadops.getEmailCampaign({ id: ab.id }); const branches = abDetail.events.filter((event) => event.kind === "verzweigt");
    expect(branches.find((event) => event.recipientId === clicker.id)?.note).toContain("ja → Dann-Zweig"); expect(branches.find((event) => event.recipientId === other.id)?.note).toContain("nein → Sonst-Zweig");
    expect(abDetail.recipients.every((row) => row.status === "wartet" && row.sentCount === 1)).toBe(true); expect(abDetail.events.some((event) => event.note.includes("Versandfenster: wartet bis"))).toBe(true); // Fenster geschlossen → zweite Mail wartet
    // Bounce per Webhook (Mailgun-Form) → Empfänger gestoppt, Adresse gesperrt, nicht mehr in Zielgruppen; Beschwerde per Knopf; Sperre aufheben
    const hook = await fetch(`${apiBase}/api/mail/bounce`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "failed", recipient: third.email, reason: "550 mailbox unavailable" }) }); expect(await hook.json()).toEqual({ handled: 1 });
    expect((await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, third.id)))[0].status).toBe("bounce"); expect((await owner.leadops.listEmailSuppressions()).items.find((row) => row.email === third.email)).toMatchObject({ reason: "bounce" });
    expect((await owner.leadops.previewEmailAudience({ source: "liste", listName: "Erweiterungen" })).sample.some((row) => row.email === third.email)).toBe(false);
    const complaint = await owner.leadops.markEmailBounced({ recipientId: other.id, kind: "beschwerde" }); expect(complaint.stopped).toBeGreaterThanOrEqual(1); expect((await owner.leadops.getEmailCampaign({ id: ab.id })).stats.bounced).toBe(2);
    const suppression = (await owner.leadops.listEmailSuppressions()).items.find((row) => row.email === third.email)!; await owner.leadops.removeEmailSuppression({ id: suppression.id }); expect((await owner.leadops.previewEmailAudience({ source: "liste", listName: "Erweiterungen" })).sample.some((row) => row.email === third.email)).toBe(true);
    await expect(owner.leadops.sendLeadMessage({ publicId: (await db.select().from(leads).where(eq(leads.email, other.email)))[0].publicId, channel: "email", subject: "Hallo", text: "Test" })).rejects.toThrow("Sperrliste");
    // Vorlagen: als Vorlage kopieren (nicht startbar), daraus neue Kampagne
    const template = await owner.leadops.duplicateEmailCampaign({ id: ab.id, asTemplate: true }); expect(template.name).toBe("A/B-Serie (Vorlage)"); expect((await owner.leadops.listEmailCampaigns()).find((row) => row.id === template.id)).toMatchObject({ isTemplate: true, abTest: true });
    await expect(owner.leadops.startEmailCampaign({ id: template.id })).rejects.toThrow("Vorlage");
    const fromTemplate = await owner.leadops.duplicateEmailCampaign({ id: template.id, name: "Aus Vorlage" }); expect((await owner.leadops.getEmailCampaign({ id: template.id })).audience).toMatchObject({ source: "liste", listNames: [] }); await owner.leadops.setEmailCampaignTemplate({ id: fromTemplate.id, isTemplate: true }); expect((await owner.leadops.getEmailCampaign({ id: fromTemplate.id })).audience).toMatchObject({ source: "liste", listNames: [] }); await owner.leadops.setEmailCampaignTemplate({ id: fromTemplate.id, isTemplate: false }); expect((await owner.leadops.getEmailCampaign({ id: fromTemplate.id })).audience).toMatchObject({ source: "liste", listNames: [] }); expect((await owner.leadops.getEmailCampaign({ id: fromTemplate.id })).isTemplate).toBe(false); expect((await owner.leadops.getEmailCampaign({ id: fromTemplate.id })).recipients.length).toBe(0);
    await owner.leadops.setEmailCampaignTemplate({ id: fromTemplate.id, isTemplate: true }); expect((await owner.leadops.getEmailCampaign({ id: fromTemplate.id })).isTemplate).toBe(true);
    // 9) Mehrfachauswahl verschieben, CSV-Export, Suche über Punkte
    const bulk = await owner.leadops.bulkMovePipelineStage({ publicIds: [frankfurt.publicId, berlin.publicId], stage: "qualifiziert" }); expect(bulk).toMatchObject({ moved: 2, label: "Qualifiziert" });
    const csv = await owner.leadops.exportPipelineCsv({ source: "kaltakquise", campaignId: "liste-erweiterungen" }); expect(csv.rows).toBe(5); expect(csv.csv.split("\n")[0]).toContain("Lead-ID;Name;Firma;E-Mail;Telefon"); expect(csv.csv.split("\n")[0]).toContain("Einschätzung;Punkte"); expect(csv.csv).toContain("12500,5"); expect(csv.csv).toContain("Qualifiziert");
    await owner.leadops.savePipelineSettings({ ...settings, distribution: { mode: "aus", rules: [], fallback: "reihum" }, stageCampaigns: {}, dispositionCampaigns: {}, staleCampaignId: null });
  });

  it("27. Dialer für Posteingangs-Leads (Telefon aus der Signatur, nachtragen an der Karte) und KI-Vorlagen-Builder (E-Mail, Serie, Kurztext – ohne Schlüssel regelbasiert)", async () => {
    const stored = await owner.leadops.storeInboxMessage({ fromEmail: "k.keller@keller-bau-test.example", fromName: "Karin Keller", subject: "Anfrage Treppenlift", bodyText: "Guten Tag,\n\nbitte schicken Sie mir ein Angebot.\n\nViele Grüße\nKarin Keller\nKeller Bau GmbH\nTel. 0711 5550177" });
    expect((await owner.leadops.listInbox({ filter: "alle" })).items.find((item) => item.id === stored.id)?.phoneHint).toBe("+497115550177");
    const created = await owner.leadops.createLeadFromInbox({ messageId: stored.id, pipeline: "email", stage: "kontaktiert", company: "Keller Bau GmbH" }); expect(created.created).toBe(true);
    expect((await leadRow(created.publicId)).phone).toBe("+497115550177"); // ohne Eingabe aus der Signatur übernommen
    const card = (await owner.leadops.pipelineOverview({ source: "email" })).stages.flatMap((stage) => stage.leads).find((lead) => lead.publicId === created.publicId)!; expect(card.phone).toBe("+497115550177");
    // Lead ohne Nummer: an der Karte nachtragen (Eingabe über den Telefon-Knopf), danach wählbar
    await db.update(leads).set({ phone: null }).where(eq(leads.publicId, created.publicId));
    await expect(owner.leadops.setPipelineContact({ publicId: created.publicId, phone: "12" })).rejects.toThrow("gültige Telefonnummer");
    expect((await owner.leadops.setPipelineContact({ publicId: created.publicId, phone: "+49 711 5550177" })).phone).toBe("+49 711 5550177"); expect((await owner.leadops.pipelineHistory({ publicId: created.publicId }))[0]).toMatchObject({ toStage: "kontakt" });
    await owner.leadops.startDialerSession({ campaignId: null, mode: "manuell", connection: "browser", agentPhone: null }); const placed = await owner.leadops.placeManualCall({ publicId: created.publicId }); expect(placed.callId).toBeGreaterThan(0); await owner.leadops.endDialerCall({ callId: placed.callId, durationSeconds: 3 }); await owner.leadops.updateDialerSession({ status: "offline" });
    // Lead zum Verkauf mit derselben E-Mail bleibt unberührt – aus dem Posteingang entsteht ein eigener Vertriebskontakt mit der Nummer aus dem Formular
    const existing = await owner.leadops.importLead({ categoryId: (await owner.leadops.listCategories())[0].id, firstName: "Olaf", lastName: "Ohne", email: "olaf@ohne-test.example" } as never); expect(existing).toBeTruthy();
    const mail2 = await owner.leadops.storeInboxMessage({ fromEmail: "olaf@ohne-test.example", subject: "Rückruf", bodyText: "Bitte zurückrufen." }); expect(mail2.leadId).toBeNull();
    const fromInbox = await owner.leadops.createLeadFromInbox({ messageId: mail2.id, pipeline: "kaltakquise", stage: "kontaktiert", phone: "0160 7770001" }); expect(fromInbox.created).toBe(true);
    const olafRows = await db.select().from(leads).where(eq(leads.email, "olaf@ohne-test.example")); expect(olafRows.find((row) => row.kind === "vertrieb")?.phone).toBe("0160 7770001"); expect(olafRows.find((row) => row.kind === "verkauf")).toMatchObject({ phone: null, pipelineStage: null });
    // Bestehender Vertriebskontakt ohne Nummer → Nummer aus dem Posteingang nachgetragen
    await db.update(leads).set({ phone: null }).where(eq(leads.publicId, fromInbox.publicId)); const mail3 = await owner.leadops.storeInboxMessage({ fromEmail: "olaf@ohne-test.example", subject: "Nochmal", bodyText: "Meine Nummer: 0160 7770002\nOlaf" }); expect(mail3.leadId).toBe(fromInbox.leadId);
    expect((await owner.leadops.createLeadFromInbox({ messageId: mail3.id, pipeline: "kaltakquise", stage: "qualifiziert" })).created).toBe(false); expect((await db.select().from(leads).where(eq(leads.publicId, fromInbox.publicId)))[0].phone).toBe("+491607770002");
    // KI-Vorlagen-Builder ohne Schlüssel: regelbasiert, aber vollständig und als Kampagne startbar
    const savedKey = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    try {
      const single = await owner.leadops.draftEmailWithAi({ brief: "Nachfass-Mail nach Angebot für Dachdecker, freundlich, mit Terminlink", tone: "freundlich", length: "mittel", abTest: true }); expect(single.source).toBe("vorlage"); expect(single.draft.subjectB).toBeTruthy(); expect(single.draft.blocks.map((block) => block.type)).not.toContain("button"); /* kein Knopf – es gibt keine Terminbuchung */
      const series = await owner.leadops.draftEmailSeriesWithAi({ brief: "Erstkontakt für PV-Betriebe in Bayern", count: 3, waitDays: 4, stopWhen: "replied", audience: "PV-Betriebe Bayern" }); expect(series.series.mails).toHaveLength(3); expect(series.tree.nodes.filter((node) => node.type === "condition").every((node) => node.type === "condition" && node.check === "replied")).toBe(true);
      const campaign = await owner.leadops.saveEmailCampaign({ name: series.series.name, fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Erweiterungen" }, tree: series.tree, design: {} });
      const started = await owner.leadops.startEmailCampaign({ id: campaign.id }); expect(started.added).toBeGreaterThanOrEqual(2); if (started.processed < started.added) await owner.leadops.runEmailCampaigns();
      const detail = await owner.leadops.getEmailCampaign({ id: campaign.id }); expect(detail.events.filter((event) => event.kind === "gesendet").length).toBe(started.added); expect(detail.events.find((event) => event.kind === "gesendet")?.subject).toBeTruthy();
      const text = await owner.leadops.draftMessageWithAi({ brief: "Rückruf wegen Angebot", channel: "whatsapp", sender: "Taner" }); expect(text.source).toBe("vorlage"); expect(text.text.length).toBeLessThanOrEqual(480); expect(text.text).toContain("Taner");
      // Vorlagen vorschreiben lassen: Vorschläge → fertige Vorlagen unter „Vorlagen“, zugeschnitten auf eine Kategorie
      const written = await owner.leadops.createEmailTemplatesWithAi({ keys: ["erstkontakt", "rueckruf"], category: "Wärmepumpe", sender: "Taner" }); expect(written.created).toHaveLength(2); expect(written.source).toBe("vorlage");
      expect(written.created[0].name).toBe("Vorlage: Erstkontakt Kaltakquise – Wärmepumpe"); expect(written.created[0].mails).toBe(3); expect(written.created[1].mails).toBe(1);
      const templates = (await owner.leadops.listEmailCampaigns()).filter((row) => row.isTemplate); expect(templates.map((row) => row.name)).toEqual(expect.arrayContaining(written.created.map((row) => row.name)));
      const writtenDetail = await owner.leadops.getEmailCampaign({ id: written.created[1].id }); expect(writtenDetail.isTemplate).toBe(true); expect(writtenDetail.tree.nodes.filter((node) => node.type === "send")).toHaveLength(1); expect(writtenDetail.tree.nodes.find((node) => node.type === "send" && node.subject.includes("Rückfrage"))).toBeTruthy();
    } finally { if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey; }
  });
  it("28. Strikte Trennung Verkaufs-Leads/Vertriebskontakte, Sperrliste als Protokoll mit Unterlisten, Sperren & Abmelde-Erkennung im Posteingang, Lead-Fenster", async () => {
    const tenantId = S.tenantId as number;
    // Trennung: Vertriebskontakte tragen kind=vertrieb, Leads zum Verkauf kind=verkauf – keine Seite sieht die andere
    const rows = await db.select({ id: leads.id, kind: leads.kind, pipelineStage: leads.pipelineStage, adPlatform: leads.adPlatform, publicId: leads.publicId, email: leads.email, status: leads.status }).from(leads).where(eq(leads.tenantId, tenantId));
    const prospects = rows.filter((row) => row.kind === "vertrieb"); const sales = rows.filter((row) => row.kind === "verkauf"); expect(prospects.length).toBeGreaterThan(3); expect(sales.length).toBeGreaterThan(3);
    expect(prospects.every((row) => row.pipelineStage && row.adPlatform)).toBe(true); expect(sales.every((row) => !row.adPlatform && !row.pipelineStage)).toBe(true);
    const listed = await owner.leadops.listLeads({}); const listedIds = new Set(listed.map((row) => row.id)); expect(prospects.some((row) => listedIds.has(row.id))).toBe(false); expect(sales.every((row) => listedIds.has(row.id))).toBe(true);
    const board = await owner.leadops.pipelineOverview({ source: "alle" }); const boardIds = new Set(board.stages.flatMap((stage) => stage.leads.map((lead) => lead.id))); expect(sales.some((row) => boardIds.has(row.id))).toBe(false); expect(prospects.every((row) => boardIds.has(row.id))).toBe(true);
    await expect(owner.leadops.movePipelineStage({ publicId: sales[0].publicId, stage: "kontaktiert" })).rejects.toThrow(/nicht gefunden/);
    await expect(owner.leadops.getLeadDetail({ publicId: prospects[0].publicId })).rejects.toThrow(/nicht gefunden/);
    const preview = await owner.leadops.previewEmailAudience({ source: "alle" }); const blocked = new Set((await db.select({ email: emailSuppressions.email }).from(emailSuppressions).where(eq(emailSuppressions.tenantId, tenantId))).map((row) => row.email));
    expect(preview.count).toBe(prospects.filter((row) => row.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) && !blocked.has(row.email.toLowerCase())).length);
    const stats = await owner.leadops.dashboard(); expect(stats).toBeTruthy();
    // Sperrliste: Unterlisten + Quelle
    const bounced = await owner.leadops.markEmailBounced({ email: "protokoll-bounce@test.example", kind: "bounce", note: "550 unbekannt" }); expect(bounced.email).toBe("protokoll-bounce@test.example");
    await owner.leadops.addEmailSuppression({ email: "protokoll-manuell@test.example", reason: "manuell", note: "telefonisch", source: "Von Hand" });
    const list = await owner.leadops.listEmailSuppressions(); expect(list.counts.alle).toBe(list.items.length); expect(list.counts.bounce).toBeGreaterThanOrEqual(1); expect(list.counts.manuell).toBeGreaterThanOrEqual(1);
    expect(list.items.find((row) => row.email === "protokoll-bounce@test.example")).toMatchObject({ reason: "bounce", source: "Mail-Anbieter (Webhook)" });
    const csv = await owner.leadops.exportEmailSuppressions(); expect(csv.split("\n")[0]).toContain("Quelle"); expect(csv).toContain("protokoll-manuell@test.example");
    // Posteingang: Antwort sperren → Sperrliste (Posteingang), Nachricht unter „Gesperrt“, Lead-Anlage blockiert; Entsperren stellt alles wieder her
    const mail = await owner.leadops.storeInboxMessage({ fromEmail: "stoer@sperren-test.example", fromName: "Störer", subject: "Günstige Leads!!!", bodyText: "Nur heute 1000 Leads." });
    const blockedResult = await owner.leadops.blockInboxSender({ messageId: mail.id }); expect(blockedResult).toMatchObject({ email: "stoer@sperren-test.example", messages: 1 });
    expect((await owner.leadops.listEmailSuppressions()).items.find((row) => row.email === "stoer@sperren-test.example")).toMatchObject({ reason: "gesperrt", source: "Posteingang" });
    expect((await owner.leadops.listInbox({ filter: "alle" })).items.some((row) => row.id === mail.id)).toBe(false); const gesperrt = await owner.leadops.listInbox({ filter: "gesperrt" }); expect(gesperrt.items.find((row) => row.id === mail.id)).toMatchObject({ blocked: true, suppressed: true }); expect(gesperrt.counts.gesperrt).toBeGreaterThanOrEqual(1);
    await expect(owner.leadops.createLeadFromInbox({ messageId: mail.id, pipeline: "email", stage: "kontaktiert" })).rejects.toThrow(/gesperrt/);
    const again = await owner.leadops.storeInboxMessage({ fromEmail: "stoer@sperren-test.example", subject: "Nochmal", bodyText: "Hallo?" }); expect((await db.select().from(inboxMessages).where(eq(inboxMessages.id, again.id)))[0]).toMatchObject({ blocked: true, isRead: true });
    const freed = await owner.leadops.unblockInboxSender({ messageId: mail.id }); expect(freed.messages).toBe(2); expect((await owner.leadops.listEmailSuppressions()).items.some((row) => row.email === "stoer@sperren-test.example")).toBe(false); expect((await owner.leadops.listInbox({ filter: "alle" })).items.some((row) => row.id === mail.id)).toBe(true);
    // Abmeldung in der Antwort eines Serien-Empfängers wird erkannt → Unterliste „Abmeldungen“, Serie gestoppt
    const recipient = (await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.email, "erika@eins-test.example"))))[0]; expect(recipient).toBeTruthy(); await db.update(emailCampaignRecipients).set({ status: "wartet" }).where(eq(emailCampaignRecipients.id, recipient.id));
    const optOut = await owner.leadops.storeInboxMessage({ fromEmail: "erika@eins-test.example", subject: "Re: Ihre E-Mail", bodyText: "Bitte nehmen Sie mich aus dem Verteiler. Keine weiteren E-Mails.\n\nErika" });
    expect((await db.select().from(inboxMessages).where(eq(inboxMessages.id, optOut.id)))[0]).toMatchObject({ optOut: true, blocked: false });
    const entry = (await owner.leadops.listEmailSuppressions()).items.find((row) => row.email === "erika@eins-test.example"); expect(entry).toMatchObject({ reason: "abgemeldet" }); expect(entry?.source).toContain("Antwort");
    expect((await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, recipient.id)))[0].status).toBe("abgemeldet");
    // Lead-Fenster: alle Bereiche
    const detail = await owner.leadops.pipelineLeadDetail({ publicId: prospects[0].publicId }); expect(detail.publicId).toBe(prospects[0].publicId); expect(Array.isArray(detail.history) && Array.isArray(detail.tasks) && Array.isArray(detail.calls) && Array.isArray(detail.campaigns) && Array.isArray(detail.inbox) && Array.isArray(detail.messages)).toBe(true); expect(typeof detail.score).toBe("number"); expect(["heiss", "warm", "kalt"]).toContain(detail.temperature); expect(detail.scoreReasons.length).toBeGreaterThan(0); // heiße Phasen: Einschätzung mit Gründen
    await expect(owner.leadops.pipelineLeadDetail({ publicId: sales[0].publicId })).rejects.toThrow(/nicht gefunden/);
    // Lead-Seite: Stammdaten bearbeiten (Verlauf „Kontaktdaten“), Kategorie wechseln, Vertriebskontakt löschen – Verkaufs-Lead bleibt geschützt
    const categoriesAll = await owner.leadops.listCategories(); const otherCategory = categoriesAll.find((row) => row.id !== detail.categoryId) ?? categoriesAll[0];
    await expect(owner.leadops.updatePipelineLead({ publicId: prospects[0].publicId, phone: "keine" })).rejects.toThrow(/gültige Telefonnummer/);
    const edited = await owner.leadops.updatePipelineLead({ publicId: prospects[0].publicId, salutation: "herr", firstName: "Erik", lastName: "Editiert", company: "Editiert GmbH", postcode: "60313", city: "Frankfurt", categoryId: otherCategory.id }); expect(edited.changed).toBeGreaterThanOrEqual(3);
    const after = await owner.leadops.pipelineLeadDetail({ publicId: prospects[0].publicId }); expect(after).toMatchObject({ firstName: "Erik", lastName: "Editiert", company: "Editiert GmbH", postcode: "60313", salutation: "herr", categoryId: otherCategory.id }); expect(after.history[0]).toMatchObject({ toStage: "kontakt" }); expect(after.history[0].note).toContain("Name: Erik Editiert");
    expect((await owner.leadops.updatePipelineLead({ publicId: prospects[0].publicId, company: "Editiert GmbH" })).changed).toBe(0);
    await expect(owner.leadops.deletePipelineLead({ publicId: sales[0].publicId })).rejects.toThrow(/nicht gefunden|Verkaufs-Leads/);
    const victim = prospects[1]; await owner.leadops.createPipelineTask({ publicId: victim.publicId, kind: "anruf", title: "Rückruf", dueAt: new Date() });
    const gone = await owner.leadops.deletePipelineLead({ publicId: victim.publicId }); expect(gone.success).toBe(true);
    expect((await db.select({ id: leads.id }).from(leads).where(eq(leads.id, victim.id))).length).toBe(0); expect((await db.select({ id: pipelineTasks.id }).from(pipelineTasks).where(eq(pipelineTasks.leadId, victim.id))).length).toBe(0); expect((await db.select({ id: pipelineEvents.id }).from(pipelineEvents).where(eq(pipelineEvents.leadId, victim.id))).length).toBe(0);
    await expect(owner.leadops.pipelineLeadDetail({ publicId: victim.publicId })).rejects.toThrow(/nicht gefunden/);
  });

  it("29. KI-Einordnung im Posteingang: Beschwerde automatisch gesperrt (Unterliste „Beschwerden“), unsicher → „Prüfen“, Abwesenheit markiert, Schalter in den E-Mail-Einstellungen, Zeitraum-Filter", async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY; // ohne Schlüssel greifen die Regeln – reicht für den Ablauf
    try {
      const settings = await owner.leadops.getMailSettings(); expect(settings).toMatchObject({ replyAiEnabled: true, replyAiAutoBlock: true, replyAiInterest: true, replyAiAvailable: false });
      // Beschwerde → Sperrliste „Beschwerden“ mit Zitat, Nachricht unter „Gesperrt“, gelesen
      const angry = await owner.leadops.storeInboxMessage({ fromEmail: "chef@beschwerde-test.example", fromName: "K. Brandt", subject: "Re: Mehr Anfragen", bodyText: "Das ist Spam! Hören Sie auf, mir zu schreiben – sonst melde ich das.\n\nK. Brandt" });
      expect(angry.ai).toMatchObject({ kind: "beschwerde", action: "gesperrt" });
      const stored = (await db.select().from(inboxMessages).where(eq(inboxMessages.id, angry.id)))[0]; expect(stored).toMatchObject({ blocked: true, isRead: true, aiKind: "beschwerde", aiAction: "gesperrt", aiSource: "regeln" }); expect(stored.aiQuote).toContain("Hören Sie");
      const entry = (await owner.leadops.listEmailSuppressions()).items.find((row) => row.email === "chef@beschwerde-test.example"); expect(entry).toMatchObject({ reason: "beschwerde" }); expect(entry?.note).toContain("automatisch gesperrt");
      expect((await owner.leadops.listInbox({ filter: "gesperrt" })).items.find((row) => row.id === angry.id)).toMatchObject({ blocked: true, ai: { kind: "beschwerde", action: "gesperrt" } });
      expect((await owner.leadops.listInbox({ filter: "alle" })).items.some((row) => row.id === angry.id)).toBe(false);
      // Entsperren macht den Fehlgriff rückgängig
      const freed = await owner.leadops.unblockInboxSender({ messageId: angry.id }); expect(freed.email).toBe("chef@beschwerde-test.example");
      expect((await owner.leadops.listEmailSuppressions()).items.some((row) => row.email === "chef@beschwerde-test.example")).toBe(false); expect((await owner.leadops.listInbox({ filter: "alle" })).items.some((row) => row.id === angry.id)).toBe(true);
      // unsicher → Ordner „Prüfen“, nicht gesperrt; „In Ordnung“ schließt die Prüfung
      const unsure = await owner.leadops.storeInboxMessage({ fromEmail: "info@vogel-test.example", fromName: "M. Vogel", subject: "Re: Kurze Frage", bodyText: "Guten Tag, woher stammen eigentlich meine Kontaktdaten? Ich bin mir nicht sicher, ob das so in Ordnung ist. Aktuell kein Bedarf." });
      expect(unsure.ai).toMatchObject({ kind: "beschwerde", action: "pruefen" });
      const check = await owner.leadops.listInbox({ filter: "pruefen" }); expect(check.counts.pruefen).toBeGreaterThanOrEqual(1); expect(check.items.find((row) => row.id === unsure.id)).toMatchObject({ blocked: false });
      expect((await owner.leadops.listEmailSuppressions()).items.some((row) => row.email === "info@vogel-test.example")).toBe(false);
      await owner.leadops.resolveInboxCheck({ id: unsure.id }); expect((await owner.leadops.listInbox({ filter: "pruefen" })).items.some((row) => row.id === unsure.id)).toBe(false); expect((await db.select().from(inboxMessages).where(eq(inboxMessages.id, unsure.id)))[0].aiAction).toBe("geprueft");
      // Abwesenheitsnotiz: nur markiert
      const away = await owner.leadops.storeInboxMessage({ fromEmail: "buero@lang-test.example", fromName: "T. Lang", subject: "Automatische Antwort", bodyText: "Ich bin bis zum 20.10. im Urlaub und erst danach wieder erreichbar." });
      expect(away.ai).toMatchObject({ kind: "abwesenheit", action: "markiert" }); expect((await db.select().from(inboxMessages).where(eq(inboxMessages.id, away.id)))[0].blocked).toBe(false);
      // Zeitraum-Filter: heute enthält die neuen Nachrichten, ein Zeitraum in der Vergangenheit nicht
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const today = await owner.leadops.listInbox({ filter: "alle", from: start, to: new Date(start.getTime() + 86_400_000) }); expect(today.items.some((row) => row.id === away.id)).toBe(true); expect(today.items.every((row) => new Date(row.receivedAt) >= start)).toBe(true);
      const past = await owner.leadops.listInbox({ filter: "alle", from: new Date(start.getTime() - 30 * 86_400_000), to: new Date(start.getTime() - 86_400_000) }); expect(past.items.some((row) => row.id === away.id)).toBe(false);
      // Filter nach KI-Einordnung
      const onlyAway = await owner.leadops.listInbox({ filter: "alle", aiKind: "abwesenheit" }); expect(onlyAway.items.some((row) => row.id === away.id)).toBe(true); expect(onlyAway.items.every((row) => row.ai?.kind === "abwesenheit")).toBe(true);
      expect((await owner.leadops.listInbox({ filter: "alle", aiKind: "beschwerde" })).items.some((row) => row.id === unsure.id)).toBe(true); expect((await owner.leadops.listInbox({ filter: "alle", aiKind: "interessiert" })).items.some((row) => row.id === away.id)).toBe(false);
      // Schalter: Auto-Sperre aus → Beschwerde nur zur Prüfung; KI aus → nur die Wortliste (Beschwerde ohne Abmeldewort bleibt unbehandelt)
      await owner.leadops.saveMailSettings({ provider: settings.provider as "smtp", fromName: settings.fromName, fromEmail: settings.fromEmail, replyAiAutoBlock: false });
      const flagged = await owner.leadops.storeInboxMessage({ fromEmail: "wut@brandt-test.example", subject: "Re", bodyText: "Unverschämt! Lassen Sie mich in Ruhe, sonst schalte ich meinen Anwalt ein." }); expect(flagged.ai).toMatchObject({ kind: "beschwerde", action: "pruefen" });
      await owner.leadops.saveMailSettings({ provider: settings.provider as "smtp", fromName: settings.fromName, fromEmail: settings.fromEmail, replyAiEnabled: false });
      const ignored = await owner.leadops.storeInboxMessage({ fromEmail: "wut2@brandt-test.example", subject: "Re", bodyText: "Unverschämt! Lassen Sie mich in Ruhe, sonst schalte ich meinen Anwalt ein." }); expect(ignored.ai?.action ?? null).toBeNull();
      const stillOptOut = await owner.leadops.storeInboxMessage({ fromEmail: "raus@brandt-test.example", subject: "Re", bodyText: "Bitte keine weiteren E-Mails an uns." }); expect(stillOptOut.ai).toMatchObject({ kind: "abmeldung", action: "gesperrt" }); // Wortliste wie bisher
      await owner.leadops.saveMailSettings({ provider: settings.provider as "smtp", fromName: settings.fromName, fromEmail: settings.fromEmail, replyAiEnabled: true, replyAiAutoBlock: true });
    } finally { if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey; }
  });

  it("30. E-Mail-Verlauf am Lead: Antwort aus dem Posteingang wird gespeichert, beim Anlegen hängen alle Mails des Absenders am Lead, Verlauf in Zeitfolge mit Vorgeschichte, Einzel-E-Mail und Serien-Versand", async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    try {
      // Vorgeschichte: Frage vor drei Tagen, unsere Antwort aus dem Posteingang (noch ohne Lead), dann die neue Anfrage
      const first = await owner.leadops.storeInboxMessage({ fromEmail: "verlauf@mayer-test.example", fromName: "M. Mayer", subject: "Frage zu Ihren Leistungen", bodyText: "Bieten Sie auch PV-Anfragen für Nürnberg an?", receivedAt: new Date(Date.now() - 3 * 86_400_000) });
      await expect(owner.leadops.replyInboxMessage({ messageId: first.id, text: "   " })).rejects.toThrow();
      const replied = await owner.leadops.replyInboxMessage({ messageId: first.id, text: "Ja, Mittelfranken decken wir ab – abgerechnet wird pro Anfrage." }); expect(replied.status).toMatch(/gesendet|simuliert/);
      const stored = (await db.select().from(outboundMessages).where(eq(outboundMessages.inboxMessageId, first.id)))[0]; expect(stored).toMatchObject({ channel: "email", toAddress: "verlauf@mayer-test.example", leadId: null, subject: "Re: Frage zu Ihren Leistungen", provider: "posteingang", status: replied.status }); expect(stored.createdByUserId).toBeTruthy();
      expect((await db.select().from(inboxMessages).where(eq(inboxMessages.id, first.id)))[0].isRead).toBe(true);
      await db.update(outboundMessages).set({ createdAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(outboundMessages.id, stored.id)); // Antwort lag zwei Tage zurück
      const second = await owner.leadops.storeInboxMessage({ fromEmail: "verlauf@mayer-test.example", fromName: "M. Mayer", subject: "Re: Frage zu Ihren Leistungen", bodyText: "Klingt gut, schicken Sie mir gerne ein Angebot.", receivedAt: new Date(Date.now() - 5 * 60_000) });
      expect(second.ai).toMatchObject({ kind: "interessiert" });
      // Lead anlegen → beide eingegangenen Mails und die Antwort hängen am Lead
      const created = await owner.leadops.createLeadFromInbox({ messageId: second.id, pipeline: "email", stage: "qualifiziert" });
      expect(created.created).toBe(true); expect(created.linked).toEqual({ incoming: 2, replies: 1 });
      expect((await db.select().from(inboxMessages).where(eq(inboxMessages.fromEmail, "verlauf@mayer-test.example"))).every((row) => row.leadId === created.leadId)).toBe(true);
      expect((await db.select().from(outboundMessages).where(eq(outboundMessages.id, stored.id)))[0].leadId).toBe(created.leadId);
      const thread = await owner.leadops.leadEmailThread({ publicId: created.publicId });
      expect(thread.email).toBe("verlauf@mayer-test.example"); expect(thread.before).toBe(3); expect(thread.leadCreatedAt).toBeTruthy();
      expect(thread.items.map((item) => item.kind)).toEqual(["eingang", "antwort", "eingang"]); expect(thread.items.map((item) => item.direction)).toEqual(["ein", "aus", "ein"]);
      expect(thread.items[0]).toMatchObject({ subject: "Frage zu Ihren Leistungen", who: "M. Mayer", status: "gelesen" }); expect(thread.items[1].who).toBeTruthy(); expect(thread.items[1].text).toContain("Mittelfranken"); expect(thread.items[2].aiKind).toBe("interessiert");
      for (let index = 1; index < thread.items.length; index += 1) expect(new Date(thread.items[index].at).getTime()).toBeGreaterThanOrEqual(new Date(thread.items[index - 1].at).getTime());
      // Antwort nach dem Anlegen hängt direkt am Lead; Einzel-E-Mail aus der Karte erscheint als eigener Eintrag
      await owner.leadops.replyInboxMessage({ messageId: second.id, text: "Das Angebot kommt morgen." });
      expect((await db.select().from(outboundMessages).where(eq(outboundMessages.leadId, created.leadId))).length).toBe(2);
      await owner.leadops.sendLeadMessage({ publicId: created.publicId, channel: "email", subject: "Ihr Angebot", text: "Anbei das Angebot wie besprochen." });
      const after = await owner.leadops.leadEmailThread({ publicId: created.publicId });
      expect(after.items.length).toBe(5); expect(after.before).toBe(3); expect(after.items[3]).toMatchObject({ kind: "antwort", direction: "aus" }); expect(after.items[4]).toMatchObject({ kind: "einzel", direction: "aus", subject: "Ihr Angebot" });
      expect((await owner.leadops.pipelineLeadDetail({ publicId: created.publicId })).inbox.length).toBe(2);
      // Serien-Versand im Verlauf: ein Empfänger aus Test 24 mit „gesendet“-Ereignis
      const sent = (await db.select({ event: emailCampaignEvents, recipient: emailCampaignRecipients }).from(emailCampaignEvents).innerJoin(emailCampaignRecipients, eq(emailCampaignRecipients.id, emailCampaignEvents.recipientId)).where(eq(emailCampaignEvents.kind, "gesendet")).limit(5)).find((row) => row.recipient.leadId);
      expect(sent).toBeTruthy();
      const serieLead = (await db.select().from(leads).where(eq(leads.id, sent!.recipient.leadId!)))[0];
      const serieThread = await owner.leadops.leadEmailThread({ publicId: serieLead.publicId }); expect(serieThread.items.some((item) => item.kind === "serie" && item.direction === "aus" && item.campaignName)).toBe(true);
      // Unbekannter Lead → leerer Verlauf
      expect(await owner.leadops.leadEmailThread({ publicId: "GIBT-ES-NICHT" })).toEqual({ items: [], email: null, before: 0, leadCreatedAt: null });
    } finally { if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey; }
  });

  it("31. Listen-Upload mit Spalten-Zuordnung: unbekannte Spalten werden Platzhalter, Zuordnung von Hand, Felder am Kontakt/in der Liste, Platzhalter in E-Mails gefüllt", async () => {
    const csv = "Name;Betrieb;Mail;Branche;Anzahl Mitarbeiter\nHansen;Hansen Dach;hansen@mapping-test.example;Dachdecker;12\nKoch;Koch Solar;koch@mapping-test.example;Photovoltaik;5\n";
    const auto = await owner.leadops.parseColdList({ csv });
    expect(auto.mapping).toEqual(["lastName", "company", "email", "platzhalter", "platzhalter"]); expect(auto.placeholders).toEqual(["branche", "anzahl_mitarbeiter"]); expect(auto.rows[0]).toMatchObject({ lastName: "Hansen", company: "Hansen Dach", extra: { branche: "Dachdecker", anzahl_mitarbeiter: "12" } });
    const manual = await owner.leadops.parseColdList({ csv, mapping: ["lastName", "ignorieren", "email", "platzhalter", "ignorieren"] });
    expect(manual.rows[0].company).toBeUndefined(); expect(manual.rows[0].extra).toEqual({ branche: "Dachdecker" }); expect(manual.placeholders).toEqual(["branche"]);
    const imported = await owner.leadops.importColdList({ listName: "Mapping-Test", rows: auto.rows, ownerUserIds: [] }); expect(imported.created).toBe(2);
    const hansen = (await db.select().from(leads).where(and(eq(leads.email, "hansen@mapping-test.example"), eq(leads.kind, "vertrieb"))))[0];
    expect((hansen.metadata as { felder?: Record<string, string> }).felder).toEqual({ branche: "Dachdecker", anzahl_mitarbeiter: "12" });
    const list = (await owner.leadops.listColdLists()).find((row) => row.listName === "Mapping-Test")!; expect(list.fields).toEqual([{ key: "branche", sample: "Dachdecker" }, { key: "anzahl_mitarbeiter", sample: "12" }]);
    expect((await owner.leadops.pipelineLeadDetail({ publicId: hansen.publicId })).fields).toEqual({ branche: "Dachdecker", anzahl_mitarbeiter: "12" });
    const card = (await owner.leadops.pipelineOverview({ source: "kaltakquise" })).stages.flatMap((stage) => stage.leads).find((row) => row.publicId === hansen.publicId)!; expect(card.fields).toEqual({ branche: "Dachdecker", anzahl_mitarbeiter: "12" });
    // Einzel-E-Mail aus der Karte und Serien-Versand füllen die Platzhalter aus der Liste
    const mail = await owner.leadops.sendLeadMessage({ publicId: hansen.publicId, channel: "email", subject: "Für {{branche}} mit {{anzahl_mitarbeiter}} Leuten", text: "Hallo {{nachname}}, als {{branche}}-Betrieb …" });
    expect(mail.subject).toBe("Für Dachdecker mit 12 Leuten"); expect(mail.text).toContain("als Dachdecker-Betrieb");
    const starter = await owner.leadops.emailCampaignStarter({ kind: "kaltakquise" }); const first = starter.tree.nodes.find((node) => node.type === "send") as Extract<typeof starter.tree.nodes[number], { type: "send" }>; first.subject = "{{branche}}: {{anzahl_mitarbeiter}} Mitarbeiter, {{nachname}}";
    const campaign = await owner.leadops.saveEmailCampaign({ name: "Mapping-Serie", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Mapping-Test" }, tree: starter.tree, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" } });
    const started = await owner.leadops.startEmailCampaign({ id: campaign.id }); expect(started.added).toBe(2);
    await owner.leadops.runEmailCampaigns();
    const sent = await db.select().from(emailCampaignEvents).where(and(eq(emailCampaignEvents.campaignId, campaign.id), eq(emailCampaignEvents.kind, "gesendet")));
    expect(sent.map((event) => event.subject).sort()).toEqual(["Dachdecker: 12 Mitarbeiter, Hansen", "Photovoltaik: 5 Mitarbeiter, Koch"]);
  });

  it("32. Gesendet mit Tracking je Mail, Übernahme in die Pipeline „E-Mail-Kampagne“ mit Stufe, Kontakte löschen, Glocke als Tagesverlauf", async () => {
    // Gesendet: jede Kampagnen-Mail trägt ihre Reaktion; die Öffnung aus Test 24/31 wird der richtigen Mail zugeordnet
    const sent = await owner.leadops.listSent({ kind: "kampagne" });
    expect(sent.items.length).toBeGreaterThan(0); expect(sent.items.every((item) => item.tracking !== null)).toBe(true);
    const mappingMail = sent.items.find((item) => item.to === "hansen@mapping-test.example")!; expect(mappingMail.lead?.publicId).toMatch(/^KALT-/); expect(mappingMail.tracking?.reaction).toBe("ohne");
    const token = (await db.select({ token: emailCampaignRecipients.token }).from(emailCampaignRecipients).where(eq(emailCampaignRecipients.email, "hansen@mapping-test.example")))[0].token;
    await (await import("./sales-outreach")).trackOpen(db, token);
    const afterOpen = await owner.leadops.listSent({ kind: "kampagne", reaction: "geoeffnet" });
    expect(afterOpen.items.some((item) => item.to === "hansen@mapping-test.example" && item.tracking?.openedAt)).toBe(true);
    const preview = await owner.leadops.sentMailPreview({ id: mappingMail.id }); expect(preview.to).toBe("hansen@mapping-test.example"); expect(preview.subject).toContain("Dachdecker"); expect(preview.html).toContain("<!doctype html>"); expect(preview.campaignName).toBe("Mapping-Serie");
    // Kontakte der E-Mail-Akquise: Upload ohne Pipeline → mit Stufe in die Pipeline „E-Mail-Kampagne“ übernehmen → einen löschen
    const imported = await owner.leadops.importColdList({ listName: "Nur-Mail-Liste", toPipeline: false, rows: [{ firstName: "Nora", lastName: "Nur", email: "nora@nur-mail.example" }, { firstName: "Olaf", lastName: "Nur", email: "olaf@nur-mail.example" }], ownerUserIds: [] });
    expect(imported.created).toBe(2);
    const contacts = await owner.leadops.emailLeads({ listName: "Nur-Mail-Liste" }); expect(contacts.items).toHaveLength(2); expect(contacts.items.every((item) => item.inPipeline === false)).toBe(true);
    const emailBoardBefore = (await owner.leadops.pipelineOverview({ source: "email" })).totals.leads;
    const pushed = await owner.leadops.pushLeadsToPipeline({ leadIds: [contacts.items[0].id], stage: "kontaktiert" }); expect(pushed).toMatchObject({ moved: 1, switched: 0, restaged: 0, already: 0, stage: "kontaktiert", target: "email", targetName: "E-Mail-Kampagne" });
    const moved = (await db.select().from(leads).where(eq(leads.id, contacts.items[0].id)))[0]; expect(moved.inPipeline).toBe(true); expect(moved.adPlatform).toBe("email"); expect(moved.pipelineStage).toBe("kontaktiert");
    expect((await owner.leadops.pipelineOverview({ source: "email" })).totals.leads).toBe(emailBoardBefore + 1);
    // Kontakt, der schon in einer anderen Pipeline steht (Kaltakquise), wird in die E-Mail-Kampagne verschoben – vorher war der Knopf dann einfach aus
    const coldImport = await owner.leadops.importColdList({ listName: "Schon-Kalt-Liste", toPipeline: true, rows: [{ firstName: "Paula", lastName: "Kalt", email: "paula@schon-kalt.example", phone: "+49 170 9999999" }], ownerUserIds: [] }); expect(coldImport.created).toBe(1);
    const coldContact = (await owner.leadops.emailLeads({ listName: "Schon-Kalt-Liste" })).items[0]; expect(coldContact.inPipeline).toBe(true); expect(coldContact.adPlatform).toBe("kaltakquise");
    const switched = await owner.leadops.pushLeadsToPipeline({ leadIds: [coldContact.id], stage: "qualifiziert" }); expect(switched).toMatchObject({ moved: 0, switched: 1, restaged: 0, already: 0, stage: "qualifiziert", target: "email" });
    const switchedRow = (await db.select().from(leads).where(eq(leads.id, coldContact.id)))[0]; expect(switchedRow.adPlatform).toBe("email"); expect(switchedRow.pipelineStage).toBe("qualifiziert");
    expect((await owner.leadops.pipelineHistory({ publicId: switchedRow.publicId })).some((event) => event.note === "Aus der Pipeline „Kaltakquise“ in die Pipeline „E-Mail-Kampagne“ verschoben")).toBe(true);
    const restaged = await owner.leadops.pushLeadsToPipeline({ leadIds: [coldContact.id], stage: "termin" }); expect(restaged).toMatchObject({ moved: 0, switched: 0, restaged: 1, already: 0 });
    const back = await owner.leadops.pushLeadsToPipeline({ leadIds: [coldContact.id], stage: "unbekannt", target: "kaltakquise" }); expect(back).toMatchObject({ switched: 1, target: "kaltakquise", targetName: "Kaltakquise", stage: "neu" });
    expect((await db.select().from(leads).where(eq(leads.id, coldContact.id)))[0].adPlatform).toBe("kaltakquise");
    const deleted = await owner.leadops.deleteEmailLeads({ leadIds: [contacts.items[1].id] }); expect(deleted.deleted).toBe(1);
    expect((await owner.leadops.emailLeads({ listName: "Nur-Mail-Liste" })).items).toHaveLength(1);
    // Glocke: die Aktionen oben stehen im Tagesverlauf, gebündelt je Art
    const feed = await owner.leadops.activityFeed({ days: 14 });
    expect(feed.days[0].label).toBe("Heute");
    const kinds = feed.days[0].groups.map((group) => group.kind);
    expect(kinds).toEqual(expect.arrayContaining(["kontakt_neu", "pipeline_uebernommen", "email_gesendet", "kampagne"]));
    const uploads = feed.days[0].groups.find((group) => group.kind === "kontakt_neu")!; expect(uploads.entries.some((entry) => entry.title.includes("Nur-Mail-Liste") && entry.count === 2)).toBe(true);
    const mails = feed.days[0].groups.find((group) => group.kind === "email_gesendet")!; expect(mails.entries.some((entry) => entry.title.includes("Mapping-Serie") && entry.count === 2)).toBe(true);
    expect(feed.days[0].summary).toMatch(/neue Kontakte/);
    const since = await owner.leadops.activityFeed({ days: 1, since: new Date(Date.now() + 60_000) }); expect(since.newCount).toBe(0);
  });

  it("33. Vertriebspipeline: Reiter „Kontakte“ (alle Kontakte einer Pipeline, auch ohne E-Mail) und Karten löschen – einzeln und als Auswahl", async () => {
    const imported = await owner.leadops.importColdList({ listName: "Löschliste", rows: [{ firstName: "Paul", lastName: "Ohne", phone: "+49 69 1111111" }, { firstName: "Petra", lastName: "Mit", email: "petra@loeschliste.example", phone: "+49 69 2222222" }, { firstName: "Pia", lastName: "Dritte", email: "pia@loeschliste.example" }], ownerUserIds: [] });
    expect(imported.created).toBe(3);
    const contacts = await owner.leadops.emailLeads({ source: "kaltakquise", inPipeline: true, withoutEmail: true, listName: "Löschliste" });
    expect(contacts.items).toHaveLength(3); expect(contacts.items.some((item) => !item.email && item.phone === "+49 69 1111111")).toBe(true);
    expect((await owner.leadops.emailLeads({ listName: "Löschliste" })).items).toHaveLength(2); // E-Mail-Akquise: nur mit E-Mail
    expect((await owner.leadops.emailLeads({ source: "ads", inPipeline: true, withoutEmail: true, listName: "Löschliste" })).items).toHaveLength(0);
    const single = await owner.leadops.deletePipelineLead({ publicId: contacts.items[0].publicId }); expect(single.success).toBe(true);
    const bulk = await owner.leadops.deletePipelineLeads({ publicIds: [contacts.items[1].publicId, contacts.items[2].publicId, "GIBTESNICHT"] }); expect(bulk).toMatchObject({ deleted: 2, skipped: 1 });
    expect((await owner.leadops.emailLeads({ source: "kaltakquise", inPipeline: true, withoutEmail: true, listName: "Löschliste" })).items).toHaveLength(0);
    expect((await db.select().from(leads).where(eq(leads.listName, "Löschliste")))).toHaveLength(0);
    const saleLead = (await db.select({ publicId: leads.publicId }).from(leads).where(ne(leads.kind, "vertrieb")).limit(1))[0];
    await expect(owner.leadops.deletePipelineLeads({ publicIds: [saleLead.publicId] })).rejects.toThrow(/Verkaufs-Leads/);
  });

  it("34. Posteingang: Schalter „nur bekannte Kontakte“ (Migration 0069), Aufräumen nur Fremde / alles, Absender auf alle Kampagnen übernehmen", async () => {
    const tenantId = S.tenantId as number;
    const settings = await owner.leadops.getMailSettings(); expect((settings as { imapScope?: string }).imapScope).toBe("bekannte");
    await owner.leadops.saveMailSettings({ provider: settings.provider as "smtp", fromName: "Vertrieb Tanesco", fromEmail: "vertrieb@tanesco-test.example", imapScope: "alle" });
    expect((await owner.leadops.getMailSettings() as { imapScope?: string }).imapScope).toBe("alle");
    await owner.leadops.saveMailSettings({ provider: settings.provider as "smtp", fromName: "Vertrieb Tanesco", fromEmail: "vertrieb@tanesco-test.example", imapScope: "bekannte" });
    // Posteingang: eine fremde Mail (kein Lead, keine Kampagne) und die bekannten aus den Tests davor
    await owner.leadops.storeInboxMessage({ fromEmail: "newsletter@fremd.example", fromName: "Newsletter", subject: "Angebot der Woche", bodyText: "Nur heute: alles reduziert." });
    const all = await db.select().from(inboxMessages).where(eq(inboxMessages.tenantId, tenantId));
    const strangers = all.filter((row) => !row.leadId && !row.campaignRecipientId); expect(strangers.length).toBeGreaterThan(0);
    const cleaned = await owner.leadops.clearInbox({ scope: "fremde" }); expect(cleaned).toEqual({ deleted: strangers.length, scope: "fremde" });
    const rest = await db.select().from(inboxMessages).where(eq(inboxMessages.tenantId, tenantId)); expect(rest.length).toBe(all.length - strangers.length); expect(rest.every((row) => row.leadId || row.campaignRecipientId)).toBe(true);
    const wiped = await owner.leadops.clearInbox({ scope: "alle" }); expect(wiped.deleted).toBe(rest.length);
    expect(await db.select().from(inboxMessages).where(eq(inboxMessages.tenantId, tenantId))).toHaveLength(0);
    // Absender auf bestehende Kampagnen übernehmen
    const applied = await owner.leadops.applySenderToCampaigns(); expect(applied.fromEmail).toBe("vertrieb@tanesco-test.example"); expect(applied.updated).toBeGreaterThan(0);
    const campaigns = await db.select({ fromEmail: emailCampaigns.fromEmail, fromName: emailCampaigns.fromName }).from(emailCampaigns).where(eq(emailCampaigns.tenantId, tenantId));
    expect(campaigns.every((row) => row.fromEmail === "vertrieb@tanesco-test.example" && row.fromName === "Vertrieb Tanesco")).toBe(true);
  });

  it("35. Eigene Stufen je Pipeline (Migration 0070): Kaltakquise bekommt eigene Stufen, Meta Ads behält den Standard, Verschieben prüft je Pipeline, Zurücksetzen", async () => {
    const standard = await owner.leadops.pipelineStages({ source: "alle" });
    expect((await owner.leadops.pipelineStageSetup({ source: "kaltakquise" })).own).toBe(false);
    const saved = await owner.leadops.savePipelineStages({ source: "kaltakquise", stages: [{ key: "neu", label: "Liste", hint: "", fixed: "entry" }, { key: "angerufen", label: "Angerufen", hint: "" }, { key: "kunde", label: "Kunde", hint: "", fixed: "won" }, { key: "verloren", label: "Verloren", hint: "", fixed: "lost" }] });
    expect(saved.source).toBe("kaltakquise");
    expect((await owner.leadops.pipelineStages({ source: "kaltakquise" })).map((stage) => stage.key)).toEqual(["neu", "angerufen", "kunde", "verloren"]);
    expect((await owner.leadops.pipelineStages({ source: "ads" })).map((stage) => stage.key)).toEqual(standard.map((stage) => stage.key));
    expect((await owner.leadops.pipelineOverview({ source: "kaltakquise" })).stageDefs.map((stage) => stage.label)).toEqual(["Liste", "Angerufen", "Kunde", "Verloren"]);
    const kaltLead = (await db.select({ publicId: leads.publicId, id: leads.id }).from(leads).where(and(eq(leads.kind, "vertrieb"), eq(leads.adPlatform, "kaltakquise"))).limit(1))[0];
    await owner.leadops.movePipelineStage({ publicId: kaltLead.publicId, stage: "angerufen" });
    expect((await db.select({ stage: leads.pipelineStage }).from(leads).where(eq(leads.id, kaltLead.id)))[0].stage).toBe("angerufen");
    await expect(owner.leadops.movePipelineStage({ publicId: kaltLead.publicId, stage: "termin" })).rejects.toThrow(/Unbekannte Stufe/);
    const detail = await owner.leadops.pipelineLeadDetail({ publicId: kaltLead.publicId });
    expect((detail as { source?: string }).source).toBe("kaltakquise"); expect((detail as { stages?: Array<{ key: string }> }).stages?.map((stage) => stage.key)).toContain("angerufen");
    await owner.leadops.resetPipelineStages({ source: "kaltakquise" });
    expect((await owner.leadops.pipelineStageSetup({ source: "kaltakquise" })).own).toBe(false);
    expect((await db.select({ stage: leads.pipelineStage }).from(leads).where(eq(leads.id, kaltLead.id)))[0].stage).toBe("neu");
  });

  it("36. Signatur für Antworten (Migration 0071) und Anhänge: Signatur speichern, Vorschau, Antwort mit Anhang wird mit Dateiname festgehalten, Grenzen greifen", async () => {
    const settings = await owner.leadops.getMailSettings();
    await owner.leadops.saveMailSettings({ provider: settings.provider as "smtp", fromName: settings.fromName ?? "Vertrieb Tanesco", fromEmail: settings.fromEmail ?? "vertrieb@tanesco-test.example", signature: { enabled: true, greeting: "Mit freundlichen Grüßen", name: "Thomas Kutzbach", phone: "+49 (0) 178 33 59 146", email: "kontakt@tanescodigital.de", website: "www.tanescodigital.de", showLogo: true, showCompany: true } });
    const saved = (await owner.leadops.getMailSettings() as { signature?: { name?: string } }).signature; expect(saved?.name).toBe("Thomas Kutzbach");
    // Signatur hängt an jeder Kampagnen-Mail: Vorschau im Ablauf, Nachbau im Ordner „Gesendet“ und frische Mails der laufenden Kampagne (auch eine vor dem Speichern angelegte)
    const nodePreview = await owner.leadops.previewEmailNode({ node: { id: "sig-n1", type: "send", subject: "Signaturprobe", blocks: [{ id: "b1", type: "text", text: "Hallo {{vorname}}" }], next: null }, design: {} });
    expect(nodePreview.html).toContain("Thomas Kutzbach"); expect(nodePreview.html).toContain("Tanesco Digital GbR");
    expect((await owner.leadops.previewEmailNode({ node: { id: "sig-n1", type: "send", subject: "Signaturprobe", blocks: [{ id: "b1", type: "text", text: "Hallo" }], next: null }, design: { signature: false } })).html).not.toContain("Thomas Kutzbach");
    const sentCampaignMail = (await owner.leadops.listSent({ kind: "kampagne" })).items[0]; if (sentCampaignMail) expect((await owner.leadops.sentMailPreview({ id: sentCampaignMail.id })).html).toContain("Thomas Kutzbach");
    const preview = await owner.leadops.mailSignaturePreview({ signature: { role: "Geschäftsführung" } });
    expect(preview.html).toContain("Thomas Kutzbach"); expect(preview.html).toContain("Geschäftsführung"); expect(preview.html).toContain("tanesco-logo-mail.png"); expect(preview.text).toContain("Telefon: +49 (0) 178 33 59 146");
    const incoming = await owner.leadops.storeInboxMessage({ fromEmail: "antwort@signatur-test.example", fromName: "Signatur Test", subject: "Angebot?", bodyText: "Können Sie mir ein Angebot schicken?" });
    const answered = (await db.select().from(inboxMessages).where(eq(inboxMessages.id, incoming.id)))[0];
    const result = await owner.leadops.replyInboxMessage({ messageId: answered.id, text: "Anbei das Angebot.", attachments: [{ filename: "Angebot.pdf", contentType: "application/pdf", contentBase64: Buffer.from("%PDF-1.4 test").toString("base64"), size: 13 }] });
    expect(result.status).toBe("simuliert"); expect(result.attachments).toBe(1);
    const stored = (await db.select().from(outboundMessages).where(and(eq(outboundMessages.inboxMessageId, answered.id), eq(outboundMessages.channel, "email"))).orderBy(desc(outboundMessages.id)).limit(1))[0];
    expect(stored.attachments).toEqual([{ filename: "Angebot.pdf", size: 13, contentType: "application/pdf" }]);
    expect((await owner.leadops.listSent({ kind: "antwort" })).items.some((item) => item.to === answered.fromEmail && (item as { attachments?: Array<{ filename: string }> }).attachments?.some((file) => file.filename === "Angebot.pdf"))).toBe(true);
    await expect(owner.leadops.replyInboxMessage({ messageId: answered.id, text: "zu viel", attachments: Array.from({ length: 6 }, (_, i) => ({ filename: `f${i}.pdf`, contentType: "application/pdf", contentBase64: "QQ==", size: 1 })) })).rejects.toThrow();
  });

  it("37. sipgate als Telefonie-Anbieter (Migration 0072): Token speichern, Verbindung prüfen, Rufnummern übernehmen, Webhook eintragen, Anruf über das sipgate-Gerät mit Ereignissen, Aufzeichnung per Klick, Datei aus dem Verlauf", async () => {
    const tenantId = S.tenantId as number;
    // Nachgebaute sipgate-API: merkt sich die Aufrufe; „aktive Anrufe“ und „Verlauf“ lassen sich im Test umschalten.
    const api: { calls: Array<{ method: string; path: string; body: unknown }>; active: Array<{ callId: string; participants: Array<{ phoneNumber: string }> }>; history: Array<Record<string, unknown>> } = { calls: [], active: [], history: [] };
    sipgateTestHooks.fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input).replace("https://api.sipgate.com/v2", ""); const method = init?.method ?? "GET";
      api.calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (path === "/authorization/userinfo") return json(200, { sub: "3376511w0", masterSipId: "3376511" });
      if (path === "/channels") return json(404, { message: "nicht vorhanden" });
      if (path === "/w0/devices") return json(200, { items: [{ id: "e0", alias: "sipgate App Taner", type: "REGISTER", online: true }, { id: "x0", alias: "Handy", type: "EXTERNAL" }] });
      if (path === "/numbers") return json(200, { items: [{ id: "n1", number: "+496119851230", localized: "0611 9851230", type: "LANDLINE", endpointAlias: "Zentrale" }, { id: "n2", number: "+4917833591460", localized: "0178 33591460", type: "MOBILE" }] });
      if (path === "/sessions/calls") return json(200, { sessionId: "sess-e2e" });
      if (path === "/calls" && method === "GET") return json(200, { data: api.active });
      if (/^\/calls\/[^/]+\/recording$/.test(path)) return json(204);
      if (/^\/calls\/[^/]+$/.test(path) && method === "DELETE") { api.active = []; return json(204); }
      if (path.startsWith("/history")) return json(200, { items: api.history });
      if (path === "/settings/sipgateio") return method === "GET" ? json(200, { incomingUrl: "", outgoingUrl: "", log: false, whitelist: null }) : json(204);
      if (path.startsWith("https://files.sipgate.example/")) return new Response("ID3-audio", { status: 200, headers: { "content-type": "audio/mpeg" } });
      return json(404, { message: `unbekannt: ${path}` });
    }) as unknown as typeof fetch;
    try {
      const before = await owner.leadops.getTelephonySettings();
      await expect(owner.leadops.saveTelephonySettings({ ...before, provider: "sipgate", credentials: before.credentials, sipgate: { tokenId: "", token: "" }, addressSid: "", bundleSids: before.bundleSids, agentConnection: "sipgate", announcement: before.announcement ?? "", pacingRatio: Number(before.pacingRatio), maxAbandonRate: Number(before.maxAbandonRate), callWindow: { weekdays: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } } as Parameters<typeof owner.leadops.saveTelephonySettings>[0])).rejects.toThrow(/Token-ID und Token/);
      await owner.leadops.saveTelephonySettings({ ...before, provider: "sipgate", credentials: before.credentials, sipgate: { tokenId: "token-e2e", token: "geheim-e2e", smsId: "s0", deviceId: "" }, addressSid: "", bundleSids: before.bundleSids, agentConnection: "sipgate", consentMode: "agent_button", recordCalls: true, announcement: before.announcement ?? "", pacingRatio: Number(before.pacingRatio), maxAbandonRate: Number(before.maxAbandonRate), callWindow: { weekdays: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } } as Parameters<typeof owner.leadops.saveTelephonySettings>[0]);
      const saved = await owner.leadops.getTelephonySettings(); expect(saved.provider).toBe("sipgate"); expect(saved.sipgate.tokenId).toBe("token-e2e"); expect(saved.sipgate.token).toBe("••••••••"); expect(saved.webhooks.sipgateEvents).toContain("/api/telephony/sipgate/events?tenant=");
      const row = (await db.select().from(telephonySettings).where(eq(telephonySettings.tenantId, tenantId)))[0]; expect(row.sipgateEncrypted).not.toContain("geheim-e2e"); // verschlüsselt abgelegt
      // Verbindung prüfen: System, Benutzer, Geräte, Rufnummern, Webhook-Stand
      const check = await owner.leadops.sipgateCheck();
      expect(check).toMatchObject({ ok: true, userId: "w0", system: "classic", masterSipId: "3376511" }); expect(check.devices.map((device) => device.id)).toEqual(["e0", "x0"]); expect(check.numbers.map((number) => number.imported)).toEqual([false, false]); expect(check.webhooks?.configured).toBe(false);
      // Rufnummern übernehmen – landen als sipgate-Nummern, die erste wird Standard
      const imported = await owner.leadops.sipgateImportNumbers(); expect(imported).toEqual({ imported: 2, total: 2 });
      expect((await owner.leadops.sipgateImportNumbers()).imported).toBe(0);
      const numbers = await db.select().from(phoneNumbers).where(and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.provider, "sipgate"))); expect(numbers.map((number) => number.e164).sort()).toEqual(["+4917833591460", "+496119851230"]);
      await expect(owner.leadops.searchPhoneNumbers({ country: "DE", type: "lokal" })).rejects.toThrow(/direkt bei sipgate/);
      // Webhook eintragen
      const hook = await owner.leadops.sipgateSetupWebhooks(); expect(hook.url).toContain("/api/telephony/sipgate/events?tenant=");
      expect(api.calls.at(-1)).toMatchObject({ method: "PUT", path: "/settings/sipgateio", body: { incomingUrl: hook.url, outgoingUrl: hook.url, log: true } });
      expect((await owner.leadops.sipgateCheck()).webhooks?.configured).toBe(false); // der Nachbau liefert weiter eine leere Adresse – der Zeitstempel steht trotzdem
      // Sitzung: Predictive geht nicht, ohne Gerät geht nicht, mit Gerät schon
      await expect(owner.leadops.startDialerSession({ campaignId: null, mode: "predictive", connection: "sipgate", agentDeviceId: "e0" })).rejects.toThrow(/Predictive/);
      await expect(owner.leadops.startDialerSession({ campaignId: null, mode: "manuell", connection: "browser" })).rejects.toThrow(/sipgate-Gerät/);
      const session = await owner.leadops.startDialerSession({ campaignId: null, mode: "manuell", connection: "browser", agentDeviceId: "e0" }); expect(session?.connection).toBe("sipgate"); expect(session?.agentDeviceId).toBe("e0");
      expect(await owner.leadops.sipgateDevices()).toHaveLength(2);
      // Anruf: sipgate ruft Gerät e0, dann den Kunden; die callId kommt aus der Liste der aktiven Anrufe
      api.active = [{ callId: "CALL-E2E", participants: [{ phoneNumber: "+49151999888" }] }];
      const instruction = await owner.leadops.placeManualCall({ phone: "+49 151 999888" });
      expect(instruction.connection).toBe("sipgate"); expect(instruction.params.device).toBe("e0");
      expect(api.calls.find((call) => call.path === "/sessions/calls")?.body).toEqual({ deviceId: "e0", caller: "e0", callee: "+49151999888", callerId: "+496119851230" });
      let call = (await db.select().from(dialerCalls).where(eq(dialerCalls.id, instruction.callId)))[0]; expect(call.provider).toBe("sipgate"); expect(call.providerCallSid).toBe("CALL-E2E"); expect(call.providerSessionId).toBe("sess-e2e"); expect(call.status).toBe("klingelt");
      // Ereignisse der Push-API: newCall (Antwort mit onAnswer/onHangup), answer → verbunden, Klick → Aufzeichnung, hangup → beendet
      const base = "https://leads.e2e.example";
      const newCall = await handleSipgateEvent(db, tenantId, { event: "newCall", callId: "CALL-E2E", direction: "out", from: "+496119851230", to: "+49151999888", "userId[]": ["w0"] }, base);
      expect(newCall.callId).toBe(call.id); expect(newCall.xml).toContain(`onAnswer="${base}/api/telephony/sipgate/events?tenant=${tenantId}&amp;secret=`);
      const incoming = await handleSipgateEvent(db, tenantId, { event: "newCall", callId: "CALL-IN", direction: "in", from: "+49301234567", to: "+496119851230" }, base); expect(incoming.callId).toBeNull(); // eingehende Anrufe gehen uns nichts an
      await handleSipgateEvent(db, tenantId, { event: "answer", callId: "CALL-E2E", direction: "out", to: "+49151999888", answeringNumber: "+49151999888" }, base);
      call = (await db.select().from(dialerCalls).where(eq(dialerCalls.id, instruction.callId)))[0]; expect(call.status).toBe("verbunden"); expect(call.connectedAt).toBeTruthy(); expect(call.recordingSid).toBeNull(); // Klick-Modus: noch keine Aufzeichnung
      expect((await owner.leadops.currentDialerSession())?.status).toBe("im_gespraech");
      await owner.leadops.markCallConsent({ callId: call.id });
      expect(api.calls.at(-1)).toMatchObject({ method: "PUT", path: "/calls/CALL-E2E/recording", body: { value: true, announcement: false } });
      call = (await db.select().from(dialerCalls).where(eq(dialerCalls.id, instruction.callId)))[0]; expect(call.recordingSid).toBe("sg-CALL-E2E");
      await handleSipgateEvent(db, tenantId, { event: "hangup", callId: "CALL-E2E", direction: "out", to: "+49151999888", cause: "normalClearing" }, base);
      call = (await db.select().from(dialerCalls).where(eq(dialerCalls.id, instruction.callId)))[0]; expect(call.status).toBe("beendet"); expect(call.endedAt).toBeTruthy(); expect(call.recordingUrl).toBeNull();
      await handleSipgateEvent(db, tenantId, { event: "hangup", callId: "CALL-E2E", direction: "out", to: "+49151999888", cause: "normalClearing" }, base); // doppelt → ignoriert
      expect((await db.select().from(dialerCalls).where(eq(dialerCalls.id, instruction.callId)))[0].status).toBe("beendet");
      // Aufzeichnung aus dem Verlauf nachtragen (erst nach 20 s – der Test stellt die Uhr vor) und über die eigene Adresse ausliefern
      api.history = [{ id: "h-e2e", source: "+496119851230", target: "+49151999888", created: call.startedAt.toISOString(), duration: 125000, status: "PICKUP", direction: "OUTGOING", recordingUrl: "https://files.sipgate.example/rec/h-e2e.mp3" }];
      const later = new Date(Date.now() + 60_000);
      expect(await reconcileSipgateRecordings(db, tenantId, base, later)).toEqual({ updated: 1 });
      call = (await db.select().from(dialerCalls).where(eq(dialerCalls.id, instruction.callId)))[0];
      expect(call.providerRecordingUrl).toBe("https://files.sipgate.example/rec/h-e2e.mp3"); expect(call.recordingUrl).toBe(`${base}/api/telephony/sipgate/recording/${call.id}?secret=${row.webhookSecret}`);
      const audio = await sipgateRecordingResponse(db, call.id, row.webhookSecret); expect(audio?.ok).toBe(true); expect(await audio!.text()).toBe("ID3-audio");
      expect(await sipgateRecordingResponse(db, call.id, "falsch")).toBeNull();
      // Abgleich ohne Webhook: zweiter Anruf, der nur über die Liste der aktiven Anrufe erkannt und beendet wird
      await owner.leadops.setCallDisposition({ callId: call.id, disposition: "interessiert", notes: "sipgate-Test" }).catch(() => undefined);
      await owner.leadops.updateDialerSession({ status: "bereit" });
      api.active = [];
      const second = await owner.leadops.placeManualCall({ phone: "+49 151 777666" });
      let other = (await db.select().from(dialerCalls).where(eq(dialerCalls.id, second.callId)))[0]; expect(other.providerCallSid).toBe("session:sess-e2e"); expect(other.status).toBe("initiiert");
      api.active = [{ callId: "CALL-2", participants: [{ phoneNumber: "+49151777666" }] }];
      await syncSipgateCalls(db, tenantId); other = (await db.select().from(dialerCalls).where(eq(dialerCalls.id, second.callId)))[0]; expect(other.providerCallSid).toBe("CALL-2"); expect(["klingelt", "verbunden"]).toContain(other.status);
      api.active = [];
      await syncSipgateCalls(db, tenantId); await syncSipgateCalls(db, tenantId); // zweimal nicht mehr in der Liste → zu Ende
      other = (await db.select().from(dialerCalls).where(eq(dialerCalls.id, second.callId)))[0]; expect(["beendet", "keine_antwort"]).toContain(other.status);
      // Live-Bild: der Agent steht mit Tageszahlen drin, der Teamleiter kann ihn steuern
      const live = await owner.leadops.dialerLiveBoard();
      const me = live.agents.find((agent) => agent.userId === ownerUserId); expect(me).toBeTruthy(); expect(me!.today.calls).toBeGreaterThanOrEqual(2); expect(me!.device).toBe("e0");
      expect(live.totals.callsToday).toBeGreaterThanOrEqual(2); expect(live.recent.some((item) => item.id === call.id && item.recordingUrl)).toBe(true);
      await owner.leadops.dialerSupervise({ userId: ownerUserId, action: "pause" }); expect((await owner.leadops.currentDialerSession())?.status).toBe("pause");
      await owner.leadops.dialerSupervise({ userId: ownerUserId, action: "bereit" }); expect((await owner.leadops.currentDialerSession())?.status).toBe("bereit");
      await owner.leadops.updateDialerSession({ status: "offline" });
      await expect(owner.leadops.dialerSupervise({ userId: ownerUserId, action: "pause" })).rejects.toThrow(/keine Sitzung/);
      // zurück auf Simulation, damit spätere Tests unberührt bleiben
      await owner.leadops.saveTelephonySettings({ ...before, provider: "simulation", credentials: before.credentials, addressSid: "", bundleSids: before.bundleSids, agentConnection: "browser", announcement: before.announcement ?? "", pacingRatio: Number(before.pacingRatio), maxAbandonRate: Number(before.maxAbandonRate), callWindow: { weekdays: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } } as Parameters<typeof owner.leadops.saveTelephonySettings>[0]);
    } finally { delete sipgateTestHooks.fetchImpl; }
  }, 20000);

  it("38. Auswertung je Agent (Gespräche → Agenten) und Rohdaten je Kategorie („was wurde daraus“)", async () => {
    // Agenten: alle Dialer-Anrufe der bisherigen Tests (Rohdaten-Liste, Kaltakquise, sipgate) – der Inhaber hat sie geführt
    const all = await owner.leadops.dialerAgentReport({ period: "alle" });
    expect(all.agents.length).toBeGreaterThan(0);
    const me = all.agents.find((agent) => agent.userId === ownerUserId)!;
    expect(me).toBeTruthy();
    expect(me.calls).toBeGreaterThanOrEqual(3); expect(me.reached).toBeGreaterThanOrEqual(2); expect(me.reachRate).not.toBeNull();
    expect(me.appointments).toBeGreaterThanOrEqual(1); // Test 18: „verkauft“
    expect(me.interested).toBeGreaterThanOrEqual(1); // Test 18: „interessiert“
    expect(me.averageScore).not.toBeNull(); expect(me.evaluated).toBeGreaterThanOrEqual(2); expect(me.approved).toBeGreaterThanOrEqual(1);
    expect(all.totals.calls).toBe(all.agents.reduce((sum, agent) => sum + agent.calls, 0));
    expect(all.agents[0].appointments).toBeGreaterThanOrEqual(all.agents[all.agents.length - 1].appointments); // nach Terminen sortiert
    const today = await owner.leadops.dialerAgentReport({ period: "heute" });
    expect(today.totals.calls).toBeLessThanOrEqual(all.totals.calls); expect(today.totals.calls).toBeGreaterThan(0);
    const messe = all.campaigns.find((campaign) => campaign.name === "Messe abtelefonieren")!;
    expect(messe).toBeTruthy();
    const perCampaign = await owner.leadops.dialerAgentReport({ period: "alle", campaignId: messe.id });
    expect(perCampaign.totals.calls).toBe(3); expect(perCampaign.totals.appointments).toBe(1); expect(perCampaign.totals.interested).toBe(1);
    // Gesprächsliste nach Agent filtern
    const mine = await owner.leadops.listCalls({ agentName: me.name });
    expect(mine.length).toBeGreaterThan(0); expect(mine.every((call) => call.agentName === me.name)).toBe(true);
    expect((await owner.leadops.listCalls({ agentName: "Gibt es nicht" })).length).toBe(0);
    await expect(invitee.leadops.dialerAgentReport({})).rejects.toThrow("vorbehalten");

    // Rohdaten je Kategorie: Test 18 hat aus der WP-Liste drei Leads gemacht (zwei verkauft/zugewiesen), zwei Kontakte wurden erreicht, ein Termin
    const report = await owner.leadops.rawCategoryReport({});
    const wp = report.categories.find((row) => row.categoryId === S.wp.id)!;
    expect(wp).toBeTruthy();
    expect(wp.total).toBeGreaterThanOrEqual(3); expect(wp.leads).toBeGreaterThanOrEqual(3); expect(wp.leadVerkauft).toBeGreaterThanOrEqual(2);
    expect(wp.angerufen).toBeGreaterThanOrEqual(2); expect(wp.erreicht).toBeGreaterThanOrEqual(2); expect(wp.termine).toBeGreaterThanOrEqual(1); expect(wp.interessiert).toBeGreaterThanOrEqual(1);
    expect(wp.leadRate).not.toBeNull(); expect(wp.saleRate).not.toBeNull();
    expect(report.totals.total).toBe(report.categories.reduce((sum, row) => sum + row.total, 0));
    expect(report.totals.leads).toBe(report.categories.reduce((sum, row) => sum + row.leads, 0));
    expect((await owner.leadops.rawCategoryReport({ batchId: 999_999 })).categories).toEqual([]);
    await expect(invitee.leadops.rawCategoryReport({})).rejects.toThrow("vorbehalten");
  });

  it("39. Anrufzähler an der Karte (Migration 0074), Stufe „In Bearbeitung“, Vertriebler anlegen (Taner/Francesco), Listen-Upload prozentual verteilen", async () => {
    // Vertriebler: Standard-Duo auf Knopfdruck, eigener ohne Login, umbenennen, pausieren
    const ensured = await owner.leadops.ensureDefaultSalesReps();
    expect(ensured.created).toEqual(["Taner", "Francesco"]);
    expect((await owner.leadops.ensureDefaultSalesReps()).created).toEqual([]); // kein zweites Mal
    const reps = await owner.leadops.listSalesReps();
    const taner = reps.find((rep) => rep.firstName === "Taner")!; const francesco = reps.find((rep) => rep.firstName === "Francesco")!;
    expect(taner).toMatchObject({ active: true, hasLogin: false, openCards: 0 }); expect(francesco.active).toBe(true);
    expect((await owner.leadops.pipelineOwners()).map((o) => o.name)).toEqual(expect.arrayContaining(["Taner", "Francesco"]));
    const lisa = await owner.leadops.createSalesRep({ name: "Lisa Neu" }); expect(lisa).toMatchObject({ created: true, hasLogin: false });
    await expect(owner.leadops.createSalesRep({ name: "lisa neu" })).rejects.toThrow("gibt es schon");
    await expect(owner.leadops.createSalesRep({ name: "Kurz", email: "kurz@example.de", password: "123" })).rejects.toThrow("8 Zeichen");
    const withLogin = await owner.leadops.createSalesRep({ name: "Paul Login", email: "paul.login@example.de", password: "geheim-12345" }); expect(withLogin.hasLogin).toBe(true);
    await owner.leadops.updateSalesRep({ userId: lisa.userId, name: "Lisa Neumann", active: false });
    const after = await owner.leadops.listSalesReps(); expect(after.find((rep) => rep.userId === lisa.userId)).toMatchObject({ name: "Lisa Neumann", active: false });
    expect((await owner.leadops.pipelineOwners()).some((o) => o.userId === lisa.userId)).toBe(false); // pausiert bekommt nichts
    await expect(invitee.leadops.listSalesReps()).rejects.toThrow("vorbehalten");

    // Listen-Upload: 70 % Taner, 30 % Francesco → 7 / 3, abwechselnd zugeteilt
    const rows = Array.from({ length: 10 }, (_, index) => ({ firstName: `Kontakt${index}`, lastName: "Verteilt", company: `Firma ${index}`, phone: `+49 69 7700${String(100 + index)}` }));
    const imported = await owner.leadops.importColdList({ listName: "Verteil-Liste", rows, ownerShares: [{ userId: taner.userId, value: 70 }, { userId: francesco.userId, value: 30 }], shareMode: "prozent" });
    expect(imported.created).toBe(10);
    const listed = await owner.leadops.emailLeads({ listName: "Verteil-Liste", withoutEmail: true, source: "kaltakquise", limit: 50 });
    expect(listed.items.length).toBe(10);
    expect(listed.items.filter((item) => item.ownerUserId === taner.userId).length).toBe(7); expect(listed.items.filter((item) => item.ownerUserId === francesco.userId).length).toBe(3);
    const byCount = await owner.leadops.importColdList({ listName: "Verteil-Liste 2", rows: rows.map((row) => ({ ...row, phone: row.phone.replace("7700", "7701") })), ownerShares: [{ userId: taner.userId, value: 4 }], shareMode: "anzahl" });
    expect(byCount.created).toBe(10);
    const second = await owner.leadops.emailLeads({ listName: "Verteil-Liste 2", withoutEmail: true, source: "kaltakquise", limit: 50 });
    expect(second.items.filter((item) => item.ownerUserId === taner.userId).length).toBe(4); expect(second.items.filter((item) => !item.ownerUserId).length).toBe(6);

    // Anrufzähler: erster Versuch → In Bearbeitung, erreicht → Kontaktiert, Rückruf → Aufgabe; alles im Verlauf
    const card = listed.items[0];
    expect(card.stage ?? "neu").toBe("neu"); expect(card.calls.count).toBe(0);
    const first = await owner.leadops.logCallAttempt({ publicId: card.publicId, result: "nicht_erreicht", note: "Niemand ran" });
    expect(first).toMatchObject({ count: 1, reached: 0, moved: "in_bearbeitung" });
    const second2 = await owner.leadops.logCallAttempt({ publicId: card.publicId, result: "mailbox", followUpAt: new Date(Date.now() + 3_600_000) });
    expect(second2).toMatchObject({ count: 2, moved: null });
    const third = await owner.leadops.logCallAttempt({ publicId: card.publicId, result: "erreicht", note: "Interesse, Angebot gewünscht" });
    expect(third).toMatchObject({ count: 3, reached: 1, moved: "kontaktiert" });
    const attempts = await owner.leadops.callAttempts({ publicId: card.publicId });
    expect(attempts).toMatchObject({ count: 3, reached: 1, lastResult: "erreicht" }); expect(attempts.attempts.map((item) => item.result)).toEqual(["erreicht", "mailbox", "nicht_erreicht"]);
    expect(attempts.attempts[0].by).toBeTruthy(); expect(attempts.attempts[0].fromDialer).toBe(false);
    const overview = await owner.leadops.pipelineOverview({ source: "kaltakquise" });
    const onBoard = overview.stages.find((stage) => stage.key === "kontaktiert")!.leads.find((lead) => lead.publicId === card.publicId)!;
    expect(onBoard.calls).toMatchObject({ count: 3, reached: 1, lastResult: "erreicht" });
    expect(overview.stageDefs.map((stage) => stage.key)).toContain("in_bearbeitung");
    const history = await owner.leadops.pipelineHistory({ publicId: card.publicId });
    expect(history.some((event) => event.toStage === "anruf" && /Anruf 3: erreicht/.test(event.note ?? ""))).toBe(true);
    expect(history.some((event) => event.toStage === "in_bearbeitung")).toBe(true);
    const tasks = await owner.leadops.listPipelineTasks({ publicId: card.publicId });
    expect(tasks.some((task) => task.kind === "anruf" && /anrufen/i.test(task.title))).toBe(true);
    await expect(owner.leadops.logCallAttempt({ publicId: card.publicId, result: "unbekannt" as never })).rejects.toThrow();

    // Dialer-Anruf an einer Karte zählt automatisch (Simulation: Endziffer 4 → Mensch)
    const dialed = listed.items[1];
    await owner.leadops.updatePipelineLead({ publicId: dialed.publicId, phone: "+49 170 9988774" });
    await owner.leadops.startDialerSession({ campaignId: null, mode: "manuell", connection: "browser" });
    const instruction = await owner.leadops.placeManualCall({ publicId: dialed.publicId });
    await owner.leadops.endDialerCall({ callId: instruction.callId, durationSeconds: 45 });
    await owner.leadops.setCallDisposition({ callId: instruction.callId, disposition: "wiedervorlage" });
    await owner.leadops.updateDialerSession({ status: "offline" });
    const dialedAttempts = await owner.leadops.callAttempts({ publicId: dialed.publicId });
    expect(dialedAttempts.count).toBe(1); expect(dialedAttempts.attempts[0]).toMatchObject({ fromDialer: true, result: "rueckruf" });
    // Migration 0074 hat vorhandene Dialer-Anrufe der Vortests übernommen? (Hooks laufen seit dem Anruf, Backfill greift bei der Migration) – mindestens dieser eine Eintrag hängt am Dialer-Anruf
    expect((await db.select({ id: leadCallAttempts.id }).from(leadCallAttempts).where(eq(leadCallAttempts.dialerCallId, instruction.callId))).length).toBe(1);
  }, 20000);

  it("40. Antwort-Stopp: eine Antwort stoppt sofort jede laufende Serie an den Kontakt – auch ohne „Wenn geantwortet“ im Ablauf; Abwesenheitsnotiz zählt nicht; Knopf „Geantwortet“ stoppt ebenfalls", async () => {
    const tenantId = S.tenantId as number; const { REPLY_STOP_NOTE } = await import("../shared/email-campaigns"); const { starterBlocks } = await import("../shared/email-design");
    // Drei Kontakte mit E-Mail in einer frischen Liste
    const rows = [["Anna", "anna@antwort-test.example"], ["Bernd", "bernd@antwort-test.example"], ["Dirk", "dirk@antwort-test.example"]].map(([firstName, email]) => ({ firstName, lastName: "Stopp", company: `${firstName} Dach GmbH`, email, phone: null }));
    expect((await owner.leadops.importColdList({ listName: "Antwort-Stopp Test", rows })).created).toBe(3);
    // Ablauf OHNE Antwort-Verzweigung: E-Mail → 1 Std. warten → E-Mail → E-Mail. Zwei Serien gleichzeitig an dieselben Kontakte.
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send" as const, label: "Erste", subject: "Erste Mail an {{vorname}}", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait" as const, hours: 1, next: "m2" }, { id: "m2", type: "send" as const, label: "Zweite", subject: "Zweite Mail", blocks: starterBlocks("nachfassen"), next: "m3" }, { id: "m3", type: "send" as const, label: "Dritte", subject: "Dritte Mail", blocks: starterBlocks("nachfassen"), next: null }] };
    const starter = await owner.leadops.emailCampaignStarter();
    const a = await owner.leadops.saveEmailCampaign({ name: "Stopp-Serie A", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Antwort-Stopp Test" }, tree, design: starter.design as unknown as Record<string, unknown> });
    const b = await owner.leadops.saveEmailCampaign({ name: "Stopp-Serie B", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Antwort-Stopp Test" }, tree, design: starter.design as unknown as Record<string, unknown> });
    for (const campaign of [a, b]) { const started = await owner.leadops.startEmailCampaign({ id: campaign.id }); expect(started.added).toBe(3); if (started.processed < 3) await owner.leadops.runEmailCampaigns(); }
    const rowsOf = async (email: string) => db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.email, email)));
    for (const email of ["anna@antwort-test.example", "bernd@antwort-test.example", "dirk@antwort-test.example"]) { const items = await rowsOf(email); expect(items).toHaveLength(2); expect(items.every((row) => row.status === "wartet" && row.sentCount === 1 && !row.repliedAt)).toBe(true); }
    // 1) Anna antwortet auf Serie A → beide Serien (A und B) sind für Anna sofort beendet, Vermerk im Verlauf
    const reply = await owner.leadops.storeInboxMessage({ fromEmail: "anna@antwort-test.example", fromName: "Anna Stopp", subject: "Re: Erste Mail an Anna", bodyText: "Ja gerne, rufen Sie mich an." }); expect(reply.replied).toBe(true);
    const anna = await rowsOf("anna@antwort-test.example"); expect(anna.every((row) => row.status === "fertig" && row.repliedAt && !row.nextActionAt && !row.nodeId)).toBe(true);
    for (const row of anna) { const events = await db.select().from(emailCampaignEvents).where(eq(emailCampaignEvents.recipientId, row.id)); expect(events.some((event) => event.kind === "beendet" && event.note === REPLY_STOP_NOTE)).toBe(true); }
    // 2) Bernd schickt nur eine Abwesenheitsnotiz → zählt nicht als Antwort, Serie läuft weiter (Vermerk im Verlauf)
    const away = await owner.leadops.storeInboxMessage({ fromEmail: "bernd@antwort-test.example", fromName: "Bernd Stopp", subject: "Automatische Antwort: Erste Mail an Bernd", bodyText: "Ich bin bis zum 30.10. im Urlaub und erst danach wieder erreichbar." }); expect(away.replied).toBe(false); expect(away.ai?.kind).toBe("abwesenheit");
    const bernd = await rowsOf("bernd@antwort-test.example"); expect(bernd.every((row) => row.status === "wartet" && !row.repliedAt)).toBe(true);
    const berndEvents = await db.select().from(emailCampaignEvents).where(or(eq(emailCampaignEvents.recipientId, bernd[0].id), eq(emailCampaignEvents.recipientId, bernd[1].id))); expect(berndEvents.some((event) => event.kind === "gewartet" && /Abwesenheitsnotiz/.test(event.note ?? ""))).toBe(true); expect(berndEvents.some((event) => event.note === REPLY_STOP_NOTE)).toBe(false);
    // 3) Knopf „Geantwortet“ an Dirks Eintrag in Serie A → stoppt A und B für Dirk
    const dirkA = (await rowsOf("dirk@antwort-test.example")).find((row) => row.campaignId === a.id)!; expect((await owner.leadops.markEmailReplied({ recipientId: dirkA.id })).stopped).toBe(2);
    expect((await rowsOf("dirk@antwort-test.example")).every((row) => row.status === "fertig" && row.repliedAt)).toBe(true);
    // 4) Wartezeit abgelaufen → Zeitplaner: Bernd bekommt Mail 2 und 3, Anna und Dirk bekommen nichts mehr
    await db.update(emailCampaignRecipients).set({ nextActionAt: new Date(Date.now() - 60_000) }).where(and(eq(emailCampaignRecipients.tenantId, tenantId), or(eq(emailCampaignRecipients.campaignId, a.id), eq(emailCampaignRecipients.campaignId, b.id))));
    await owner.leadops.runEmailCampaigns();
    expect((await rowsOf("bernd@antwort-test.example")).every((row) => row.status === "fertig" && row.sentCount === 3)).toBe(true);
    expect((await rowsOf("anna@antwort-test.example")).every((row) => row.sentCount === 1)).toBe(true); expect((await rowsOf("dirk@antwort-test.example")).every((row) => row.sentCount === 1)).toBe(true);
    // Kampagnen-Ansicht: gestoppte Empfänger als „geantwortet“ gezählt, Serie beendet
    const detail = await owner.leadops.getEmailCampaign({ id: a.id }); expect(detail.stats.replied).toBe(2); expect(detail.status).toBe("beendet"); expect(detail.recipients.find((row) => row.email === "anna@antwort-test.example")).toMatchObject({ status: "fertig", sentCount: 1 });
    expect(detail.events.filter((event) => event.kind === "beendet" && event.note === REPLY_STOP_NOTE)).toHaveLength(2);
    // 5) Antwort trifft zwischen Laden und Senden ein (Nachprüfung direkt vor dem Versand): dritte Serie, Antwort wird vor dem Zeitplaner gesetzt, aber ohne Stopp-Lauf → der Zeitplaner selbst beendet statt zu senden
    const c = await owner.leadops.saveEmailCampaign({ name: "Stopp-Serie C", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Antwort-Stopp Test" }, tree, design: starter.design as unknown as Record<string, unknown> });
    expect((await owner.leadops.startEmailCampaign({ id: c.id })).added).toBe(3); await owner.leadops.runEmailCampaigns();
    const berndC = (await rowsOf("bernd@antwort-test.example")).find((row) => row.campaignId === c.id)!; expect(berndC.sentCount).toBe(1);
    await db.update(emailCampaignRecipients).set({ repliedAt: new Date(), nextActionAt: new Date(Date.now() - 60_000) }).where(eq(emailCampaignRecipients.id, berndC.id)); // nur Zeitstempel, kein Stopp-Lauf
    await owner.leadops.runEmailCampaigns();
    const berndAfter = (await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, berndC.id)))[0]; expect(berndAfter.status).toBe("fertig"); expect(berndAfter.sentCount).toBe(1);
    expect((await db.select().from(emailCampaignEvents).where(eq(emailCampaignEvents.recipientId, berndC.id))).some((event) => event.kind === "beendet" && event.note === REPLY_STOP_NOTE)).toBe(true);
    // 6) Schalter „Bei Antwort anhalten“ (Migration 0075, Standard an – auch für alte Kampagnen): Serie D bewusst aus → Annas Antwort stoppt D nicht
    expect((await owner.leadops.listEmailCampaigns()).find((row) => row.id === a.id)?.stopOnReply).toBe(true); expect((await owner.leadops.getEmailCampaign({ id: a.id })).stopOnReply).toBe(true);
    const d = await owner.leadops.saveEmailCampaign({ name: "Stopp-Serie D (aus)", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Antwort-Stopp Test" }, tree, design: starter.design as unknown as Record<string, unknown>, stopOnReply: false });
    expect((await owner.leadops.listEmailCampaigns()).find((row) => row.id === d.id)?.stopOnReply).toBe(false);
    expect((await owner.leadops.startEmailCampaign({ id: d.id })).added).toBe(3); await owner.leadops.runEmailCampaigns();
    const annaD = (await rowsOf("anna@antwort-test.example")).find((row) => row.campaignId === d.id)!; expect(annaD.sentCount).toBe(1); expect(annaD.status).toBe("wartet"); // neue Serie: Anna darf wieder angeschrieben werden (bewusst gestartet)
    await owner.leadops.storeInboxMessage({ fromEmail: "anna@antwort-test.example", fromName: "Anna Stopp", subject: "Re: Erste Mail an Anna", bodyText: "Nochmal: ja, gerne anrufen." });
    const annaDAfter = (await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, annaD.id)))[0]; expect(annaDAfter.status).toBe("wartet"); expect(annaDAfter.repliedAt).toBeTruthy();
    expect((await db.select().from(emailCampaignEvents).where(eq(emailCampaignEvents.recipientId, annaD.id))).some((event) => event.kind === "gewartet" && /läuft weiter/.test(event.note ?? ""))).toBe(true);
    await db.update(emailCampaignRecipients).set({ nextActionAt: new Date(Date.now() - 60_000) }).where(eq(emailCampaignRecipients.campaignId, d.id)); await owner.leadops.runEmailCampaigns();
    expect((await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, annaD.id)))[0]).toMatchObject({ status: "fertig", sentCount: 3 }); // trotz Antwort alle drei Mails
    // Schalter nachträglich einschalten → gilt sofort für die laufende Serie (Sicherheitsnetz vor dem nächsten Lauf)
    const e = await owner.leadops.saveEmailCampaign({ name: "Stopp-Serie E", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Antwort-Stopp Test" }, tree, design: starter.design as unknown as Record<string, unknown>, stopOnReply: false });
    expect((await owner.leadops.startEmailCampaign({ id: e.id })).added).toBe(3); await owner.leadops.runEmailCampaigns();
    const dirkE = (await rowsOf("dirk@antwort-test.example")).find((row) => row.campaignId === e.id)!; expect(dirkE.status).toBe("wartet"); // Dirks frühere Antwort liegt vor dieser Anmeldung → bewusst neu angeschrieben
    await db.update(emailCampaignRecipients).set({ createdAt: new Date(Date.now() - 3 * 3_600_000), nextActionAt: new Date(Date.now() - 60_000) }).where(eq(emailCampaignRecipients.id, dirkE.id)); // alter Eintrag (vor Dirks Antwort angelegt) – wie Daten aus der Zeit vor dem Antwort-Stopp
    await owner.leadops.saveEmailCampaign({ id: e.id, name: "Stopp-Serie E", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Antwort-Stopp Test" }, tree, design: starter.design as unknown as Record<string, unknown>, stopOnReply: true });
    await owner.leadops.runEmailCampaigns();
    expect((await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, dirkE.id)))[0]).toMatchObject({ status: "fertig", sentCount: 1 }); // Sicherheitsnetz: beendet statt Mail 2
    expect((await db.select().from(emailCampaignEvents).where(eq(emailCampaignEvents.recipientId, dirkE.id))).some((event) => event.kind === "beendet" && event.note === REPLY_STOP_NOTE)).toBe(true);
  }, 30000);

  it("41. Upload-Verlauf mit Löschungen, Lead-Log je Empfänger (Stufe, Schritte, Wartezeit, Fehler), Karten prozentual verteilen, Mehrfach-Durchlauf je Kampagne (Migration 0076)", async () => {
    const tenantId = S.tenantId as number; const { REPLY_STOP_NOTE } = await import("../shared/email-campaigns"); const { starterBlocks } = await import("../shared/email-design");
    // 1) Upload-Verlauf: Liste hochladen, zwei Kontakte von Hand löschen, Liste löschen → Einträge „gelöscht“ mit Grund und Person
    const rows = [["Udo", "udo@verlauf-test.example"], ["Vera", "vera@verlauf-test.example"], ["Willi", "willi@verlauf-test.example"], ["Xenia", "xenia@verlauf-test.example"]].map(([firstName, email]) => ({ firstName, lastName: "Verlauf", company: `${firstName} GmbH`, email }));
    expect((await owner.leadops.importColdList({ listName: "Verlauf Test", rows })).created).toBe(4);
    const contacts = await owner.leadops.emailLeads({ listName: "Verlauf Test" }); expect(contacts.items.length).toBe(4);
    expect((await owner.leadops.deleteEmailLeads({ leadIds: contacts.items.slice(0, 2).map((item) => item.id) })).deleted).toBe(2);
    let history = await owner.leadops.listImportHistory({ limit: 50 }); let deletion = history.find((row) => row.kind === "loeschung" && row.listName === "Verlauf Test");
    expect(deletion).toMatchObject({ rowCount: 2, created: 0 }); expect(deletion?.note).toContain("von Hand gelöscht"); expect(deletion?.actorName).toBeTruthy();
    expect(history.find((row) => row.kind === "upload" && row.listName === "Verlauf Test")?.stillThere).toBe(2);
    expect((await owner.leadops.deleteColdList({ listName: "Verlauf Test" })).deleted).toBe(2);
    history = await owner.leadops.listImportHistory({ limit: 50 }); const deletions = history.filter((row) => row.kind === "loeschung" && row.listName === "Verlauf Test"); expect(deletions.length).toBe(2); expect(deletions.some((row) => /komplett gelöscht/.test(row.note ?? ""))).toBe(true);
    expect(history.find((row) => row.kind === "upload" && row.listName === "Verlauf Test")?.stillThere).toBe(0);
    // Upload zurücknehmen schreibt ebenfalls einen Lösch-Eintrag
    expect((await owner.leadops.importColdList({ listName: "Verlauf Rücknahme", rows: rows.slice(0, 2) })).created).toBe(2);
    const upload = (await owner.leadops.listImportHistory({ limit: 50 })).find((row) => row.kind === "upload" && row.listName === "Verlauf Rücknahme")!; expect((await owner.leadops.undoListImport({ id: upload.id })).deleted).toBe(2);
    expect((await owner.leadops.listImportHistory({ limit: 50 })).some((row) => row.kind === "loeschung" && row.listName === "Verlauf Rücknahme" && /rückgängig/.test(row.note ?? ""))).toBe(true);
    // 2) Lead-Log + Stufe je Empfänger: Serie an drei neue Kontakte, einer bekommt einen Versandfehler (ungültige Adresse), einer eine Antwort
    const logRows = [["Lena", "lena@log-test.example"], ["Max", "max@log-test.example"], ["Nora", "nora@log-test.example"]].map(([firstName, email]) => ({ firstName, lastName: "Log", company: `${firstName} Dach GmbH`, email }));
    expect((await owner.leadops.importColdList({ listName: "Log Test", rows: logRows })).created).toBe(3);
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send" as const, label: "Erste", subject: "Erste Mail an {{vorname}}", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait" as const, hours: 48, next: "c1" }, { id: "c1", type: "condition" as const, check: "opened" as const, yes: "e1", no: "m2" }, { id: "m2", type: "send" as const, label: "Zweite", subject: "Zweite Mail", blocks: starterBlocks("nachfassen"), next: null }, { id: "e1", type: "end" as const, label: "Hat geöffnet" }] };
    const starter = await owner.leadops.emailCampaignStarter();
    const log = await owner.leadops.saveEmailCampaign({ name: "Log-Serie", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Log Test" }, tree, design: starter.design as unknown as Record<string, unknown> });
    expect((await owner.leadops.startEmailCampaign({ id: log.id })).added).toBe(3); await owner.leadops.runEmailCampaigns();
    const detail = await owner.leadops.getEmailCampaign({ id: log.id }); expect(detail.recipients.every((row) => row.lead?.key === "neu" && row.lead.label === "Neu")).toBe(true); // Stufe je Empfänger
    const lena = detail.recipients.find((row) => row.email === "lena@log-test.example")!;
    const lenaLog = await owner.leadops.emailRecipientLog({ recipientId: lena.id });
    expect(lenaLog.recipient.sentCount).toBe(1); expect(lenaLog.lead?.stage?.label).toBe("Neu"); expect(lenaLog.waiting).toMatch(/^wartet noch 1 Tag 23 Std\.|^wartet noch 2 Tage/); expect(lenaLog.steps.map((step) => step.state)).toEqual(["erledigt", "aktuell", "offen", "offen"]); // steht während der Wartezeit am Warten-Schritt expect(lenaLog.events.map((event) => event.kind)).toEqual(["gesendet", "gewartet"]); expect(lenaLog.errors).toEqual([]);
    // Versandfehler: Adresse unzustellbar simulieren (lastError + Ereignis) → Fehler im Log, Fehler-Chip in der Liste, Glocke
    const max = detail.recipients.find((row) => row.email === "max@log-test.example")!;
    await db.update(emailCampaignRecipients).set({ status: "fehler", nextActionAt: null, lastError: "SMTP: 550 Mailbox unavailable" }).where(eq(emailCampaignRecipients.id, max.id));
    await db.insert(emailCampaignEvents).values({ tenantId, campaignId: log.id, recipientId: max.id, nodeId: "m2", kind: "fehler", subject: "Zweite Mail", note: "Versand fehlgeschlagen" });
    const maxLog = await owner.leadops.emailRecipientLog({ recipientId: max.id }); expect(maxLog.errors.length).toBe(2); expect(maxLog.errors.map((item) => item.note)).toContain("SMTP: 550 Mailbox unavailable"); expect(maxLog.waiting).toBeNull();
    expect((await owner.leadops.listEmailCampaigns()).find((row) => row.id === log.id)?.stats.failed).toBe(1);
    expect((await owner.leadops.getEmailCampaign({ id: log.id })).recipients.find((row) => row.id === max.id)?.lastError).toBe("SMTP: 550 Mailbox unavailable");
    // Antwort → Log zeigt „Antwort erhalten“ und den Stopp, Stufe springt (Automatik „Antwort → Kontaktiert“ aus den Vortests)
    await owner.leadops.storeInboxMessage({ fromEmail: "nora@log-test.example", fromName: "Nora Log", subject: "Re: Erste Mail an Nora", bodyText: "Ja, gern." });
    const nora = detail.recipients.find((row) => row.email === "nora@log-test.example")!; const noraLog = await owner.leadops.emailRecipientLog({ recipientId: nora.id });
    expect(noraLog.recipient.status).toBe("fertig"); expect(noraLog.events.map((event) => event.label)).toContain("Antwort erhalten"); expect(noraLog.events.some((event) => event.note === REPLY_STOP_NOTE)).toBe(true); expect(noraLog.steps.some((step) => step.state === "abgebrochen" || step.state === "uebersprungen")).toBe(true);
    // 3) Karten verteilen: 70/30 auf die ersten beiden Vertriebler – nur die Karten ohne Vertriebler
    const reps = await owner.leadops.pipelineOwners(); expect(reps.length).toBeGreaterThanOrEqual(2);
    const cards = (await owner.leadops.getEmailCampaign({ id: log.id })).recipients.map((row) => row.lead!.publicId);
    expect((await owner.leadops.distributePipelineOwners({ publicIds: cards, userIds: [reps[0].userId, reps[1].userId], shares: [{ userId: reps[0].userId, value: 70 }, { userId: reps[1].userId, value: 30 }], mode: "prozent" })).updated).toBe(3);
    const owned = await db.select({ ownerUserId: leads.ownerUserId }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.listName, "Log Test"))); expect(owned.filter((row) => row.ownerUserId === reps[0].userId).length).toBe(2); expect(owned.filter((row) => row.ownerUserId === reps[1].userId).length).toBe(1);
    expect((await owner.leadops.getEmailCampaign({ id: log.id })).recipients.every((row) => row.lead?.ownerUserId)).toBe(true);
    // 4) Mehrfach-Durchlauf: Standard 1 → erneuter Start nimmt niemanden erneut; maxRuns 2 → fertige Kontakte erneut, Antwort/Fehler nie
    await db.update(emailCampaignRecipients).set({ status: "fertig", nextActionAt: null, nodeId: null }).where(eq(emailCampaignRecipients.id, lena.id)); // Lena fertig
    const again = await owner.leadops.startEmailCampaign({ id: log.id }); expect(again).toMatchObject({ added: 1, repeated: 1, skipped: 2, maxRuns: 1 }); // Standard: nur Max (Versandfehler zählt nicht als Durchlauf) erneut – Lena fertig, Nora geantwortet
    await owner.leadops.saveEmailCampaign({ id: log.id, name: "Log-Serie", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Log Test" }, tree, design: starter.design as unknown as Record<string, unknown>, maxRuns: 2 });
    expect((await owner.leadops.listEmailCampaigns()).find((row) => row.id === log.id)?.maxRuns).toBe(2);
    const second = await owner.leadops.startEmailCampaign({ id: log.id }); expect(second).toMatchObject({ added: 1, repeated: 1, skipped: 2, maxRuns: 2 }); // Lena (fertig) erneut – Max läuft gerade, Nora (geantwortet) nie
    const lenaRows = await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.campaignId, log.id), eq(emailCampaignRecipients.email, "lena@log-test.example"))); expect(lenaRows.length).toBe(2); expect(lenaRows.some((row) => row.status === "wartet")).toBe(true);
    expect((await owner.leadops.emailRecipientLog({ recipientId: lena.id })).runs.length).toBe(2);
    expect((await owner.leadops.startEmailCampaign({ id: log.id })).added).toBe(0); // Lenas zweiter Durchlauf läuft noch → kein dritter
    // Lena: beide Durchläufe fertig → maxRuns 2 erreicht; Max: zweiter Durchlauf offen; Nora: geantwortet → niemand mehr
    await db.update(emailCampaignRecipients).set({ status: "fertig" }).where(eq(emailCampaignRecipients.email, "lena@log-test.example"));
    const third = await owner.leadops.startEmailCampaign({ id: log.id }); expect(third.added).toBe(0); expect(third.skipped).toBe(3);
    // Standard (maxRuns 1): ein Kontakt mit Versandfehler darf nach dem Beheben erneut rein – sonst niemand
    await owner.leadops.saveEmailCampaign({ id: log.id, name: "Log-Serie", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Log Test" }, tree, design: starter.design as unknown as Record<string, unknown>, maxRuns: 1 });
    await db.update(emailCampaignRecipients).set({ status: "fehler", nextActionAt: null, lastError: "SMTP: Verbindung abgelehnt" }).where(and(eq(emailCampaignRecipients.campaignId, log.id), eq(emailCampaignRecipients.email, "max@log-test.example")));
    const retry = await owner.leadops.startEmailCampaign({ id: log.id }); expect(retry).toMatchObject({ added: 1, repeated: 1, skipped: 2 });
  }, 30000);

  it("42. Gebietskarte (Migrationen 0077/0078): Gebiete je Kunde und Kategorie speichern, Überschneidungen je Kategorie, ändern, Kunde aus-/einschalten, löschen, Rechte", async () => {
    const categories = await owner.leadops.listCategories(); const pv = categories[0]; const second = categories[1] ?? categories[0];
    const aurora = await owner.leadops.saveTerritory({ customerName: "Aurora Home Solar", categoryId: pv.id, postcodes: ["60311", "60313", "60316", "61118", "63065", "abc", "60311"], note: "Rhein-Main", sourceName: "Aurora.csv", rawCount: 3 });
    expect(aurora).toMatchObject({ created: true, postcodes: 5 });
    const helios = await owner.leadops.saveTerritory({ customerName: "Helios Solar", categoryId: pv.id, postcodes: ["60311", "60313", "63065", "63067", "65183"] });
    const vektor = await owner.leadops.saveTerritory({ customerName: "Vektor Klima", categoryId: second.id === pv.id ? null : second.id, postcodes: ["60311", "60313", "80331"] });
    const list = await owner.leadops.listTerritories(); expect(list.map((row) => row.customerName)).toEqual(["Aurora Home Solar", "Helios Solar", "Vektor Klima"]);
    const auroraRow = list.find((row) => row.id === aurora.id)!; expect(auroraRow.postcodes).toEqual(["60311", "60313", "60316", "61118", "63065"]); expect(auroraRow.categoryName).toBe(pv.name); expect(auroraRow.color).toMatch(/^#[0-9a-f]{6}$/i); expect(auroraRow.createdBy).toBeTruthy();
    expect(list.find((row) => row.id === helios.id)?.color).not.toBe(auroraRow.color); // nächste freie Farbe
    const overlaps = await owner.leadops.territoryOverlaps(); expect(overlaps).toMatchObject({ customers: 3, territories: 3, totalOverlapPlz: 3 });
    const pvGroup = overlaps.groups.find((group) => group.categoryId === pv.id)!; expect(pvGroup).toMatchObject({ customers: 2, overlapPlz: 3, maxCustomers: 2 }); expect(pvGroup.items.map((item) => item.plz)).toEqual(["60311", "60313", "63065"]); expect(pvGroup.pairs[0]).toMatchObject({ shared: 3 });
    if (second.id !== pv.id) expect(overlaps.groups.find((group) => group.categoryId === second.id)?.overlapPlz).toBe(0); // andere Kategorie zählt nicht
    // Gebiet ersetzen (gleiche Farbe bleibt), dann löschen
    expect(await owner.leadops.saveTerritory({ id: aurora.id, customerName: "Aurora Home Solar", categoryId: pv.id, postcodes: ["60311"] })).toMatchObject({ created: false, postcodes: 1 });
    expect((await owner.leadops.listTerritories()).find((row) => row.id === aurora.id)).toMatchObject({ postcodes: ["60311"], color: auroraRow.color });
    expect((await owner.leadops.territoryOverlaps()).groups.find((group) => group.categoryId === pv.id)?.overlapPlz).toBe(1);
    await expect(owner.leadops.saveTerritory({ customerName: "Leer", postcodes: ["abc"] })).rejects.toThrow(/Keine gültige PLZ/);
    await expect(owner.leadops.saveTerritory({ customerName: "Falsche Sparte", categoryId: 999999, postcodes: ["60311"] })).rejects.toThrow(/Kategorie/);
    // Kunde ausschalten (Migration 0078): bleibt gespeichert, zählt aber nicht mehr bei Überschneidungen und Kennzahlen
    expect((await owner.leadops.setTerritoryActive({ id: helios.id, active: false })).active).toBe(false);
    expect((await owner.leadops.listTerritories()).find((row) => row.id === helios.id)?.active).toBe(false);
    const paused = await owner.leadops.territoryOverlaps(); expect(paused.inactive).toBe(1); expect(paused.groups.find((group) => group.categoryId === pv.id)?.overlapPlz ?? 0).toBe(0);
    expect((await owner.leadops.setTerritoryActive({ id: helios.id, active: true })).active).toBe(true); expect((await owner.leadops.territoryOverlaps()).groups.find((group) => group.categoryId === pv.id)?.overlapPlz).toBe(1);
    expect((await owner.leadops.deleteTerritory({ id: vektor.id })).customerName).toBe("Vektor Klima"); expect((await owner.leadops.listTerritories()).length).toBe(2);
    await expect(owner.leadops.deleteTerritory({ id: vektor.id })).rejects.toThrow();
    // Partner (extern, z. B. Käufer) sehen die Gebietskarte nicht
    const externalUser = (await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, S.tenantId as number), eq(memberships.partnerType, "extern"))).limit(1))[0];
    if (externalUser) await expect(appRouter.createCaller({ user: { id: externalUser.userId } } as never).leadops.listTerritories()).rejects.toThrow("vorbehalten");
  }, 20000);

  it("43. Verteilung je Pipeline (50/50 Taner/Francesco in der Kaltakquise) greift beim Übernehmen aus der E-Mail-Akquise; KI-Erkennung einer Gebietsliste ohne Schlüssel über Regeln", async () => {
    const tenantId = S.tenantId as number;
    const reps = await owner.leadops.listSalesReps(); const taner = reps.find((rep) => rep.firstName === "Taner")!; const francesco = reps.find((rep) => rep.firstName === "Francesco")!;
    const settings = await owner.leadops.pipelineSettings();
    // Allgemein aus, nur die Kaltakquise-Pipeline 50/50 – „standard“-Einträge werden nicht gespeichert
    const saved = await owner.leadops.savePipelineSettings({ ...settings, distribution: { mode: "aus", rules: [], fallback: "reihum", shares: [], perPipeline: { kaltakquise: { mode: "anteile", shares: [{ userId: taner.userId, percent: 50 }, { userId: francesco.userId, percent: 50 }] }, email: { mode: "standard", shares: [] } } } });
    expect(saved.distribution.perPipeline).toEqual({ kaltakquise: { mode: "anteile", shares: [{ userId: taner.userId, percent: 50 }, { userId: francesco.userId, percent: 50 }] } });
    const imported = await owner.leadops.importColdList({ listName: "Verteil-Mail-Liste", toPipeline: false, ownerUserIds: [], rows: [1, 2, 3, 4].map((n) => ({ firstName: `Kontakt${n}`, lastName: "Verteil", email: `kontakt${n}@verteil-test.example` })) }); expect(imported.created).toBe(4);
    const contacts = (await owner.leadops.emailLeads({ listName: "Verteil-Mail-Liste" })).items; expect(contacts).toHaveLength(4);
    // In die E-Mail-Pipeline: dort ist die Verteilung aus → niemand zugeteilt
    const toEmail = await owner.leadops.pushLeadsToPipeline({ leadIds: [contacts[0].id], stage: "neu", target: "email" }); expect(toEmail).toMatchObject({ moved: 1, assigned: 0 });
    expect((await db.select({ ownerUserId: leads.ownerUserId }).from(leads).where(eq(leads.id, contacts[0].id)))[0].ownerUserId).toBeNull();
    // In die Kaltakquise-Pipeline: 50/50 – drei neue plus der eine aus der E-Mail-Pipeline verschobene → 2 Taner, 2 Francesco
    const toCold = await owner.leadops.pushLeadsToPipeline({ leadIds: contacts.map((item) => item.id), stage: "neu", target: "kaltakquise" }); expect(toCold).toMatchObject({ moved: 3, switched: 1, assigned: 4 });
    expect(toCold.assignedTo.map((item) => item.count).sort()).toEqual([2, 2]);
    const owners = await db.select({ ownerUserId: leads.ownerUserId }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.listName, "Verteil-Mail-Liste")));
    expect(owners.filter((row) => row.ownerUserId === taner.userId)).toHaveLength(2); expect(owners.filter((row) => row.ownerUserId === francesco.userId)).toHaveLength(2);
    const events = await db.select({ note: pipelineEvents.note }).from(pipelineEvents).where(and(eq(pipelineEvents.tenantId, tenantId), eq(pipelineEvents.leadId, contacts[1].id)));
    expect(events.some((event) => /Zugeteilt an (Taner|Francesco) \(Regel: Anteil 50 % \(Kaltakquise\)\)/.test(event.note ?? ""))).toBe(true);
    // Nochmal übernehmen: schon zugeteilt → bleibt beim Vertriebler, nichts doppelt verteilt
    expect(await owner.leadops.pushLeadsToPipeline({ leadIds: contacts.map((item) => item.id), stage: "kontaktiert", target: "kaltakquise" })).toMatchObject({ restaged: 4, assigned: 0 });
    await owner.leadops.savePipelineSettings({ ...saved, distribution: { mode: "aus", rules: [], fallback: "reihum", shares: [], perPipeline: {} } });
    // KI-Erkennung: ohne ANTHROPIC_API_KEY entscheiden die Regeln – Kunden-Spalte, PLZ, Ort, Umkreis, Kategorie
    const categories = await owner.leadops.listCategories();
    const analysed = await owner.leadops.analyzeTerritoryFile({ fileName: "kunden-gebiete.xlsx", rows: [["Kunde", "Kategorie", "PLZ", "Ort", "Umkreis km"], ["Nordlicht Solar", categories[0]?.name ?? "PV", "20095", "Hamburg", ""], ["", "", "20097", "", ""], ["Aurora Energie", "", "", "Frankfurt am Main", "25"]] });
    expect(analysed.source).toBe("regeln"); expect(analysed.aiError).toContain("ANTHROPIC_API_KEY"); expect(analysed.plan.layout).toBe("zeilen"); expect(analysed.summary).toContain("Kunde:");
    expect(analysed.drafts.map((draft) => [draft.customerName, draft.lines])).toEqual([["Nordlicht Solar", ["20095", "Hamburg", "20097"]], ["Aurora Energie", ["Frankfurt am Main 25 km Umkreis"]]]);
    if (categories[0]) expect(analysed.drafts[0].categoryId).toBe(categories[0].id);
    await expect(owner.leadops.analyzeTerritoryFile({ rows: [[""]] })).rejects.toThrow("leer");
    await expect(invitee.leadops.analyzeTerritoryFile({ rows: [["60311"]] })).rejects.toThrow("nicht zur Verfügung"); // Partner-Zugänge dürfen keine Gebiete analysieren
  }, 20000);

  it("44. E-Mail-Kampagne mit mehreren Listen; „Liste hinzufügen“ und Speichern nehmen Kontakte neuer Listen in die laufende Kampagne auf", async () => {
    const mk = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ firstName: `${prefix}${i}`, lastName: "Liste", email: `${prefix.toLowerCase()}${i}@listen-e2e.example` }));
    for (const [name, prefix, n] of [["E2E Liste A", "La", 2], ["E2E Liste B", "Lb", 3], ["E2E Liste C", "Lc", 1]] as const) expect((await owner.leadops.importColdList({ listName: name, toPipeline: false, rows: mk(prefix, n) })).created).toBe(n);
    expect((await owner.leadops.previewEmailAudience({ source: "liste", listName: "E2E Liste A", listNames: ["E2E Liste A", "E2E Liste B"] })).count).toBe(5);
    const starter = await owner.leadops.emailCampaignStarter();
    const saved = await owner.leadops.saveEmailCampaign({ name: "Listen-Serie", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "E2E Liste A", listNames: ["E2E Liste A"] }, tree: starter.tree, design: starter.design as unknown as Record<string, unknown>, sendWindow: { enabled: true, weekdays: [], from: "09:00", to: "09:01", timezone: "Europe/Berlin" } });
    expect((await owner.leadops.startEmailCampaign({ id: saved.id })).added).toBe(2);
    const added = await owner.leadops.addListsToEmailCampaign({ id: saved.id, listNames: ["E2E Liste B"] }); expect(added).toMatchObject({ running: true, added: 3, lists: ["E2E Liste A", "E2E Liste B"] });
    expect((await owner.leadops.addListsToEmailCampaign({ id: saved.id, listNames: ["E2E Liste B"] })).added).toBe(0); // niemand doppelt
    const resaved = await owner.leadops.saveEmailCampaign({ id: saved.id, name: "Listen-Serie", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "E2E Liste A", listNames: ["E2E Liste A", "E2E Liste B", "E2E Liste C"] }, tree: starter.tree, design: starter.design as unknown as Record<string, unknown> });
    expect(resaved.enrolled).toBe(1);
    const detail = await owner.leadops.getEmailCampaign({ id: saved.id }); expect(detail.recipients).toHaveLength(6);
    expect(detail.recipients.filter((row) => row.lead?.listName === "E2E Liste B")).toHaveLength(3);
    // Neue Kontakte in Liste A (Kampagne läuft) → gleich aufgenommen; Kontakt ohne E-Mail wird gezählt
    const more = await owner.leadops.importColdList({ listName: "E2E Liste A", toPipeline: false, rows: [{ firstName: "Neu", lastName: "Liste", email: "neu@listen-e2e.example" }, { firstName: "Ohne", lastName: "Mail", phone: "+49 30 5550101" }] });
    expect(more.campaigns).toEqual([{ id: saved.id, name: "Listen-Serie", added: 1 }]);
    const after = await owner.leadops.getEmailCampaign({ id: saved.id }); expect(after.recipients).toHaveLength(7); expect(after.audienceInfo).toMatchObject({ pending: 0, noEmail: 1 });
    expect((await owner.leadops.syncEmailCampaignAudience({ id: saved.id })).added).toBe(0);
    // Liste B wieder entfernen → ihre 3 Empfänger sind wirklich raus, auch nach Versandlauf und „Jetzt aufnehmen“
    const removedB = await owner.leadops.removeListsFromEmailCampaign({ id: saved.id, listNames: ["E2E Liste B"] }); expect(removedB).toEqual({ removed: 3, lists: ["E2E Liste A", "E2E Liste C"] });
    await owner.leadops.runEmailCampaigns(); expect((await owner.leadops.syncEmailCampaignAudience({ id: saved.id })).added).toBe(0);
    const afterB = await owner.leadops.getEmailCampaign({ id: saved.id }); expect(afterB.recipients).toHaveLength(4); expect(afterB.recipients.some((row) => row.lead?.listName === "E2E Liste B")).toBe(false);
    expect((await owner.leadops.listEmailCampaigns()).find((row) => row.id === saved.id)?.stats.total).toBe(4);
    // Liste C im Editor abwählen und speichern → Empfänger raus
    const resaved2 = await owner.leadops.saveEmailCampaign({ id: saved.id, name: "Listen-Serie", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "E2E Liste A", listNames: ["E2E Liste A"] }, tree: starter.tree, design: starter.design as unknown as Record<string, unknown> });
    expect(resaved2).toMatchObject({ enrolled: 0, removed: 1 });
    // Altfall: Empfänger aus einer Liste, die schon nicht mehr zur Zielgruppe gehört → per Name entfernbar
    const leftoverImport = await owner.leadops.importColdList({ listName: "E2E Altliste", toPipeline: false, rows: [{ firstName: "Alt", lastName: "Eins", email: "alt1@listen-e2e.example" }] }); expect(leftoverImport.created).toBe(1);
    await owner.leadops.addListsToEmailCampaign({ id: saved.id, listNames: ["E2E Altliste"] });
    await owner.leadops.saveEmailCampaign({ id: saved.id, name: "Listen-Serie", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "E2E Liste A", listNames: ["E2E Liste A"] }, tree: starter.tree, design: starter.design as unknown as Record<string, unknown> });
    expect((await owner.leadops.getEmailCampaign({ id: saved.id })).recipients.some((row) => row.lead?.listName === "E2E Altliste")).toBe(false);
    // einzelnen Empfänger entfernen
    const one = (await owner.leadops.getEmailCampaign({ id: saved.id })).recipients[0];
    expect((await owner.leadops.removeEmailRecipients({ campaignId: saved.id, recipientIds: [one.id] })).removed).toBe(1);
    expect((await owner.leadops.getEmailCampaign({ id: saved.id })).recipients).toHaveLength(2);
    // Letzte Liste entfernen → leer, „Jetzt aufnehmen“ nimmt niemanden (nie „alle Kontakte“)
    expect((await owner.leadops.removeListsFromEmailCampaign({ id: saved.id, listNames: ["E2E Liste A"] })).lists).toEqual([]);
    expect((await owner.leadops.getEmailCampaign({ id: saved.id })).audienceInfo).toMatchObject({ total: 0, pending: 0 });
    expect((await owner.leadops.syncEmailCampaignAudience({ id: saved.id })).added).toBe(0);
    expect((await owner.leadops.getEmailCampaign({ id: saved.id })).recipients).toHaveLength(0);
  }, 20000);

  it("45. Gelöschte Kontakte bleiben gelöscht – Kontakte-Reiter, Pipeline-Karten, Versand, Nachaufnahme, Listen", async () => {
    const rows = [1, 2, 3, 4].map((n) => ({ firstName: `Weg${n}`, lastName: "Loesch", email: `weg${n}@loesch-e2e.example` }));
    expect((await owner.leadops.importColdList({ listName: "Lösch-Test", toPipeline: false, rows })).created).toBe(4);
    const starter = await owner.leadops.emailCampaignStarter();
    const saved = await owner.leadops.saveEmailCampaign({ name: "Lösch-Serie", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Lösch-Test", listNames: ["Lösch-Test"] }, tree: starter.tree, design: starter.design as unknown as Record<string, unknown>, sendWindow: { enabled: true, weekdays: [], from: "09:00", to: "09:01", timezone: "Europe/Berlin" } });
    expect((await owner.leadops.startEmailCampaign({ id: saved.id })).added).toBe(4);
    const contacts = (await owner.leadops.emailLeads({ listName: "Lösch-Test" })).items; expect(contacts).toHaveLength(4);
    // zwei im Reiter „Kontakte“ löschen, einen als Pipeline-Karte
    expect((await owner.leadops.deleteEmailLeads({ leadIds: contacts.slice(0, 2).map((row) => row.id) })).deleted).toBe(2);
    expect((await owner.leadops.deletePipelineLeads({ publicIds: [contacts[2].publicId] })).deleted).toBe(1);
    await owner.leadops.runEmailCampaigns(); await owner.leadops.syncEmailCampaignAudience({ id: saved.id });
    expect((await owner.leadops.emailLeads({ listName: "Lösch-Test" })).items.map((row) => row.email)).toEqual([contacts[3].email]);
    const detail = await owner.leadops.getEmailCampaign({ id: saved.id }); expect(detail.recipients.map((row) => row.email)).toEqual([contacts[3].email]); expect(detail.audienceInfo).toMatchObject({ total: 1, pending: 0 });
    expect((await owner.leadops.listColdLists()).find((list) => list.listName === "Lösch-Test")?.contacts).toBe(1);
    expect((await owner.leadops.pipelineOverview({ source: "email" })).stages.flatMap((stage) => stage.leads).some((lead) => String(lead.email ?? "").includes("loesch-e2e"))).toBe(false);
    // Einzelne Kontakte aus einer Liste in eine laufende Kampagne – ohne die ganze Liste
    const single = await owner.leadops.importColdList({ listName: "Einzel-Liste", toPipeline: false, rows: [{ firstName: "Eins", lastName: "Einzel", email: "eins@einzel-e2e.example" }, { firstName: "Zwei", lastName: "Einzel", email: "zwei@einzel-e2e.example" }, { firstName: "Ohne", lastName: "Einzel", phone: "+49 30 5551234" }] }); expect(single.created).toBe(3);
    const singles = (await owner.leadops.emailLeads({ listName: "Einzel-Liste", withoutEmail: true })).items; expect(singles).toHaveLength(3);
    const eins = singles.find((row) => row.email === "eins@einzel-e2e.example")!; const ohne = singles.find((row) => !row.email)!;
    expect(await owner.leadops.addLeadsToEmailCampaign({ id: saved.id, leadIds: [eins.id, ohne.id] })).toMatchObject({ added: 1, noEmail: 1, already: 0, status: "aktiv" });
    expect((await owner.leadops.addLeadsToEmailCampaign({ id: saved.id, leadIds: [eins.id] })).already).toBe(1);
    const withSingle = await owner.leadops.getEmailCampaign({ id: saved.id }); expect(withSingle.recipients.map((row) => row.email).sort()).toEqual([contacts[3].email, "eins@einzel-e2e.example"].sort());
    expect(withSingle.audienceInfo).toMatchObject({ pending: 0 }); // „Zwei“ wird nicht automatisch mitgenommen – nur die Liste der Kampagne zählt
  }, 20000);

  it("46. Posteingang: gelöschte Mails merken (Migration 0079) – einzeln und „Alle Antworten“, IMAP-Abholung lädt sie nicht wieder", async () => {
    const { inboxDeletedMessages, inboxMessages } = await import("../drizzle/schema");
    const a = await owner.leadops.storeInboxMessage({ fromEmail: "tester1@loesch-inbox.example", subject: "Test 1", bodyText: "nur ein Test" });
    const b = await owner.leadops.storeInboxMessage({ fromEmail: "tester2@loesch-inbox.example", subject: "Test 2", bodyText: "noch ein Test" });
    const ids = [a.id, b.id];
    const rows = await db.select({ id: inboxMessages.id, messageId: inboxMessages.messageId }).from(inboxMessages).where(sql`${inboxMessages.id} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`); expect(rows).toHaveLength(2);
    expect((await owner.leadops.deleteInboxMessages({ ids: [a.id] })).deleted).toBe(1);
    expect((await owner.leadops.listInbox({ filter: "alle" })).items.some((item) => item.id === a.id)).toBe(false);
    const remembered = await db.select({ messageId: inboxDeletedMessages.messageId }).from(inboxDeletedMessages);
    expect(remembered.map((row) => row.messageId)).toContain(rows.find((row) => row.id === a.id)!.messageId);
    // zweimal löschen schadet nicht; „Alle Antworten“-Aufräumen läuft durch
    expect((await owner.leadops.deleteInboxMessages({ ids: [a.id, b.id] })).deleted).toBe(1);
    // „Alle Antworten“ erfasst auch Antworten auf Test-Mails ohne Kampagne (Betreff „Re:“/„AW:“), Fremde ohne Re: bleiben
    const testReply = await owner.leadops.storeInboxMessage({ fromEmail: "tester3@loesch-inbox.example", subject: "Re: [Test] Unsere Leads", bodyText: "Test" });
    const aw = await owner.leadops.storeInboxMessage({ fromEmail: "tester4@loesch-inbox.example", subject: "AW: Angebot", bodyText: "Test" });
    const other = await owner.leadops.storeInboxMessage({ fromEmail: "newsletter@loesch-inbox.example", subject: "Newsletter Oktober", bodyText: "Hallo" });
    expect((await owner.leadops.clearInbox({ scope: "antworten" })).deleted).toBeGreaterThanOrEqual(2);
    const left = (await owner.leadops.listInbox({ filter: "alle" })).items.map((item) => item.id);
    expect(left).not.toContain(testReply.id); expect(left).not.toContain(aw.id); expect(left).toContain(other.id);
  }, 20000);

  it("47. Kontakt von Hand in der Pipeline anlegen – alle Infos, Notiz, Liste; Doppelte werden abgelehnt", async () => {
    const created = await owner.leadops.createPipelineContact({ source: "kaltakquise", salutation: "Herr", firstName: "Max", lastName: "Handanlage", company: "Hand GmbH", phone: "+49 30 9998877", email: "max@hand-e2e.example", street: "Hauptstr. 1", postcode: "10115", city: "Berlin", website: "www.hand.example", stage: "kontaktiert", dealValue: 1500, note: "Will Rückruf am Dienstag", listName: "Messe-Kontakte" });
    expect(created).toMatchObject({ name: "Max Handanlage", stage: "kontaktiert" }); expect(created.publicId).toMatch(/^KALT-/);
    const board = await owner.leadops.pipelineOverview({ source: "kaltakquise" });
    const card = board.stages.find((stage) => stage.key === "kontaktiert")!.leads.find((lead) => lead.publicId === created.publicId)!;
    expect(card).toBeTruthy(); expect(card.adCampaignName).toBe("Liste: Messe-Kontakte");
    expect((await owner.leadops.listPipelineNotes({ publicId: created.publicId })).map((note) => note.text)).toContain("Will Rückruf am Dienstag");
    expect((await owner.leadops.listColdLists()).some((list) => list.listName === "Messe-Kontakte")).toBe(true);
    await expect(owner.leadops.createPipelineContact({ source: "kaltakquise", firstName: "Doppelt", email: "MAX@hand-e2e.example" })).rejects.toThrow(/gibt es schon/);
    await expect(owner.leadops.createPipelineContact({ source: "email", firstName: "Ohne" })).rejects.toThrow(/Telefon oder E-Mail/);
    const mail = await owner.leadops.createPipelineContact({ source: "email", company: "Nur Firma AG", email: "info@nurfirma-e2e.example" }); expect(mail.publicId).toMatch(/^MAIL-/);
    expect((await owner.leadops.pipelineOverview({ source: "email" })).stages.flatMap((stage) => stage.leads).some((lead) => lead.publicId === mail.publicId)).toBe(true);
  }, 20000);

  it("48. Eigene Pipelines: anlegen, Liste hochladen, Kontakt von Hand, Karten verschieben, umbenennen, löschen (Karten → Kaltakquise)", async () => {
    const created = await owner.leadops.createCustomPipeline({ label: "Messe 2026" }); expect(created.key).toMatch(/^p-[a-z0-9]{2,14}$/);
    await expect(owner.leadops.createCustomPipeline({ label: "messe 2026" })).rejects.toThrow(/gibt es schon/);
    const settings = await owner.leadops.pipelineSettings(); expect(settings.customPipelines).toEqual([{ key: created.key, label: "Messe 2026" }]); expect(settings.sourceOrder).toContain(created.key);
    // normales Speichern der Einstellungen behält die eigene Pipeline
    await owner.leadops.savePipelineSettings({ ...settings, staleDays: settings.staleDays });
    expect((await owner.leadops.pipelineSettings()).customPipelines.map((item) => item.key)).toEqual([created.key]);
    const imported = await owner.leadops.importColdList({ pipeline: created.key, listName: "Messestand Halle 3", rows: [{ firstName: "Mia", lastName: "Messe", phone: "+49 40 7001001", email: "mia@messe-e2e.example" }, { firstName: "Tom", lastName: "Messe", phone: "+49 40 7001002" }] }); expect(imported.created).toBe(2);
    const board = await owner.leadops.pipelineOverview({ source: created.key }); const cards = board.stages.flatMap((stage) => stage.leads); expect(cards).toHaveLength(2);
    expect((await owner.leadops.pipelineOverview({ source: "kaltakquise" })).stages.flatMap((stage) => stage.leads).some((lead) => lead.email === "mia@messe-e2e.example")).toBe(false);
    expect((await owner.leadops.listColdLists({ pipeline: created.key })).map((list) => list.listName)).toEqual(["Messestand Halle 3"]);
    expect((await owner.leadops.listColdLists()).some((list) => list.listName === "Messestand Halle 3")).toBe(true); // für E-Mail-Kampagnen sichtbar
    const hand = await owner.leadops.createPipelineContact({ source: created.key, firstName: "Lea", lastName: "Handmesse", phone: "+49 40 7001003" });
    expect((await owner.leadops.pipelineOverview({ source: created.key })).stages.flatMap((stage) => stage.leads).some((lead) => lead.publicId === hand.publicId)).toBe(true);
    // Stufen nur für diese Pipeline
    const own = [{ key: "neu", label: "Neu", hint: "", fixed: "entry" as const }, { key: "gespraech", label: "Gespräch am Stand", hint: "" }, { key: "kunde", label: "Kunde", hint: "", fixed: "won" as const }, { key: "verloren", label: "Verloren", hint: "", fixed: "lost" as const }];
    await owner.leadops.savePipelineStages({ source: created.key, stages: own });
    expect((await owner.leadops.pipelineStages({ source: created.key })).map((stage) => stage.key)).toEqual(["neu", "gespraech", "kunde", "verloren"]);
    expect((await owner.leadops.pipelineStages({ source: "kaltakquise" })).some((stage) => stage.key === "gespraech")).toBe(false);
    // verschieben: Messe → E-Mail-Kampagne und zurück
    const moved = await owner.leadops.moveLeadsToPipeline({ publicIds: [hand.publicId], target: "email" }); expect(moved).toMatchObject({ moved: 1, label: "E-Mail-Kampagne" });
    expect((await owner.leadops.pipelineOverview({ source: "email" })).stages.flatMap((stage) => stage.leads).some((lead) => lead.publicId === hand.publicId)).toBe(true);
    expect((await owner.leadops.moveLeadsToPipeline({ publicIds: [hand.publicId], target: created.key })).moved).toBe(1);
    await owner.leadops.renameCustomPipeline({ key: created.key, label: "Messe Hamburg" }); expect((await owner.leadops.pipelineSettings()).customPipelines[0].label).toBe("Messe Hamburg");
    const removed = await owner.leadops.deleteCustomPipeline({ key: created.key }); expect(removed.moved).toBe(3);
    expect((await owner.leadops.pipelineSettings()).customPipelines).toEqual([]);
    const ids = new Set([...cards.map((lead) => lead.publicId), hand.publicId]);
    expect((await owner.leadops.pipelineOverview({ source: "kaltakquise" })).stages.flatMap((stage) => stage.leads).filter((lead) => ids.has(lead.publicId))).toHaveLength(3);
  }, 30000);

  it("49. Tracking ganz genau: Personen vs. Mails, Scanner zählen nicht, Klick = geöffnet, Kontakte außerhalb der Zielgruppe entfernen", async () => {
    const outreach = await import("./sales-outreach");
    await owner.leadops.importColdList({ listName: "Tracking-Genau", toPipeline: false, rows: [{ firstName: "Ada", lastName: "Auf", email: "ada@track-genau.example" }, { firstName: "Ben", lastName: "Bot", email: "ben@track-genau.example" }, { firstName: "Cem", lastName: "Klick", email: "cem@track-genau.example" }, { firstName: "Test", lastName: "Kontakt", email: "test@track-genau.example" }] });
    const starter = await owner.leadops.emailCampaignStarter({ kind: "kaltakquise" });
    const campaign = await owner.leadops.saveEmailCampaign({ name: "Tracking genau", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Tracking-Genau" }, tree: starter.tree, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" } } as never);
    expect((await owner.leadops.startEmailCampaign({ id: campaign.id })).added).toBe(4);
    await owner.leadops.runEmailCampaigns();
    const recipients = await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, campaign.id));
    const tokenOf = (email: string) => recipients.find((row) => row.email === email)!.token;
    // „gerade eben gesendet“: Aufruf in den ersten Sekunden ist ein Scanner
    await outreach.trackOpen(db, tokenOf("ada@track-genau.example"), { userAgent: "Mozilla/5.0 (Macintosh)", method: "GET" });
    expect((await owner.leadops.getEmailCampaign({ id: campaign.id })).stats.opened).toBe(0);
    await db.update(emailCampaignRecipients).set({ lastSentAt: new Date(Date.now() - 60_000) }).where(eq(emailCampaignRecipients.campaignId, campaign.id));
    // Scanner / Vorschau / HEAD zählen nicht
    await outreach.trackOpen(db, tokenOf("ben@track-genau.example"), { userAgent: "Mimecast Security Scanner", method: "GET" });
    await outreach.trackOpen(db, tokenOf("ben@track-genau.example"), { userAgent: "", method: "GET" });
    expect(await outreach.trackClick(db, tokenOf("ben@track-genau.example"), "https://tanesco.digital/termin", { userAgent: "Mozilla/5.0", method: "HEAD" })).toBe("https://tanesco.digital/termin");
    // echte Öffnung (auch über Gmail-Bild-Proxy) zählt – zweimal öffnen bleibt eine Öffnung
    await outreach.trackOpen(db, tokenOf("ada@track-genau.example"), { userAgent: "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)", method: "GET" });
    await outreach.trackOpen(db, tokenOf("ada@track-genau.example"), { userAgent: "Mozilla/5.0 (iPhone)", method: "GET" });
    // Klick ohne geladene Bilder: zählt als geklickt UND geöffnet
    await outreach.trackClick(db, tokenOf("cem@track-genau.example"), "https://tanesco.digital/termin", { userAgent: "Mozilla/5.0 (Windows NT 10.0)", method: "GET" });
    let detail = await owner.leadops.getEmailCampaign({ id: campaign.id });
    expect(detail.stats).toMatchObject({ total: 4, sent: 4, opened: 2, clicked: 1, openRate: 50 });
    expect(detail.stats.mails).toEqual({ sent: 4, opened: 2, clicked: 1, replied: 0 });
    // zweite Mail der Serie an Ada, die sie wieder öffnet → 2 Personen, 3 geöffnete Mails
    const ada = recipients.find((row) => row.email === "ada@track-genau.example")!;
    const secondAt = new Date(Date.now() - 30_000);
    // Zeitachse: erste Mail vor 2 Min., geöffnet vor 50 s, zweite Mail vor 30 s
    await db.update(emailCampaignEvents).set({ createdAt: new Date(Date.now() - 120_000) }).where(and(eq(emailCampaignEvents.recipientId, ada.id), eq(emailCampaignEvents.kind, "gesendet")));
    await db.update(emailCampaignEvents).set({ createdAt: new Date(Date.now() - 50_000) }).where(and(eq(emailCampaignEvents.recipientId, ada.id), eq(emailCampaignEvents.kind, "geoeffnet")));
    await db.update(emailCampaignRecipients).set({ openedAt: new Date(Date.now() - 50_000) }).where(eq(emailCampaignRecipients.id, ada.id));
    await db.insert(emailCampaignEvents).values({ tenantId: ada.tenantId, campaignId: campaign.id, recipientId: ada.id, nodeId: null, kind: "gesendet", subject: "Nachfass", note: "E-Mail „Nachfass“ gesendet", createdAt: secondAt });
    await db.update(emailCampaignRecipients).set({ lastSentAt: secondAt, sentCount: 2 }).where(eq(emailCampaignRecipients.id, ada.id));
    await outreach.trackOpen(db, ada.token, { userAgent: "Mozilla/5.0 (iPhone)", method: "GET" });
    detail = await owner.leadops.getEmailCampaign({ id: campaign.id });
    expect(detail.stats.opened).toBe(2); expect(detail.stats.mails).toMatchObject({ sent: 5, opened: 3 });
    const listed = (await owner.leadops.listEmailCampaigns()).find((row) => row.id === campaign.id)!;
    expect(listed.stats.mails).toMatchObject({ sent: 5, opened: 3, clicked: 1 });
    // gleiche Zahl im Ordner „Gesendet“ (je Mail)
    const sentFolder = await owner.leadops.listSent({ kind: "kampagne", campaignId: campaign.id });
    expect(sentFolder.items.filter((item) => item.tracking?.openedAt).length).toBe(3);
    // Testkontakt aus der Liste löschen → „1 nicht mehr in der Liste“ → entfernen → Zahlen stimmen
    const testLead = (await db.select({ id: leads.id }).from(leads).where(eq(leads.email, "test@track-genau.example")))[0];
    await db.update(leads).set({ listName: "Anderswo" }).where(eq(leads.id, testLead.id));
    expect(listed.audienceInfo?.outside ?? 0).toBe(0);
    const before = (await owner.leadops.listEmailCampaigns()).find((row) => row.id === campaign.id)!; expect(before.audienceInfo).toMatchObject({ total: 3, outside: 1 });
    expect(await owner.leadops.pruneEmailCampaignRecipients({ id: campaign.id })).toEqual({ removed: 1 });
    const after = (await owner.leadops.listEmailCampaigns()).find((row) => row.id === campaign.id)!;
    expect(after.stats).toMatchObject({ total: 3, sent: 3, opened: 2, clicked: 1 }); expect(after.audienceInfo).toMatchObject({ outside: 0 }); expect(after.stats.mails.sent).toBe(4);
  }, 30000);

  it("50. Stufenfarben speichern; gelöschte Kontakte verschwinden komplett aus den Kampagnen-Zahlen", async () => {
    const current = await owner.leadops.pipelineStages({ source: "kaltakquise" });
    await owner.leadops.savePipelineStages({ source: "kaltakquise", stages: current.map((stage, index) => (index === 1 ? { ...stage, color: "#FF00AA" } : stage)) });
    const saved = await owner.leadops.pipelineStages({ source: "kaltakquise" }); expect(saved[1].color).toBe("#ff00aa"); expect(saved[0].color).toBeUndefined();
    await expect(owner.leadops.savePipelineStages({ source: "kaltakquise", stages: current.map((stage) => ({ ...stage, color: "rot" })) })).rejects.toThrow();
    await owner.leadops.savePipelineStages({ source: "kaltakquise", stages: current });
    // Kampagne mit 2 Kontakten, beide geöffnet → einen Kontakt löschen → Zahlen nur noch 1
    await owner.leadops.importColdList({ listName: "Weg-ist-weg", toPipeline: false, rows: [{ firstName: "Ina", lastName: "Bleibt", email: "ina@weg-ist-weg.example" }, { firstName: "Udo", lastName: "Geht", email: "udo@weg-ist-weg.example" }] });
    const starter = await owner.leadops.emailCampaignStarter({ kind: "kaltakquise" });
    const campaign = await owner.leadops.saveEmailCampaign({ name: "Weg ist weg", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Weg-ist-weg" }, tree: starter.tree, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" } } as never);
    await owner.leadops.startEmailCampaign({ id: campaign.id }); await owner.leadops.runEmailCampaigns();
    const outreach = await import("./sales-outreach");
    for (const row of await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, campaign.id))) await outreach.trackOpen(db, row.token);
    let listed = (await owner.leadops.listEmailCampaigns()).find((row) => row.id === campaign.id)!; expect(listed.stats).toMatchObject({ total: 2, opened: 2 }); expect(listed.stats.mails.opened).toBe(2);
    const udo = (await db.select({ publicId: leads.publicId }).from(leads).where(eq(leads.email, "udo@weg-ist-weg.example")))[0];
    await owner.leadops.deletePipelineLeads({ publicIds: [udo.publicId] });
    listed = (await owner.leadops.listEmailCampaigns()).find((row) => row.id === campaign.id)!;
    expect(listed.stats).toMatchObject({ total: 1, sent: 1, opened: 1 }); expect(listed.stats.mails).toMatchObject({ sent: 1, opened: 1 });
    const orphan = await db.select().from(emailCampaignEvents).where(eq(emailCampaignEvents.campaignId, campaign.id));
    const recipientIds = new Set((await db.select({ id: emailCampaignRecipients.id }).from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, campaign.id))).map((row) => row.id));
    expect(orphan.every((event) => recipientIds.has(event.recipientId))).toBe(true);
  }, 30000);

  it("51. Antwort von anderer Adresse derselben Firma oder mit „AW:“-Betreff landet beim richtigen Empfänger; Antwort-Adresse = Abhol-Postfach", async () => {
    await owner.leadops.importColdList({ listName: "Antwort-Test", toPipeline: false, rows: [{ firstName: "Karl", lastName: "Koppen", company: "Koppen GmbH", email: "info@koppen-e2e.example" }, { firstName: "Gina", lastName: "Gmail", email: "gina.antwort@gmail.com" }] });
    const starter = await owner.leadops.emailCampaignStarter({ kind: "kaltakquise" });
    const campaign = await owner.leadops.saveEmailCampaign({ name: "Antwort-Test", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Antwort-Test" }, tree: starter.tree, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" } } as never);
    await owner.leadops.startEmailCampaign({ id: campaign.id }); await owner.leadops.runEmailCampaigns();
    const recipients = await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, campaign.id));
    const koppen = recipients.find((row) => row.email === "info@koppen-e2e.example")!; const gina = recipients.find((row) => row.email === "gina.antwort@gmail.com")!;
    const sentSubject = (await db.select().from(emailCampaignEvents).where(and(eq(emailCampaignEvents.recipientId, koppen.id), eq(emailCampaignEvents.kind, "gesendet"))))[0].subject!;
    // Antwort von einer anderen Adresse derselben Firma → Koppen
    const fromColleague = await owner.leadops.storeInboxMessage({ fromEmail: "m.koppen@koppen-e2e.example", subject: "Termin nächste Woche?", bodyText: "Hallo, gerne nächste Woche telefonieren." });
    expect((await db.select().from(inboxMessages).where(eq(inboxMessages.id, fromColleague.id)))[0].campaignRecipientId).toBe(koppen.id);
    expect((await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, koppen.id)))[0].repliedAt).not.toBeNull();
    // Antwort von privater Gmail-Adresse mit „AW:“ auf den Betreff → über den Betreff zugeordnet
    const giSubject = (await db.select().from(emailCampaignEvents).where(and(eq(emailCampaignEvents.recipientId, gina.id), eq(emailCampaignEvents.kind, "gesendet"))))[0].subject!;
    const viaSubject = await owner.leadops.storeInboxMessage({ fromEmail: "gina.privat@gmail.com", subject: `AW: ${giSubject}`, bodyText: "Danke, klingt gut." });
    expect((await db.select().from(inboxMessages).where(eq(inboxMessages.id, viaSubject.id)))[0].campaignRecipientId).toBe(gina.id);
    // fremde Gmail-Adresse ohne passenden Betreff → keine Zuordnung (nicht raten)
    const stranger = await owner.leadops.storeInboxMessage({ fromEmail: "irgendwer@gmail.com", subject: "Hallo", bodyText: "Werbung" });
    expect((await db.select().from(inboxMessages).where(eq(inboxMessages.id, stranger.id)))[0].campaignRecipientId).toBeNull();
    expect(sentSubject.length).toBeGreaterThan(5);
    // Antwort-Adresse: ohne eigene Einstellung → Abhol-Postfach, wenn es vom Absender abweicht
    const { replyToFor, replyRouting } = await import("./mail-settings");
    expect(replyToFor({ replyTo: null, fromEmail: "thomas@privat.example", imapEnabled: true, imapUsername: "antworten@firma.example" })).toBe("antworten@firma.example");
    expect(replyToFor({ replyTo: "x@firma.example", fromEmail: "thomas@privat.example", imapEnabled: true, imapUsername: "antworten@firma.example" })).toBe("x@firma.example");
    expect(replyToFor({ replyTo: null, fromEmail: "antworten@firma.example", imapEnabled: true, imapUsername: "antworten@firma.example" })).toBeUndefined();
    expect(replyRouting({ replyTo: "privat@x.example", fromEmail: "a@firma.example", imapEnabled: true, imapUsername: "a@firma.example" }).ok).toBe(false);
    expect(replyRouting({ replyTo: null, fromEmail: "privat@x.example", imapEnabled: true, imapUsername: "a@firma.example" }).ok).toBe(true);
  }, 30000);

  it("52. Rückgängig & Papierkorb: Anruf erreicht → „In Kontakt“, Anruf/Stufe/Zuteilung/Notiz zurücknehmen, Anruf löschen, Liste löschen und wiederherstellen", async () => {
    // eigene Stufen mit „In Kontakt“ für die Kaltakquise
    const current = await owner.leadops.pipelineStages({ source: "kaltakquise" });
    const own = [{ key: "neu", label: "Neu", hint: "", fixed: "entry" as const }, { key: "angerufen", label: "Angerufen", hint: "" }, { key: "in_kontakt", label: "In Kontakt", hint: "" }, { key: "termin", label: "Termin", hint: "" }, { key: "kunde", label: "Kunde", hint: "", fixed: "won" as const }, { key: "verloren", label: "Verloren", hint: "", fixed: "lost" as const }];
    await owner.leadops.savePipelineStages({ source: "kaltakquise", stages: own });
    const imported = await owner.leadops.importColdList({ listName: "Rückgängig-Test", rows: [{ firstName: "Uwe", lastName: "Undo", phone: "+49 30 9100001", email: "uwe@undo-e2e.example" }, { firstName: "Rita", lastName: "Redo", phone: "+49 30 9100002" }] });
    expect(imported.created).toBe(2);
    const card = async (name: string) => (await owner.leadops.pipelineOverview({ source: "kaltakquise" })).stages.flatMap((stage) => stage.leads.map((lead) => ({ ...lead, stage: stage.key }))).find((lead) => lead.name.includes(name))!;
    const uwe = await card("Uwe");
    // Erreicht → automatisch „In Kontakt“; Rückgängig nimmt Versuch und Stufe zurück
    const call = await owner.leadops.logCallAttempt({ publicId: uwe.publicId, result: "erreicht" });
    expect(call.moved).toBe("in_kontakt"); expect((await card("Uwe")).stage).toBe("in_kontakt"); expect(call.undoId).toBeGreaterThan(0);
    await owner.leadops.undoOperation({ id: call.undoId! });
    expect((await card("Uwe")).stage).toBe("neu"); expect((await owner.leadops.callAttempts({ publicId: uwe.publicId })).count).toBe(0);
    await expect(owner.leadops.undoOperation({ id: call.undoId! })).rejects.toThrow(/schon/);
    // Anruf-Ergebnis löschen (Test) und wiederherstellen
    await owner.leadops.logCallAttempt({ publicId: uwe.publicId, result: "mailbox", move: false });
    const attempt = (await owner.leadops.callAttempts({ publicId: uwe.publicId })).attempts[0];
    const removed = await owner.leadops.deleteCallAttempt({ id: attempt.id }); expect((await owner.leadops.callAttempts({ publicId: uwe.publicId })).count).toBe(0);
    await owner.leadops.undoOperation({ id: removed.undoId }); expect((await owner.leadops.callAttempts({ publicId: uwe.publicId })).count).toBe(1);
    // Stufe von Hand + Zuteilung + Notiz zurücknehmen
    const moved = await owner.leadops.movePipelineStage({ publicId: uwe.publicId, stage: "termin" }); expect((await card("Uwe")).stage).toBe("termin");
    await owner.leadops.undoOperation({ id: moved.undoId }); expect((await card("Uwe")).stage).toBe("neu");
    const me = (await owner.leadops.pipelineOwners())[0];
    const assigned = await owner.leadops.assignPipelineOwner({ publicIds: [uwe.publicId], ownerUserId: me.userId }); expect((await card("Uwe")).ownerUserId).toBe(me.userId);
    await owner.leadops.undoOperation({ id: assigned.undoId }); expect((await card("Uwe")).ownerUserId ?? null).toBe(uwe.ownerUserId ?? null);
    const note = await owner.leadops.addPipelineNote({ publicId: uwe.publicId, text: "Nur ein Test" });
    await owner.leadops.undoOperation({ id: note.undoId }); expect((await owner.leadops.listPipelineNotes({ publicId: uwe.publicId })).some((item: { text: string }) => item.text === "Nur ein Test")).toBe(false);
    // Liste löschen → Papierkorb → wiederherstellen (mit Anrufen und Verlauf)
    const gone = await owner.leadops.deleteColdList({ listName: "Rückgängig-Test" }); expect(gone.deleted).toBe(2);
    expect(await card("Uwe")).toBeUndefined();
    const trash = (await owner.leadops.listUndo({ kind: "loeschen" })).find((row) => row.id === gone.undoId)!; expect(trash.title).toContain("Rückgängig-Test");
    const restored = await owner.leadops.undoOperation({ id: gone.undoId }); expect(restored.message).toMatch(/2 Kontakte wiederhergestellt/);
    const back = await card("Uwe"); expect(back.publicId).toBe(uwe.publicId); expect((await owner.leadops.callAttempts({ publicId: uwe.publicId })).count).toBe(1);
    expect((await owner.leadops.listColdLists()).some((list) => list.listName === "Rückgängig-Test")).toBe(true);
    // einzelne Karte löschen → wiederherstellen
    const single = await owner.leadops.deletePipelineLead({ publicId: uwe.publicId }); expect(await card("Uwe")).toBeUndefined();
    await owner.leadops.undoOperation({ id: single.undoId }); expect((await card("Uwe")).publicId).toBe(uwe.publicId);
    await owner.leadops.savePipelineStages({ source: "kaltakquise", stages: current });
  }, 40000);

  it("53. Kontakt von Hand aus dem E-Mail-Funnel nehmen – Serie stoppt, Verlauf bleibt, Rückgängig holt ihn zurück", async () => {
    await owner.leadops.importColdList({ listName: "Funnel-Stopp", toPipeline: false, rows: [{ firstName: "Fritz", lastName: "Funnel", email: "fritz@funnel-e2e.example" }, { firstName: "Berta", lastName: "Bleibt", email: "berta@funnel-e2e.example" }] });
    const starter = await owner.leadops.emailCampaignStarter({ kind: "kaltakquise" });
    const campaign = await owner.leadops.saveEmailCampaign({ name: "Funnel-Stopp", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Funnel-Stopp" }, tree: starter.tree, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" } } as never);
    await owner.leadops.startEmailCampaign({ id: campaign.id }); await owner.leadops.runEmailCampaigns();
    const fritz = (await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.campaignId, campaign.id), eq(emailCampaignRecipients.email, "fritz@funnel-e2e.example"))))[0];
    expect(["wartet", "laeuft"]).toContain(fritz.status);
    const stopped = await owner.leadops.stopLeadsInCampaigns({ leadIds: [fritz.leadId!] }); expect(stopped.stopped).toBe(1);
    const after = (await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, fritz.id)))[0]; expect(after.status).toBe("fertig"); expect(after.nextActionAt).toBeNull();
    expect((await owner.leadops.getEmailCampaign({ id: campaign.id })).stats.sent).toBe(2); // Zahlen bleiben
    const info = (await owner.leadops.listEmailCampaigns()).find((row) => row.id === campaign.id)!; expect(info.audienceInfo?.pending ?? 0).toBe(0); // wird nicht wieder aufgenommen
    await owner.leadops.undoOperation({ id: stopped.undoId }); expect((await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, fritz.id)))[0].status).toBe(fritz.status);
    const single = await owner.leadops.stopRecipientInCampaign({ recipientId: fritz.id }); expect(single.stopped).toBe(1);
    await expect(owner.leadops.stopRecipientInCampaign({ recipientId: fritz.id })).rejects.toThrow(/keiner laufenden/);
  }, 30000);

  it("54. Erst-E-Mail einzeln freigeben: nichts geht ohne Freigabe raus, Entwurf (Vorlage) wird persönlich, freigegebener Text wird gesendet; Tageslimit für alle Kampagnen zusammen", async () => {
    await owner.leadops.importColdList({ listName: "Freigabe-Test", toPipeline: false, rows: [{ firstName: "Rita", lastName: "Review", company: "Review Dach GmbH", city: "Kassel", email: "rita@review-e2e.example" }, { firstName: "Olaf", lastName: "Offen", company: "Offen Solar", email: "olaf@offen-e2e.example" }] });
    const starter = await owner.leadops.emailCampaignStarter({ kind: "kaltakquise" });
    const campaign = await owner.leadops.saveEmailCampaign({ name: "Freigabe-Test", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Freigabe-Test" }, tree: starter.tree, design: {}, reviewFirst: true, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" } } as never);
    expect((await owner.leadops.getEmailCampaign({ id: campaign.id })).reviewFirst).toBe(true);
    await owner.leadops.startEmailCampaign({ id: campaign.id }); await owner.leadops.runEmailCampaigns();
    const recipients = await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, campaign.id));
    expect(recipients.every((row) => row.sentCount === 0)).toBe(true); // ohne Freigabe geht nichts raus
    const list = (await owner.leadops.listEmailCampaigns()).find((row) => row.id === campaign.id)!; expect(list.review).toEqual({ zurFreigabe: 2, freigegeben: 0 });
    const queue = await owner.leadops.campaignReviewQueue({ campaignId: campaign.id }); expect(queue.counts).toEqual({ offen: 0, entwurf: 2, freigegeben: 0 }); // der Versand-Lauf hat die Entwürfe schon geschrieben (Vorlage, ohne KI-Schlüssel) und wartet auf Freigabe
    const rita = queue.items.find((item) => item.email === "rita@review-e2e.example")!; expect(rita.city).toBe("Kassel");
    const drafts = await owner.leadops.generateCampaignDrafts({ campaignId: campaign.id, recipientIds: [rita.id] }); // ohne KI-Schlüssel: Vorlage mit den Daten des Kontakts
    expect(drafts.drafts).toHaveLength(1); expect(drafts.drafts[0].subject).toContain("Review Dach GmbH"); expect(drafts.drafts[0].text).not.toContain("{{"); expect(drafts.drafts[0].text).not.toMatch(/ {2}/); expect(drafts.drafts[0].text).toMatch(/^Sehr geehrte Damen und Herren,/); /* ohne bekannte Anrede nie „Guten Tag Rita Review“ */ expect(drafts.drafts[0].options.map((option) => option.key)).toEqual(["individuell", "drittanbieter"]); expect(drafts.drafts[0].options[1].text).toContain("Drittpartner bei Review Dach GmbH"); expect(drafts.drafts[0].options[1].text).toContain("Zwischenhändler"); expect(drafts.drafts[0].options[1].text).toContain("direkte Zusammenarbeit"); // Kernbotschaft Drittanbieter-Ansatz
    expect((await owner.leadops.campaignReviewQueue({ campaignId: campaign.id })).counts).toEqual({ offen: 0, entwurf: 2, freigegeben: 0 });
    await owner.leadops.saveCampaignDraft({ recipientId: rita.id, subject: "Persönlich für Review Dach", text: "Guten Tag Frau Review,\n\nIhr Betrieb in Kassel ist uns aufgefallen. Kurz telefonieren?\n\nViele Grüße", approve: false });
    await owner.leadops.runEmailCampaigns(); expect((await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, rita.id)))[0].sentCount).toBe(0); // gespeichert ≠ freigegeben
    await owner.leadops.saveCampaignDraft({ recipientId: rita.id, subject: "Persönlich für Review Dach", text: "Guten Tag Frau Review,\n\nIhr Betrieb in Kassel ist uns aufgefallen. Kurz telefonieren?\n\nViele Grüße", approve: true, approach: "drittanbieter" }); expect((await owner.leadops.campaignReviewQueue({ campaignId: campaign.id })).items.find((item) => item.id === rita.id)?.draftApproach).toBe("drittanbieter");
    await owner.leadops.runEmailCampaigns();
    const ritaRow = (await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, rita.id)))[0]; expect(ritaRow.sentCount).toBe(1);
    const sentEvent = (await db.select().from(emailCampaignEvents).where(and(eq(emailCampaignEvents.recipientId, rita.id), eq(emailCampaignEvents.kind, "gesendet"))))[0]; expect(sentEvent.subject).toBe("Persönlich für Review Dach");
    const olaf = recipients.find((row) => row.email === "olaf@offen-e2e.example")!; expect((await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, olaf.id)))[0].sentCount).toBe(0);
    await expect(owner.leadops.saveCampaignDraft({ recipientId: rita.id, subject: "x", text: "schon raus", approve: true })).rejects.toThrow(/schon raus/);
    // Tageslimit (alle Kampagnen zusammen): heute wurden schon viele gesendet → mit Limit 1 geht Olaf nicht mehr raus
    delete process.env.EMAIL_THROTTLE_OFF;
    try {
      await owner.leadops.setCampaignDailyLimit({ limit: 1 }); const status = await owner.leadops.campaignDailyStatus(); expect(status.limit).toBe(1); expect(status.left).toBe(0);
      await owner.leadops.saveCampaignDraft({ recipientId: olaf.id, subject: "Für Offen Solar", text: "Guten Tag Herr Offen, kurze Frage zu Ihrem Bedarf.", approve: true });
      await owner.leadops.runEmailCampaigns(); expect((await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, olaf.id)))[0].sentCount).toBe(0);
      await owner.leadops.setCampaignDailyLimit({ limit: 2000 }); expect((await owner.leadops.campaignDailyStatus()).left).toBeGreaterThan(0);
    } finally { process.env.EMAIL_THROTTLE_OFF = "1"; }
    await owner.leadops.runEmailCampaigns(); expect((await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, olaf.id)))[0].sentCount).toBe(1);
    expect((await owner.leadops.saveMailSettings({ provider: "smtp", campaignDailyLimit: 50 } as never)).success).toBe(true); expect((await owner.leadops.campaignDailyStatus()).limit).toBe(50);
  }, 40000);

  it("55. Antworten sicher zuordnen: über die Message-ID der gesendeten Mail (In-Reply-To), über „Antworten an“ und über die Firmen-Domain mit Unter-Domain", async () => {
    await owner.leadops.importColdList({ listName: "Zuordnung-Test", toPipeline: false, rows: [{ firstName: "Zoe", lastName: "Zuordnung", company: "Zuordnung Energie GmbH", email: "info@zuordnung-e2e.example" }] });
    const starter = await owner.leadops.emailCampaignStarter({ kind: "kaltakquise" });
    const campaign = await owner.leadops.saveEmailCampaign({ name: "Zuordnung-Test", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Zuordnung-Test" }, tree: starter.tree, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" } } as never);
    await owner.leadops.startEmailCampaign({ id: campaign.id }); await owner.leadops.runEmailCampaigns();
    const zoe = (await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, campaign.id)))[0];
    await db.update(emailCampaignEvents).set({ messageId: "abc123@tanesco-test.example" }).where(and(eq(emailCampaignEvents.recipientId, zoe.id), eq(emailCampaignEvents.kind, "gesendet"))); // simulierter Versand hat keine Message-ID – hier nachgetragen
    // 1. ganz andere Adresse und anderer Betreff, aber In-Reply-To passt → Zoe
    const viaReference = await owner.leadops.storeInboxMessage({ fromEmail: "chef@ganz-andere-firma.example", subject: "Rückruf", bodyText: "Bitte um Rückruf.", references: ["<ABC123@tanesco-test.example>"] });
    expect((await db.select().from(inboxMessages).where(eq(inboxMessages.id, viaReference.id)))[0].campaignRecipientId).toBe(zoe.id);
    // 2. Absender ist ein Ticketsystem, „Antworten an“ ist die Firmenadresse → Zoe
    const viaReplyTo = await owner.leadops.storeInboxMessage({ fromEmail: "noreply@ticketsystem.example", subject: "Ticket #4711", bodyText: "Wir melden uns.", replyAddresses: ["info@zuordnung-e2e.example"] });
    expect((await db.select().from(inboxMessages).where(eq(inboxMessages.id, viaReplyTo.id)))[0].campaignRecipientId).toBe(zoe.id);
    // 3. Unter-Domain derselben Firma → Zoe
    const viaSubdomain = await owner.leadops.storeInboxMessage({ fromEmail: "hallo@mail.zuordnung-e2e.example", subject: "Interesse", bodyText: "Klingt interessant." });
    expect((await db.select().from(inboxMessages).where(eq(inboxMessages.id, viaSubdomain.id)))[0].campaignRecipientId).toBe(zoe.id);
    const { rootDomain, companySlug } = await import("./inbox");
    expect(rootDomain("mail.firma.de")).toBe("firma.de"); expect(rootDomain("firma.co.uk")).toBe("firma.co.uk"); expect(rootDomain("a.b.firma.com")).toBe("firma.com");
    expect(companySlug("Koppen GmbH & Co. KG")).toBe("koppen"); expect(companySlug("Thüga Energie")).toBe("thuegaenergie"); expect(companySlug("AB GmbH")).toBeNull();
  }, 30000);

  it("56. Kontakt sperren (Lead-Seite / Kontakte): Sperrliste „Manuell“ mit Grund, laufende Serie stoppt, Vermerk im Verlauf, Kontakte zeigen „Gesperrt“ – Sperre aufheben", async () => {
    await owner.leadops.importColdList({ listName: "Sperr-Test", toPipeline: true, rows: [{ firstName: "Sven", lastName: "Sperr", company: "Sperr Solar", email: "sven@sperr-e2e.example" }, { firstName: "Ohne", lastName: "Mail", company: "Ohne Mail GmbH", phone: "+49 30 5550999" }] });
    const starter = await owner.leadops.emailCampaignStarter({ kind: "kaltakquise" });
    const campaign = await owner.leadops.saveEmailCampaign({ name: "Sperr-Test", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Sperr-Test" }, tree: starter.tree, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" } } as never);
    await owner.leadops.startEmailCampaign({ id: campaign.id }); await owner.leadops.runEmailCampaigns();
    const before = (await owner.leadops.emailLeads({ listName: "Sperr-Test", source: "kaltakquise", inPipeline: true, withoutEmail: true })).items; const sven = before.find((row) => row.email === "sven@sperr-e2e.example")!; const ohne = before.find((row) => row.company === "Ohne Mail GmbH")!;
    expect(sven.blocked).toBe(false);
    const result = await owner.leadops.blockLeads({ leadIds: [sven.id, ohne.id], note: "Will keine Werbung", source: "Vertriebspipeline" });
    expect(result).toMatchObject({ blocked: 1, skipped: 1, stopped: 1 });
    const entry = (await owner.leadops.listEmailSuppressions()).items.find((row) => row.email === "sven@sperr-e2e.example")!; expect(entry.reason).toBe("manuell"); expect(entry.note).toBe("Will keine Werbung"); expect(entry.source).toBe("Vertriebspipeline");
    expect((await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.campaignId, campaign.id), eq(emailCampaignRecipients.email, "sven@sperr-e2e.example"))))[0].status).toBe("abgemeldet");
    const detail = await owner.leadops.pipelineLeadDetail({ publicId: sven.publicId }); expect(detail.suppression).toMatchObject({ reason: "manuell", note: "Will keine Werbung" }); expect(detail.history.some((row) => /gesperrt/i.test(row.note ?? ""))).toBe(true);
    const after = (await owner.leadops.emailLeads({ listName: "Sperr-Test", source: "kaltakquise", inPipeline: true, withoutEmail: true, blocked: true })); expect(after.items.map((row) => row.id)).toEqual([sven.id]); expect(after.blocked).toBeGreaterThanOrEqual(1); expect(after.items[0].blockedReason).toBe("Von Hand gesperrt");
    // gesperrt → ein neuer Durchlauf nimmt ihn nicht mehr auf
    await owner.leadops.saveEmailCampaign({ id: campaign.id, name: "Sperr-Test", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Sperr-Test" }, tree: starter.tree, design: {}, maxRuns: 0 } as never);
    await expect(owner.leadops.startEmailCampaign({ id: campaign.id })).rejects.toThrow(/keine Kontakte/); // der einzige Kontakt mit E-Mail ist gesperrt
    expect((await owner.leadops.unblockLeads({ leadIds: [sven.id, ohne.id] })).unblocked).toBe(1);
    expect((await owner.leadops.pipelineLeadDetail({ publicId: sven.publicId })).suppression).toBeNull();
    expect((await owner.leadops.emailLeads({ listName: "Sperr-Test", source: "kaltakquise", inPipeline: true, withoutEmail: true, blocked: true })).items).toHaveLength(0);
  }, 30000);

  it("57. Posteingang: mehrere Mails auf einmal – ungelesen, archivieren, Absender sperren, löschen (kommen nicht wieder)", async () => {
    const made = [] as number[]; for (const [i, from] of ["bulk1@bulk-e2e.example", "bulk2@bulk-e2e.example", "bulk3@bulk-e2e.example"].entries()) made.push((await owner.leadops.storeInboxMessage({ fromEmail: from, subject: `Test ${i}`, bodyText: "Hallo" })).id);
    expect((await owner.leadops.inboxBulkAction({ ids: made, action: "gelesen" })).count).toBe(3);
    await owner.leadops.replyInboxMessage({ messageId: made[2], text: "Danke für Ihre Nachricht." }); const answered = await owner.leadops.listInbox({ filter: "geantwortet" }); expect(answered.items.some((item) => item.id === made[2] && item.answeredAt)).toBe(true); expect(answered.items.some((item) => item.id === made[0])).toBe(false); expect(answered.counts.geantwortet).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(inboxMessages).where(eq(inboxMessages.id, made[0])))[0].isRead).toBe(true);
    expect((await owner.leadops.inboxBulkAction({ ids: [made[0]], action: "archivieren" })).count).toBe(1);
    expect((await owner.leadops.inboxBulkAction({ ids: [made[1], made[1]], action: "sperren" })).count).toBe(1);
    expect((await owner.leadops.listEmailSuppressions()).items.some((row) => row.email === "bulk2@bulk-e2e.example")).toBe(true);
    // Mehrfachauswahl → als Leads in die Pipeline: neue Absender werden angelegt, gesperrte übersprungen, zweiter Lauf setzt nur die Stufe
    const toLead = [] as number[]; for (const from of ["neu1@bulk-e2e.example", "neu2@bulk-e2e.example"]) toLead.push((await owner.leadops.storeInboxMessage({ fromEmail: from, fromName: "Nina Neu", subject: "Interesse", bodyText: "Bitte Infos" })).id);
    const madeLeads = await owner.leadops.createLeadsFromInbox({ messageIds: [...toLead, made[1]], pipeline: "email", stage: "kontaktiert" });
    expect(madeLeads.created).toBe(2); expect(madeLeads.skipped).toBe(1); // bulk2 ist gesperrt
    const again = await owner.leadops.createLeadsFromInbox({ messageIds: toLead, pipeline: "email", stage: "termin" });
    expect(again.created).toBe(0); expect(again.updated).toBe(2); // schon da → nur Stufe
    const neuLead = (await db.select().from(leads).where(and(eq(leads.email, "neu1@bulk-e2e.example"), eq(leads.kind, "vertrieb"))))[0]; expect(neuLead?.pipelineStage).toBe("termin"); expect(neuLead?.lastName).toBe("Neu");
    expect((await owner.leadops.inboxBulkAction({ ids: made, action: "loeschen" })).count).toBe(3);
    expect(await db.select().from(inboxMessages).where(inArray(inboxMessages.id, made))).toHaveLength(0);
  }, 30000);
  it("58. Wartezeit: Leads stehen am Warten-Schritt, Ablaufänderungen gelten für Wartende, alte Einträge rücken nach, keine E-Mail doppelt", async () => {
    const { repairWaitingRecipients } = await import("./sales-outreach"); const { starterBlocks } = await import("../shared/email-design");
    await owner.leadops.importColdList({ listName: "Warte-Test", toPipeline: false, rows: [{ firstName: "Wanda", lastName: "Wartet", company: "Wartet Dach", email: "wanda@warte-e2e.example" }, { firstName: "Alt", lastName: "Eintrag", company: "Alt Solar", email: "alt@warte-e2e.example" }, { firstName: "Doro", lastName: "Doppelt", company: "Doppelt Bau", email: "doro@warte-e2e.example" }] });
    // Ablauf beim Start: Erste → 1 Std. warten → Ende
    const before = { start: "m1", nodes: [{ id: "m1", type: "send" as const, label: "Erste", subject: "Erste an {{vorname}}", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait" as const, hours: 1, next: "e1" }, { id: "e1", type: "end" as const, label: "Ende" }] };
    const starter = await owner.leadops.emailCampaignStarter();
    const campaign = await owner.leadops.saveEmailCampaign({ name: "Warte-Test", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Warte-Test" }, tree: before, design: starter.design as unknown as Record<string, unknown>, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" } } as never);
    expect((await owner.leadops.startEmailCampaign({ id: campaign.id })).added).toBe(3); await owner.leadops.runEmailCampaigns();
    const rows = async () => db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, campaign.id));
    expect((await rows()).every((row) => row.sentCount === 1 && row.status === "wartet" && row.nodeId === "w1")).toBe(true); // alle warten AM Warten-Schritt
    const detail = await owner.leadops.getEmailCampaign({ id: campaign.id }); expect(detail.recipients.every((row) => row.nodeId === "w1")).toBe(true);
    const wanda = (await rows()).find((row) => row.email === "wanda@warte-e2e.example")!; const alt = (await rows()).find((row) => row.email === "alt@warte-e2e.example")!; const doro = (await rows()).find((row) => row.email === "doro@warte-e2e.example")!;
    const wandaLog = await owner.leadops.emailRecipientLog({ recipientId: wanda.id }); expect(wandaLog.currentStep?.id).toBe("w1"); expect(wandaLog.steps.map((step) => step.state)).toEqual(["erledigt", "aktuell", "offen"]);
    // Alter Eintrag (vor dieser Logik): stand schon am Schritt NACH dem Warten – hier am Ende → nach dem Serverstart rückt er auf den Warten-Schritt
    await db.update(emailCampaignRecipients).set({ nodeId: "e1" }).where(eq(emailCampaignRecipients.id, alt.id));
    expect(await repairWaitingRecipients(db)).toBeGreaterThanOrEqual(1); expect((await rows()).find((row) => row.id === alt.id)?.nodeId).toBe("w1"); expect(await repairWaitingRecipients(db)).toBe(0); // zweiter Lauf: nichts mehr zu tun
    // Während alle warten, wird hinter dem Warten eine „Kurze Nachfrage“ eingefügt → nach der Wartezeit bekommen sie die Nachfrage statt direkt ans Ende zu springen
    const after = { start: "m1", nodes: [before.nodes[0], { id: "w1", type: "wait" as const, hours: 1, next: "m2" }, { id: "m2", type: "send" as const, label: "Kurze Nachfrage", subject: "Kurze Nachfrage", blocks: starterBlocks("nachfassen"), next: "e1" }, before.nodes[2]] };
    await owner.leadops.saveEmailCampaign({ id: campaign.id, name: "Warte-Test", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Warte-Test" }, tree: after, design: starter.design as unknown as Record<string, unknown>, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" } } as never);
    await owner.leadops.runEmailCampaigns(); expect((await rows()).every((row) => row.sentCount === 1)).toBe(true); // Wartezeit läuft noch
    await db.update(emailCampaignRecipients).set({ nextActionAt: new Date(Date.now() - 60_000) }).where(inArray(emailCampaignRecipients.id, [wanda.id, alt.id])); // Wartezeit um (Wanda neu, Alt nachgerückt)
    await owner.leadops.runEmailCampaigns();
    for (const id of [wanda.id, alt.id]) { const row = (await rows()).find((item) => item.id === id)!; expect(row.sentCount).toBe(2); expect(row.status).toBe("fertig"); const events = await db.select().from(emailCampaignEvents).where(eq(emailCampaignEvents.recipientId, id)); expect(events.filter((event) => event.kind === "gesendet").map((event) => event.nodeId)).toEqual(["m1", "m2"]); }
    expect((await rows()).find((row) => row.id === doro.id)?.sentCount).toBe(1); // Doro wartet noch
    // Doppelversand-Schutz: Doro steht (z. B. nach einem Umbau) wieder vor der Ersten – die hat sie laut Verlauf schon → übersprungen, es geht mit der Nachfrage weiter
    await db.update(emailCampaignRecipients).set({ nodeId: "m1", status: "laeuft", nextActionAt: null }).where(eq(emailCampaignRecipients.id, doro.id));
    await owner.leadops.runEmailCampaigns();
    const doroWaits = (await rows()).find((row) => row.id === doro.id)!; expect(doroWaits.sentCount).toBe(1); expect(doroWaits).toMatchObject({ status: "wartet", nodeId: "w1" }); // Erste übersprungen, Wartezeit beginnt neu
    await db.update(emailCampaignRecipients).set({ nextActionAt: new Date(Date.now() - 60_000) }).where(eq(emailCampaignRecipients.id, doro.id)); await owner.leadops.runEmailCampaigns();
    const doroRow = (await rows()).find((row) => row.id === doro.id)!; expect(doroRow.sentCount).toBe(2); expect(doroRow.status).toBe("fertig");
    const doroEvents = await db.select().from(emailCampaignEvents).where(eq(emailCampaignEvents.recipientId, doro.id)).orderBy(asc(emailCampaignEvents.id));
    expect(doroEvents.filter((event) => event.kind === "gesendet").map((event) => event.nodeId)).toEqual(["m1", "m2"]); expect(doroEvents.some((event) => event.kind === "verzweigt" && /^Übersprungen/.test(event.note ?? ""))).toBe(true);
    const doroLog = await owner.leadops.emailRecipientLog({ recipientId: doro.id }); expect(doroLog.events.map((event) => event.label)).toContain("E-Mail übersprungen (schon gesendet)");
  }, 40000);
  it("59. KI-Versand je Schritt: Freigabe für JEDE E-Mail (auch Nachfass), Ansatz der Kampagne, gesendeter Text gespeichert, nie still die Vorlage", async () => {
    const { starterBlocks } = await import("../shared/email-design");
    await owner.leadops.importColdList({ listName: "KI-Test", toPipeline: false, rows: [{ firstName: "Kim", lastName: "Kette", company: "Kette Klima", city: "Mainz", email: "kim@ki-e2e.example" }] });
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send" as const, label: "Erste", subject: "Erste an {{firma}}", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait" as const, hours: 1, next: "m2" }, { id: "m2", type: "send" as const, label: "Kurze Nachfrage", subject: "Nachfrage {{firma}}", blocks: starterBlocks("nachfassen"), next: null }] };
    const starter = await owner.leadops.emailCampaignStarter();
    const campaign = await owner.leadops.saveEmailCampaign({ name: "KI-Test", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "KI-Test" }, tree, design: starter.design as unknown as Record<string, unknown>, kiModus: "freigabe", kiAnsatz: "drittanbieter", sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" } } as never);
    expect((await owner.leadops.getEmailCampaign({ id: campaign.id })).reviewFirst).toBe(true); // Freigabe-Modus zählt wie „Erst-E-Mail einzeln freigeben“
    await owner.leadops.startEmailCampaign({ id: campaign.id }); await owner.leadops.runEmailCampaigns();
    const row = async () => (await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, campaign.id)))[0];
    let kim = await row(); expect(kim.sentCount).toBe(0); expect(kim.draftState).toBe("entwurf"); expect(kim.draftNodeId).toBe("m1"); expect(kim.draftApproach).toBe("drittanbieter"); expect(kim.draftText).toContain("Zwischenhändler"); // Ansatz der Kampagne, ohne KI-Schlüssel aus der festen Vorlage
    const queue1 = await owner.leadops.campaignReviewQueue({ campaignId: campaign.id }); expect(queue1.items[0].nodeLabel).toBe("Erste"); expect(queue1.items[0].followUp).toBe(false);
    // Entwurf-Regeln (auch ohne KI): förmliche Anrede, Pflichtinhalte, Schluss mit Kontaktweg und „Vielen Dank“, kein Gruß
    expect(kim.draftText).toMatch(/^Sehr geehrte/); expect(kim.draftText).not.toMatch(/^(Hallo|Guten Tag)/); expect(kim.draftText).toContain("20 Test-Leads"); expect(kim.draftText).toContain("zehn Fragen"); expect(kim.draftText).toContain("antworten Sie einfach auf diese E-Mail"); expect(kim.draftText!.trim().endsWith("Vielen Dank")).toBe(true); expect(kim.draftText).not.toMatch(/Grüßen/);
    // „Alle neu schreiben“: verwirft die Entwürfe, die KI/Vorlage schreibt sie beim nächsten Lauf neu
    expect((await owner.leadops.resetCampaignDrafts({ campaignId: campaign.id })).reset).toBeGreaterThanOrEqual(1);
    expect((await row()).draftState).toBeNull(); expect((await row()).draftText).toBeNull();
    await owner.leadops.generateCampaignDrafts({ campaignId: campaign.id, limit: 5 }); kim = await row(); expect(kim.draftState).toBe("entwurf"); expect(kim.draftNodeId).toBe("m1");
    // „Alle freigeben“ / „Alle wieder prüfen“
    // Ohne KI-Schlüssel ist der Entwurf nur Ersatz aus der Vorlage → „Alle freigeben“ lässt ihn aus (nie still die Vorlage)
    const all = await owner.leadops.approveAllCampaignDrafts({ campaignId: campaign.id, approve: true }); expect(all).toMatchObject({ approved: 0, templateOnly: 1 });
    expect((await row()).draftState).toBe("entwurf");
    kim = await row(); await owner.leadops.saveCampaignDraft({ recipientId: kim.id, subject: kim.draftSubject!, text: kim.draftText!, approve: true }); // bewusst einzeln freigegeben
    expect((await row()).draftState).toBe("freigegeben"); expect((await row()).draftSource).toBe("vorlage"); // unverändert → bleibt „Ersatz aus Vorlage“
    const back = await owner.leadops.approveAllCampaignDrafts({ campaignId: campaign.id, approve: false }); expect((back as { reverted: number }).reverted).toBeGreaterThanOrEqual(1);
    expect((await row()).draftState).toBe("entwurf");
    await owner.leadops.saveCampaignDraft({ recipientId: kim.id, subject: "Persönlich 1 für Kette Klima", text: "Guten Tag Frau Kette,\n\npersönliche erste Mail.", approve: true });
    await owner.leadops.runEmailCampaigns(); kim = await row();
    expect(kim.sentCount).toBe(1); expect(kim.nodeId).toBe("w1"); expect(kim.draftState).toBeNull(); expect(kim.draftNodeId).toBeNull(); // Entwurf verbraucht – nächster Schritt bekommt einen frischen
    // Wartezeit um → Nachfass-Mail braucht WIEDER eine Freigabe
    await db.update(emailCampaignRecipients).set({ nextActionAt: new Date(Date.now() - 60_000) }).where(eq(emailCampaignRecipients.id, kim.id));
    await owner.leadops.runEmailCampaigns(); kim = await row();
    expect(kim.sentCount).toBe(1); expect(kim.nodeId).toBe("m2"); expect(kim.draftState).toBe("entwurf"); expect(kim.draftNodeId).toBe("m2"); // wartet an der Nachfass-Mail auf Freigabe
    const queue2 = await owner.leadops.campaignReviewQueue({ campaignId: campaign.id }); expect(queue2.items[0].nodeLabel).toBe("Kurze Nachfrage"); expect(queue2.items[0].followUp).toBe(true);
    await owner.leadops.runEmailCampaigns(); expect((await row()).sentCount).toBe(1); // ohne Freigabe geht weiterhin nichts raus
    await owner.leadops.saveCampaignDraft({ recipientId: kim.id, subject: "Persönlich 2 – kurze Nachfrage", text: "Guten Tag Frau Kette,\n\nkurze Nachfrage zur ersten Mail.", approve: true });
    await owner.leadops.runEmailCampaigns(); kim = await row();
    expect(kim.sentCount).toBe(2); expect(kim.status).toBe("fertig");
    const sent = await db.select().from(emailCampaignEvents).where(and(eq(emailCampaignEvents.recipientId, kim.id), eq(emailCampaignEvents.kind, "gesendet"))).orderBy(asc(emailCampaignEvents.id));
    expect(sent.map((event) => event.subject)).toEqual(["Persönlich 1 für Kette Klima", "Persönlich 2 – kurze Nachfrage"]); // beide Schritte mit dem freigegebenen, persönlichen Text
    // Gesendet: der echte Text ist gespeichert und wird so angezeigt – nicht die Vorlage
    expect(sent.map((event) => event.bodySource)).toEqual(["hand", "hand"]); expect(sent[0].body).toContain("persönliche erste Mail");
    const preview = await owner.leadops.sentMailPreview({ id: `k${sent[0].id}` }); expect(preview.html).toContain("persönliche erste Mail"); expect(preview).toMatchObject({ source: "hand", exact: true });
    const sentList = await owner.leadops.listSent({ campaignId: campaign.id }); expect(sentList.items.map((item) => item.origin?.source)).toEqual(["hand", "hand"]); expect(sentList.origins.hand).toBe(2);
    // Auto-Modus ohne KI-Schlüssel: es geht NICHTS raus (keine Vorlage als stiller Ersatz) – der Kontakt wartet
    await owner.leadops.importColdList({ listName: "KI-Auto", toPipeline: false, rows: [{ firstName: "Udo", lastName: "Auto", company: "Auto Solar", email: "udo@ki-auto-e2e.example" }] });
    const auto = await owner.leadops.saveEmailCampaign({ name: "KI-Auto", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "KI-Auto" }, tree: { start: "a1", nodes: [{ id: "a1", type: "send" as const, label: "Erste", subject: "Hallo {{firma}}", blocks: starterBlocks("kaltakquise"), next: null }] }, design: starter.design as unknown as Record<string, unknown>, kiModus: "auto", kiAnsatz: "individuell", sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" } } as never);
    expect((await owner.leadops.getEmailCampaign({ id: auto.id })).reviewFirst).toBe(false);
    await owner.leadops.startEmailCampaign({ id: auto.id }); await owner.leadops.runEmailCampaigns();
    const udo = (await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, auto.id)))[0];
    expect(udo.sentCount).toBe(0); expect(udo.status).toBe("wartet");
    expect((await db.select().from(emailCampaignEvents).where(and(eq(emailCampaignEvents.recipientId, udo.id), eq(emailCampaignEvents.kind, "gesendet"))))).toHaveLength(0);
  }, 40000);
  it("60. Zustellbarkeit: Absender-Adressen mit Verteilung und eigenem Limit, Warmlauf-Limit, Wochenbericht, KI-Antwortvorschlag (Vorlage), Listen-Anreicherung", async () => {
    const health = await import("./mail-health"); const { starterBlocks } = await import("../shared/email-design");
    // Absender-Adressen: anlegen, verteilen (fest je Kontakt), Budget je Adresse, am Ereignis vermerkt
    await owner.leadops.saveMailSettings({ provider: "smtp", fromEmail: "vertrieb@tanesco-test.example", fromName: "Tanesco" } as never);
    const sender = await owner.leadops.saveMailSender({ fromEmail: "zweite@tanesco-zwei.example", fromName: "Tanesco Zwei", dailyLimit: 2 });
    expect(sender.id).toBeGreaterThan(0);
    const listed = await owner.leadops.listMailSenders(); expect(listed.main?.fromEmail).toBe("vertrieb@tanesco-test.example"); expect(listed.senders).toHaveLength(1);
    const pool = await health.senderPoolFor(db, S.tenantId as number); expect(pool).not.toBeNull();
    const picks = ["a@x.example", "b@x.example", "c@x.example", "d@x.example", "e@x.example", "f@x.example"].map((email) => pool!.pick(email)!.fromEmail);
    expect(new Set(picks).size).toBe(2); // beide Adressen kommen vor
    expect(picks.filter((email) => email === "zweite@tanesco-zwei.example").length).toBeLessThanOrEqual(2); // eigenes Tagesbudget der Zusatz-Adresse
    const stable = pool!.pick("a@x.example")!.fromEmail; expect(["vertrieb@tanesco-test.example", "zweite@tanesco-zwei.example"]).toContain(stable);
    // Versand schreibt die Adresse ans Ereignis
    await owner.leadops.importColdList({ listName: "Sender-Test", toPipeline: false, rows: [{ firstName: "Eva", lastName: "Eins", company: "Eins GmbH", email: "eva@sender-e2e.example" }, { firstName: "Zoe", lastName: "Zwei", company: "Zwei GmbH", email: "zoe@sender-e2e.example" }] });
    const starter = await owner.leadops.emailCampaignStarter();
    const campaign = await owner.leadops.saveEmailCampaign({ name: "Sender-Test", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Sender-Test" }, tree: { start: "m1", nodes: [{ id: "m1", type: "send" as const, label: "Erste", subject: "Hallo {{firma}}", blocks: starterBlocks("kaltakquise"), next: null }] }, design: starter.design as unknown as Record<string, unknown>, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" } } as never);
    await owner.leadops.startEmailCampaign({ id: campaign.id }); await owner.leadops.runEmailCampaigns();
    const senderEvents = await db.select().from(emailCampaignEvents).where(and(eq(emailCampaignEvents.campaignId, campaign.id), eq(emailCampaignEvents.kind, "gesendet")));
    expect(senderEvents).toHaveLength(2); expect(senderEvents.every((event) => event.sender && ["vertrieb@tanesco-test.example", "zweite@tanesco-zwei.example"].includes(event.sender))).toBe(true);
    // Warmlaufen: Limit folgt der Rampe
    await owner.leadops.saveMailSettings({ provider: "smtp", campaignDailyLimit: 100, warmupEnabled: true } as never);
    const status = await owner.leadops.campaignDailyStatus(); expect(status.warmup).not.toBeNull(); expect(status.limit).toBe(40); expect((status as { configured?: number }).configured).toBe(100); // Woche 1
    await owner.leadops.saveMailSettings({ provider: "smtp", warmupEnabled: false } as never);
    expect((await owner.leadops.campaignDailyStatus()).limit).toBe(100);
    // Wochenbericht: Baustein + Versand (simuliert)
    const report = await health.buildWeeklyReport(db, S.tenantId as number);
    expect(report.text).toContain("Gesendet:"); expect(report.text).toContain("Antworten:"); expect(report.subject).toContain("deine Woche");
    const sentReport = await owner.leadops.sendWeeklyReport(); expect(sentReport.sent).toBe(true);
    // KI-Antwortvorschlag: ohne KI-Schlüssel kommt die Vorlage – mit Anrede und Telefonat-Frage
    const message = await owner.leadops.storeInboxMessage({ fromEmail: "chef@antwort-vorschlag.example", fromName: "Carla Chef", subject: "Re: Hallo", bodyText: "Klingt interessant, was kostet das?" });
    const suggestion = await owner.leadops.suggestInboxReply({ messageId: message.id });
    expect(suggestion.source).toBe("vorlage"); expect(suggestion.text).toMatch(/^Guten Tag,/); expect(suggestion.text).not.toContain("Carla Chef,"); /* kein „Guten Tag Vorname Nachname“ */ expect(suggestion.text).toContain("Telefonat"); expect(suggestion.text).toContain("20 Test-Leads"); expect(suggestion.text).not.toMatch(/Grüßen\s*$/);
    // Listen-Anreicherung: Webseite aus der Firmen-Domain beim Upload, Ansprechpartner aus der E-Mail-Adresse
    await owner.leadops.importColdList({ listName: "Anreicherung", toPipeline: false, rows: [{ company: "Koppen Solar", email: "stefan.koppen@koppen-solar.example" }, { company: "Ohne Namen GmbH", email: "info@ohne-namen.example" }] });
    const enriched = await owner.leadops.enrichListContacts({ listName: "Anreicherung" });
    expect(enriched.found).toBeGreaterThanOrEqual(1);
    const koppen = (await db.select().from(leads).where(and(eq(leads.email, "stefan.koppen@koppen-solar.example"), eq(leads.kind, "vertrieb"))))[0];
    expect(koppen?.firstName).toBe("Stefan"); expect(koppen?.lastName).toBe("Koppen");
    expect(((koppen?.metadata ?? {}) as { website?: string }).website).toBe("koppen-solar.example"); // Webseite aus der Firmen-Domain
  }, 40000);

  it("61. Kampagnen-Archiv: laufende Kampagne → beendet + archiviert, nimmt niemanden mehr auf (Hand, Liste, Start, Automatik, Upload), Wiederherstellen, Vorlagen nicht", async () => {
    const outreach = await import("./sales-outreach"); const pipelineExtras = await import("./pipeline-extras"); const { starterBlocks } = await import("../shared/email-design");
    await owner.leadops.importColdList({ listName: "Archiv-Test", toPipeline: true, rows: [{ firstName: "Arne", lastName: "Archiv", company: "Archiv GmbH", email: "arne@archiv-e2e.example" }, { firstName: "Bea", lastName: "Box", company: "Box GmbH", email: "bea@archiv-e2e.example" }] });
    const starter = await owner.leadops.emailCampaignStarter();
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send" as const, label: "Erste", subject: "Hallo {{firma}}", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait" as const, hours: 72, next: "m2" }, { id: "m2", type: "send" as const, label: "Nachfass", subject: "Nachgefragt {{firma}}", blocks: starterBlocks("nachfassen"), next: null }] };
    const campaign = await owner.leadops.saveEmailCampaign({ name: "Archiv-Test", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Archiv-Test" }, tree, design: starter.design as unknown as Record<string, unknown>, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" } } as never);
    expect((await owner.leadops.startEmailCampaign({ id: campaign.id })).added).toBe(2); await owner.leadops.runEmailCampaigns();
    const live = (await owner.leadops.listEmailCampaigns()).find((row) => row.id === campaign.id)!; expect(live.status).toBe("aktiv"); expect(live.archivedAt).toBeNull(); expect(live.createdAt).toBeTruthy();
    // Archivieren: laufende Kampagne wird beendet, Datum gesetzt, Empfänger + Zahlen bleiben
    expect(await owner.leadops.archiveEmailCampaign({ id: campaign.id, archived: true })).toMatchObject({ archived: true, status: "beendet" });
    const archived = (await owner.leadops.listEmailCampaigns()).find((row) => row.id === campaign.id)!; expect(archived.status).toBe("beendet"); expect(archived.archivedAt).toBeTruthy(); expect(archived.stats.total).toBe(2); expect(archived.stats.sent).toBe(2);
    const detail = await owner.leadops.getEmailCampaign({ id: campaign.id }); expect(detail.recipients).toHaveLength(2); expect((detail as { archivedAt?: Date | null }).archivedAt).toBeTruthy();
    // Nimmt niemanden mehr auf – jede Tür ist zu
    await expect(owner.leadops.startEmailCampaign({ id: campaign.id })).rejects.toThrow(/Archiv/);
    await expect(owner.leadops.addListsToEmailCampaign({ id: campaign.id, listNames: ["Sender-Test"] })).rejects.toThrow(/Archiv/);
    await expect(owner.leadops.syncEmailCampaignAudience({ id: campaign.id })).rejects.toThrow(/Archiv/);
    await expect(owner.leadops.setEmailCampaignStatus({ id: campaign.id, status: "aktiv" })).rejects.toThrow(/Archiv/);
    const senderLead = (await db.select({ id: leads.id }).from(leads).where(and(eq(leads.email, "eva@sender-e2e.example"), eq(leads.kind, "vertrieb"))))[0];
    await expect(owner.leadops.addLeadsToEmailCampaign({ id: campaign.id, leadIds: [senderLead.id] })).rejects.toThrow(/Archiv/);
    expect(await pipelineExtras.enrollInCampaign(db, S.tenantId as number, { leadId: senderLead.id, campaignId: campaign.id, reason: "Test" })).toMatchObject({ enrolled: false, reason: "Kampagne archiviert" });
    // Neuer Upload in die Liste: die archivierte Kampagne nimmt nichts auf
    const upload = await owner.leadops.importColdList({ listName: "Archiv-Test", toPipeline: false, rows: [{ firstName: "Cem", lastName: "Neu", company: "Neu GmbH", email: "cem@archiv-e2e.example" }] });
    expect((upload as { campaigns?: Array<{ id: number }> }).campaigns?.some((row) => row.id === campaign.id) ?? false).toBe(false);
    expect((await owner.leadops.getEmailCampaign({ id: campaign.id })).recipients).toHaveLength(2);
    expect(await outreach.processEmailCampaigns(db, "http://localhost", { campaignId: campaign.id, limit: 100 })).toBe(0); // Zeitplaner lässt sie in Ruhe
    // Noch einmal archivieren ändert nichts; Vorlagen lassen sich nicht archivieren
    expect(await owner.leadops.archiveEmailCampaign({ id: campaign.id, archived: true })).toMatchObject({ archived: true, status: "beendet" });
    const template = await owner.leadops.duplicateEmailCampaign({ id: campaign.id, asTemplate: true, name: "Vorlage Archiv" });
    await expect(owner.leadops.archiveEmailCampaign({ id: template.id, archived: true })).rejects.toThrow(/Vorlagen/);
    expect((await owner.leadops.listEmailCampaigns()).find((row) => row.id === template.id)?.archivedAt).toBeNull(); // Kopie/Vorlage erbt das Archiv nicht
    // Wiederherstellen: zurück in die Übersicht, bleibt beendet; Liste hinzufügen nimmt wieder auf
    expect(await owner.leadops.archiveEmailCampaign({ id: campaign.id, archived: false })).toMatchObject({ archived: false, status: "beendet" });
    const restored = (await owner.leadops.listEmailCampaigns()).find((row) => row.id === campaign.id)!; expect(restored.archivedAt).toBeNull(); expect(restored.status).toBe("beendet");
    const added = await owner.leadops.addListsToEmailCampaign({ id: campaign.id, listNames: ["Archiv-Test"] }); expect(added.running).toBe(true); expect(added.added).toBe(1); // Cem kommt jetzt rein
  }, 40000);

  it("62. Zielgruppe „Nur ausgewählte Kontakte“: Entwurf ohne Liste + von Hand aufgenommen → Zahlen passen, Start nimmt genau diese, Upload nimmt niemanden dazu", async () => {
    const outreach = await import("./sales-outreach"); const { starterBlocks } = await import("../shared/email-design");
    await owner.leadops.importColdList({ listName: "Auswahl-Test", toPipeline: true, rows: [{ firstName: "Dora", lastName: "Drei", company: "Drei GmbH", email: "dora@auswahl-e2e.example" }, { firstName: "Emil", lastName: "Vier", company: "Vier GmbH", email: "emil@auswahl-e2e.example" }, { firstName: "Fritz", lastName: "Fuenf", company: "Fuenf GmbH", email: "fritz@auswahl-e2e.example" }] });
    const starter = await owner.leadops.emailCampaignStarter();
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send" as const, label: "Erste", subject: "Hallo {{firma}}", blocks: starterBlocks("kaltakquise"), next: null }] };
    // Wie in der Praxis: Kampagne mit Zielgruppe „Liste“, aber ohne Liste – dann Kontakte aus „Kontakte“ aufnehmen
    const campaign = await owner.leadops.saveEmailCampaign({ name: "Auswahl-Test", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: null, listNames: [] }, tree, design: starter.design as unknown as Record<string, unknown>, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" } } as never);
    const picked = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.kind, "vertrieb"), inArray(leads.email, ["dora@auswahl-e2e.example", "emil@auswahl-e2e.example"])));
    expect(await owner.leadops.addLeadsToEmailCampaign({ id: campaign.id, leadIds: picked.map((row) => row.id) })).toMatchObject({ added: 2, status: "entwurf" });
    const listed = (await owner.leadops.listEmailCampaigns()).find((row) => row.id === campaign.id)!;
    expect(listed.audience.source).toBe("auswahl"); expect(listed.audienceInfo).toMatchObject({ total: 2, picked: true, outside: 0, pending: 0 }); expect(listed.stats.total).toBe(2); // Empfänger = Zielgruppe, kein Widerspruch mehr
    // Alte Daten (vor der Zielgruppe „auswahl“): Entwurf „Liste ohne Liste“ mit Empfängern wird beim Laden repariert
    await db.update(emailCampaigns).set({ audience: { source: "liste", listName: null, listNames: [] } }).where(eq(emailCampaigns.id, campaign.id));
    expect((await owner.leadops.getEmailCampaign({ id: campaign.id })).audience.source).toBe("auswahl");
    expect((await owner.leadops.listEmailCampaigns()).find((row) => row.id === campaign.id)?.audienceInfo).toMatchObject({ total: 2, picked: true });
    const preview = await owner.leadops.previewEmailAudience({ source: "auswahl", campaignId: campaign.id }); expect(preview.count).toBe(2); expect(preview.sample.map((row) => row.name).sort()).toEqual(["Dora Drei", "Emil Vier"]);
    // Start nimmt genau die zwei – Fritz (in derselben Liste, nicht ausgewählt) bleibt draußen
    const started = await owner.leadops.startEmailCampaign({ id: campaign.id }); expect(started.added).toBe(2);
    await owner.leadops.runEmailCampaigns();
    const sent = await db.select().from(emailCampaignEvents).where(and(eq(emailCampaignEvents.campaignId, campaign.id), eq(emailCampaignEvents.kind, "gesendet")));
    expect(sent).toHaveLength(2);
    expect((await owner.leadops.getEmailCampaign({ id: campaign.id })).recipients.map((row) => row.email).sort()).toEqual(["dora@auswahl-e2e.example", "emil@auswahl-e2e.example"]);
    // Neuer Upload in die Liste und „Jetzt aufnehmen“: niemand kommt automatisch dazu
    await owner.leadops.importColdList({ listName: "Auswahl-Test", toPipeline: false, rows: [{ firstName: "Gerd", lastName: "Sechs", company: "Sechs GmbH", email: "gerd@auswahl-e2e.example" }] });
    expect((await owner.leadops.syncEmailCampaignAudience({ id: campaign.id })).added).toBe(0);
    expect((await owner.leadops.getEmailCampaign({ id: campaign.id })).recipients).toHaveLength(2);
    expect(await outreach.enrollListIntoRunningCampaigns(db, S.tenantId as number, "Auswahl-Test", "http://localhost")).toEqual([]);
    // Von Hand aufgenommene bleiben fest drin, wenn Listen dazukommen: kein „nicht mehr in der Liste“, kein Entfernen, Start zählt sie mit
    const mix = await owner.leadops.saveEmailCampaign({ name: "Auswahl-Mix", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: null, listNames: [] }, tree, design: starter.design as unknown as Record<string, unknown>, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" } } as never);
    const koppenLead = (await db.select({ id: leads.id }).from(leads).where(and(eq(leads.kind, "vertrieb"), eq(leads.email, "stefan.koppen@koppen-solar.example"))))[0];
    expect(await owner.leadops.addLeadsToEmailCampaign({ id: mix.id, leadIds: [koppenLead.id] })).toMatchObject({ added: 1 }); // aus Liste „Anreicherung“
    expect((await owner.leadops.getEmailCampaign({ id: mix.id })).recipients[0].picked).toBe(true);
    await owner.leadops.addListsToEmailCampaign({ id: mix.id, listNames: ["Auswahl-Test"] }); // andere Liste dazu
    const mixed = (await owner.leadops.listEmailCampaigns()).find((row) => row.id === mix.id)!;
    expect(mixed.audience.source).toBe("liste"); expect(mixed.audienceInfo).toMatchObject({ outside: 0, handPicked: 1 }); expect(mixed.audienceInfo!.pending).toBeGreaterThan(0); // Hand-Kontakt steht in keiner gewählten Liste, zählt aber nicht als „nicht mehr in der Liste“
    expect((await owner.leadops.pruneEmailCampaignRecipients({ id: mix.id })).removed).toBe(0); // „Entfernen“ würde ihn nie treffen
    const mixStart = await owner.leadops.startEmailCampaign({ id: mix.id }); expect(mixStart.added).toBe(mixed.audienceInfo!.pending + 1); expect(mixStart.skipped).toBe(0);
    // Leere Auswahl lässt sich nicht starten – mit klarem Hinweis
    const empty = await owner.leadops.saveEmailCampaign({ name: "Auswahl leer", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "auswahl" }, tree, design: starter.design as unknown as Record<string, unknown> } as never);
    await expect(owner.leadops.startEmailCampaign({ id: empty.id })).rejects.toThrow(/Noch keine Kontakte ausgewählt/);
  }, 40000);

  it("63a. Versandzeiten: laufende Kampagnen werden einmalig auf 9:00–11:30 und 14:00–16:30 Uhr umgestellt (Drip bleibt), gespeicherte eigene Zeiten bleiben", async () => {
    const { starterBlocks } = await import("../shared/email-design"); const starter = await owner.leadops.emailCampaignStarter();
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send" as const, label: "Erste", subject: "Hallo {{firma}}", blocks: starterBlocks("kaltakquise"), next: null }] };
    const base = { fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "alle" }, tree, design: starter.design as unknown as Record<string, unknown> };
    const own = await owner.leadops.saveEmailCampaign({ ...base, name: "Eigene Zeiten", sendWindow: { enabled: true, weekdays: [1, 2, 3], from: "08:00", to: "12:00", timezone: "Europe/Berlin", pauseFrom: null, pauseTo: null } } as never);
    const old = await owner.leadops.saveEmailCampaign({ ...base, name: "Alte Zeiten" } as never);
    // Wie vor dem Update gespeichert: 7:30–17:00, freitags bis 13 Uhr, Drip 20/Std. – ohne Kennung der neuen Zeiten
    await db.update(emailCampaigns).set({ status: "aktiv", sendWindow: { enabled: true, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin", days: { "5": { from: "07:30", to: "13:00" } }, drip: { enabled: true, perHour: 20, gapSeconds: 180 } } }).where(eq(emailCampaigns.id, old.id));
    const moved = (await owner.leadops.getEmailCampaign({ id: old.id })).sendWindow as Record<string, unknown>;
    expect(moved).toMatchObject({ enabled: true, from: "09:00", to: "16:30", pauseFrom: "11:30", pauseTo: "14:00", days: null, drip: { enabled: true, perHour: 20, gapSeconds: 180 } });
    expect((await owner.leadops.getEmailCampaign({ id: own.id })).sendWindow).toMatchObject({ weekdays: [1, 2, 3], from: "08:00", to: "12:00", pauseFrom: null }); // bewusst gespeichert → bleibt
    // Danach selbst geändert → bleibt ebenfalls (keine zweite Umstellung)
    await owner.leadops.saveEmailCampaign({ ...base, id: old.id, name: "Alte Zeiten", sendWindow: { ...moved, from: "10:00" } } as never);
    expect((await owner.leadops.getEmailCampaign({ id: old.id })).sendWindow).toMatchObject({ from: "10:00", pauseFrom: "11:30" });
  }, 30000);

  it("63b. Aroundhome nie in Entwürfen: Text, Betreff und Alternativ-Vorschläge werden gesäubert, Prüfung im Freigabe-Fenster", async () => {
    const { starterBlocks } = await import("../shared/email-design");
    await owner.leadops.importColdList({ listName: "Portal-Test", toPipeline: false, rows: [{ firstName: "Pia", lastName: "Portal", company: "Portal Solar", email: "pia@portal-e2e.example" }, { firstName: "Olaf", lastName: "Ohne", company: "Ohne Solar", email: "olaf@portal-e2e.example" }] });
    const starter = await owner.leadops.emailCampaignStarter();
    const tree = { start: "p1", nodes: [{ id: "p1", type: "send" as const, label: "Erste", subject: "Erste an {{firma}}", blocks: starterBlocks("kaltakquise"), next: null }] };
    const campaign = await owner.leadops.saveEmailCampaign({ name: "Portal-Test", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Portal-Test" }, tree, design: starter.design as unknown as Record<string, unknown>, kiModus: "freigabe", sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" } } as never);
    await owner.leadops.startEmailCampaign({ id: campaign.id }); await owner.leadops.runEmailCampaigns();
    const [pia, olaf] = await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, campaign.id)).orderBy(asc(emailCampaignRecipients.id));
    await db.update(emailCampaignRecipients).set({ draftState: "entwurf", draftNodeId: "p1", draftSubject: "Mehr Anfragen für Portal Solar", draftText: "Sehr geehrte Frau Portal,\n\nauf Aroundhome haben Sie 120 Bewertungen mit 4,8 Sternen. Wir liefern exklusive Leads.\n\nVielen Dank", draftOptions: [{ key: "individuell", label: "Individuell", subject: "Mehr Anfragen", text: "Bei Around Home sind Sie Partner. Der Rest bleibt." }, { key: "frei", label: "Frei", subject: "Ihre Aroundhome-Bewertungen", text: "x" }] }).where(eq(emailCampaignRecipients.id, pia.id));
    await db.update(emailCampaignRecipients).set({ draftState: "entwurf", draftNodeId: "p1", draftSubject: "Ihre Aroundhome-Bewertungen", draftText: "Sehr geehrter Herr Ohne,\n\nText.\n\nVielen Dank" }).where(eq(emailCampaignRecipients.id, olaf.id));
    const queue = await owner.leadops.campaignReviewQueue({ campaignId: campaign.id });
    expect(queue.portalCheck).toMatchObject({ found: 0, cleaned: 1, reset: 1 });
    const [pia2, olaf2] = await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, campaign.id)).orderBy(asc(emailCampaignRecipients.id));
    expect(pia2.draftText).not.toMatch(/around\s*-?\s*home/i); expect(pia2.draftText).toContain("Wir liefern exklusive Leads."); expect(pia2.draftText).toContain("Vielen Dank");
    expect(pia2.draftOptions).toHaveLength(1); expect(JSON.stringify(pia2.draftOptions)).not.toMatch(/around\s*-?\s*home/i); expect(JSON.stringify(pia2.draftOptions)).toContain("Der Rest bleibt.");
    expect(olaf2.draftState).toBeNull(); expect(olaf2.draftSubject).toBeNull(); // Aroundhome im Betreff → verworfen, wird neu geschrieben
    expect((await owner.leadops.campaignReviewQueue({ campaignId: campaign.id })).portalCheck).toMatchObject({ found: 0, cleaned: 0, reset: 0 }); // zweiter Blick: sauber
  }, 30000);

  it("63c. Öffnungen/Klicks vom Versanddienst: Brevo-Webhook und Brevo-Abruf tragen sie ein (auch bei „Persönlich senden“), ohne Doppelte", async () => {
    const { starterBlocks } = await import("../shared/email-design"); const mailEvents = await import("./mail-events");
    await owner.leadops.importColdList({ listName: "Öffnen-Test", toPipeline: false, rows: [{ firstName: "Otto", lastName: "Offen", company: "Offen Solar", email: "otto@offen-e2e.example" }, { firstName: "Klara", lastName: "Klick", company: "Klick Solar", email: "klara@offen-e2e.example" }] });
    const starter = await owner.leadops.emailCampaignStarter();
    const campaign = await owner.leadops.saveEmailCampaign({ name: "Öffnen-Test", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Öffnen-Test" }, tree: { start: "o1", nodes: [{ id: "o1", type: "send" as const, label: "Erste", subject: "Hallo {{firma}}", blocks: starterBlocks("kaltakquise"), next: null }] }, design: { ...(starter.design as unknown as Record<string, unknown>), plain: true }, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" } } as never);
    await owner.leadops.startEmailCampaign({ id: campaign.id }); await owner.leadops.runEmailCampaigns();
    const rows = async () => db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, campaign.id)).orderBy(asc(emailCampaignRecipients.id));
    const [otto, klara] = await rows(); expect(otto.sentCount).toBe(1); expect(otto.openedAt).toBeNull();
    const sentAt = new Date(Date.now() - 10 * 60_000); await db.update(emailCampaignRecipients).set({ lastSentAt: sentAt }).where(eq(emailCampaignRecipients.campaignId, campaign.id)); // vor 10 Minuten gesendet
    await db.update(emailCampaignEvents).set({ messageId: "202610261200.otto@smtp-relay.mailin.fr" }).where(and(eq(emailCampaignEvents.recipientId, otto.id), eq(emailCampaignEvents.kind, "gesendet")));
    // Webhook (Brevo-Format): „opened“ mit Message-ID → Otto geöffnet; zweite Meldung zählt nicht doppelt; Apple-Proxy zählt nicht
    const hook = async (payload: Record<string, unknown>) => (await (await realFetch(`${apiBase}/api/mail/bounce`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })).json()) as { handled: number };
    expect(await hook({ event: "proxy_open", email: "otto@offen-e2e.example", "message-id": "<202610261200.otto@smtp-relay.mailin.fr>" })).toEqual({ handled: 0 });
    expect(await hook({ event: "opened", email: "otto@offen-e2e.example", "message-id": "<202610261200.otto@smtp-relay.mailin.fr>", date: new Date(Date.now() - 5 * 60_000).toISOString() })).toEqual({ handled: 1 });
    expect(await hook({ event: "unique_opened", email: "otto@offen-e2e.example", "message-id": "<202610261200.otto@smtp-relay.mailin.fr>" })).toEqual({ handled: 0 });
    // Scanner direkt nach dem Versand zählt nicht
    expect(await hook({ event: "opened", email: "klara@offen-e2e.example", date: new Date(sentAt.getTime() + 2_000).toISOString() })).toEqual({ handled: 0 });
    // Brevo-Abruf (HTTP-Versand): Klara hat geklickt → geöffnet + geklickt; zweiter Abruf ändert nichts
    const [settingsBefore] = await db.select().from(mailSettings).where(eq(mailSettings.tenantId, S.tenantId));
    await db.update(mailSettings).set({ provider: "brevo_api", password: "xkeysib-e2e", enabled: true }).where(eq(mailSettings.tenantId, S.tenantId));
    const clickAt = new Date(Date.now() - 3 * 60_000).toISOString();
    const fake = (async (input: string | URL | Request) => { const url = String(input); const body = url.includes("event=clicks") && url.includes("offset=0") ? { events: [{ email: "klara@offen-e2e.example", date: clickAt, messageId: "<unbekannt@mailin.fr>", event: "clicks", link: "https://tanesco.digital/preise" }] } : { events: [] }; return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }); }) as typeof fetch;
    const first = await mailEvents.syncBrevoEvents(db, { tenantId: S.tenantId, force: true, fetchImpl: fake }); expect(first.applied).toBe(1);
    const second = await mailEvents.syncBrevoEvents(db, { tenantId: S.tenantId, force: true, fetchImpl: fake }); expect(second.applied).toBe(0);
    if (settingsBefore) await db.update(mailSettings).set({ provider: settingsBefore.provider, password: settingsBefore.password, enabled: settingsBefore.enabled }).where(eq(mailSettings.tenantId, S.tenantId));
    const [otto2, klara2] = await rows();
    expect(otto2.openedAt).not.toBeNull(); expect(otto2.clickedAt).toBeNull();
    expect(klara2.openedAt).not.toBeNull(); expect(klara2.clickedAt).not.toBeNull(); expect(klara2.clickedUrls).toEqual(["https://tanesco.digital/preise"]);
    const detail = await owner.leadops.getEmailCampaign({ id: campaign.id }); expect(detail.stats).toMatchObject({ sent: 2, opened: 2, clicked: 1 });
    const kinds = (await db.select().from(emailCampaignEvents).where(eq(emailCampaignEvents.campaignId, campaign.id))).map((event) => event.kind).sort(); expect(kinds).toEqual(["beendet", "beendet", "geklickt", "geoeffnet", "geoeffnet", "gesendet", "gesendet"]);
  }, 30000);

  it("63d. Gesendet: Filter nach Datum und Uhrzeit (deutsche Zeit) – Liste, Gesamtzahl, Zähler und Kampagnen-Auswahl passen", async () => {
    const { starterBlocks } = await import("../shared/email-design");
    await owner.leadops.importColdList({ listName: "Zeitfilter-Test", toPipeline: false, rows: [{ firstName: "Anna", lastName: "Morgen", company: "Morgen Dach", email: "anna@zeitfilter-e2e.example" }, { firstName: "Bernd", lastName: "Mittag", company: "Mittag Dach", email: "bernd@zeitfilter-e2e.example" }, { firstName: "Carla", lastName: "Abend", company: "Abend Dach", email: "carla@zeitfilter-e2e.example" }] });
    const starter = await owner.leadops.emailCampaignStarter();
    const campaign = await owner.leadops.saveEmailCampaign({ name: "Zeitfilter-Test", fromName: "Tanesco", fromEmail: "vertrieb@tanesco-test.example", audience: { source: "liste", listName: "Zeitfilter-Test" }, tree: { start: "o1", nodes: [{ id: "o1", type: "send" as const, label: "Erste", subject: "Hallo {{firma}}", blocks: starterBlocks("kaltakquise"), next: null }] }, design: { ...(starter.design as unknown as Record<string, unknown>), plain: true }, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" } } as never);
    await owner.leadops.startEmailCampaign({ id: campaign.id }); await owner.leadops.runEmailCampaigns();
    const sends = await db.select({ id: emailCampaignEvents.id }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.campaignId, campaign.id), eq(emailCampaignEvents.kind, "gesendet"))).orderBy(asc(emailCampaignEvents.id));
    expect(sends).toHaveLength(3);
    // Mo 12.10.2026 09:10 und 14:05 (Sommerzeit), Di 13.10. 17:00
    const times = ["2026-10-12T07:10:00.000Z", "2026-10-12T12:05:00.000Z", "2026-10-13T15:00:00.000Z"];
    for (const [index, row] of sends.entries()) await db.update(emailCampaignEvents).set({ createdAt: new Date(times[index]) }).where(eq(emailCampaignEvents.id, row.id));
    const base = { campaignId: campaign.id, kind: "kampagne" as const }; const at = (list: { items: Array<{ at: Date | string }> }) => list.items.map((item) => new Date(item.at).toISOString());
    const montag = await owner.leadops.listSent({ ...base, from: new Date("2026-10-11T22:00:00Z"), to: new Date("2026-10-12T22:00:00Z") });
    expect(at(montag)).toEqual([times[1], times[0]]); expect(montag.total).toBe(2); expect(montag.counts.kampagne).toBe(2); expect(montag.capped).toBe(false);
    expect(at(await owner.leadops.listSent({ ...base, timeFrom: "09:00", timeTo: "11:30" }))).toEqual([times[0]]);
    expect(at(await owner.leadops.listSent({ ...base, timeFrom: "14:00", timeTo: "16:30" }))).toEqual([times[1]]);
    expect(at(await owner.leadops.listSent({ ...base, timeFrom: "16:31" }))).toEqual([times[2]]);
    expect(at(await owner.leadops.listSent({ ...base, from: new Date("2026-10-12T22:00:00Z") }))).toEqual([times[2]]);
    // „bis“ genau zur Sendezeit schließt aus, eine Minute danach (so schickt es die Oberfläche) schließt ein
    expect((await owner.leadops.listSent({ ...base, from: new Date("2026-10-12T07:00:00Z"), to: new Date("2026-10-12T12:05:00Z") })).total).toBe(1);
    expect((await owner.leadops.listSent({ ...base, from: new Date("2026-10-12T07:00:00Z"), to: new Date("2026-10-12T12:06:00Z") })).total).toBe(2);
    // Zeitraum + Uhrzeit zusammen, Reaktions-Zähler passen zum Ausschnitt
    const kombi = await owner.leadops.listSent({ ...base, from: new Date("2026-10-11T22:00:00Z"), to: new Date("2026-10-13T22:00:00Z"), timeFrom: "14:00", timeTo: "17:00" });
    expect(at(kombi)).toEqual([times[2], times[1]]); expect(Object.values(kombi.reactions).reduce((sum, value) => sum + value, 0)).toBe(2);
    // Kampagne gewählt: Auswahlliste enthält weiter alle Kampagnen; ohne Kampagne bleiben die Zähler je Art bei „nur Kampagnen“ gleich
    const gewaehlt = await owner.leadops.listSent({ campaignId: campaign.id });
    expect(gewaehlt.campaigns.length).toBeGreaterThan(1); expect(gewaehlt.campaigns.find((item) => item.id === campaign.id)?.count).toBe(3);
    expect((await owner.leadops.listSent({ kind: "kampagne" })).counts).toEqual((await owner.leadops.listSent({})).counts);
    await expect(owner.leadops.listSent({ timeFrom: "9 Uhr" } as never)).rejects.toThrow();
    // Kontakte: Filter „Gesendet“ = alle, die eine E-Mail bekommen haben (egal was danach kam); je Kontakt seine Mails mit Uhrzeit
    const kontakte = await owner.leadops.emailLeads({ listName: "Zeitfilter-Test", activity: "angeschrieben" });
    expect(kontakte.items.map((item) => item.email).sort()).toEqual(["anna@zeitfilter-e2e.example", "bernd@zeitfilter-e2e.example", "carla@zeitfilter-e2e.example"]);
    expect(kontakte.counts.angeschrieben).toBeGreaterThanOrEqual(3); expect(kontakte.items.every((item) => item.mails === 1 && item.lastSentAt)).toBe(true);
    const anna = kontakte.items.find((item) => item.email === "anna@zeitfilter-e2e.example")!;
    const annasMails = await owner.leadops.listSent({ leadId: anna.id, email: anna.email });
    expect(annasMails.items).toHaveLength(1); expect(annasMails.items[0].to).toBe("anna@zeitfilter-e2e.example"); expect(times).toContain(new Date(annasMails.items[0].at).toISOString());
    expect((await owner.leadops.listSent({ email: "ANNA@zeitfilter-e2e.example" })).items.map((item) => item.to)).toEqual(["anna@zeitfilter-e2e.example"]);
    const ohne = await owner.leadops.importColdList({ listName: "Zeitfilter-Ohne", toPipeline: false, rows: [{ firstName: "Dora", lastName: "Neu", email: "dora@zeitfilter-e2e.example" }] }); expect(ohne.created).toBe(1);
    expect((await owner.leadops.emailLeads({ listName: "Zeitfilter-Ohne", activity: "angeschrieben" })).total).toBe(0);
  }, 30000);

  it("63e. Früheren Stand wiederherstellen: versehentlich „In die Vertriebspipeline übernommen“ → Vorschau zeigt den Stand davor → zurücksetzen → selbst rückgängig; Übernehmen hat jetzt Rückgängig", async () => {
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    await owner.leadops.importColdList({ listName: "Restore-Test", toPipeline: false, rows: [{ firstName: "Anke", lastName: "Alt", company: "Alt Dach", email: "anke@restore-e2e.example" }, { firstName: "Bodo", lastName: "Bleib", company: "Bleib Solar", email: "bodo@restore-e2e.example" }, { firstName: "Cora", lastName: "Kalt", company: "Kalt Bau", email: "cora@restore-e2e.example" }] });
    const contacts = async () => (await owner.leadops.emailLeads({ listName: "Restore-Test" })).items;
    const ids = Object.fromEntries((await contacts()).map((item) => [item.email!.split("@")[0], item.id])) as Record<"anke" | "bodo" | "cora", number>;
    const coldStages = await owner.leadops.pipelineStages({ source: "kaltakquise" }); const emailStages = await owner.leadops.pipelineStages({ source: "email" });
    // vorher: Cora steht in der Kaltakquise (zweite Stufe), Anke und Bodo nur in der E-Mail-Akquise
    await owner.leadops.pushLeadsToPipeline({ leadIds: [ids.cora], target: "kaltakquise", stage: coldStages[1].key });
    const row = async (id: number) => (await db.select({ inPipeline: leads.inPipeline, adPlatform: leads.adPlatform, stage: leads.pipelineStage, owner: leads.ownerUserId }).from(leads).where(eq(leads.id, id)))[0];
    const coraBefore = await row(ids.cora); expect(coraBefore).toMatchObject({ inPipeline: true, adPlatform: "kaltakquise", stage: coldStages[1].key });
    const ankeBefore = await row(ids.anke); expect(ankeBefore).toMatchObject({ inPipeline: false, adPlatform: "kaltakquise", stage: "neu" });
    await pause(1100); const at = new Date(); await pause(1100);
    // das Versehen: alle drei in die Pipeline „E-Mail-Kampagne“, letzte offene Stufe
    const pushed = await owner.leadops.pushLeadsToPipeline({ leadIds: [ids.anke, ids.bodo, ids.cora], target: "email", stage: emailStages[2].key });
    expect(pushed.moved + pushed.switched).toBe(3); expect(pushed.undoId).toBeGreaterThan(0);
    expect((await owner.leadops.listUndo({ limit: 20 })).some((entry) => entry.id === pushed.undoId && entry.title === "3 Kontakte in die Pipeline „E-Mail-Kampagne“ übernommen")).toBe(true);
    // Vorschau: genau diese drei, mit dem Stand davor
    const preview = await owner.leadops.pipelineStateAt({ at });
    const mine = preview.items.filter((item) => Object.values(ids).includes(item.leadId));
    expect(mine).toHaveLength(3);
    const anke = mine.find((item) => item.leadId === ids.anke)!; expect(anke.then.pipeline).toBe("Nur E-Mail-Akquise"); expect(anke.now.pipeline).toBe("E-Mail-Kampagne");
    const cora = mine.find((item) => item.leadId === ids.cora)!; expect(cora.then.pipeline).toBe("Kaltakquise"); expect(cora.then.stage).toBe(coldStages[1].label);
    expect(preview.groups.some((group) => group.label.includes("übernommen") && group.leadIds.includes(ids.anke))).toBe(true);
    await expect(owner.leadops.pipelineStateAt({ at: new Date(Date.now() + 3_600_000) })).rejects.toThrow(/Zukunft/);
    // zurücksetzen (nur unsere drei) → wie vorher, inkl. Vertriebler
    const restored = await owner.leadops.restorePipelineState({ at, leadIds: [ids.anke, ids.bodo, ids.cora] });
    expect(restored.restored).toBe(3); expect(restored.undoId).toBeGreaterThan(0);
    expect(await row(ids.anke)).toEqual(ankeBefore); expect(await row(ids.bodo)).toMatchObject({ inPipeline: false, adPlatform: "kaltakquise", stage: "neu", owner: ankeBefore.owner });
    expect(await row(ids.cora)).toEqual(coraBefore);
    expect((await owner.leadops.pipelineStateAt({ at })).items.filter((item) => Object.values(ids).includes(item.leadId))).toHaveLength(0);
    await expect(owner.leadops.restorePipelineState({ at, leadIds: [ids.anke] })).rejects.toThrow(/nichts zurückzusetzen/);
    // das Zurücksetzen selbst rückgängig → wieder wie nach dem Versehen
    await owner.leadops.undoOperation({ id: restored.undoId });
    expect(await row(ids.anke)).toMatchObject({ inPipeline: true, adPlatform: "email", stage: emailStages[2].key });
    // … und das Übernehmen hat jetzt ein eigenes Rückgängig (mit Vertriebler)
    await owner.leadops.undoOperation({ id: pushed.undoId });
    expect(await row(ids.anke)).toEqual(ankeBefore); expect(await row(ids.cora)).toEqual(coraBefore);
    // wie heute Abend passiert: Übernehmen mit der alten Version (ohne Rückgängig-Eintrag) → nur der Verlauf der Karten zählt
    await pause(1100); const at2 = new Date(); await pause(1100);
    const again = await owner.leadops.pushLeadsToPipeline({ leadIds: [ids.anke, ids.bodo, ids.cora], target: "email", stage: emailStages[1].key });
    await db.delete(undoLog).where(eq(undoLog.id, again.undoId));
    const fromHistory = (await owner.leadops.pipelineStateAt({ at: at2 })).items.filter((item) => Object.values(ids).includes(item.leadId));
    expect(fromHistory).toHaveLength(3); expect(fromHistory.find((item) => item.leadId === ids.anke)?.then.pipeline).toBe("Nur E-Mail-Akquise"); expect(fromHistory.find((item) => item.leadId === ids.cora)?.then).toMatchObject({ pipeline: "Kaltakquise", stage: coldStages[1].label });
    expect((await owner.leadops.restorePipelineState({ at: at2, leadIds: [ids.anke, ids.bodo, ids.cora] })).restored).toBe(3);
    expect(await row(ids.anke)).toEqual(ankeBefore); expect(await row(ids.bodo)).toMatchObject({ inPipeline: false, adPlatform: "kaltakquise", stage: "neu" }); expect(await row(ids.cora)).toEqual(coraBefore);
  }, 40000);

  it("63. Verträge: Bausteine speichern, zur Unterschrift senden, öffentliche Seite, Unterschrift mit Nachweis (Zeit, IP, Gerät, Prüfsummen), PDF, Ablehnen, Vorlage", async () => {
    const leadOptions = await owner.leadops.contractLeadOptions({ query: "" }); expect(leadOptions.length).toBeGreaterThan(0);
    const probe = leadOptions.find((row) => row.name) ?? leadOptions[0]; expect((await owner.leadops.contractLeadOptions({ query: (probe.name || probe.email).slice(0, 4) })).some((row) => row.id === probe.id)).toBe(true);
    expect(await owner.leadops.contractLeadOptions({ query: "%_kein_treffer_%" })).toEqual([]);
    const defaults = await owner.leadops.contractDefaults(); expect(defaults.starter.blocks.some((block) => block.type === "signature" && block.party === "kunde")).toBe(true);
    const blocks = [...defaults.starter.blocks.map((block) => block.type === "detail" ? { ...block, value: block.key === "preis" ? "" : block.value || "Hessen" } : block), { id: "bUst", type: "field" as const, key: "ustid", label: "USt-IdNr.", required: true }];
    const saved = await owner.leadops.saveContract({ title: "Leadliefervertrag E2E", blocks, values: { firma: "E2E Solar GmbH", name: "Erika E2E", email: "erika@e2e-vertrag.example", anbieterVertreter: "Taner" }, recipientEmail: "erika@e2e-vertrag.example", recipientName: "Erika E2E" });
    expect(saved.number).toMatch(/^V-\d{4}-\d{4}$/);
    const draft = await owner.leadops.getContract({ id: saved.id }); expect(draft.status).toBe("entwurf"); expect(draft.values.anbieterFirma).toContain("Tanesco"); expect(draft.events.map((event) => event.kind)).toEqual(["erstellt"]);
    expect((await owner.leadops.contractPreviewHtml({ id: saved.id, title: draft.title, blocks: draft.blocks as never, values: draft.ownValues })).html).toContain("E2E Solar GmbH");
    // Senden: Link mit Token, Dokument-Prüfsumme, Versand simuliert (kein Mail-Server)
    await expect(owner.leadops.sendContract({ id: saved.id, recipientEmail: "erika@e2e-vertrag.example" })).rejects.toThrow(/Preis je Lead/);
    await owner.leadops.saveContract({ id: saved.id, title: "Leadliefervertrag E2E", blocks: blocks.map((block) => block.type === "detail" && block.key === "preis" ? { ...block, value: "79 €" } : block), values: { firma: "E2E Solar GmbH", name: "Erika E2E", email: "erika@e2e-vertrag.example", anbieterVertreter: "Taner" } });
    const sent = await owner.leadops.sendContract({ id: saved.id, recipientEmail: "erika@e2e-vertrag.example", recipientName: "Erika E2E", message: "Wie besprochen" });
    expect(sent.token).toMatch(/^[a-f0-9]{48}$/); expect(sent.url).toContain(`/vertrag/${sent.token}`);
    const open = await owner.leadops.getContract({ id: saved.id }); expect(open.status).toBe("gesendet"); expect(open.documentHash).toHaveLength(64);
    await expect(owner.leadops.saveContract({ id: saved.id, title: "geändert", blocks: draft.blocks as never })).rejects.toThrow(/Kopie/);
    // Öffentliche Seite: erster Aufruf → „angesehen“ mit IP; Seite enthält Felder und Unterschriftsfeld
    const page = await realFetch(`${apiBase}/vertrag/${sent.token}`, { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "E2E-Browser/1.0" } }); expect(page.status).toBe(200);
    const html = await page.text(); expect(html).toContain("Jetzt unterschreiben"); expect(html).toContain(`data-token="${sent.token}"`); expect(html).toContain('data-field="ustid"'); expect(html).toContain("Der Preis je geliefertem Lead beträgt 79 €");
    const viewed = await owner.leadops.getContract({ id: saved.id }); expect(viewed.status).toBe("angesehen"); expect(viewed.events.find((event) => event.kind === "angesehen")?.ip).toBe("203.0.113.9");
    expect((await realFetch(`${apiBase}/vertrag/000000000000000000000000`)).status).toBe(404);
    // Unterschreiben: Pflichtfelder prüfen, dann mit Bild → Nachweis
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAlgAAADICAYAAAA0n5+2AAAIt0lEQVR42u3dyZEbORAFUFIhA3SUCfLfGpmgozyQTh2hnuFSCwrI5b3rRGiaQCLxCwTJ2w0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACALe6GAABq+Pb9x59X//33r5/2fQELADgSpLYSuAQsABCsBgUrQUvAAgDB6qJgJWwJWAAgWE0kaAlYACBcvQlFR8OaoCVgAUCbYHU2+OwNXIKWgAUAgtXg/7eAJWABgGAlaAlYACBYxQkzgtZ5XwwBAPDf8CRAnWPwAGCybD9p8+rvFcQELAAQVi4IhIKWgAUA4YJKlnDiJEvAAoDw4SRrKMkeFAUsACgYrLKHkWx3yAQsACgerCoFEEHrOV/TAAATVQodvs7hOYMCAAN1vQjuAvxnTrAAAAZzggUAg/h0nZOsD06wAGBAqBCuer7eZ74aAgBP6FxTD/x/rLqsEY0A4OINVOjqWR/d5737g4hFD3BBqLLhqhPz3TuAmnyAi4OVzVewotZPBW3hkjvA7fUl5cxBDnMXxaMwVXkspWzAZjlgozi7WTj1yF8z5tD4CVgAO0LRmca/J3TZoHPXi/k7N44CFkCDUHVFw786zCEYCKpxuIMFaOoPGvwVTf7j3331b8++C8b4+mH+w0tEUjdgg1zU9J1o5a4dc1NrPQpYAIObeYRG7uJ0rroxLz3WpYAFUOAp2QXqHPVjLtT+Fu5gAW1latzuZsUL5/Rci1tJ4UC7DTJ6M3eSZfyNe/6xVyiEePLTtNCobfRqh0o1r1BYFqo0MWbXYra68ilDtWMe8s6FO1gMWQij7yq4+8DoWsy4QV71fVzoOxlqP/trsHAJ34xsMJytySo15C3D+eNrXOPuMdHn5qspJPpT3sf/T6MjSk1GHgPrRA1V8fvXz3vmebEQuaQR7W3yq34bjvo1WbFmnGRdP57GUc0LWIQKV6MK3Sd5EDSOv37rQ7hS7+u55M7mwn63mc0scl+6iFOc4w8oCFfqXcCiabDy6Sk4t06ELOGqYr1n+nsVE4eeDFYUuhML1ILQYJzIMn9OsHhawO53kO3ptnttPnr9TrKEK9ZQVOxuxqubkdML9Wnuj42T0z1jIiTP4wSLzeEqygmBhqg+1cSxNeLDIeoGAYtgTajCj+OC8NAzmOsLCFgIJgM2D820V30KEvvXidChbrien8qxcaXduD7+vkev4dv3H380UBsk29Z/t2+7hxmcYGmuJTZan55Sp+xbH5XrxS9BIGChIQ/+u480W3LWqFEYt66rrJEsH9RBwMKpgI0XddporCv3Bb2B2dzBsmm1CCfuZKlRPo/hszHOei9LGEfAggkbiGZbNxgwJ2hVCFZqhpW8RdjsVKDzyYDQZZ7Yvvajv2XofiXROcGyaZUMV8+ezr1VWCsEMK93RJmDDD/nBbebEywabsyefHM+CHDtOnkXSqwbELDYsWl1eNLzNGv+qBG0fA0DmXiL0KbVOngah/gPAcSes6vXkLcEEbCwaQUPlMbDQwD7xn7LmrkiaG1dq2oEAYtQ4UpT+jxOxsODAOOC1pE+s7cGrFkELEiwWVT+wdvsc0W+oHV1cFYbZOGSe7MTAc3JGGSpVWKunZXrx9olEydYQgX/bPbGaW2wMv65+smMgKwmELBwGpBsgzBeHgIYN2ej15N6QMAifLjSqPaPozHzIMC5QOTiOgIWNN8QbPjxNmfMKWSX5pK7TfDY2Ghy6s24AswX+gRLM/b0OGusHtWaS+9qFeCosCdYzzY8U/Z5PIwJmerVKAAClqfatJuVsRtXb0KBdQ5QKmB5CsZmX+dhwLoFBCwbXuqQacyE+ixhVq0CApYNz4bVfBydwlirAOUDlg2LGUHLKBhbgLIBSzM2RgJuznEyVoCApYF7vQiuE0KoMQUErGAbXefGbMMSdgEQsMKEDxDuPQwArJDqx56f/aSJDYtVc5NhDqKsmdF/h/oHBCwb3fCgqXR7hnsnttvHwjoBBKyEG53NlJHh3lyvXT/CGDBayqbyrHFWaZLVX1/n+RGkcrMGIWYPjrg279UGuUITzFI8FjhYn2CPfCz1HayKbxfauM1Pps1/ZaOLNBceioBSAetVs6vU3DRqYSpiLawenz1jseJvdQkfBKz04aPKqY/Tq77jXWWzjfo63v1dkQKY4AUCVvjNM1Oj8haDIGVM48/LjNftu++ghlKLNesToXBVNwBUm0enLjHrTb+g+3pzyX1Ck8n0ZG2zyrfJvZqbrm/xqtf1b0HqJejv8dy7TELERuPkKt4iPDP+vp+NTBuGeaPSunCCNalpRE+6LrPnOHWoWHs26fhjN6uGBGbshQLWsImM3jg0tprjWuFrQzwUxKjXVZfs9Sai9o3ItXnvNrkrJ8P34vQJNJU2KRuujczDIVHrT8AKOPEzJ2VL8WlQAr7XgOCF+qlTS/fuRTJj0nyvjQaVcc6FK5unzVMtqAUB63ABzf6dNg1F88ow/8KVeo1E7ZlLAStxsY2cdG8JkjmwCFdk27Q71Kofmhew0hfo2YJwkZ29tRGlJnxsn06bP4KUgLWwGYz8fTIFyLtaWVUj3spG8ML6F7DSLn6Fyru6ixaw1CyCmCCFgBV2UStcIoca4Qp9W3BCwEq1YBU2Z2vuqhryljb6ubCEgJVucVoEjKy30fXkQxgAAlaaoGVTYka9Ha0zJ1YAAhYIWSeD/ah/BwABC1qGrLOEKwABC4QtoQoghS+GAGK6IggJVwBzaLaQxNETLaEKQMACTgYugQoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAyOcvSoeRE5SfCiMAAAAASUVORK5CYII="; // gezeichnete Unterschrift (600×200, transparent)
    const missing = await realFetch(`${apiBase}/api/vertrag/${sent.token}/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signerName: "Erika E2E", fields: {}, signatureImage: png, consent: true }) }); expect(missing.status).toBe(400); expect(((await missing.json()) as { error: string }).error).toContain("Bitte ausfüllen");
    const signed = await realFetch(`${apiBase}/api/vertrag/${sent.token}/sign`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", "user-agent": "E2E-Browser/1.0" }, body: JSON.stringify({ signerName: "Erika E2E", fields: { ustid: "DE123456789" }, signatureImage: png, method: "zeichnen", consent: true }) }); expect(signed.status).toBe(200);
    const done = await owner.leadops.getContract({ id: saved.id });
    expect(done.status).toBe("unterschrieben"); expect(done.signerName).toBe("Erika E2E"); expect(done.signerIp).toBe("203.0.113.9"); expect(done.signerUserAgent).toBe("E2E-Browser/1.0"); expect(done.signatureHash).toHaveLength(64); expect(done.values.ustid).toBe("DE123456789"); expect(done.signatureImage).toBe(png);
    expect(done.events.map((event) => event.kind)).toEqual(["erstellt", "geaendert", "gesendet", "angesehen", "unterschrieben"]);
    const again = await realFetch(`${apiBase}/api/vertrag/${sent.token}/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signerName: "X Y", fields: {}, signatureImage: png, consent: true }) }); expect(again.status).toBe(400); // nicht doppelt
    const proofPage = await (await realFetch(`${apiBase}/vertrag/${sent.token}`)).text(); expect(proofPage).toContain("Nachweis der elektronischen Unterschrift"); expect(proofPage).toContain(done.signatureHash!); expect(proofPage).toContain("203.0.113.9");
    const pdf = await realFetch(`${apiBase}/api/vertrag/${sent.token}/pdf`); expect(pdf.status).toBe(200); expect(pdf.headers.get("content-type")).toContain("application/pdf"); expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
    expect(Buffer.from((await owner.leadops.contractPdf({ id: saved.id })).base64, "base64").subarray(0, 4).toString()).toBe("%PDF");
    await expect(owner.leadops.deleteContract({ id: saved.id })).rejects.toThrow(/stornieren/);
    // Ablehnen, Erinnern, Stornieren, Vorlage, Kopie
    const ready = defaults.starter.blocks.map((block) => block.type === "detail" ? { ...block, value: block.value || "80 €" } : block);
    const second = await owner.leadops.saveContract({ title: "Zweiter", blocks: ready, values: { firma: "Zwei GmbH" } }); const sent2 = await owner.leadops.sendContract({ id: second.id, recipientEmail: "zwei@e2e-vertrag.example" });
    expect((await owner.leadops.remindContract({ id: second.id })).mail).toBeTruthy();
    const declined = await realFetch(`${apiBase}/api/vertrag/${sent2.token}/decline`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "Preis zu hoch" }) }); expect(declined.status).toBe(200);
    expect((await owner.leadops.getContract({ id: second.id })).declineReason).toBe("Preis zu hoch");
    const third = await owner.leadops.saveContract({ title: "Dritter", blocks: ready }); await owner.leadops.sendContract({ id: third.id, recipientEmail: "drei@e2e-vertrag.example" }); await owner.leadops.cancelContract({ id: third.id });
    expect((await owner.leadops.getContract({ id: third.id })).status).toBe("storniert"); expect((await realFetch(`${apiBase}/vertrag/${(await owner.leadops.getContract({ id: third.id })).token}`)).status).toBe(200);
    const template = await owner.leadops.saveContractTemplate({ name: "E2E-Vorlage", title: "Leadliefervertrag", blocks: defaults.starter.blocks }); expect((await owner.leadops.listContractTemplates()).some((row) => row.id === template.id)).toBe(true);
    const copy = await owner.leadops.duplicateContract({ id: saved.id }); expect((await owner.leadops.getContract({ id: copy.id })).status).toBe("entwurf");
    expect((await owner.leadops.listContracts()).filter((row) => ["Leadliefervertrag E2E", "Zweiter", "Dritter"].includes(row.title) || row.title.includes("(Kopie)")).length).toBeGreaterThanOrEqual(4);
    await owner.leadops.deleteContractTemplate({ id: template.id });
  }, 40000);
});
