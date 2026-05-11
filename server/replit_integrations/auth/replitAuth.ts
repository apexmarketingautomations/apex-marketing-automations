import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { authStorage } from "./storage";
import { storage } from "../../storage";

const getOidcConfig = memoize(
  async () => {
    const replId = process.env.REPL_ID;
    if (!replId) {
      console.warn("[AUTH] REPL_ID is not set — Replit OIDC disabled (expected on Railway)");
      return null;
    }
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      replId
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET || "apex-fallback-secret-change-in-production",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(claims: any) {
  const userId = claims["sub"];
  await authStorage.upsertUser({
    id: userId,
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
  try {
    const existing = await storage.getSubAccountsByUser(userId);
    if (!existing || existing.length === 0) {
      const displayName =
        [claims["first_name"], claims["last_name"]].filter(Boolean).join(" ").trim() ||
        (claims["email"] ? String(claims["email"]).split("@")[0] : "") ||
        "My Workspace";
      const created = await storage.createSubAccount({
        name: `${displayName}'s Workspace`,
        twilioNumber: "",
        ownerUserId: userId,
        plan: "starter",
        language: "en",
      } as any);
      console.log(`[AUTH] Auto-created default sub-account ${created.id} for new user ${userId}`);
    }
  } catch (e) {
    console.error("[AUTH] Default sub-account auto-create failed:", e instanceof Error ? e.message : e);
  }
}

const IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours of inactivity

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  app.use((req: any, _res, next) => {
    if (req.session && req.isAuthenticated && req.isAuthenticated()) {
      const now = Date.now();
      const lastActivity = req.session.lastActivity || now;
      if (now - lastActivity > IDLE_TIMEOUT_MS) {
        console.log(`[AUTH] Session idle timeout for user ${req.user?.id || req.user?.claims?.sub || 'unknown'} (${Math.round((now - lastActivity) / 60000)}m idle)`);
        return req.logout(() => {
          req.session?.destroy(() => {
            next();
          });
        });
      }
      req.session.lastActivity = now;
    }
    next();
  });

  app.get("/api/auth/session-info", (req: any, res) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.json({ authenticated: false });
    }
    const lastActivity = req.session?.lastActivity || Date.now();
    const idleMs = Date.now() - lastActivity;
    const remainingMs = Math.max(0, IDLE_TIMEOUT_MS - idleMs);
    res.json({
      authenticated: true,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
      remainingMs,
      lastActivity,
    });
  });

  // Register Google OAuth BEFORE checking REPL_ID — Google works without Replit
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: "/api/auth/google/callback",
          proxy: true,
        },
        async (_accessToken: string, _refreshToken: string, profile: any, done: any) => {
          try {
            const email = profile.emails?.[0]?.value;
            const googleId = `google_${profile.id}`;
            let existingUser = email ? await authStorage.getUserByEmail(email) : undefined;
            if (existingUser) {
              if (!existingUser.profileImageUrl && profile.photos?.[0]?.value) {
                await authStorage.upsertUser({ ...existingUser, profileImageUrl: profile.photos[0].value });
              }
              done(null, { id: existingUser.id, claims: { sub: existingUser.id }, authProvider: "google" });
            } else {
              await authStorage.upsertUser({
                id: googleId,
                email: email || null,
                firstName: profile.name?.givenName || null,
                lastName: profile.name?.familyName || null,
                profileImageUrl: profile.photos?.[0]?.value || null,
                authProvider: "google",
              });
              done(null, { id: googleId, claims: { sub: googleId }, authProvider: "google" });
            }
          } catch (error) {
            done(error as Error);
          }
        }
      )
    );
    app.get("/api/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
    app.get("/api/auth/google/callback", passport.authenticate("google", { failureRedirect: "/login" }), (_req: any, res: any) => {
      res.redirect("/");
    });
    console.log("[AUTH] ✅ Google OAuth strategy enabled");
  } else {
    console.log("[AUTH] Google OAuth not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing)");
  }

  const config = await getOidcConfig();

  if (!config) {
    console.warn("[AUTH] Skipping Replit OIDC strategy registration — REPL_ID not set");
    return;
  }

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  // Keep track of registered strategies
  const registeredStrategies = new Set<string>();

  // Helper function to ensure strategy exists for a domain
  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });


}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (user.authProvider === "email" || user.authProvider === "google" || user.authProvider === "firebase") {
    return next();
  }

  if (!user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
