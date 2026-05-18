/**
 * server/services/qualityValidator.ts
 *
 * Post-generation quality validation for Dynamic Page schemas.
 * Runs after AI generation and blocks or auto-fixes mismatched output
 * before the schema is returned to the client or saved to the DB.
 *
 * Checks:
 * 1. Business type mismatch (e.g. ecommerce CRM tag for a barbershop)
 * 2. Generic placeholder copy ("AI automation", "ecommerce" when not asked)
 * 3. CTA mismatch ("Shop Now" for non-ecommerce)
 * 4. Missing visual objects the user explicitly requested
 * 5. Orb-only scene when user described specific objects
 * 6. Niche collapse (businessType stayed "general" or "business" when prompt was specific)
 */

import type { DynamicPageSchema } from "../../client/src/lib/dynamic-pages/schema";
import type { ParsedPromptIntent } from "./visualPromptParser";

export interface ValidationIssue {
  severity: "error" | "warning";
  field: string;
  issue: string;
  fix?: string;
}

export interface ValidationReport {
  passed: boolean;
  score: number;        // 0–100, 100 = perfect match
  issues: ValidationIssue[];
  autoFixed: boolean;
  fixedSchema?: DynamicPageSchema;
}

// ── Checks ────────────────────────────────────────────────────────────────────

function checkNicheCollapse(schema: DynamicPageSchema, intent: ParsedPromptIntent, issues: ValidationIssue[]): void {
  const aiNiche = schema.meta?.niche?.toLowerCase() ?? "";
  const aiBusinessType = schema.meta?.businessType?.toLowerCase() ?? "";

  // If parser found a real niche but AI collapsed to generic
  if (intent.niche !== "general" && (aiNiche === "general" || aiBusinessType === "business")) {
    issues.push({
      severity: "error",
      field: "meta.niche",
      issue: `AI collapsed to generic niche "${aiNiche}" but prompt is for "${intent.businessLabel}"`,
      fix: `Set niche to "${intent.niche}" and businessType to "${intent.businessType}"`,
    });
  }
}

function checkGenericCopy(schema: DynamicPageSchema, intent: ParsedPromptIntent, issues: ValidationIssue[]): void {
  const headline = schema.copy?.headline ?? "";
  const subheadline = schema.copy?.subheadline ?? "";
  const body = schema.copy?.body ?? "";
  const allCopy = `${headline} ${subheadline} ${body}`.toLowerCase();

  const GENERIC_PHRASES = [
    "ai automation", "ai-powered solutions", "automate. convert. grow",
    "set it and forget it", "smart follow-up", "personalized outreach at scale",
    "grow your business with ai", "automation. leads. results.",
    "cutting-edge technology and proven strategies",
  ];

  // Only flag these as errors when the prompt is NOT about AI/automation tools
  const promptIsAboutAI = /ai.?tool|ai.?platform|automation.?software|ai.?saas|marketing.?automation/i.test(intent.businessType + intent.niche);
  if (!promptIsAboutAI) {
    for (const phrase of GENERIC_PHRASES) {
      if (allCopy.includes(phrase)) {
        issues.push({
          severity: "error",
          field: "copy",
          issue: `Generic AI-placeholder copy detected: "${phrase}"`,
          fix: `Replace with niche-specific copy for ${intent.businessLabel}`,
        });
        break; // one is enough to flag
      }
    }
  }
}

function checkEcommerceMismatch(schema: DynamicPageSchema, intent: ParsedPromptIntent, issues: ValidationIssue[]): void {
  // Not an ecommerce or retail prompt but has ecommerce artifacts
  // Retail niches (boutique, supplement, jewelry, etc.) can legitimately use "Shop Now"
  const isShoppable = intent.niche === "ecommerce" || intent.niche === "retail" || intent.businessType === "ecommerce";
  if (!isShoppable) {
    const cta = schema.cta?.primaryText?.toLowerCase() ?? "";
    const crmTag = schema.crm?.automationTag?.toLowerCase() ?? "";
    const headline = schema.copy?.headline?.toLowerCase() ?? "";

    if (cta === "shop now" || cta === "buy now" || cta.includes("add to cart")) {
      issues.push({
        severity: "error",
        field: "cta.primaryText",
        issue: `Ecommerce CTA "${schema.cta?.primaryText}" used for non-ecommerce business: ${intent.businessLabel}`,
        fix: `Change CTA to "${intent.ctaText}"`,
      });
    }

    if (crmTag.includes("ecommerce")) {
      issues.push({
        severity: "error",
        field: "crm.automationTag",
        issue: `Ecommerce CRM tag "${schema.crm?.automationTag}" used for ${intent.businessLabel}`,
        fix: `Change automationTag to "${intent.crmTag}"`,
      });
    }

    if (headline.includes("shop our") || headline.includes("buy our") || headline.includes("free shipping")) {
      issues.push({
        severity: "warning",
        field: "copy.headline",
        issue: `Ecommerce-style headline for non-ecommerce business`,
        fix: `Rewrite for ${intent.businessLabel}`,
      });
    }
  }
}

function checkVisualObjects(schema: DynamicPageSchema, intent: ParsedPromptIntent, issues: ValidationIssue[]): void {
  if (intent.semanticObjects.length === 0) return;

  const sceneObjects = schema.scene?.objects ?? [];
  const sceneLabels = sceneObjects
    .map(o => (o.label ?? "").toLowerCase())
    .join(" ");

  for (const requested of intent.semanticObjects) {
    const label = requested.label.toLowerCase();
    const semanticType = requested.semanticType.replace(/_/g, " ").toLowerCase();

    const isPresent = sceneLabels.includes(label) ||
      sceneLabels.includes(semanticType) ||
      sceneObjects.some(o => {
        const ol = (o.label ?? "").toLowerCase();
        return label.split(" ").some(word => word.length > 3 && ol.includes(word));
      });

    if (!isPresent) {
      issues.push({
        severity: "error",
        field: "scene.objects",
        issue: `Requested object "${requested.label}" is missing from the scene`,
        fix: `Add scene object with label "${requested.label}", animation "${requested.animation}", material "${requested.material}"`,
      });
    }
  }
}

function checkOrbOnlyScene(schema: DynamicPageSchema, intent: ParsedPromptIntent, issues: ValidationIssue[]): void {
  // Only complain if the user explicitly requested specific objects
  if (intent.semanticObjects.length === 0) return;

  const objects = schema.scene?.objects ?? [];
  const allGeneric = objects.every(o => {
    const label = (o.label ?? "").toLowerCase();
    return label === "orb" || label === "torus" || label === "ring" || label === "sphere" || label === "";
  });

  if (allGeneric && objects.length > 0) {
    issues.push({
      severity: "error",
      field: "scene.objects",
      issue: `Scene contains only generic orb/torus primitives, but user requested: ${intent.semanticObjects.map(o => o.label).join(", ")}`,
      fix: `Replace generic objects with semantic objects matching the prompt`,
    });
  }
}

function checkCTAMismatch(schema: DynamicPageSchema, intent: ParsedPromptIntent, issues: ValidationIssue[]): void {
  if (!schema.cta?.primaryText) return;
  const cta = schema.cta.primaryText.toLowerCase();

  // Booking business but no booking CTA
  if (intent.ctaIntent === "booking" && !/(book|schedule|reserve|appointment|session|cut|class|consult)/i.test(cta)) {
    issues.push({
      severity: "warning",
      field: "cta.primaryText",
      issue: `Booking business (${intent.businessLabel}) has non-booking CTA: "${schema.cta.primaryText}"`,
      fix: `Change CTA to "${intent.ctaText}"`,
    });
  }

  // Quote business but no quote CTA
  if (intent.ctaIntent === "quote" && !/(quote|estimate|price|bid)/i.test(cta)) {
    issues.push({
      severity: "warning",
      field: "cta.primaryText",
      issue: `Quote-based business (${intent.businessLabel}) has generic CTA: "${schema.cta.primaryText}"`,
      fix: `Change CTA to "${intent.ctaText}"`,
    });
  }
}

// ── Auto-fix engine ───────────────────────────────────────────────────────────

function autoFix(schema: DynamicPageSchema, intent: ParsedPromptIntent, issues: ValidationIssue[]): DynamicPageSchema {
  const fixed = JSON.parse(JSON.stringify(schema)) as DynamicPageSchema;
  let changed = false;

  for (const issue of issues) {
    if (issue.severity !== "error") continue;

    // Fix niche collapse
    if (issue.field === "meta.niche") {
      fixed.meta.niche = intent.niche;
      fixed.meta.businessType = intent.businessType;
      changed = true;
    }

    // Fix ecommerce CTA mismatch
    if (issue.field === "cta.primaryText") {
      fixed.cta.primaryText = intent.ctaText;
      fixed.cta.primaryUrl = "#contact";
      changed = true;
    }

    // Fix ecommerce CRM tag mismatch
    if (issue.field === "crm.automationTag") {
      fixed.crm.automationTag = intent.crmTag;
      changed = true;
    }

    // Fix missing visual objects — inject them into the scene
    if (issue.field === "scene.objects") {
      const existingIds = new Set(fixed.scene.objects.map(o => o.id));

      for (const obj of intent.semanticObjects) {
        const alreadyPresent = fixed.scene.objects.some(o => {
          const ol = (o.label ?? "").toLowerCase();
          return obj.label.split(" ").some(w => w.length > 3 && ol.includes(w));
        });
        if (alreadyPresent) continue;

        const id = `${obj.semanticType}-1`;
        if (existingIds.has(id)) continue;

        fixed.scene.objects.push({
          id,
          label: obj.label,
          type: obj.fallbackPrimitive as any,
          style: "cinematic_3d",
          props: [obj.semanticType],
          position: [0, 0, -2],
          scale: obj.scale ?? [1, 1, 1],
          animation: obj.animation as any,
          color: obj.color,
          emissive: obj.material === "emissive" ? obj.color : undefined,
          material: obj.material as any,
          opacity: 0.95,
          // Extended fields for Stitch-style renderer
          ...(obj.semanticType && { semanticType: obj.semanticType } as any),
          ...(obj.fallbackPrimitive && { fallbackPrimitive: obj.fallbackPrimitive } as any),
          objectCategory: "semantic_object" as any,
        });
        existingIds.add(id);
        changed = true;
      }

      // If all objects are still generic orbs but we added semantic ones, remove the generics
      const semanticCount = fixed.scene.objects.filter(o => (o as any).objectCategory === "semantic_object").length;
      if (semanticCount > 0 && fixed.scene.objects.length > semanticCount + 2) {
        fixed.scene.objects = fixed.scene.objects.filter(o =>
          (o as any).objectCategory === "semantic_object" || o.label !== "orb"
        );
      }
    }
  }

  // Ensure CRM tag uses niche-specific tag even if no explicit issue was flagged
  if (intent.niche !== "general" && fixed.crm?.automationTag === "new-lead") {
    fixed.crm.automationTag = intent.crmTag;
    changed = true;
  }

  // Ensure form fields are niche-appropriate
  if (intent.formFields.length > 0 && fixed.forms?.length > 0) {
    fixed.forms[0].crmTag = intent.crmTag;
    // Only replace fields if form is still at generic defaults
    const isGenericForm = fixed.forms[0].fields.every(f =>
      ["name", "email", "phone"].includes(f.name)
    );
    if (isGenericForm && intent.formFields.length > 3) {
      fixed.forms[0].fields = intent.formFields.map(fieldName => ({
        name: fieldName,
        label: fieldName.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        type: fieldTypeFor(fieldName),
        required: ["name", "phone", "email"].includes(fieldName),
      }));
      changed = true;
    }
  }

  return changed ? { ...fixed, designSource: "apex-generator" } as any : schema;
}

function fieldTypeFor(fieldName: string): "text" | "email" | "phone" | "textarea" | "select" {
  if (fieldName === "email") return "email";
  if (fieldName === "phone") return "phone";
  if (["message", "description", "accident_type", "tattoo_idea", "main_challenge"].includes(fieldName)) return "textarea";
  return "text";
}

// ── Score calculation ─────────────────────────────────────────────────────────

function calcScore(issues: ValidationIssue[]): number {
  let score = 100;
  for (const issue of issues) {
    score -= issue.severity === "error" ? 20 : 5;
  }
  return Math.max(0, score);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function validateGeneratedSchema(
  schema: DynamicPageSchema,
  prompt: string,
  intent: ParsedPromptIntent,
): ValidationReport {
  const issues: ValidationIssue[] = [];

  checkNicheCollapse(schema, intent, issues);
  checkGenericCopy(schema, intent, issues);
  checkEcommerceMismatch(schema, intent, issues);
  checkVisualObjects(schema, intent, issues);
  checkOrbOnlyScene(schema, intent, issues);
  checkCTAMismatch(schema, intent, issues);

  const score = calcScore(issues);
  const hasErrors = issues.some(i => i.severity === "error");

  if (!hasErrors) {
    return { passed: true, score, issues, autoFixed: false };
  }

  // Auto-fix all errors
  const fixedSchema = autoFix(schema, intent, issues);
  const recheck: ValidationIssue[] = [];
  checkGenericCopy(fixedSchema, intent, recheck);
  checkEcommerceMismatch(fixedSchema, intent, recheck);
  checkVisualObjects(fixedSchema, intent, recheck);

  const finalScore = calcScore(recheck);

  return {
    passed: recheck.filter(i => i.severity === "error").length === 0,
    score: finalScore,
    issues,
    autoFixed: true,
    fixedSchema,
  };
}
