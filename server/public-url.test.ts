import { afterEach, describe, expect, it } from "vitest";
import { ensurePublicAppUrl, publicUrlStatus, rememberPublicHost } from "./public-url";

const saved = { app: process.env.APP_URL, railway: process.env.RAILWAY_PUBLIC_DOMAIN };
afterEach(() => { if (saved.app === undefined) delete process.env.APP_URL; else process.env.APP_URL = saved.app; if (saved.railway === undefined) delete process.env.RAILWAY_PUBLIC_DOMAIN; else process.env.RAILWAY_PUBLIC_DOMAIN = saved.railway; });
const req = (host: string, proto = "https", forwarded?: string) => ({ get: (name: string) => (name === "host" ? host : name === "x-forwarded-proto" ? proto : name === "x-forwarded-host" ? forwarded : undefined), protocol: "http" }) as never;

describe("Öffentliche App-Adresse für Links in E-Mails", () => {
  it("APP_URL hat Vorrang, sonst Railway-Domain, sonst die Adresse des ersten öffentlichen Aufrufs", () => {
    process.env.APP_URL = "https://leads.tanesco.example"; process.env.RAILWAY_PUBLIC_DOMAIN = "x.up.railway.app"; ensurePublicAppUrl(); expect(process.env.APP_URL).toBe("https://leads.tanesco.example");
    delete process.env.APP_URL; ensurePublicAppUrl(); expect(process.env.APP_URL).toBe("https://x.up.railway.app"); expect(publicUrlStatus()).toEqual({ url: "https://x.up.railway.app", source: "Railway" });
    delete process.env.APP_URL; delete process.env.RAILWAY_PUBLIC_DOMAIN; ensurePublicAppUrl(); expect(process.env.APP_URL).toBeUndefined();
    rememberPublicHost(req("127.0.0.1:3000")); expect(process.env.APP_URL).toBeUndefined(); // lokal/intern nie
    rememberPublicHost(req("app.railway.internal")); expect(process.env.APP_URL).toBeUndefined();
    rememberPublicHost(req("10.0.0.5:8080", "https", "leads.tanesco.example")); expect(process.env.APP_URL).toBe("https://leads.tanesco.example"); expect(publicUrlStatus().source).toBe("Aufruf");
    rememberPublicHost(req("andere.example")); expect(process.env.APP_URL).toBe("https://leads.tanesco.example"); // einmal gesetzt, bleibt sie
  });
});
