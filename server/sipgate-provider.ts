/**
 * sipgate als Telefonie-Anbieter hinter dem Dialer (REST API v2, https://api.sipgate.com/v2).
 *
 * So läuft ein Anruf: Die Software sagt sipgate „ruf von Gerät e0 die Nummer X an, zeige Rufnummer Y“ (Click-to-Dial).
 * sipgate klingelt zuerst das Gerät des Agenten (sipgate-App, Tischtelefon oder externes Handy) und verbindet dann
 * zum Kunden. Ein Browser-Softphone wie bei Twilio gibt es nicht – dafür braucht man keine Rufnummern zu kaufen,
 * die kommen aus dem sipgate-Konto. Status-Ereignisse (klingelt, verbunden, aufgelegt) kommen über die Push-API
 * (sipgate.io-Webhooks) oder – falls nicht eingerichtet – über regelmäßiges Nachsehen in der Liste der aktiven Anrufe.
 * Aufzeichnung: per API starten; die fertige Datei taucht später im Verlauf (History bzw. Channel-Events) auf.
 *
 * Zwei sipgate-Systeme: „classic“ (sipgate basic/team/trunking: POST /sessions/calls, GET /history) und
 * „neo“ (POST /calls, GET /channels/{id}/events). Die Software erkennt das System beim Prüfen der Verbindung.
 */
import type { AvailableNumber, MessageInput, MessageResult, NumberSearch, OriginateInput, OriginateResult, PurchasedNumber, TelephonyProvider } from "./telephony-provider";

export type SipgateCredentials = { tokenId: string; token: string };
export type SipgateSystem = "classic" | "neo";
export type SipgateOptions = { userId?: string | null; system?: SipgateSystem | null; deviceId?: string | null; smsId?: string | null; fetchImpl?: typeof fetch };
export type SipgateDevice = { id: string; alias: string; type: string; online: boolean | null; dnd: boolean | null };
export type SipgateNumber = { id: string; e164: string; localized: string; type: string; endpointAlias: string | null };
export type SipgateHistoryEntry = { id: string; target: string | null; source: string | null; createdAt: Date; durationSeconds: number | null; status: string | null; recordingUrl: string | null; direction: string | null };
export type SipgateWebhookSettings = { incomingUrl: string; outgoingUrl: string; log: boolean; whitelist: string[] | null };

export const SIPGATE_BASE = "https://api.sipgate.com/v2";
const digits = (value: string | null | undefined) => String(value ?? "").replace(/\D/g, "");
/** Zwei Rufnummern gleich? Vergleicht die letzten acht Ziffern – reicht gegen Formatunterschiede (+49 / 0049 / 0…). */
export const sameNumber = (a: string | null | undefined, b: string | null | undefined) => { const x = digits(a); const y = digits(b); return x.length >= 6 && y.length >= 6 && x.slice(-8) === y.slice(-8); };
const SYSTEM_HINT: Record<number, string> = {
  401: "Token-ID oder Token stimmen nicht (sipgate → Konto → Personal Access Token).",
  402: "Guthaben bei sipgate reicht nicht aus.",
  403: "Der Token darf das nicht – bitte die nötigen Rechte (Scopes) beim Anlegen des Tokens ankreuzen.",
  404: "Diesen Weg kennt sipgate nicht – vielleicht passt das erkannte System (classic/neo) nicht; „Verbindung prüfen“ erneut ausführen.",
  415: "sipgate erwartet JSON (Content-Type).",
};

export class SipgateProvider implements TelephonyProvider {
  readonly name = "sipgate" as const;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly credentials: SipgateCredentials, readonly options: SipgateOptions = {}) { this.fetchImpl = options.fetchImpl ?? fetch; }
  private get auth() { return `Basic ${Buffer.from(`${this.credentials.tokenId}:${this.credentials.token}`).toString("base64")}`; }
  get system(): SipgateSystem { return this.options.system === "neo" ? "neo" : "classic"; }
  get userId() { return this.options.userId || "w0"; }

  /** HTTP-Aufruf gegen die sipgate-API; Fehler kommen als „sipgate: …“ mit Hinweis in Klartext. */
  async request<T = unknown>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown, options: { allow404?: boolean } = {}): Promise<T> {
    const response = await this.fetchImpl(`${SIPGATE_BASE}${path}`, { method, headers: { authorization: this.auth, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await response.text();
    if (!response.ok) {
      if (response.status === 404 && options.allow404) return null as T;
      let message = ""; try { const parsed = JSON.parse(text) as { message?: string; error?: string; errors?: Array<{ message?: string }> }; message = parsed.message ?? parsed.error ?? parsed.errors?.map((item) => item.message).filter(Boolean).join(", ") ?? ""; } catch { message = text.slice(0, 200); }
      throw new Error(`sipgate (HTTP ${response.status}): ${SYSTEM_HINT[response.status] ?? ""}${message ? ` ${message}` : ""}`.trim());
    }
    if (!text) return {} as T;
    try { return JSON.parse(text) as T; } catch { return {} as T; }
  }

  /* ---------------------------------------------------------------- Konto, Geräte, Rufnummern */
  /** Wer ist der Token? Liefert die Benutzer-ID („w0“) und die Konto-ID. */
  async userInfo(): Promise<{ userId: string; masterSipId: string | null; domain: string | null }> {
    const data = await this.request<{ sub?: string; masterSipId?: string; domain?: string }>("GET", "/authorization/userinfo");
    const match = /w\d+$/.exec(String(data.sub ?? "")); return { userId: match ? match[0] : "w0", masterSipId: data.masterSipId ?? null, domain: data.domain ?? null };
  }
  /** classic oder neo? Neo-Konten haben „Channels“, classic-Konten nicht. */
  async detectSystem(): Promise<SipgateSystem> {
    const channels = await this.request<{ items?: unknown[] } | null>("GET", "/channels", undefined, { allow404: true }).catch(() => null);
    return channels && Array.isArray(channels.items) ? "neo" : "classic";
  }
  async devices(userId = this.userId): Promise<SipgateDevice[]> {
    const data = await this.request<{ items?: Array<{ id: string; alias?: string; type?: string; online?: boolean; dnd?: boolean }> }>("GET", `/${userId}/devices`);
    return (data.items ?? []).map((item) => ({ id: item.id, alias: item.alias ?? item.id, type: item.type ?? "", online: typeof item.online === "boolean" ? item.online : null, dnd: typeof item.dnd === "boolean" ? item.dnd : null }));
  }
  async numbers(): Promise<SipgateNumber[]> {
    const data = await this.request<{ items?: Array<{ id: string; number: string; localized?: string; type?: string; endpointAlias?: string }> }>("GET", "/numbers");
    return (data.items ?? []).filter((item) => item.number && item.type !== "QUICKDIAL").map((item) => ({ id: String(item.id), e164: item.number.startsWith("+") ? item.number : `+${digits(item.number)}`, localized: item.localized ?? item.number, type: item.type ?? "", endpointAlias: item.endpointAlias ?? null }));
  }

  /* ---------------------------------------------------------------- Anrufe */
  /** Click-to-Dial: zuerst klingelt das Gerät des Agenten, dann wird der Kunde gerufen. Liefert die sipgate-callId, sobald der Anruf in der Liste der aktiven Anrufe auftaucht. */
  async originateCall(input: OriginateInput): Promise<OriginateResult> {
    const deviceId = input.deviceId || this.options.deviceId; if (!deviceId) throw new Error("Kein sipgate-Gerät gewählt (Telefonie → Einstellungen → sipgate bzw. beim Start der Sitzung).");
    const callerId = input.from.replace(/\s+/g, "");
    const body = { deviceId, caller: deviceId, callee: input.to, callerId };
    const data = await this.request<{ sessionId?: string }>("POST", this.system === "neo" ? "/calls" : "/sessions/calls", body);
    const sessionId = data.sessionId ? String(data.sessionId) : "";
    const callId = await this.findCallId(input.to, input.timeoutSeconds ?? 6);
    return { providerCallSid: callId ?? (sessionId ? `session:${sessionId}` : `pending:${Date.now()}`), providerSessionId: sessionId || null };
  }
  /** Aktive Anrufe (Echtzeit-Anrufsteuerung). */
  async activeCalls(): Promise<Array<{ callId: string; participants: string[]; recording: boolean | null }>> {
    const data = await this.request<{ data?: unknown[]; items?: unknown[] }>("GET", "/calls");
    const rows = (Array.isArray(data.data) ? data.data : Array.isArray(data.items) ? data.items : []) as Array<{ callId?: string; recording?: boolean; participants?: Array<{ phoneNumber?: string }> }>;
    return rows.filter((row) => row.callId).map((row) => ({ callId: String(row.callId), participants: (row.participants ?? []).map((item) => String(item.phoneNumber ?? "")).filter(Boolean), recording: typeof row.recording === "boolean" ? row.recording : null }));
  }
  /** Sucht in den aktiven Anrufen den zur Zielnummer; wartet dafür bis zu `seconds` Sekunden (der Agent muss erst abheben). */
  async findCallId(to: string, seconds = 6, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))): Promise<string | null> {
    const until = Date.now() + seconds * 1000;
    for (;;) {
      const calls = await this.activeCalls().catch(() => [] as Array<{ callId: string; participants: string[] }>);
      const hit = calls.find((call) => call.participants.some((number) => sameNumber(number, to)));
      if (hit) return hit.callId;
      if (Date.now() >= until) return null;
      await sleep(1000);
    }
  }
  async hangupCall(providerCallSid: string) { if (!/^(session|pending):/.test(providerCallSid)) await this.request("DELETE", `/calls/${encodeURIComponent(providerCallSid)}`); }
  async redirectCall() { throw new Error("Weiterleiten über sipgate ist in der Software nicht vorgesehen."); }
  /** Aufzeichnung starten – mit `announcement` spielt sipgate seine eigene Ansage „Dieses Gespräch wird aufgezeichnet“. */
  async startRecording(providerCallSid: string, _callbackUrl: string, options: { announcement?: boolean } = {}) {
    if (/^(session|pending):/.test(providerCallSid)) throw new Error("Die sipgate-Anruf-ID ist noch nicht bekannt – die Aufzeichnung kann erst starten, wenn der Anruf verbunden ist.");
    await this.request("PUT", `/calls/${encodeURIComponent(providerCallSid)}/recording`, { value: true, announcement: options.announcement ?? false });
    return { recordingSid: `sg-${providerCallSid}`.slice(0, 64) };
  }
  async stopRecording(providerCallSid: string) { await this.request("PUT", `/calls/${encodeURIComponent(providerCallSid)}/recording`, { value: false, announcement: false }); }
  async accessToken() { return null; }

  /* ---------------------------------------------------------------- SMS */
  async sendMessage(input: MessageInput): Promise<MessageResult> {
    if (input.channel !== "sms") throw new Error("WhatsApp geht über sipgate nicht – nur SMS.");
    await this.request("POST", "/sessions/sms", { smsId: this.options.smsId || "s0", recipient: input.to, message: input.body });
    return { providerMessageSid: `sms-sg-${Date.now()}`, status: "gesendet" };
  }

  /* ---------------------------------------------------------------- Rufnummern (kommen aus dem sipgate-Konto) */
  async searchNumbers(_search: NumberSearch): Promise<AvailableNumber[]> { throw new Error("Rufnummern kauft man direkt bei sipgate – vorhandene Nummern holst du mit „Rufnummern aus sipgate übernehmen“ (Telefonie → Einstellungen)."); }
  async purchaseNumber(): Promise<PurchasedNumber> { throw new Error("Rufnummern kauft man direkt bei sipgate."); }
  async releaseNumber() { /* nur in der Software entfernen – bei sipgate bleibt die Nummer */ }

  /* ---------------------------------------------------------------- Verlauf & Aufzeichnungen */
  /** Anrufe im Verlauf (classic: /history, neo: Channel-Events) – zum Nachtragen von Dauer, Ergebnis und Aufzeichnung. */
  async history(options: { since: Date; until: Date }): Promise<SipgateHistoryEntry[]> {
    const normalize = (row: Record<string, unknown>): SipgateHistoryEntry => {
      const recordings = Array.isArray(row.recordings) ? (row.recordings as Array<Record<string, unknown>>) : [];
      const recordingUrl = typeof row.recordingUrl === "string" && row.recordingUrl ? row.recordingUrl : recordings.map((item) => item.url ?? item.recordingUrl ?? item.downloadUrl).find((value): value is string => typeof value === "string" && value.length > 0) ?? null;
      const rawDuration = Number(row.duration ?? NaN); const durationSeconds = Number.isFinite(rawDuration) ? Math.round(rawDuration > 86_400 ? rawDuration / 1000 : rawDuration) : null; // Millisekunden oder Sekunden – beides kam schon vor
      return { id: String(row.id ?? ""), target: typeof row.target === "string" ? row.target : null, source: typeof row.source === "string" ? row.source : null, createdAt: new Date(String(row.created ?? row.createdAt ?? Date.now())), durationSeconds, status: typeof row.status === "string" ? row.status : null, recordingUrl, direction: typeof row.direction === "string" ? row.direction : null };
    };
    if (this.system === "neo") {
      const channels = await this.request<{ items?: Array<{ id: string }> }>("GET", "/channels");
      const out: SipgateHistoryEntry[] = [];
      for (const channel of (channels.items ?? []).slice(0, 10)) {
        const events = await this.request<{ items?: Array<Record<string, unknown>> }>("GET", `/channels/${encodeURIComponent(channel.id)}/events?limit=50`).catch(() => ({ items: [] }));
        out.push(...(events.items ?? []).map(normalize));
      }
      return out.filter((entry) => entry.createdAt >= options.since && entry.createdAt <= options.until);
    }
    const params = new URLSearchParams({ types: "CALL", from: options.since.toISOString(), to: options.until.toISOString(), limit: "100" });
    const data = await this.request<{ items?: Array<Record<string, unknown>> }>("GET", `/history?${params}`);
    return (data.items ?? []).map(normalize);
  }
  /** Aufzeichnungsdatei mit den Zugangsdaten laden (die Datei liegt bei sipgate). */
  async fetchRecording(url: string) { return this.fetchImpl(url, { headers: { authorization: this.auth } }); }

  /* ---------------------------------------------------------------- Push-API (sipgate.io-Webhooks) */
  async webhookSettings(): Promise<SipgateWebhookSettings | null> {
    const data = await this.request<{ incomingUrl?: string; outgoingUrl?: string; log?: boolean; whitelist?: string[] | null } | null>("GET", "/settings/sipgateio", undefined, { allow404: true });
    return data ? { incomingUrl: data.incomingUrl ?? "", outgoingUrl: data.outgoingUrl ?? "", log: Boolean(data.log), whitelist: data.whitelist ?? null } : null;
  }
  async saveWebhookSettings(input: { incomingUrl: string; outgoingUrl: string; log?: boolean; whitelist?: string[] | null }) {
    await this.request("PUT", "/settings/sipgateio", { incomingUrl: input.incomingUrl, outgoingUrl: input.outgoingUrl, log: input.log ?? true, whitelist: input.whitelist ?? null });
  }
}

/* ------------------------------------------------------------------ Push-API-Ereignisse */

export type SipgateEvent = { event: "newCall" | "answer" | "hangup" | "dtmf" | string; callId: string; direction: "in" | "out" | null; from: string | null; to: string | null; cause: string | null; userIds: string[]; answeringNumber: string | null };
const first = (value: unknown): string | null => Array.isArray(value) ? (value.length ? String(value[0]) : null) : value === undefined || value === null || value === "" ? null : String(value);
/** Formulardaten eines sipgate-Webhooks (application/x-www-form-urlencoded) in ein sauberes Ereignis verwandeln. */
export function parseSipgateEvent(body: Record<string, unknown>): SipgateEvent {
  const userIds = ([] as unknown[]).concat(body["userId[]"] ?? body.userId ?? []).map(String);
  return { event: String(first(body.event) ?? ""), callId: String(first(body.callId) ?? ""), direction: first(body.direction) === "in" ? "in" : first(body.direction) === "out" ? "out" : null, from: first(body.from), to: first(body.to), cause: first(body.cause), userIds, answeringNumber: first(body.answeringNumber) };
}
/** Hangup-Grund von sipgate → Status, wie ihn der Dialer von Twilio kennt. */
export function sipgateStatusOf(event: SipgateEvent): string | null {
  if (event.event === "newCall") return "ringing";
  if (event.event === "answer") return "in-progress";
  if (event.event !== "hangup") return null;
  switch (event.cause) {
    case "busy": return "busy";
    case "cancel": return "canceled";
    case "noAnswer": return "no-answer";
    case "congestion": case "notFound": return "failed";
    default: return "completed"; // normalClearing, forwarded
  }
}
const escapeXml = (value: string) => value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char] ?? char);
/** Antwort auf ein newCall-Ereignis: sipgate soll uns auch „abgenommen“ und „aufgelegt“ melden. */
export const sipgateResponseXml = (options: { onAnswer: string; onHangup: string }) => `<?xml version="1.0" encoding="UTF-8"?><Response onAnswer="${escapeXml(options.onAnswer)}" onHangup="${escapeXml(options.onHangup)}" />`;
export const sipgateEmptyXml = () => `<?xml version="1.0" encoding="UTF-8"?><Response />`;
