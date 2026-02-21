import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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
}
