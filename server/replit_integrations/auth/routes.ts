import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import bcrypt from "bcryptjs";
import admin from "firebase-admin";
import { db } from "../../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { isAdminFlag } from "../../auth/authorization";

let firebaseInitialized = false;
function initFirebaseAdmin() {
  if (firebaseInitialized) return;
  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        projectId: "apex-ma",
      });
    }
    firebaseInitialized = true;
    console.log("[AUTH] Firebase Admin initialized");
  } catch (err: any) {
    console.warn("[AUTH] Firebase Admin init failed:", err.message);
  }
}

export function registerAuthRoutes(app: Express): void {
  initFirebaseAdmin();
  app.get("/api/auth/user", async (req: any, res) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const userId = req.user.claims?.sub || req.user.id;
      const user = await authStorage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const adminUserId = process.env.ADMIN_USER_ID;

      // Strip server-only fields before sending the user record to the client.
      const { passwordHash, ...safeUser } = user as any;

      // Admin if env-var ID matches OR the DB isAdmin flag was explicitly set
      const isDevAdmin = (adminUserId && userId === adminUserId) || isAdminFlag(safeUser.isAdmin);

      res.json({
        ...safeUser,
        ...(isDevAdmin ? {
          role: "DEV_ADMIN",
          isPaid: true,
          radius: 999999,
          permissions: ["all"],
        } : {
          role: "user",
        }),
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, firstName, lastName } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        return res.status(400).json({ message: "Password must contain at least one uppercase letter, one lowercase letter, and one number" });
      }

      const existing = await authStorage.getUserByEmail(email.toLowerCase().trim());
      if (existing) {
        return res.status(409).json({ message: "An account with this email already exists" });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const userId = `apex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      await authStorage.upsertUser({
        id: userId,
        email: email.toLowerCase().trim(),
        firstName: firstName || null,
        lastName: lastName || null,
        profileImageUrl: null,
        passwordHash,
        authProvider: "email",
      });

      const user = await authStorage.getUser(userId);

      req.session.regenerate?.((regenErr: any) => {
        if (regenErr) {
          console.error("[AUTH] Session regenerate failed:", regenErr.message);
          return res.status(500).json({ message: "Account created but session initialization failed" });
        }
        req.login({ id: userId, claims: { sub: userId }, authProvider: "email" }, (err: any) => {
          if (err) {
            console.error("Login after register failed:", err);
            return res.status(500).json({ message: "Account created but login failed" });
          }
          res.json({ success: true, user });
        });
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  // ---------- Setup-link flow (one-time, expiring) ----------
  // Placeholder format stored in users.password_hash:
  //   setup:<expiresAtMs>:<token>
  // - never matches a bcrypt hash, so /email-login bcrypt.compare cannot succeed.
  // - expiry encoded in the value, no extra table needed.
  // Rate limiter (in-memory, per-IP) to slow brute force / oracle abuse.
  const setupCheckHits = new Map<string, { count: number; windowStart: number }>();
  function setupCheckLimited(ip: string): boolean {
    const now = Date.now();
    const win = 60_000;
    const max = 30;
    const entry = setupCheckHits.get(ip);
    if (!entry || now - entry.windowStart > win) {
      setupCheckHits.set(ip, { count: 1, windowStart: now });
      return false;
    }
    entry.count += 1;
    return entry.count > max;
  }
  function findSetupPlaceholder(hash: string | null | undefined, token: string): { match: boolean; expired: boolean; placeholder: string } {
    if (!hash || !hash.startsWith("setup:")) return { match: false, expired: false, placeholder: "" };
    const parts = hash.split(":");
    if (parts.length !== 3) return { match: false, expired: false, placeholder: "" };
    const [, expiresAtStr, storedToken] = parts;
    if (storedToken !== token) return { match: false, expired: false, placeholder: hash };
    const expiresAt = Number(expiresAtStr);
    if (!Number.isFinite(expiresAt)) return { match: false, expired: true, placeholder: hash };
    const expired = Date.now() > expiresAt;
    return { match: true, expired, placeholder: hash };
  }

  app.post("/api/auth/setup-account", async (req, res) => {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        return res.status(400).json({ message: "Setup token and password are required" });
      }
      if (typeof token !== "string" || token.length < 16 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
        return res.status(400).json({ message: "Invalid setup token" });
      }
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        return res.status(400).json({ message: "Password must contain at least one uppercase letter, one lowercase letter, and one number" });
      }

      // Lookup by suffix-match on the placeholder. We then verify expiry and atomically consume.
      const { sql } = await import("drizzle-orm");
      const found = await db.execute(sql`SELECT id, email, first_name, password_hash, auth_provider FROM users WHERE password_hash LIKE ${"setup:%:" + token} LIMIT 1`);
      const row: any = (found as any).rows?.[0];
      if (!row) {
        return res.status(404).json({ message: "Setup link is invalid or has already been used" });
      }
      const { match, expired, placeholder } = findSetupPlaceholder(row.password_hash, token);
      if (!match) {
        return res.status(404).json({ message: "Setup link is invalid or has already been used" });
      }
      if (expired) {
        return res.status(410).json({ message: "This setup link has expired. Please request a new one." });
      }

      const newHash = await bcrypt.hash(password, 12);
      // Atomic conditional update — only succeeds if the placeholder still matches (one-time guarantee, race-safe).
      const consumed: any = await db.execute(sql`UPDATE users SET password_hash = ${newHash}, auth_provider = 'email', updated_at = NOW() WHERE id = ${row.id} AND password_hash = ${placeholder} RETURNING id`);
      const rowsAffected = consumed.rowCount ?? consumed.rows?.length ?? 0;
      if (rowsAffected !== 1) {
        return res.status(409).json({ message: "Setup link has already been used" });
      }

      const refreshed = await authStorage.getUser(row.id);

      (req as any).session.regenerate?.((regenErr: any) => {
        if (regenErr) {
          console.error("[AUTH] Session regenerate failed during setup:", regenErr.message);
          return res.status(500).json({ message: "Account ready, but session error — please go log in" });
        }
        (req as any).login({ id: row.id, claims: { sub: row.id }, authProvider: "email" }, (err: any) => {
          if (err) {
            console.error("[AUTH] Login after setup failed:", err);
            return res.status(500).json({ message: "Account ready, but login failed — please go log in" });
          }
          res.json({
            success: true,
            user: { ...refreshed, passwordHash: undefined, role: "user" },
          });
        });
      });
    } catch (error) {
      console.error("Setup account error:", error);
      res.status(500).json({ message: "Account setup failed" });
    }
  });

  app.get("/api/auth/setup-account/check", async (req, res) => {
    try {
      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
      if (setupCheckLimited(ip)) {
        return res.status(429).json({ valid: false });
      }
      const token = String(req.query.token || "");
      if (!token || token.length < 16 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
        return res.json({ valid: false });
      }
      const { sql } = await import("drizzle-orm");
      const found = await db.execute(sql`SELECT email, first_name, password_hash FROM users WHERE password_hash LIKE ${"setup:%:" + token} LIMIT 1`);
      const row: any = (found as any).rows?.[0];
      if (!row) return res.json({ valid: false });
      const { match, expired } = findSetupPlaceholder(row.password_hash, token);
      if (!match) return res.json({ valid: false });
      if (expired) return res.json({ valid: false, expired: true });
      res.json({ valid: true, email: row.email, firstName: row.first_name });
    } catch (error) {
      console.error("Setup account check error:", error);
      res.json({ valid: false });
    }
  });

  // One-time admin account setup — only works if user doesn't exist yet
  app.post("/api/auth/setup-admin", async (req, res) => {
    try {
      const { email, password, adminKey } = req.body;
      // Must provide the ADMIN_USER_ID as the key to prevent abuse
      const expectedKey = process.env.ADMIN_USER_ID || process.env.SESSION_SECRET;
      if (!adminKey || adminKey !== expectedKey) {
        return res.status(403).json({ message: "Invalid admin key" });
      }
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password required" });
      }
      const existing = await authStorage.getUserByEmail(email.toLowerCase().trim());
      const hash = await bcrypt.hash(password, 12);
      const adminUserId = process.env.ADMIN_USER_ID || `admin_${Date.now()}`;
      if (existing) {
        // Update password AND ensure admin role is set
        await authStorage.upsertUser({ 
          ...existing, 
          passwordHash: hash,
          isAdmin: "true",
          role: "admin"
        });
        return res.json({ success: true, message: "Password updated and admin role set" });
      }
      await authStorage.upsertUser({
        id: adminUserId,
        email: email.toLowerCase().trim(),
        passwordHash: hash,
        authProvider: "email",
        isAdmin: "true",
      });
      res.json({ success: true, message: "Admin account created" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/auth/email-login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      const user = await authStorage.getUserByEmail(email.toLowerCase().trim());
      if (!user || !user.passwordHash) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      if (user.passwordHash.startsWith("setup:")) {
        return res.status(403).json({ message: "This account hasn't been set up yet. Please use the setup link sent to you." });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      const adminUserId = process.env.ADMIN_USER_ID;
      const isDevAdmin = (adminUserId && user.id === adminUserId) || isAdminFlag(user.isAdmin);
      const sessionUser = { id: user.id, claims: { sub: user.id }, authProvider: "email" };

      (req.session as any).passport = { user: sessionUser };

      req.session.save((saveErr: any) => {
        if (saveErr) {
          console.error("[AUTH] Session save error:", saveErr?.message);
          return res.status(500).json({ message: "Session save failed: " + saveErr?.message });
        }
        res.json({
          success: true,
          user: {
            ...user,
            passwordHash: undefined,
            ...(isDevAdmin ? { role: "DEV_ADMIN", isPaid: true, radius: 999999, permissions: ["all"] } : { role: "user" }),
          },
        });
      });
    } catch (error) {
      console.error("Email login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/auth/firebase-login", async (req: any, res) => {
    try {
      const { idToken } = req.body;
      if (!idToken) {
        return res.status(400).json({ message: "Firebase ID token is required" });
      }

      if (!firebaseInitialized) {
        return res.status(503).json({ message: "Firebase Auth is not configured on the server" });
      }

      const decoded = await admin.auth().verifyIdToken(idToken);
      const { uid, email, name, picture, email_verified, firebase: firebaseMeta } = decoded;

      if (!email) {
        return res.status(400).json({ message: "Firebase account has no email address" });
      }

      if (!email_verified) {
        return res.status(403).json({ message: "Email address is not verified" });
      }

      const signInProvider = firebaseMeta?.sign_in_provider;
      if (signInProvider !== "google.com") {
        return res.status(403).json({ message: "Only Google sign-in is supported via Firebase" });
      }

      const firebaseUserId = `firebase_${uid}`;
      let user = await authStorage.getUser(firebaseUserId);

      if (!user) {
        const existingByEmail = await authStorage.getUserByEmail(email.toLowerCase().trim());
        if (existingByEmail && existingByEmail.authProvider !== "firebase") {
          return res.status(409).json({ message: "An account with this email already exists. Please sign in with your original method." });
        }

        await authStorage.upsertUser({
          id: firebaseUserId,
          email: email.toLowerCase().trim(),
          firstName: name?.split(" ")[0] || null,
          lastName: name?.split(" ").slice(1).join(" ") || null,
          profileImageUrl: picture || null,
          passwordHash: null,
          authProvider: "firebase",
        });
        user = await authStorage.getUser(firebaseUserId);
      }

      if (!user) {
        return res.status(500).json({ message: "Failed to create user account" });
      }

      req.session.regenerate?.((regenErr: any) => {
        if (regenErr) {
          console.error("[AUTH] Session regenerate failed:", regenErr.message);
          return res.status(500).json({ message: "Login failed — session error" });
        }
        req.login({ id: user.id, claims: { sub: user.id }, authProvider: "firebase" }, (err: any) => {
          if (err) {
            console.error("Firebase login session error:", err);
            return res.status(500).json({ message: "Login failed" });
          }

          const adminUserId = process.env.ADMIN_USER_ID;
          const isDevAdmin = (adminUserId && user!.id === adminUserId) || isAdminFlag(user!.isAdmin);

          res.json({
            success: true,
            user: {
              ...user,
              passwordHash: undefined,
              ...(isDevAdmin ? { role: "DEV_ADMIN", isPaid: true, radius: 999999, permissions: ["all"] } : { role: "user" }),
            },
          });
        });
      });
    } catch (error: any) {
      console.error("Firebase login error:", error.message);
      if (error.code === "auth/id-token-expired") {
        return res.status(401).json({ message: "Firebase token expired. Please sign in again." });
      }
      res.status(401).json({ message: "Invalid Firebase token" });
    }
  });

  app.post("/api/auth/fcm-token", async (req: any, res) => {
    try {
      if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const { token } = req.body;
      if (!token) return res.status(400).json({ message: "FCM token required" });

      const userId = req.user?.claims?.sub || req.user?.id;
      console.log(`[FCM] Token registered for user ${userId}: ${token.substring(0, 20)}...`);

      res.json({ success: true });
    } catch (error) {
      console.error("FCM token error:", error);
      res.status(500).json({ message: "Failed to store FCM token" });
    }
  });

  app.post("/api/auth/apex-logout", (req, res) => {
    req.logout(() => {
      req.session?.destroy(() => {
        res.json({ success: true });
      });
    });
  });
}
