/**
 * client/src/components/dynamic-pages/WebGLSceneRenderer.tsx
 *
 * Renders a WebGLSceneSchema as a live Three.js/R3F scene.
 * Maps schema fields to procedural Three.js primitives.
 * Includes mobile fallback and FPS guard.
 */

import React, { Suspense, useRef, useState, useMemo, useEffect, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  Float,
  Stars,
  MeshDistortMaterial,
  MeshWobbleMaterial,
  Environment,
  Sparkles,
} from "@react-three/drei";
import { EffectComposer, Bloom, ChromaticAberration, Vignette } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import * as THREE from "three";
import type { WebGLSceneSchema, SceneObject, ParticleConfig, LightingConfig, CameraConfig } from "@/lib/dynamic-pages/schema";

// ── FPS Guard ─────────────────────────────────────────────────────────────────

function useFPSGuard(threshold = 20, windowMs = 3000): boolean {
  const [lowFPS, setLowFPS] = useState(false);
  const frames = useRef<number[]>([]);
  const lastTime = useRef(performance.now());

  useEffect(() => {
    const id = requestAnimationFrame(function tick() {
      const now = performance.now();
      frames.current.push(now - lastTime.current);
      lastTime.current = now;
      const cutoff = now - windowMs;
      frames.current = frames.current.filter((_, i) =>
        frames.current.slice(0, i).reduce((s, v) => s + v, 0) < windowMs
      );
      if (frames.current.length >= 30) {
        const avgMs = frames.current.reduce((s, v) => s + v, 0) / frames.current.length;
        const fps = 1000 / avgMs;
        if (fps < threshold) setLowFPS(true);
      }
      requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [threshold, windowMs]);

  return lowFPS;
}

// ── Scene Object Renderer ─────────────────────────────────────────────────────

function SceneObjectMesh({ obj, lowQuality }: { obj: SceneObject; lowQuality: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const animSpeed = lowQuality ? 0.3 : 1;

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime() * animSpeed;
    if (obj.animation === "spin") {
      meshRef.current.rotation.y = t * 0.5;
      meshRef.current.rotation.x = t * 0.3;
    } else if (obj.animation === "pulse") {
      const s = 1 + Math.sin(t * 2) * 0.1;
      meshRef.current.scale.setScalar(s);
    } else if (obj.animation === "orbit") {
      meshRef.current.position.x = obj.position[0] + Math.sin(t * 0.5) * 1.5;
      meshRef.current.position.y = obj.position[1] + Math.cos(t * 0.3) * 0.8;
    }
  });

  const floatSpeed = obj.animation === "slow_float" ? 1.5 : obj.animation === "bob" ? 3 : 2;
  const geometry = useMemo(() => {
    switch (obj.type) {
      case "torus": return <torusGeometry args={[0.6, 0.2, 32, 100]} />;
      case "box": return <boxGeometry args={[1.2, 1.2, 1.2]} />;
      case "cone": return <coneGeometry args={[0.7, 1.5, 32]} />;
      case "cylinder": return <cylinderGeometry args={[0.5, 0.5, 1.5, 32]} />;
      case "ring": return <ringGeometry args={[0.4, 0.8, 32]} />;
      default: return <sphereGeometry args={[0.8, lowQuality ? 32 : 64, lowQuality ? 32 : 64]} />;
    }
  }, [obj.type, lowQuality]);

  const material = useMemo(() => {
    if (obj.material === "distort") {
      return (
        <MeshDistortMaterial
          color={obj.color}
          distort={obj.distort ?? 0.4}
          speed={3}
          roughness={0}
          metalness={0.8}
          transparent
          opacity={obj.opacity ?? 0.85}
        />
      );
    }
    if (obj.material === "wobble") {
      return (
        <MeshWobbleMaterial
          color={obj.color}
          factor={obj.wobbleFactor ?? 0.4}
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
      return <meshStandardMaterial color={obj.color} emissive={obj.emissive ?? obj.color} emissiveIntensity={2} />;
    }
    return <meshStandardMaterial color={obj.color} metalness={0.7} roughness={0.2} />;
  }, [obj.material, obj.color, obj.distort, obj.wobbleFactor, obj.opacity, obj.emissive]);

  const scale = obj.scale ?? [1, 1, 1];

  return (
    <Float speed={floatSpeed} rotationIntensity={0.5} floatIntensity={1.5}>
      <mesh ref={meshRef} position={obj.position} scale={scale}>
        {geometry}
        {material}
      </mesh>
    </Float>
  );
}

// ── Particle Field ────────────────────────────────────────────────────────────

function SceneParticles({ particles, lowQuality }: { particles: ParticleConfig; lowQuality: boolean }) {
  const densityMap = { low: 300, medium: 800, high: 1200 };
  const count = Math.min(particles.count ?? densityMap[particles.density], lowQuality ? 300 : 1200);
  const size = particles.size ?? 0.04;

  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3]     = (Math.random() - 0.5) * 20;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 20;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 20;
    }
    return arr;
  }, [count]);

  const ref = useRef<THREE.Points>(null);
  const speed = particles.speed ?? 1;
  const speedMod = lowQuality ? 0.3 : 1;

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.getElapsedTime() * 0.03 * speed * speedMod;
      if (particles.type === "rain") {
        ref.current.position.y = (ref.current.position.y - 0.01 * speed) % 20 - 10;
      }
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={size} color={particles.color} transparent opacity={0.7} sizeAttenuation />
    </points>
  );
}

// ── Lights ────────────────────────────────────────────────────────────────────

function SceneLights({ lighting }: { lighting: LightingConfig }) {
  const colors = lighting.colors;
  return (
    <>
      <ambientLight intensity={lighting.ambientIntensity ?? 0.3} />
      <pointLight position={[10, 10, 10]} intensity={lighting.intensity ?? 2} color={colors[0] ?? "#6366f1"} />
      <pointLight position={[-10, -10, -5]} intensity={(lighting.intensity ?? 2) * 0.75} color={colors[1] ?? "#a855f7"} />
      {colors[2] && <pointLight position={[0, 10, -10]} intensity={(lighting.intensity ?? 2) * 0.5} color={colors[2]} />}
    </>
  );
}

// ── Background / Environment ──────────────────────────────────────────────────

function SceneEnvironment({ environment }: { environment: string }) {
  const bgMap: Record<string, string> = {
    outer_space: "#000005",
    neon_city: "#0a0014",
    luxury: "#0a0805",
    medical: "#f0f8ff",
    minimal: "#ffffff",
    tech: "#000814",
    storm: "#0a0f15",
    forest: "#0a1a0a",
    underwater: "#001a2e",
    default: "#030712",
  };
  const bg = bgMap[environment] ?? bgMap.default;
  const starsEnvs = ["outer_space", "neon_city", "tech", "storm", "default", "abstract"];
  const showStars = starsEnvs.includes(environment);

  return (
    <>
      <color attach="background" args={[bg]} />
      {showStars && <Stars radius={80} depth={50} count={3000} factor={4} saturation={0} fade speed={0.5} />}
      <Environment preset="city" />
    </>
  );
}

// ── Post Processing ───────────────────────────────────────────────────────────

function ScenePostProcessing({ pp, lowQuality }: { pp: WebGLSceneSchema["postProcessing"]; lowQuality: boolean }) {
  if (lowQuality) return null;
  const effects: React.ReactElement[] = [];
  if (pp.bloom) effects.push(<Bloom key="bloom" luminanceThreshold={0.2} luminanceSmoothing={0.9} intensity={pp.bloomIntensity ?? 1.5} />);
  if (pp.chromaticAberration) effects.push(<ChromaticAberration key="ca" blendFunction={BlendFunction.NORMAL} offset={new THREE.Vector2(0.0005, 0.0005)} />);
  if (pp.vignette) effects.push(<Vignette key="vignette" eskil={false} offset={0.1} darkness={pp.vignetteIntensity ?? 0.8} />);
  if (effects.length === 0) return null;
  return <EffectComposer>{effects}</EffectComposer>;
}

// ── Inner scene (inside Canvas) ───────────────────────────────────────────────

function InnerScene({ scene }: { scene: WebGLSceneSchema }) {
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const lowFPS = useFPSGuard(20, 3000);
  const lowQuality = isMobile || lowFPS;
  const maxObjects = lowQuality ? 3 : scene.objects.length;

  return (
    <>
      <SceneEnvironment environment={scene.environment} />
      <SceneLights lighting={scene.lighting} />
      <SceneParticles particles={scene.particles} lowQuality={lowQuality} />

      {scene.objects.slice(0, maxObjects).map(obj => (
        <SceneObjectMesh key={obj.id} obj={obj} lowQuality={lowQuality} />
      ))}

      <Sparkles count={lowQuality ? 30 : 80} scale={12} size={3} speed={0.5} color={scene.lighting.colors[0] ?? "#6366f1"} />

      <OrbitControls
        enableZoom={false}
        enablePan={false}
        autoRotate
        autoRotateSpeed={scene.camera.intensity ?? 0.5}
        maxPolarAngle={Math.PI / 1.5}
        minPolarAngle={Math.PI / 4}
      />

      <ScenePostProcessing pp={scene.postProcessing} lowQuality={lowQuality} />
    </>
  );
}

// ── Public export ─────────────────────────────────────────────────────────────

interface Props {
  scene: WebGLSceneSchema;
  className?: string;
  height?: string;
}

export function WebGLSceneRenderer({ scene, className = "", height = "100%" }: Props) {
  return (
    <div className={className} style={{ width: "100%", height }}>
      <Canvas
        camera={{ fov: scene.camera.fov ?? 60, position: [0, 0, 8] }}
        gl={{ antialias: true, alpha: false }}
        dpr={Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 2)}
      >
        <Suspense fallback={null}>
          <InnerScene scene={scene} />
        </Suspense>
      </Canvas>
    </div>
  );
}
