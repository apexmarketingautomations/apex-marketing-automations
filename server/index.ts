import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seed } from "./seed";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "1mb" }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const responseStr = JSON.stringify(capturedJsonResponse);
        logLine += ` :: ${responseStr.length > 200 ? responseStr.substring(0, 200) + "...[truncated]" : responseStr}`;
      }

      log(logLine);
    }
  });

  next();
});

function validateEnvVars() {
  const required: { key: string; label: string; critical: boolean }[] = [
    { key: "VAPI_API_KEY", label: "Vapi Private API Key (for server-side calls)", critical: true },
    { key: "VAPI_PUBLIC_KEY", label: "Vapi Public Key (for browser demo calls)", critical: false },
    { key: "TWILIO_ACCOUNT_SID", label: "Twilio Account SID", critical: false },
    { key: "TWILIO_AUTH_TOKEN", label: "Twilio Auth Token", critical: false },
  ];

  let hasError = false;
  for (const { key, label, critical } of required) {
    if (!process.env[key]) {
      const level = critical ? "ERROR" : "WARN";
      console.error(`[${level}] Missing environment variable: ${key} — ${label}`);
      if (critical) hasError = true;
    }
  }

  if (hasError) {
    console.error("[STARTUP] Some critical environment variables are missing. Voice agent features will be unavailable.");
  }

  if (process.env.TWILIO_ACCOUNT_SID && !process.env.TWILIO_AUTH_TOKEN) {
    console.error("[WARN] TWILIO_ACCOUNT_SID is set but TWILIO_AUTH_TOKEN is missing — Twilio will not work.");
  }
  if (!process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    console.error("[WARN] TWILIO_AUTH_TOKEN is set but TWILIO_ACCOUNT_SID is missing — Twilio will not work.");
  }
}

(async () => {
  validateEnvVars();
  await seed();
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
