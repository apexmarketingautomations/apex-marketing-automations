import type { DynamicPageSchema, WebGLSceneSchema } from "./schema";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const MAX_OBJECTS = 8;
const MAX_PARTICLE_COUNT = 2000;

function isHexColor(v: unknown): boolean {
  return typeof v === "string" && HEX_COLOR.test(v);
}

function validateScene(scene: unknown, errors: string[], warnings: string[]): void {
  if (!scene || typeof scene !== "object") {
    errors.push("scene is required");
    return;
  }
  const s = scene as Partial<WebGLSceneSchema>;
  if (!s.sceneType) errors.push("scene.sceneType is required");
  if (!s.environment) errors.push("scene.environment is required");
  if (!Array.isArray(s.objects)) {
    errors.push("scene.objects must be an array");
  } else {
    if (s.objects.length > MAX_OBJECTS) {
      warnings.push(`scene.objects has ${s.objects.length} items — max ${MAX_OBJECTS} for performance`);
    }
    s.objects.forEach((obj, i) => {
      if (!obj.id) errors.push(`scene.objects[${i}].id is required`);
      if (!obj.type) errors.push(`scene.objects[${i}].type is required`);
      if (!isHexColor(obj.color)) warnings.push(`scene.objects[${i}].color should be a hex color`);
    });
  }
  if (s.particles) {
    const count = s.particles.count ?? 0;
    if (count > MAX_PARTICLE_COUNT) {
      warnings.push(`particle count ${count} exceeds max ${MAX_PARTICLE_COUNT} — clamping recommended`);
    }
  }
}

export function validateSchema(schema: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!schema || typeof schema !== "object") {
    return { valid: false, errors: ["schema must be an object"], warnings };
  }

  const s = schema as Partial<DynamicPageSchema>;

  if (s.version !== "1.0") errors.push('schema.version must be "1.0"');
  if (!s.id || typeof s.id !== "string") errors.push("schema.id is required");
  if (!s.meta?.title) errors.push("schema.meta.title is required");
  if (!s.meta?.slug) errors.push("schema.meta.slug is required");
  if (!s.meta?.niche) errors.push("schema.meta.niche is required");
  if (!s.copy?.headline) errors.push("schema.copy.headline is required");
  if (!s.theme?.colors) errors.push("schema.theme.colors is required");
  if (s.theme?.colors) {
    const colors = s.theme.colors;
    ["primary", "secondary", "background", "text"].forEach(k => {
      if (!isHexColor((colors as any)[k])) {
        warnings.push(`theme.colors.${k} should be a hex color`);
      }
    });
  }
  if (!s.cta?.primaryText) warnings.push("schema.cta.primaryText is empty");

  validateScene(s.scene, errors, warnings);

  if (!Array.isArray(s.sections)) {
    warnings.push("schema.sections is empty — page will have no content sections");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/** Apply safe defaults to any fields that failed validation */
export function sanitizeSchema(schema: DynamicPageSchema): DynamicPageSchema {
  const s = { ...schema };

  // Clamp particle count
  if (s.scene?.particles?.count && s.scene.particles.count > MAX_PARTICLE_COUNT) {
    s.scene = {
      ...s.scene,
      particles: { ...s.scene.particles, count: MAX_PARTICLE_COUNT },
    };
  }

  // Clamp objects
  if (s.scene?.objects && s.scene.objects.length > MAX_OBJECTS) {
    s.scene = {
      ...s.scene,
      objects: s.scene.objects.slice(0, MAX_OBJECTS),
    };
  }

  return s;
}
