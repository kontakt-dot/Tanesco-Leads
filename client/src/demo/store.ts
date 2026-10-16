/**
 * Demo-Datenhaltung für den Chat-Build von Tanesco Leads.
 * Ersetzt die MySQL-Datenbank durch einen In-Memory-Store, der im
 * localStorage des Browsers persistiert wird. Alle Tabellen entsprechen
 * den Drizzle-Tabellen aus drizzle/schema.ts (Feldnamen 1:1).
 */

export type Row = Record<string, any> & { id: number };

export const TABLES = [
  "users", "tenants", "tenantSettings", "reclamationReasons", "apiTokens", "partnerIntegrations", "integrationEvents",
  "memberships", "memberOperationalSettings", "invitations", "teams", "tags", "suppliers", "organizationProfiles", "supplierInboundMappings", "balanceTransactions", "deliveryEndpoints", "partnerResponseRules", "supplierReturnWebhooks", "partnerAccounts", "partnerCancelRules", "partnerCallbacks", "callQaConfigs", "callRecords", "callQaCampaigns", "telephonySettings", "metaConnections", "adInsights", "pipelineEvents", "emailCampaigns", "listImports", "activityLog", "emailCampaignRecipients", "emailCampaignEvents", "mailSettings", "inboxMessages", "companyProspects", "pipelineStageConfigs", "pipelineNotes", "pipelineTasks", "leadCallAttempts", "pipelineSettings", "outboundMessages", "emailSuppressions", "phoneNumbers", "dialerCampaigns", "dialerQueueItems", "agentSessions", "dialerCalls", "rawBatches", "rawContacts", "d2dAgencies", "d2dReps", "d2dCaptures", "d2dDailyStats", "d2dSettings", "integrationPresets",
  "leadCategories", "categoryFields", "categoryFieldMappings", "leads", "leadStatusEvents", "leadDeletionEvents",
  "leadImportBatches", "leadTagAssignments", "orders", "orderOperationalConfigs", "orderEvents", "deliveryChains",
  "deliveryStops", "deliveryStopReasons", "leadDeliveries", "automationRules", "automationExecutionLogs", "cooperations",
  "cooperationCategoryMappings", "cooperationFieldMappings", "marketplaceOffers", "marketplacePurchases",
  "marketplacePriceHistory", "claims", "claimEvents", "supportTickets", "emailTemplates", "emailEvents", "products",
  "invoices", "teamProductAssignments", "productOperationalConfigs", "termsAcceptances", "impersonationSessions",
] as const;

export type TableName = (typeof TABLES)[number];
export type Store = { version: number; seq: Record<string, number>; tables: Record<TableName, Row[]> };

export const STORE_KEY = "tanesco-leads-demo-store";
export const STORE_VERSION = 38; // 38: Upload-Verlauf mit Löschungen, Mehrfach-Durchlauf (maxRuns) – davor 37: Antwort-Stopp-Schalter je Kampagne (stopOnReply) – davor 36: Anrufzähler (leadCallAttempts), Stufe „In Bearbeitung“, Vertriebler-Verwaltung – davor 35: zweite Rohdaten-Liste „Handwerk Rhein-Main“ (18 Kontakte, von drei Agenten abtelefoniert, Leads/verkauft) für Rohdaten- und Agenten-Auswertung – davor 34: Live-Bild (Dialer-Kampagne mit Wählliste, Sitzungen von Taner/Francesco, Gespräche heute), sipgate statt Twilio – davor 33: Glocke mit Tagesverlauf (activityLog), Tracking je gesendeter Mail, Vorlagen unter den Kampagnen – davor 32: Gesendet-Ordner, Tags beim Upload, Listen ansehen, Versandfenster je Wochentag – davor 31: E-Mail-Verlauf am Lead (Antworten aus dem Posteingang gespeichert, Vorgeschichte Mayer) // 30: KI-Einordnung im Posteingang (Beschwerden automatisch sperren), Zeitraum-Filter // 29: Trennung Verkaufs-Leads/Vertriebskontakte, Sperrliste mit Unterlisten, Kürzel WTG/ERS/HÖR/TRL, Kategoriefarben // 28: Wiedervorlagen, Termine, Angebotswerte, Nachrichten, Team-Ziele, A/B-Test, Sperrliste // 27: Kürzel HG/ER/WG/TL // 26: Kategorie-Emojis, Aufzeichnung ohne Abfrage // 25: Rufnummer im Seed, Dialer in der Pipeline // 24: automatische Gesprächsnotizen (Dialer) // 23: Kategorie Hörgeräte, Bestell-/Kettendaten ohne Zukunftsdatum // 14: Kategorien Fenster/Treppenlifte/Bäder/Alarmanlagen/Wintergärten, Haustür-Spezifikation, E-Mail-Automatik

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function reviver(_key: string, value: unknown) {
  return typeof value === "string" && ISO_DATE.test(value) ? new Date(value) : value;
}

export function emptyStore(): Store {
  const tables = Object.fromEntries(TABLES.map((name) => [name, []])) as unknown as Record<TableName, Row[]>;
  return { version: STORE_VERSION, seq: {}, tables };
}

export function loadStore(): Store | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw, reviver) as Store;
    if (!parsed || parsed.version !== STORE_VERSION || !parsed.tables) return null;
    for (const name of TABLES) if (!Array.isArray(parsed.tables[name])) parsed.tables[name] = [];
    return parsed;
  } catch {
    return null;
  }
}

let saveTimer: number | undefined;
export function scheduleSave(store: Store) {
  if (typeof window === "undefined") return;
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* Speicher nicht verfügbar */ }
  }, 150);
}

export function clearStore() {
  try { window.localStorage.removeItem(STORE_KEY); } catch { /* ignorieren */ }
}

/** Nächste Auto-Increment-ID einer Tabelle. */
export function nextId(store: Store, table: TableName) {
  const current = store.seq[table] ?? Math.max(0, ...store.tables[table].map((row) => row.id));
  const next = current + 1;
  store.seq[table] = next;
  return next;
}

export function insert<T extends Record<string, any>>(store: Store, table: TableName, values: T): T & { id: number } {
  const id = nextId(store, table);
  const now = new Date();
  const row = { createdAt: now, ...values, id } as T & { id: number };
  if (!("updatedAt" in row) && ["tenants", "tenantSettings", "partnerIntegrations", "memberOperationalSettings", "organizationProfiles", "leadCategories", "categoryFields", "leads", "orderOperationalConfigs", "deliveryChains", "automationRules", "cooperations", "supportTickets", "emailTemplates", "productOperationalConfigs"].includes(table)) (row as any).updatedAt = now;
  store.tables[table].push(row);
  return row;
}

export function update(store: Store, table: TableName, predicate: (row: Row) => boolean, values: Record<string, any>) {
  let count = 0;
  for (const row of store.tables[table]) {
    if (!predicate(row)) continue;
    for (const [key, value] of Object.entries(values)) if (value !== undefined) row[key] = value;
    if ("updatedAt" in row) row.updatedAt = new Date();
    count += 1;
  }
  return count;
}

export function remove(store: Store, table: TableName, predicate: (row: Row) => boolean) {
  const before = store.tables[table].length;
  store.tables[table] = store.tables[table].filter((row) => !predicate(row));
  return before - store.tables[table].length;
}

export const money = (value: number | string | null | undefined) => Number(value ?? 0).toFixed(2);

export function randomId(length: number) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function tokenId(length: number) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
