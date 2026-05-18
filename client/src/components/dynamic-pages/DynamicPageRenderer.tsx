/**
 * client/src/components/dynamic-pages/DynamicPageRenderer.tsx
 *
 * Renders a full page from a DynamicPageSchema.
 * Hybrid architecture:
 *   - WebGL 3D hero (Three.js + React Three Fiber) — always rendered
 *   - Below-hero sections: AI-generated Tailwind HTML in a sandboxed iframe
 *     when schema.generatedHtml is present, otherwise falls back to the
 *     fixed schema-driven section components.
 */

import { Suspense, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { WebGLSceneRenderer } from "./WebGLSceneRenderer";
import type { DynamicPageSchema, SectionSchema, CTAConfig, CTAAnimation } from "@/lib/dynamic-pages/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Zap, Star, CheckCircle, MessageSquare, HelpCircle, BarChart, Users, ArrowRight, Phone } from "lucide-react";

// ── Section renderers ─────────────────────────────────────────────────────────

function HeroSection({ section, schema }: { section: SectionSchema; schema: DynamicPageSchema }) {
  return (
    <section className="relative text-center py-24 px-6">
      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
        <Badge className="mb-4" style={{ backgroundColor: schema.theme.colors.primary + "20", color: schema.theme.colors.primary, border: `1px solid ${schema.theme.colors.primary}40` }}>
          {schema.meta.niche.replace(/_/g, " ")}
        </Badge>
        <h1 className="text-4xl md:text-6xl font-black mb-6 leading-tight" style={{ color: schema.theme.colors.text }}>
          {schema.copy.headline}
        </h1>
        <p className="text-lg md:text-xl mb-8 max-w-2xl mx-auto" style={{ color: schema.theme.colors.textMuted }}>
          {schema.copy.subheadline}
        </p>
        <CTAButton cta={schema.cta} primaryColor={schema.theme.colors.primary} />
      </motion.div>
    </section>
  );
}

function FeaturesSection({ section, schema }: { section: SectionSchema; schema: DynamicPageSchema }) {
  const items = section.items ?? [];
  return (
    <section className="py-16 px-6">
      <h2 className="text-3xl font-black text-center mb-12" style={{ color: schema.theme.colors.text }}>
        {section.title}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {items.map((item, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}
            className="p-6 rounded-2xl border" style={{ background: schema.theme.colors.surface, borderColor: schema.theme.colors.primary + "30" }}>
            <div className="w-10 h-10 rounded-xl mb-4 flex items-center justify-center" style={{ backgroundColor: schema.theme.colors.primary + "20" }}>
              <Zap size={20} style={{ color: schema.theme.colors.primary }} />
            </div>
            <h3 className="text-lg font-bold mb-2" style={{ color: schema.theme.colors.text }}>{item.title}</h3>
            <p className="text-sm" style={{ color: schema.theme.colors.textMuted }}>{item.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function TestimonialsSection({ section, schema }: { section: SectionSchema; schema: DynamicPageSchema }) {
  const items = section.items ?? [];
  return (
    <section className="py-16 px-6">
      <h2 className="text-3xl font-black text-center mb-12" style={{ color: schema.theme.colors.text }}>{section.title}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
        {items.map((item, i) => (
          <div key={i} className="p-6 rounded-2xl border" style={{ background: schema.theme.colors.surface, borderColor: schema.theme.colors.primary + "30" }}>
            <div className="flex gap-1 mb-3">{[...Array(5)].map((_, j) => <Star key={j} size={14} style={{ color: schema.theme.colors.primary }} fill={schema.theme.colors.primary} />)}</div>
            <p className="text-sm mb-4" style={{ color: schema.theme.colors.textMuted }}>"{item.body}"</p>
            <p className="font-semibold text-sm" style={{ color: schema.theme.colors.text }}>— {item.title}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FAQSection({ section, schema }: { section: SectionSchema; schema: DynamicPageSchema }) {
  const items = section.items ?? [];
  return (
    <section className="py-16 px-6 max-w-3xl mx-auto">
      <h2 className="text-3xl font-black text-center mb-12" style={{ color: schema.theme.colors.text }}>{section.title}</h2>
      <div className="space-y-4">
        {items.map((item, i) => (
          <div key={i} className="p-5 rounded-xl border" style={{ background: schema.theme.colors.surface, borderColor: schema.theme.colors.primary + "30" }}>
            <h3 className="font-bold mb-2 flex items-center gap-2" style={{ color: schema.theme.colors.text }}>
              <HelpCircle size={16} style={{ color: schema.theme.colors.primary }} />{item.title}
            </h3>
            <p className="text-sm" style={{ color: schema.theme.colors.textMuted }}>{item.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CTABannerSection({ section, schema }: { section: SectionSchema; schema: DynamicPageSchema }) {
  return (
    <section className="py-20 px-6 text-center rounded-3xl mx-6 my-8" style={{ background: `linear-gradient(135deg, ${schema.theme.colors.primary}20, ${schema.theme.colors.secondary}20)`, border: `1px solid ${schema.theme.colors.primary}30` }}>
      <h2 className="text-3xl font-black mb-4" style={{ color: schema.theme.colors.text }}>{section.title}</h2>
      {section.subtitle && <p className="text-lg mb-8" style={{ color: schema.theme.colors.textMuted }}>{section.subtitle}</p>}
      <CTAButton cta={schema.cta} primaryColor={schema.theme.colors.primary} />
    </section>
  );
}

function StatsSection({ section, schema }: { section: SectionSchema; schema: DynamicPageSchema }) {
  const items = section.items ?? [];
  return (
    <section className="py-16 px-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto">
        {items.map((item, i) => (
          <div key={i} className="text-center">
            <p className="text-4xl font-black" style={{ color: schema.theme.colors.primary }}>{item.title}</p>
            <p className="text-sm mt-1" style={{ color: schema.theme.colors.textMuted }}>{item.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function GenericSection({ section, schema }: { section: SectionSchema; schema: DynamicPageSchema }) {
  return (
    <section className="py-16 px-6 max-w-4xl mx-auto">
      <h2 className="text-3xl font-black mb-4" style={{ color: schema.theme.colors.text }}>{section.title}</h2>
      {section.subtitle && <p className="text-lg mb-6" style={{ color: schema.theme.colors.textMuted }}>{section.subtitle}</p>}
      {section.body && <p style={{ color: schema.theme.colors.textMuted }}>{section.body}</p>}
    </section>
  );
}

// ── CTA Button ────────────────────────────────────────────────────────────────

const glowKeyframes = `@keyframes ctaGlow { 0%,100% { box-shadow: 0 0 20px currentColor, 0 0 40px currentColor; } 50% { box-shadow: 0 0 40px currentColor, 0 0 80px currentColor; } }`;

function CTAButton({ cta, primaryColor }: { cta: CTAConfig; primaryColor: string }) {
  const animStyle: Record<CTAAnimation, React.CSSProperties> = {
    none: {},
    pulse: { animation: "pulse 2s infinite" },
    glow: { animation: "ctaGlow 2s ease-in-out infinite", color: primaryColor },
    bounce: { animation: "bounce 1s infinite" },
    shimmer: {},
  };

  return (
    <>
      <style>{glowKeyframes}</style>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <a href={cta.primaryUrl}>
          <Button size="lg" style={{ background: `linear-gradient(135deg, ${primaryColor}, ${primaryColor}cc)`, ...animStyle[cta.animation] }} className="text-white font-bold px-8 py-3 rounded-xl">
            {cta.primaryText} <ArrowRight size={16} className="ml-2" />
          </Button>
        </a>
        {cta.secondaryText && (
          <a href={cta.secondaryUrl ?? "#"}>
            <Button variant="outline" size="lg" className="px-8 py-3 rounded-xl" style={{ borderColor: primaryColor + "60", color: primaryColor }}>
              {cta.secondaryText}
            </Button>
          </a>
        )}
      </div>
    </>
  );
}

// ── Section router ────────────────────────────────────────────────────────────

function Section({ section, schema }: { section: SectionSchema; schema: DynamicPageSchema }) {
  if (!section.visible) return null;
  switch (section.type) {
    case "hero":         return <HeroSection section={section} schema={schema} />;
    case "features":     return <FeaturesSection section={section} schema={schema} />;
    case "testimonials": return <TestimonialsSection section={section} schema={schema} />;
    case "faq":          return <FAQSection section={section} schema={schema} />;
    case "cta_banner":   return <CTABannerSection section={section} schema={schema} />;
    case "stats":        return <StatsSection section={section} schema={schema} />;
    default:             return <GenericSection section={section} schema={schema} />;
  }
}

// ── AI HTML iframe renderer ───────────────────────────────────────────────────

function buildIframeDoc(html: string, colors: DynamicPageSchema["theme"]["colors"]): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://cdn.tailwindcss.com"></script>
<style>
:root {
  --primary: ${colors.primary};
  --secondary: ${colors.secondary};
  --accent: ${colors.accent};
  --bg: ${colors.background};
  --surface: ${colors.surface};
  --text: ${colors.text};
  --text-muted: ${colors.textMuted};
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: Inter, system-ui, sans-serif; }
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap');
</style>
</head>
<body>
${html}
</body>
</html>`;
}

function HtmlSectionsIframe({ schema }: { schema: DynamicPageSchema }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    // Auto-resize to content height
    try {
      const height = iframe.contentDocument?.documentElement?.scrollHeight ?? 0;
      if (height > 0) iframe.style.height = `${height}px`;
    } catch {
      // cross-origin sandbox — leave at minHeight
    }
  }, []);

  const doc = buildIframeDoc(schema.generatedHtml!, schema.theme.colors);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={doc}
      onLoad={handleLoad}
      title="Generated page sections"
      sandbox="allow-scripts allow-forms allow-same-origin"
      style={{ width: "100%", border: "none", minHeight: "600px", display: "block" }}
    />
  );
}

// ── Public export ─────────────────────────────────────────────────────────────

interface Props {
  schema: DynamicPageSchema;
  isPreview?: boolean;
  heroHeight?: string;
}

export function DynamicPageRenderer({ schema, isPreview = false, heroHeight = "500px" }: Props) {
  const sorted = [...(schema.sections ?? [])].sort((a, b) => a.order - b.order);
  const hasGeneratedHtml = !!schema.generatedHtml?.trim();

  return (
    <div style={{ backgroundColor: schema.theme.colors.background, color: schema.theme.colors.text, fontFamily: schema.theme.font ?? "Inter" }}>
      {/* ── WebGL 3D Hero (always rendered) ── */}
      <div style={{ position: "relative", height: heroHeight }}>
        {/* AI-generated hero image — rendered as a layered backdrop behind the 3D scene */}
        {schema.scene?.fallbackImage && (
          <div style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url(${schema.scene.fallbackImage})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            zIndex: 0,
          }}>
            {/* Dark overlay so the 3D scene reads clearly */}
            <div style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.55)" }} />
          </div>
        )}

        <Suspense fallback={<div style={{ height: heroHeight, background: schema.theme.colors.surface }} />}>
          <WebGLSceneRenderer scene={schema.scene} height={heroHeight} />
        </Suspense>

        {/* Overlay copy */}
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", pointerEvents: "none" }}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }} style={{ textAlign: "center", pointerEvents: "auto" }}>
            <h1 style={{ fontSize: isPreview ? "2rem" : "3.5rem", fontWeight: 900, marginBottom: "1rem", color: schema.theme.colors.text, textShadow: "0 2px 20px rgba(0,0,0,0.8)" }}>
              {schema.copy.headline}
            </h1>
            <p style={{ fontSize: isPreview ? "1rem" : "1.25rem", marginBottom: "2rem", color: schema.theme.colors.textMuted, maxWidth: "600px" }}>
              {schema.copy.subheadline}
            </p>
            <CTAButton cta={schema.cta} primaryColor={schema.theme.colors.primary} />
          </motion.div>
        </div>
      </div>

      {/* ── Below-hero sections ── */}
      {hasGeneratedHtml ? (
        /* AI-generated Tailwind HTML — renders what the user actually described */
        <HtmlSectionsIframe schema={schema} />
      ) : (
        /* Fallback: schema-driven fixed section components */
        <>
          <div>
            {sorted.filter(s => s.type !== "hero").map(section => (
              <Section key={section.id} section={section} schema={schema} />
            ))}
          </div>
          {schema.forms.length > 0 && (
            <section className="py-16 px-6 max-w-md mx-auto">
              <h2 className="text-2xl font-black mb-8 text-center" style={{ color: schema.theme.colors.text }}>
                {schema.forms[0].title}
              </h2>
              <form className="space-y-4" onSubmit={e => e.preventDefault()}>
                {schema.forms[0].fields.map(field => (
                  <div key={field.name}>
                    <label className="block text-sm font-medium mb-1" style={{ color: schema.theme.colors.textMuted }}>{field.label}</label>
                    {field.type === "textarea" ? (
                      <textarea className="w-full p-3 rounded-xl border bg-transparent" style={{ borderColor: schema.theme.colors.primary + "40", color: schema.theme.colors.text }} rows={4} />
                    ) : (
                      <input type={field.type} className="w-full p-3 rounded-xl border bg-transparent" style={{ borderColor: schema.theme.colors.primary + "40", color: schema.theme.colors.text }} />
                    )}
                  </div>
                ))}
                <Button className="w-full py-3 rounded-xl font-bold" style={{ background: `linear-gradient(135deg, ${schema.theme.colors.primary}, ${schema.theme.colors.secondary})` }}>
                  {schema.forms[0].submitText}
                </Button>
              </form>
            </section>
          )}
        </>
      )}
    </div>
  );
}
