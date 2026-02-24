import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import bcrypt from "bcryptjs";

export function registerAuthRoutes(app: Express): void {
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
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
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

      req.login({ id: userId, claims: { sub: userId }, authProvider: "email" }, (err: any) => {
        if (err) {
          console.error("Login after register failed:", err);
          return res.status(500).json({ message: "Account created but login failed" });
        }
        res.json({ success: true, user });
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
    } catch (error) {
      console.error("Email login error:", error);
      res.status(500).json({ message: "Login failed" });
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
