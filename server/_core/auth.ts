/**
 * Eigene Anmeldung mit E-Mail und Passwort – ersetzt den Manus-OAuth-Login.
 * Sitzungen bleiben ein signiertes JWT im HttpOnly-Cookie (JWT_SECRET).
 */
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";

const scrypt = promisify(scryptCallback);

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined) {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function validatePasswordStrength(password: string) {
  if (password.length < 10) return "Das Passwort muss mindestens 10 Zeichen lang sein.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Das Passwort muss Buchstaben und mindestens eine Ziffer enthalten.";
  return null;
}

export function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

const secretKey = () => { if (!ENV.cookieSecret) throw new Error("JWT_SECRET ist nicht gesetzt."); return new TextEncoder().encode(ENV.cookieSecret); };

export async function signSession(openId: string, name: string, expiresInMs = ONE_YEAR_MS, actorOpenId?: string | null) {
  return new SignJWT({ openId, name, ...(actorOpenId ? { actorOpenId } : {}) }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuedAt().setExpirationTime(Math.floor((Date.now() + expiresInMs) / 1000)).sign(secretKey());
}

export type SessionClaims = { openId: string; name: string; actorOpenId: string | null };

export async function verifySession(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    const openId = payload.openId; if (typeof openId !== "string" || !openId) return null;
    return { openId, name: typeof payload.name === "string" ? payload.name : "", actorOpenId: typeof payload.actorOpenId === "string" ? payload.actorOpenId : null };
  } catch { return null; }
}

export function sessionTokenFromRequest(req: Request) {
  const cookies = req.headers.cookie ? parseCookieHeader(req.headers.cookie) : {};
  let token = cookies[COOKIE_NAME];
  const authHeader = req.headers.authorization;
  if (!token && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) token = authHeader.slice(7);
  return token;
}

/** „Als Benutzer eingeloggt“: liefert den ursprünglichen Administrator, wenn die Sitzung eine Impersonation ist. */
export async function impersonatorOf(req: Request): Promise<User | null> {
  const claims = await verifySession(sessionTokenFromRequest(req));
  if (!claims?.actorOpenId) return null;
  return (await db.getUserByOpenId(claims.actorOpenId)) ?? null;
}

/** Liest die Sitzung aus Cookie oder Authorization-Header und liefert den Benutzer. */
export async function authenticateRequest(req: Request): Promise<User> {
  const session = await verifySession(sessionTokenFromRequest(req));
  if (!session) throw ForbiddenError("Invalid session cookie");
  const user = await db.getUserByOpenId(session.openId);
  if (!user) throw ForbiddenError("User not found");
  await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
  return user;
}

export const sdk = { authenticateRequest, signSession, verifySession, createSessionToken: (openId: string, options: { name?: string; expiresInMs?: number } = {}) => signSession(openId, options.name ?? "", options.expiresInMs) };
