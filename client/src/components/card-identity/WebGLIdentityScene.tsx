/**
 * client/src/components/card-identity/WebGLIdentityScene.tsx
 *
 * R3F scene driven by IdentityVisualDNA.scene.
 * Includes FPS guard and mobile auto-downgrade.
 */

import React, { Suspense, useRef, useState, useMemo, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  OrbitControls,
  Float,
  Stars,
  MeshDistortMaterial,
  MeshWobbleMaterial,
} from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import type { IdentityVisualDNA, SceneObject, ParticleConfig, LightingConfig, PostProcessingConfig } from "@/lib/card-identity/schema";

// ── FPS Guard ─────────────────────────────────────────────────────────────────

function useFPSGuard(threshold = 20, windowMs = 3000): boolean {
  const [lowFPS, setLowFPS] = useState(false);
  const frames = useRef<number[]>([]);
  const lastTime = useRef(performance.now());

  useEffect(() => {
    let animId: number;
    const tick = () => {
      const now = performance.now();
      frames.current.push(now - lastTime.current);
      lastTime.current = now;
      // Keep only frames within the window
      let total = 0;
      let start = frames.current.length - 1;
      while (start > 0 && total < windowMs) {
        total += frames.current[start];
        start--;
      }
      frames.current = frames.current.slice(start);
      if (frames.current.length >= 20) {
        const avgMs = frames.current.reduce((s, v) => s + v, 0) / frames.current.length;
        const fps = 1000 / avgMs;
        if (fps < threshold && !lowFPS) setLowFPS(true);
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [threshold, windowMs, lowFPS]);

  return lowFPS;
}

// ── Scene Object ──────────────────────────────────────────────────────────────

function IdentityObject({ obj, lowQuality }: { obj: SceneObject; lowQuality: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const animSpeed = lowQuality ? 0.4 : 1;

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime() * animSpeed;
    if (obj.animation === "spin") {
      meshRef.current.rotation.y = t * 0.5;
      meshRef.current.rotation.x = t * 0.2;
    } else if (obj.animation === "pulse") {
      const s = obj.scale * (1 + Math.sin(t * 2) * 0.08);
      meshRef.current.scale.setScalar(s);
    } else if (obj.animation === "orbit") {
      meshRef.current.position.x = obj.position[0] + Math.sin(t * 0.5) * 1.5;
      meshRef.current.position.y = obj.position[1] + Math.cos(t * 0.3) * 0.8;
    } else if (obj.animation === "breathe") {
      const s = obj.scale * (1 + Math.sin(t * 1.2) * 0.05);
      meshRef.current.scale.setScalar(s);
    }
  });

  const geometry = useMemo(() => {
    switch (obj.type) {
      case "ring": return <torusGeometry args={[0.6, 0.2, 24, 80]} />;
      case "cube": return <boxGeometry args={[1.2, 1.2, 1.2]} />;
      case "crystal": return <octahedronGeometry args={[0.8]} />;
      default: return <sphereGeometry args={[0.8, lowQuality ? 24 : 48, lowQuality ? 24 : 48]} />;
    }
  }, [obj.type, lowQuality]);

  const material = useMemo(() => {
    if (obj.material === "distort") {
      return (
        <MeshDistortMaterial
          color={obj.color}
          distort={0.4}
          speed={3}
          roughness={0}
          metalness={0.8}
          transparent
          opacity={obj.opacity}
        />
      );
    }
    if (obj.material === "wobble") {
      return (
        <MeshWobbleMaterial
          color={obj.color}
          factor={0.4}
          speed={2}
          metalness={1}
          roughness={0}
        />
      );
    }
    if (obj.material === "glass") {
      return <meshPhysicalMaterial color={obj.color} metalness={0.1} roughness={0} transparent opacity={0.3} />;
    }
    if (obj.material === "emissive") {
      return <meshStandardMaterial color={obj.color} emissive={obj.color} emissiveIntensity={2} />;
    }
    if (obj.material === "metallic") {
      return <meshStandardMaterial color={obj.color} metalness={1} roughness={0.1} />;
    }
    return <meshStandardMaterial color={obj.color} metalness={0.7} roughness={0.2} />;
  }, [obj.material, obj.color, obj.opacity]);

  const floatSpeed = obj.animation === "float" || obj.animation === "breathe" ? 1.5 : 2;

  return (
    <Float speed={floatSpeed} rotationIntensity={0.4} floatIntensity={1.2}>
      <mesh ref={meshRef} position={obj.position} scale={obj.scale}>
        {geometry}
        {material}
      </mesh>
    </Float>
  );
}

// ── Particles ─────────────────────────────────────────────────────────────────

function IdentityParticles({ particles, lowQuality }: { particles: ParticleConfig; lowQuality: boolean }) {
  const count = lowQuality ? Math.min(200, Math.floor(particles.count / 3)) : particles.count;
  const ref = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3]     = (Math.random() - 0.5) * 18;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 18;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 18;
    }
    return arr;
  }, [count]);

  const speed = particles.speed;
  const speedMod = lowQuality ? 0.3 : 1;

  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.y = clock.getElapsedTime() * 0.03 * speed * speedMod;
    if (particles.type === "rain") {
      ref.current.position.y = (ref.current.position.y - 0.01 * speed * speedMod) % 18 - 9;
    } else if (particles.type === "swirl") {
      ref.current.rotation.x = clock.getElapsedTime() * 0.02 * speed * speedMod;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={particles.size} color={particles.color} transparent opacity={0.6} sizeAttenuation />
    </points>
  );
}

// ── Lights ────────────────────────────────────────────────────────────────────

function IdentityLights({ lighting }: { lighting: LightingConfig }) {
  return (
    <>
      <ambientLight intensity={lighting.ambientIntensity} />
      {lighting.pointLights.map((light, i) => (
        <pointLight key={i} position={light.position} color={light.color} intensity={light.intensity} />
      ))}
    </>
  );
}

// ── Post Processing ───────────────────────────────────────────────────────────

function IdentityPostProcessing({ pp, lowQuality }: { pp: PostProcessingConfig; lowQuality: boolean }) {
  if (lowQuality) return null;
  const effects: React.ReactElement[] = [];
  if (pp.bloom) {
    effects.push(
      <Bloom key="bloom" luminanceThreshold={0.2} luminanceSmoothing={0.9} intensity={pp.bloomIntensity} />
    );
  }
  if (pp.vignette) {
    effects.push(<Vignette key="vignette" eskil={false} offset={0.1} darkness={0.8} />);
  }
  if (effects.length === 0) return null;
  return <EffectComposer>{effects}</EffectComposer>;
}

// ── Environment ───────────────────────────────────────────────────────────────

const ENV_BG: Record<string, string> = {
  space: "#000008",
  luxury: "#0a0805",
  neon_city: "#0a0014",
  nature: "#051208",
  abstract: "#030712",
  minimal: "#0f0f0f",
  club: "#050015",
};

function IdentityEnvironment({ environment, colors }: { environment: string; colors: IdentityVisualDNA["colors"] }) {
  const bg = ENV_BG[environment] ?? "#030712";
  const starsEnvs = ["space", "abstract", "club", "neon_city"];
  const showStars = starsEnvs.includes(environment);
  return (
    <>
      <color attach="background" args={[bg]} />
      {showStars && <Stars radius={60} depth={40} count={1500} factor={3} saturation={0} fade speed={0.3} />}
    </>
  );
}

// ── Inner Scene ───────────────────────────────────────────────────────────────

function InnerIdentityScene({ dna }: { dna: IdentityVisualDNA }) {
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const lowFPS = useFPSGuard(20, 3000);
  const lowQuality = isMobile || lowFPS;

  const maxObjects = lowQuality ? 2 : dna.scene.objects.length;

  const autoRotateSpeed = dna.cameraMotion === "slow_orbit" ? 0.4
    : dna.cameraMotion === "drift" ? 0.8
    : dna.cameraMotion === "static" || dna.cameraMotion === "lock" ? 0
    : 0.4;

  return (
    <>
      <IdentityEnvironment environment={dna.scene.environment} colors={dna.colors} />
      <IdentityLights lighting={dna.scene.lighting} />
      {dna.scene.particles.enabled && (
        <IdentityParticles particles={dna.scene.particles} lowQuality={lowQuality} />
      )}
      {dna.scene.objects.slice(0, maxObjects).map(obj => (
        <IdentityObject key={obj.id} obj={obj} lowQuality={lowQuality} />
      ))}
      <OrbitControls
        enableZoom={false}
        enablePan={false}
        autoRotate={autoRotateSpeed > 0}
        autoRotateSpeed={autoRotateSpeed}
        maxPolarAngle={Math.PI / 1.5}
        minPolarAngle={Math.PI / 4}
      />
      <IdentityPostProcessing pp={dna.scene.postProcessing} lowQuality={lowQuality} />
    </>
  );
}

// ── Public Export ─────────────────────────────────────────────────────────────

interface Props {
  dna: IdentityVisualDNA;
  height?: string;
  className?: string;
}

export function WebGLIdentityScene({ dna, height = "280px", className = "" }: Props) {
  return (
    <div className={className} style={{ width: "100%", height }}>
      <Canvas
        camera={{ fov: 60, position: [0, 0, 7] }}
        gl={{ antialias: true, alpha: false }}
        dpr={Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 2)}
      >
        <Suspense fallback={null}>
          <InnerIdentityScene dna={dna} />
        </Suspense>
      </Canvas>
    </div>
  );
}
