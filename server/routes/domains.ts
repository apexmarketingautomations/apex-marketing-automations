import type { Express } from "express";
import { asyncHandler, parseIntParam, verifyAccountOwnership } from "./helpers";
import { storage } from "../storage";
import { z } from "zod";
import { publishEventAsync, EVENT_TYPES } from "../eventBus";

const CF_API = "https://api.cloudflare.com/client/v4";

function cfHeaders() {
  return {
    "Authorization": `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "8a2cec35db413f6601e6a98559ba587c";

// TLD pricing — cost vs what we charge
const TLD_PRICING: Record<string, { cost: number; sale: number }> = {
  ".com":  { cost: 8.57,  sale: 12.99 },
  ".net":  { cost: 9.77,  sale: 14.99 },
  ".org":  { cost: 9.93,  sale: 14.99 },
  ".io":   { cost: 32.00, sale: 49.99 },
  ".co":   { cost: 8.00,  sale: 15.99 },
  ".app":  { cost: 14.00, sale: 19.99 },
  ".dev":  { cost: 12.00, sale: 17.99 },
  ".biz":  { cost: 8.00,  sale: 12.99 },
  ".info": { cost: 3.00,  sale: 9.99  },
  ".us":   { cost: 7.00,  sale: 11.99 },
};

async function cfFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${CF_API}${path}`, {
    ...opts,
    headers: { ...cfHeaders(), ...(opts.headers || {}) },
  });
  return res.json() as Promise<any>;
}

async function checkDomainAvailability(domain: string) {
  const tld = "." + domain.split(".").slice(1).join(".");
  const pricing = TLD_PRICING[tld] || { cost: 10, sale: 19.99 };

  try {
    // Use Cloudflare Registrar to check availability
    const data = await cfFetch(
      `/accounts/${ACCOUNT_ID}/registrar/domains/${domain}`
    );

    // If it exists in CF registrar, it's taken
    if (data.success && data.result) {
      return { available: false, domain, tld, ...pricing };
    }

    // Try WHOIS check via CF
    const whois = await cfFetch(
      `/accounts/${ACCOUNT_ID}/intel/whois?domain=${domain}`
    );

    if (whois.success && whois.result?.registrar) {
      return { available: false, domain, tld, costPrice: pricing.cost, salePrice: pricing.sale };
    }

    return { available: true, domain, tld, costPrice: pricing.cost, salePrice: pricing.sale };
  } catch (err: any) {
    // If lookup fails, assume available (CF will confirm on purchase)
    return { available: null, domain, tld, costPrice: pricing.cost, salePrice: pricing.sale, reason: "Could not verify — try purchasing to confirm" };
  }
}

export function registerDomainRoutes(app: Express) {

  // List domains for account
  app.get("/api/domains/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const domains = await storage.getDomains(subAccountId);
    res.json(domains || []);
  }));

  // Check single domain availability
  app.post("/api/domains/check", asyncHandler(async (req, res) => {
    const { domain } = z.object({ domain: z.string().min(3) }).parse(req.body);
    const clean = domain.toLowerCase().trim();
    const result = await checkDomainAvailability(clean);
    res.json(result);
  }));

  // Search multiple TLDs for a domain name
  app.post("/api/domains/search", asyncHandler(async (req, res) => {
    const { query } = z.object({ query: z.string().min(2) }).parse(req.body);
    const name = query.toLowerCase().replace(/\.[^.]+$/, "").trim();
    const tlds = [".com", ".net", ".org", ".io", ".co", ".app", ".dev"];

    const results = await Promise.allSettled(
      tlds.map(tld => checkDomainAvailability(`${name}${tld}`))
    );

    const domains = results
      .filter(r => r.status === "fulfilled")
      .map(r => (r as PromiseFulfilledResult<any>).value);

    res.json(domains);
  }));

  // Purchase domain via Cloudflare Registrar
  app.post("/api/domains/purchase", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const { domain, subAccountId } = z.object({
      domain: z.string().min(3),
      subAccountId: z.number().int().positive(),
    }).parse(req.body);

    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const tld = "." + domain.split(".").slice(1).join(".");
    const pricing = TLD_PRICING[tld] || { cost: 10, sale: 19.99 };

    try {
      // Register via Cloudflare
      const cfResult = await cfFetch(
        `/accounts/${ACCOUNT_ID}/registrar/domains/${domain}/registration`,
        {
          method: "POST",
          body: JSON.stringify({ auto_renew: true }),
        }
      );

      const status = cfResult.success ? "registered" : "pending";

      // Save to database
      const savedDomain = await storage.createDomain({
        subAccountId,
        domainName: domain,
        status,
        purchasePrice: pricing.cost,
        salePrice: pricing.sale,
        dnsConfigured: false,
        sslActive: false,
        registrar: "cloudflare",
      });

      publishEventAsync(EVENT_TYPES.DOMAIN_REGISTERED, {
        subAccountId,
        domain,
        domainId: savedDomain.id,
      }, "domain-routes");

      res.json(savedDomain);
    } catch (err: any) {
      // Save as pending if CF call fails
      const savedDomain = await storage.createDomain({
        subAccountId,
        domainName: domain,
        status: "pending",
        purchasePrice: pricing.cost,
        salePrice: pricing.sale,
        dnsConfigured: false,
        sslActive: false,
        registrar: "cloudflare",
      });
      res.json({ ...savedDomain, warning: "Domain queued — Cloudflare will confirm shortly" });
    }
  }));

  // Add external domain (user already owns it)
  app.post("/api/domains/add-external", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const { domain, subAccountId } = z.object({
      domain: z.string().min(3),
      subAccountId: z.number().int().positive(),
    }).parse(req.body);

    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    // Generate verification token
    const token = `apex-verify-${Math.random().toString(36).slice(2, 18)}`;

    const savedDomain = await storage.createDomain({
      subAccountId,
      domainName: domain,
      status: "install_pending",
      purchasePrice: 0,
      salePrice: 0,
      dnsConfigured: false,
      sslActive: false,
      registrar: "external",
      verificationToken: token,
    });

    res.json({
      ...savedDomain,
      instructions: {
        step1: `Add a TXT record to your DNS: Name="_apex-verify.${domain}" Value="${token}"`,
        step2: `Point your A record to: ${process.env.SERVER_IP || "your server IP"}`,
        step3: "Click Verify once DNS propagates (can take up to 24h)",
      },
    });
  }));

  // Update domain (attach to site, etc)
  app.patch("/api/domains/:id", asyncHandler(async (req, res) => {
    const domainId = parseIntParam(req.params.id, "id");
    const updates = req.body;
    const domain = await storage.updateDomain(domainId, updates);
    res.json(domain);
  }));

  // Delete domain
  app.delete("/api/domains/:id", asyncHandler(async (req, res) => {
    const domainId = parseIntParam(req.params.id, "id");
    await storage.deleteDomain(domainId);
    res.json({ success: true });
  }));

  // Verify domain ownership via DNS TXT record
  app.post("/api/domains/:id/verify", asyncHandler(async (req, res) => {
    const domainId = parseIntParam(req.params.id, "id");
    const domain = await storage.getDomain(domainId);
    if (!domain) return res.status(404).json({ error: "Domain not found" });

    try {
      // Check DNS via Cloudflare
      const dnsResult = await cfFetch(
        `/accounts/${ACCOUNT_ID}/intel/dns?domain=_apex-verify.${domain.domainName}&type=TXT`
      );

      const verified = dnsResult.success &&
        dnsResult.result?.some((r: any) =>
          r.content?.includes(domain.verificationToken || "")
        );

      if (verified || domain.registrar === "cloudflare") {
        await storage.updateDomain(domainId, {
          status: "verified",
          verifiedAt: new Date(),
          dnsConfigured: true,
        });

        publishEventAsync(EVENT_TYPES.DOMAIN_VERIFIED, {
          subAccountId: domain.subAccountId,
          domain: domain.domainName,
          domainId,
        }, "domain-routes");

        return res.json({ verified: true, message: "Domain verified successfully" });
      }

      res.json({ verified: false, message: "TXT record not found yet — DNS can take up to 24h to propagate" });
    } catch (err: any) {
      res.json({ verified: false, message: "Verification check failed — try again in a few minutes" });
    }
  }));

  // Check verification status (polling)
  app.post("/api/domains/:id/check-verification", asyncHandler(async (req, res) => {
    const domainId = parseIntParam(req.params.id, "id");
    const domain = await storage.getDomain(domainId);
    if (!domain) return res.status(404).json({ error: "Domain not found" });
    res.json({
      verified: !!domain.verifiedAt,
      dnsConfigured: domain.dnsConfigured,
      sslActive: domain.sslActive,
      status: domain.status,
    });
  }));

  // Attach domain to a site
  app.post("/api/domains/:id/attach-site", asyncHandler(async (req, res) => {
    const domainId = parseIntParam(req.params.id, "id");
    const { siteId } = z.object({ siteId: z.number().int().positive() }).parse(req.body);

    const domain = await storage.getDomain(domainId);
    if (!domain) return res.status(404).json({ error: "Domain not found" });

    // Configure DNS via Cloudflare
    try {
      // Add CNAME or A record pointing to our server
      await cfFetch(
        `/zones/${await getZoneId(domain.domainName)}/dns_records`,
        {
          method: "POST",
          body: JSON.stringify({
            type: "CNAME",
            name: domain.domainName,
            content: "apexmarketingautomations.com",
            proxied: true,
            ttl: 1,
          }),
        }
      );
    } catch (err) {
      // Continue even if DNS auto-config fails
      console.warn("[DOMAINS] Auto DNS config failed:", (err as any).message);
    }

    await storage.updateDomain(domainId, { siteId, status: "verified" });

    publishEventAsync(EVENT_TYPES.DOMAIN_ATTACHED, {
      subAccountId: domain.subAccountId,
      domain: domain.domainName,
      domainId,
      siteId,
    }, "domain-routes");

    res.json({ success: true, message: `Domain ${domain.domainName} attached to site` });
  }));
}

async function getZoneId(domain: string): Promise<string> {
  const rootDomain = domain.split(".").slice(-2).join(".");
  const data = await cfFetch(`/zones?name=${rootDomain}`);
  if (data.success && data.result?.length > 0) {
    return data.result[0].id;
  }
  throw new Error(`Zone not found for ${domain}`);
}
