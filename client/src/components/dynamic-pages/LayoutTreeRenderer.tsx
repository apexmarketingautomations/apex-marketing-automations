/**
 * client/src/components/dynamic-pages/LayoutTreeRenderer.tsx
 *
 * Renders a freeform AI-composed layout tree (ComposedLayout) to React.
 *
 * This is the Stitch-style renderer — it walks a recursive LayoutNode tree
 * and paints each node using the generated DesignSystem tokens. It is the new
 * default for `generationMode: "stitch-style"`.
 *
 * The legacy block renderer in DynamicPageRenderer.tsx is unchanged and still
 * handles `generationMode: "apex-fast"`.
 *
 * Apex backend wiring is preserved: `form` nodes render from
 * DynamicPageSchema.forms[], `cta` nodes use DynamicPageSchema.cta.
 */

import { Suspense, useMemo } from "react";
import { motion } from "framer-motion";
import * as Icons from "lucide-react";
import { WebGLSceneRenderer } from "./WebGLSceneRenderer";
import type { DynamicPageSchema } from "@/lib/dynamic-pages/schema";
import type {
  ComposedLayout,
  DesignSystem,
  LayoutNode,
  LayoutNodeStyle,
  NodeAnimation,
} from "@/lib/dynamic-pages/layoutTree";

// ── Style resolution ──────────────────────────────────────────────────────────

function space(ds: DesignSystem, token?: number): string | undefined {
  if (token == null) return undefined;
  const px = ds.spacing[Math.max(0, Math.min(ds.spacing.length - 1, token))];
  return `${px}px`;
}

function surfacePaint(ds: DesignSystem, style: LayoutNodeStyle): React.CSSProperties {
  const c = ds.colors;
  const radius = style.radius ? ds.radius[style.radius] : undefined;
  const base: React.CSSProperties = { borderRadius: radius };
  switch (style.surface) {
    case "glass":
      return {
        ...base,
        background: "rgba(255,255,255,0.06)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        border: `1px solid ${c.border}`,
      };
    case "solid":
      return { ...base, background: c.surface, border: `1px solid ${c.border}` };
    case "elevated":
      return { ...base, background: c.surfaceAlt, border: `1px solid ${c.border}` };
    case "gradient":
      return { ...base, background: c.gradient };
    case "outline":
      return { ...base, background: "transparent", border: `1px solid ${c.border}` };
    default:
      return base;
  }
}

function resolveStyle(ds: DesignSystem, style: LayoutNodeStyle | undefined): React.CSSProperties {
  if (!style) return {};
  const css: React.CSSProperties = {};

  // display / flex / grid
  if (style.display === "flex") {
    css.display = "flex";
    css.flexDirection = style.direction ?? "row";
    if (style.wrap) css.flexWrap = "wrap";
  } else if (style.display === "grid") {
    css.display = "grid";
    css.gridTemplateColumns = style.gridTemplate
      ? style.gridTemplate
      : style.gridCols
        ? `repeat(${style.gridCols}, minmax(0, 1fr))`
        : undefined;
  } else if (style.display === "block") {
    css.display = "block";
  }
  if (style.gridCols && css.display !== "grid" && !style.display) {
    css.display = "grid";
    css.gridTemplateColumns = `repeat(${style.gridCols}, minmax(0, 1fr))`;
  }

  const alignMap: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch", baseline: "baseline" };
  const justifyMap: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", between: "space-between", around: "space-around", evenly: "space-evenly" };
  if (style.align) css.alignItems = alignMap[style.align];
  if (style.justify) css.justifyContent = justifyMap[style.justify];
  if (style.gap != null) css.gap = space(ds, style.gap);

  // spacing
  if (style.padX != null) { css.paddingLeft = space(ds, style.padX); css.paddingRight = space(ds, style.padX); }
  if (style.padY != null) { css.paddingTop = space(ds, style.padY); css.paddingBottom = space(ds, style.padY); }
  if (style.marginX != null) { css.marginLeft = space(ds, style.marginX); css.marginRight = space(ds, style.marginX); }
  if (style.marginY != null) { css.marginTop = space(ds, style.marginY); css.marginBottom = space(ds, style.marginY); }

  // sizing
  if (style.width) css.width = style.width;
  if (style.maxWidth) css.maxWidth = style.maxWidth;
  if (style.height) css.height = style.height;
  if (style.minHeight) css.minHeight = style.minHeight;
  if (style.aspectRatio) css.aspectRatio = style.aspectRatio;
  if (style.colSpan) css.gridColumn = `span ${style.colSpan}`;

  // position
  if (style.position) css.position = style.position;
  if (style.top != null) css.top = style.top;
  if (style.right != null) css.right = style.right;
  if (style.bottom != null) css.bottom = style.bottom;
  if (style.left != null) css.left = style.left;
  if (style.zIndex != null) css.zIndex = style.zIndex;

  // paint
  Object.assign(css, surfacePaint(ds, style));
  if (style.background) {
    css.background = style.background === "gradient" ? ds.colors.gradient : style.background;
  }
  if (style.elevation != null && style.elevation > 0) css.boxShadow = ds.elevation[style.elevation];
  if (style.borderAccent) css.border = `1px solid ${ds.colors.accent}`;
  if (style.overflow) css.overflow = style.overflow;
  if (style.opacity != null) css.opacity = style.opacity;
  if (style.rotate) css.transform = `rotate(${style.rotate}deg)`;
  if (style.blur) { css.backdropFilter = `blur(${style.blur}px)`; (css as any).WebkitBackdropFilter = `blur(${style.blur}px)`; }
  if (style.textAlign) css.textAlign = style.textAlign;

  // center maxWidth blocks
  if (style.maxWidth && (style.marginX == null)) { css.marginLeft = "auto"; css.marginRight = "auto"; }

  return css;
}

// ── Animation ─────────────────────────────────────────────────────────────────

function entryMotion(ds: DesignSystem, anim?: NodeAnimation) {
  if (!anim?.entry || anim.entry === "none" || ds.motion.intensity === "none") {
    return { initial: false as const };
  }
  const offsets: Record<string, Record<string, number>> = {
    fade: {},
    fade_up: { y: 32 },
    fade_down: { y: -32 },
    slide_left: { x: 44 },
    slide_right: { x: -44 },
    scale_in: { scale: 0.92 },
    blur_in: {},
  };
  const from = { opacity: 0, ...(offsets[anim.entry] ?? {}) };
  const to = { opacity: 1, x: 0, y: 0, scale: 1 };
  return {
    initial: from,
    whileInView: to,
    viewport: { once: true, margin: "-60px" },
    transition: {
      duration: (anim.duration ?? ds.motion.durations.slow) / 1000,
      delay: (anim.delay ?? 0) / 1000,
      ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
    },
  };
}

function ambientClass(anim?: NodeAnimation): string {
  if (!anim?.ambient || anim.ambient === "none") return "";
  return `lt-ambient-${anim.ambient}`;
}

// ── Typography ────────────────────────────────────────────────────────────────

function typographyCss(ds: DesignSystem, role: string | undefined, isHeading: boolean): React.CSSProperties {
  const r = ds.typography.roles[(role as keyof typeof ds.typography.roles)] ?? ds.typography.roles.body;
  return {
    fontSize: r.size,
    fontWeight: r.weight,
    lineHeight: r.lineHeight,
    letterSpacing: r.letterSpacing,
    textTransform: r.textTransform,
    fontFamily: isHeading ? ds.typography.headingFamily : ds.typography.fontFamily,
    margin: 0,
  };
}

// ── Node renderer ─────────────────────────────────────────────────────────────

interface RenderCtx {
  ds: DesignSystem;
  schema: DynamicPageSchema;
  isPreview: boolean;
}

function LucideIcon({ name, color, size = 22 }: { name?: string; color: string; size?: number }) {
  const key = (name ?? "sparkles")
    .split(/[-_\s]/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  const Cmp = (Icons as Record<string, any>)[key] ?? Icons.Sparkles;
  return <Cmp size={size} color={color} strokeWidth={2} />;
}

function NodeChildren({ node, ctx }: { node: LayoutNode; ctx: RenderCtx }) {
  return <>{(node.children ?? []).map(child => <LayoutNodeView key={child.id} node={child} ctx={ctx} />)}</>;
}

function LayoutNodeView({ node, ctx }: { node: LayoutNode; ctx: RenderCtx }): JSX.Element | null {
  const { ds, schema } = ctx;
  const css = resolveStyle(ds, node.style);
  const anim = node.style?.animation;
  const motionProps = entryMotion(ds, anim);
  const ambient = ambientClass(anim);
  const c = ds.colors;

  switch (node.type) {
    // ── structural ──────────────────────────────────────────────────────────
    case "container":
    case "zone":
    case "stack":
    case "row":
    case "grid":
    case "split_layout":
    case "motion_cluster":
    case "glass_panel":
    case "floating_panel": {
      const dataGrid = (node.type === "grid" || node.style?.display === "grid")
        ? `lt-grid-${node.style?.gridCols ?? 3}` : "";
      const splitClass = node.type === "split_layout" || node.style?.gridTemplate ? "lt-split" : "";
      return (
        <motion.div
          {...motionProps}
          className={[ambient, dataGrid, splitClass].filter(Boolean).join(" ")}
          style={css}
        >
          <NodeChildren node={node} ctx={ctx} />
        </motion.div>
      );
    }

    case "spacer":
      return <div style={{ height: space(ds, node.style?.padY as number ?? 6) }} />;

    case "divider":
      return <div style={{ height: 1, background: c.border, width: "100%", ...css }} />;

    // ── scene ───────────────────────────────────────────────────────────────
    case "scene": {
      const fullBleed = node.content?.sceneFullBleed;
      return (
        <div style={{ ...css, ...(fullBleed ? {} : { minHeight: "420px" }) }}>
          <Suspense fallback={<div style={{ width: "100%", height: "100%", background: c.surface }} />}>
            <WebGLSceneRenderer scene={schema.scene} height={fullBleed ? "100%" : "420px"} />
          </Suspense>
        </div>
      );
    }

    // ── text / heading ──────────────────────────────────────────────────────
    case "heading": {
      const level = node.content?.headingLevel ?? 2;
      const Tag = (`h${level}` as keyof JSX.IntrinsicElements);
      const tCss = typographyCss(ds, node.content?.typographyRole ?? "h2", true);
      const colorKey = node.content?.colorToken;
      const gradient = node.content?.gradientText;
      return (
        <motion.div {...motionProps} style={css}>
          <Tag
            style={{
              ...tCss,
              color: gradient ? "transparent" : (colorKey ? c[colorKey] : c.text),
              ...(gradient ? { backgroundImage: c.gradient, WebkitBackgroundClip: "text", backgroundClip: "text" } : {}),
            }}
          >
            {node.content?.text ?? ""}
          </Tag>
        </motion.div>
      );
    }

    case "text": {
      const tCss = typographyCss(ds, node.content?.typographyRole ?? "body", false);
      const colorKey = node.content?.colorToken;
      return (
        <motion.p {...motionProps} style={{ ...tCss, color: colorKey ? c[colorKey] : c.text, ...css }}>
          {node.content?.text ?? ""}
        </motion.p>
      );
    }

    // ── image ───────────────────────────────────────────────────────────────
    case "image": {
      const url = node.content?.imageUrl;
      return (
        <motion.div {...motionProps} className={ambient} style={{ overflow: "hidden", ...css }}>
          {url ? (
            <img
              src={url}
              alt={node.content?.imageAlt ?? ""}
              style={{ width: "100%", height: "100%", objectFit: node.content?.imageFit ?? "cover", display: "block" }}
            />
          ) : (
            <div style={{ width: "100%", height: "100%", minHeight: 200, background: `linear-gradient(135deg, ${c.surface}, ${c.surfaceAlt})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <LucideIcon name="image" color={c.textMuted} size={32} />
            </div>
          )}
        </motion.div>
      );
    }

    // ── cta ─────────────────────────────────────────────────────────────────
    case "cta": {
      const text = node.content?.ctaText ?? schema.cta?.primaryText ?? "Get Started";
      const url = node.content?.ctaUrl ?? schema.cta?.primaryUrl ?? "#booking";
      const variant = node.content?.ctaVariant ?? "primary";
      const isPrimary = variant === "primary";
      const isGhost = variant === "ghost";
      return (
        <motion.a
          {...motionProps}
          href={url}
          className={ambient}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "14px 30px",
            borderRadius: ds.radius.full,
            fontWeight: 700, fontSize: "1rem", textDecoration: "none",
            background: isPrimary ? c.gradient : isGhost ? "transparent" : c.surface,
            color: isPrimary ? "#fff" : c.text,
            border: isGhost ? `1px solid ${c.border}` : "none",
            boxShadow: isPrimary ? ds.elevation[2] : "none",
            ...css,
          }}
        >
          {text}
          <LucideIcon name="arrow-right" color={isPrimary ? "#fff" : c.text} size={17} />
        </motion.a>
      );
    }

    // ── form ────────────────────────────────────────────────────────────────
    case "form": {
      const form = schema.forms?.find(f => f.id === node.content?.formId) ?? schema.forms?.[0];
      if (!form) return null;
      return (
        <motion.form {...motionProps} style={{ display: "flex", flexDirection: "column", gap: 14, ...css }} onSubmit={e => e.preventDefault()}>
          {form.fields.map(field => (
            <div key={field.name} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, color: c.textMuted }}>{field.label}</label>
              {field.type === "textarea" ? (
                <textarea rows={4} style={inputStyle(ds)} />
              ) : field.type === "select" ? (
                <select style={inputStyle(ds)}>
                  {(field.options ?? []).map(o => <option key={o}>{o}</option>)}
                </select>
              ) : (
                <input type={field.type} style={inputStyle(ds)} />
              )}
            </div>
          ))}
          <button
            type="submit"
            style={{
              marginTop: 6, padding: "14px 24px", borderRadius: ds.radius.full,
              fontWeight: 700, fontSize: "1rem", border: "none", cursor: "pointer",
              background: c.gradient, color: "#fff", boxShadow: ds.elevation[2],
            }}
          >
            {form.submitText}
          </button>
        </motion.form>
      );
    }

    // ── card ────────────────────────────────────────────────────────────────
    case "card":
      return (
        <motion.div {...motionProps} className={ambient} style={{ display: "flex", flexDirection: "column", gap: 12, ...css }}>
          <NodeChildren node={node} ctx={ctx} />
        </motion.div>
      );

    // ── stat ────────────────────────────────────────────────────────────────
    case "stat": {
      return (
        <motion.div {...motionProps} className={ambient} style={{ display: "flex", flexDirection: "column", gap: 4, ...css }}>
          <span style={{ fontSize: "clamp(2.2rem,4vw,3.4rem)", fontWeight: 900, fontFamily: ds.typography.headingFamily, color: c.primary, lineHeight: 1 }}>
            {node.content?.statValue ?? "—"}
          </span>
          <span style={{ fontSize: "1rem", fontWeight: 700, color: c.text }}>{node.content?.statLabel ?? ""}</span>
          <NodeChildren node={node} ctx={ctx} />
        </motion.div>
      );
    }

    // ── badge ───────────────────────────────────────────────────────────────
    case "badge":
      return (
        <motion.span {...motionProps} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: "0.85rem", fontWeight: 600, color: c.text, ...css }}>
          {node.content?.icon && <LucideIcon name={node.content.icon} color={c.accent} size={15} />}
          {node.content?.badgeText ?? ""}
        </motion.span>
      );

    // ── icon ────────────────────────────────────────────────────────────────
    case "icon":
      return (
        <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 48, height: 48, color: "#fff", ...css }}>
          <LucideIcon name={node.content?.icon} color="#fff" size={22} />
        </div>
      );

    // ── list ────────────────────────────────────────────────────────────────
    case "list":
      return (
        <motion.ul {...motionProps} style={{ display: "flex", flexDirection: "column", gap: 8, listStyle: "none", padding: 0, margin: 0, ...css }}>
          {(node.content?.listItems ?? []).map((item, i) => (
            <li key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", color: c.textMuted }}>
              <LucideIcon name="check" color={c.accent} size={17} />
              <span>{item}</span>
            </li>
          ))}
        </motion.ul>
      );

    // ── quote ───────────────────────────────────────────────────────────────
    case "quote":
      return (
        <motion.figure {...motionProps} style={{ margin: 0, ...css }}>
          <blockquote style={{ ...typographyCss(ds, "h3", true), color: c.text, margin: 0 }}>
            {node.content?.quoteText ?? ""}
          </blockquote>
          {node.content?.quoteAuthor && (
            <figcaption style={{ marginTop: 16, fontSize: "0.9rem", fontWeight: 600, color: c.accent }}>
              {node.content.quoteAuthor}
            </figcaption>
          )}
        </motion.figure>
      );

    // ── marquee ─────────────────────────────────────────────────────────────
    case "marquee": {
      const items = node.content?.marqueeItems ?? [];
      const loop = [...items, ...items];
      return (
        <div style={{ overflow: "hidden", width: "100%", ...css }}>
          <div className="lt-marquee-track" style={{ display: "flex", gap: 48, width: "max-content" }}>
            {loop.map((item, i) => (
              <span key={i} style={{ fontSize: "1.05rem", fontWeight: 700, color: c.text, whiteSpace: "nowrap", opacity: 0.85 }}>
                {item}
              </span>
            ))}
          </div>
        </div>
      );
    }

    default:
      return (
        <div style={css}>
          <NodeChildren node={node} ctx={ctx} />
        </div>
      );
  }
}

function inputStyle(ds: DesignSystem): React.CSSProperties {
  return {
    width: "100%", padding: "12px 14px", borderRadius: ds.radius.md,
    border: `1px solid ${ds.colors.border}`, background: "rgba(255,255,255,0.04)",
    color: ds.colors.text, fontSize: "0.95rem", fontFamily: ds.typography.fontFamily,
  };
}

// ── Responsive + animation stylesheet ─────────────────────────────────────────

function GlobalLayoutStyles({ ds }: { ds: DesignSystem }) {
  const css = `
.lt-grid-2,.lt-grid-3,.lt-grid-4 { display:grid; }
@media (max-width:${ds.breakpoints.tablet}px){
  .lt-grid-3,.lt-grid-4 { grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
  .lt-split { grid-template-columns:1fr !important; }
}
@media (max-width:${ds.breakpoints.mobile}px){
  .lt-grid-2,.lt-grid-3,.lt-grid-4 { grid-template-columns:1fr !important; }
}
@keyframes lt-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-14px)} }
@keyframes lt-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
@keyframes lt-drift { 0%,100%{transform:translateX(0)} 50%{transform:translateX(12px)} }
@keyframes lt-spin_slow { from{transform:rotate(0)} to{transform:rotate(360deg)} }
@keyframes lt-breathe { 0%,100%{opacity:0.82} 50%{opacity:1} }
@keyframes lt-shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
@keyframes lt-marquee { from{transform:translateX(0)} to{transform:translateX(-50%)} }
.lt-ambient-float{animation:lt-float 6s ease-in-out infinite}
.lt-ambient-pulse{animation:lt-pulse 4s ease-in-out infinite}
.lt-ambient-drift{animation:lt-drift 8s ease-in-out infinite}
.lt-ambient-spin_slow{animation:lt-spin_slow 28s linear infinite}
.lt-ambient-breathe{animation:lt-breathe 5s ease-in-out infinite}
.lt-marquee-track{animation:lt-marquee 28s linear infinite}
`;
  return <style>{css}</style>;
}

// ── Public export ─────────────────────────────────────────────────────────────

interface Props {
  layout: ComposedLayout;
  schema: DynamicPageSchema;
  isPreview?: boolean;
}

export function LayoutTreeRenderer({ layout, schema, isPreview = false }: Props) {
  const ds = layout.designSystem;
  const ctx = useMemo<RenderCtx>(() => ({ ds, schema, isPreview }), [ds, schema, isPreview]);

  return (
    <div
      style={{
        background: ds.colors.background,
        color: ds.colors.text,
        fontFamily: ds.typography.fontFamily,
        minHeight: "100%",
      }}
    >
      <GlobalLayoutStyles ds={ds} />
      <LayoutNodeView node={layout.root} ctx={ctx} />
    </div>
  );
}
