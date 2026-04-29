// server/routes/publicForms.ts
// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC INBOUND WEB FORM ENDPOINT
// Receives form submissions from external standalone sites (e.g. Big Mama Beauty)
// and creates a Contact + Deal in the matching sub-account's CRM pipeline.
//
// WIRE UP in server/routes.ts:
//   import { publicFormsRouter } from './routes/publicForms';
//   app.use('/api/public', publicFormsRouter);
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { db } from '../db';
import { subAccounts, contacts, deals } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';

export const publicFormsRouter = Router();

// ── Rate limiter: 20 submissions per IP per 15 min ──────────────────────────
const formRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Please try again later.' },
});

// ── Input validation schema ──────────────────────────────────────────────────
const FormSchema = z.object({
  firstName: z.string().min(1).max(100).trim(),
  lastName:  z.string().max(100).trim().optional().default(''),
  email:     z.string().email().max(255).toLowerCase().trim(),
  phone:     z.string().max(30).trim().optional().default(''),
  interest:  z.string().max(200).trim().optional().default('General Inquiry'),
  message:   z.string().max(2000).trim().optional().default(''),
});

// ── CORS headers for public access ──────────────────────────────────────────
function setCorsHeaders(res: Response) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── OPTIONS preflight ────────────────────────────────────────────────────────
publicFormsRouter.options('/form/:token', (req: Request, res: Response) => {
  setCorsHeaders(res);
  res.sendStatus(204);
});

// ── POST /api/public/form/:token ─────────────────────────────────────────────
publicFormsRouter.post(
  '/form/:token',
  formRateLimit,
  async (req: Request, res: Response) => {
    setCorsHeaders(res);

    const { token } = req.params;

    // 1. Validate token & find sub-account
    const account = await db.query.subAccounts.findFirst({
      where: eq(subAccounts.webhookToken, token),
    });

    if (!account) {
      return res.status(404).json({ error: 'Invalid form token.' });
    }

    // 2. Validate body
    const parsed = FormSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid form data.',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { firstName, lastName, email, phone, interest, message } = parsed.data;

    // 3. Upsert contact (avoid duplicates by email + subAccountId)
    let contact = await db.query.contacts.findFirst({
      where: (c, { and, eq: eqFn }) =>
        and(eqFn(c.email, email), eqFn(c.subAccountId, account.id)),
    });

    const source = `${account.name} Website`;
    const tags   = [
      'website-lead',
      account.name.toLowerCase().replace(/\s+/g, '-'),
      interest.toLowerCase().replace(/\s+/g, '-'),
    ];
    const notes = `Service Interest: ${interest}\n\nMessage:\n${message}`;

    if (contact) {
      // Update existing contact with latest info
      await db
        .update(contacts)
        .set({ firstName, lastName, phone, notes, tags })
        .where(eq(contacts.id, contact.id));
    } else {
      // Create new contact
      const [newContact] = await db
        .insert(contacts)
        .values({
          subAccountId: account.id,
          firstName,
          lastName,
          email,
          phone,
          source,
          tags,
          notes,
        })
        .returning();
      contact = newContact;
    }

    // 4. Create deal in "New Lead" stage
    await db.insert(deals).values({
      subAccountId: account.id,
      contactId:    contact.id,
      title:        `${firstName} ${lastName} — ${interest}`.trim(),
      status:       'open',
      stageId:      5, // New Lead
      notes:        `Source: ${source}\nInterest: ${interest}\n\n${message}`,
    });

    // 5. Success
    return res.status(201).json({
      success: true,
      message: 'Your message has been received. We\'ll be in touch soon!',
    });
  }
);
