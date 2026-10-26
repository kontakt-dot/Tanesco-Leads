import "dotenv/config";
import express from "express";
import path from "node:path";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { registerStripeWebhook } from "../stripe";
import { registerPublicApiRoutes } from "../publicApi";
import { ensurePublicAppUrl, rememberPublicHost } from "../public-url";
import { startDeliveryScheduler, startDialerScheduler, startEmailCampaignScheduler } from "../delivery-scheduler";
import { runIntegrationHealthChecks } from "../integration-health";
import { registerFileRoutes } from "../storage";
import { registerTelephonyRoutes } from "../telephony-routes";
import { ENV } from "./env";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  ensurePublicAppUrl(); // APP_URL fehlt? → Railway-Domain, sonst die Adresse des ersten Aufrufs (Links/Zähler in E-Mails brauchen eine volle Adresse)
  app.use((req, _res, next) => { rememberPublicHost(req); next(); });
  registerStripeWebhook(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb", verify: (req, _res, buf) => { (req as unknown as { rawBody?: string }).rawBody = buf.toString("utf8"); } })); // Rohdaten für Webhook-Signaturen (Meta)
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads"), { maxAge: "7d" })); // Bilder aus dem E-Mail-Builder
  registerPublicApiRoutes(app);
  startDialerScheduler(); // Predictive-Dialer (DIALER_TICK_SECONDS, Standard 5, 0 = aus)
  startEmailCampaignScheduler(); // E-Mail-Kampagnen im Minutentakt (EMAIL_CAMPAIGN_TICK_SECONDS, Standard 60)
  startDeliveryScheduler(); // Lieferintervalle + Wiederholungen (DELIVERY_SCHEDULER_INTERVAL_MINUTES, Standard 15, 0 = aus)
  registerFileRoutes(app);
  app.use("/api/telephony", express.urlencoded({ extended: false }));
  registerTelephonyRoutes(app);
  // Geplante Integrationsprüfung: von außen per POST mit Header "x-cron-secret: <CRON_SECRET>" auslösbar
  app.post("/api/scheduled/integration-health", async (req, res) => {
    try {
      if (!ENV.cronSecret || req.headers["x-cron-secret"] !== ENV.cronSecret) return res.status(403).json({ error: "cron-only" });
      const result = await runIntegrationHealthChecks();
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : "healthcheck-failed", timestamp: new Date().toISOString() });
    }
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
