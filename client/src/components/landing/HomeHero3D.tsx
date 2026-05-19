import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { useDetectGPU } from "@react-three/drei";
import { HomeHeroScene } from "./HomeHeroScene";
import { useReducedMotion } from "./useReducedMotion";
import { usePageVisibility } from "./usePageVisibility";

type Props = {
  className?: string;
  accent?: string;
};

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export function HomeHero3D({ className = "", accent = "#7c3aed" }: Props) {
  const reducedMotion = useReducedMotion();
  const visible = usePageVisibility();
  const gpu = useDetectGPU();
  const lowQuality = reducedMotion || (gpu?.tier ?? 3) <= 1 || gpu?.isMobile;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const vh = Math.max(1, window.innerHeight || 1);
        // progress 0..1 as the hero scrolls out of view
        const p = clamp01((-rect.top) / Math.max(1, rect.height - vh * 0.15));
        setScrollProgress(p);
      });
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // If the tab is hidden, unmount the canvas entirely so it doesn't render.
  if (!visible) {
    return <div ref={hostRef} className={className} aria-hidden="true" />;
  }

  const dpr = useMemo(() => {
    if (typeof window === "undefined") return 1;
    const raw = window.devicePixelRatio || 1;
    return lowQuality ? 1 : Math.min(2, raw);
  }, [lowQuality]);

  return (
    <div ref={hostRef} className={className}>
      <Canvas
        dpr={dpr}
        frameloop={reducedMotion ? "demand" : "always"}
        gl={{
          antialias: !lowQuality,
          alpha: true,
          powerPreference: lowQuality ? "low-power" : "high-performance",
        }}
        camera={{ fov: 45, near: 0.1, far: 70, position: [0, 1.2, 6] }}
      >
        <HomeHeroScene reducedMotion={reducedMotion} scrollProgress={scrollProgress} accent={accent} />
      </Canvas>
    </div>
  );
}
