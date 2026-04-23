import type { Express } from "express";
import { z } from "zod";
import { sendEmail } from "../messaging/sendEmail";
import { asyncHandler, verifyAccountOwnership } from "./helpers";
import { messagingLimiter } from "../rateLimiter";

const sendEmailSchema = z.object({
  subAccountId: z.number().int().positive(),
  toEmail: z.string().email(),
  subject: z.string().min(1).max(998),
  body: z.string().min(1),
  from: z.string().email().optional(),
});

export function registerMessagingEmailRoutes(app: Express) {
  app.post(
    "/api/messages/email",
    messagingLimiter,
    asyncHandler(async (req, res) => {
      const parsed = sendEmailSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const { subAccountId, toEmail, subject, body, from } = parsed.data;

      if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

      const result = await sendEmail({
        subAccountId,
        to: toEmail,
        subject,
        body,
        from,
      });

      if (!result.ok) {
        const status = result.reason === "not_configured" ? 503 : 502;
        return res.status(status).json({
          error: result.errorMessage || "Failed to send email",
          reason: result.reason,
          messageRowId: result.messageRowId,
        });
      }

      return res.status(201).json({
        ok: true,
        messageRowId: result.messageRowId,
      });
    }),
  );
}
