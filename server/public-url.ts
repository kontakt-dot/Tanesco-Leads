/**
 * Öffentliche Adresse der App – für alles, was in E-Mails steht: Öffnungs-Zähler, Klick-Links, Abmelde-Link, Logo, Bilder.
 * Ohne Adresse wären das relative Links („/api/mail/o/…“), die in einem E-Mail-Programm nie ankommen – dann zählt
 * „Geöffnet“ nichts, Klicks und Abmelden gehen ins Leere.
 * Reihenfolge: APP_URL (fest eingestellt) → Railway-Domain (RAILWAY_PUBLIC_DOMAIN) → die Adresse, über die die App
 * zuletzt aufgerufen wurde. Fehlt APP_URL, wird sie beim Start bzw. beim ersten Aufruf gesetzt – so greifen alle Stellen.
 */
import type { Request } from "express";

let source: "APP_URL" | "Railway" | "Aufruf" | null = null;
const clean = (value: string | null | undefined) => (value ?? "").trim().replace(/\/+$/, "");
const isLocal = (host: string) => /^(localhost|127\.|0\.0\.0\.0|\[::1\]|::1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(host) || host.endsWith(".internal") || host.endsWith(".railway.internal");

/** Beim Start: fehlt APP_URL, aus der Railway-Domain ableiten. */
export function ensurePublicAppUrl() {
  if (clean(process.env.APP_URL)) { source = "APP_URL"; return process.env.APP_URL; }
  const railway = clean(process.env.RAILWAY_PUBLIC_DOMAIN).replace(/^https?:\/\//, "");
  if (railway) { process.env.APP_URL = `https://${railway}`; source = "Railway"; console.log(`[App-Adresse] APP_URL fehlt – benutze ${process.env.APP_URL} (Railway)`); }
  return process.env.APP_URL ?? null;
}
/** Bei jedem Aufruf: ist noch keine Adresse bekannt, die öffentliche Adresse des Aufrufs übernehmen (nie localhost/intern). */
export function rememberPublicHost(req: Request) {
  if (clean(process.env.APP_URL)) return;
  const host = String(req.get("x-forwarded-host") ?? req.get("host") ?? "").split(",")[0].trim(); if (!host || isLocal(host)) return;
  const proto = String(req.get("x-forwarded-proto") ?? req.protocol ?? "https").split(",")[0].trim() || "https";
  process.env.APP_URL = `${proto === "http" ? "http" : "https"}://${host}`; source = "Aufruf"; console.log(`[App-Adresse] APP_URL fehlt – benutze ${process.env.APP_URL} (aus dem Aufruf)`);
}
export function publicUrlStatus() { const url = clean(process.env.APP_URL); return { url: url || null, source: url ? source ?? "APP_URL" : null }; }
