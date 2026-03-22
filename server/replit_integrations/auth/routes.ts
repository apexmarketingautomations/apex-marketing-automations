import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import bcrypt from "bcryptjs";
import admin from "firebase-admin";

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
      const isDevAdmin = adminUserId && userId === adminUserId;

      res.json({
        ...user,
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

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      req.session.regenerate?.((regenErr: any) => {
        if (regenErr) {
          console.error("[AUTH] Session regenerate failed:", regenErr.message);
          return res.status(500).json({ message: "Login failed — session error" });
        }
        req.login({ id: user.id, claims: { sub: user.id }, authProvider: "email" }, (err: any) => {
          if (err) {
            console.error("Email login failed:", err);
            return res.status(500).json({ message: "Login failed" });
          }

          const adminUserId = process.env.ADMIN_USER_ID;
          const isDevAdmin = adminUserId && user.id === adminUserId;

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
          const isDevAdmin = adminUserId && user!.id === adminUserId;

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
