import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Environment, Float, Grid, Stars, useDetectGPU } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";

type Props = {
  reducedMotion: boolean;
  scrollProgress: number; // 0..1
  accent: string;
};

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export function HomeHeroScene({ reducedMotion, scrollProgress, accent }: Props) {
  const { camera, invalidate } = useThree();
  const lastTick = useRef(0);
  const gpu = useDetectGPU();
  const lowQuality = reducedMotion || (gpu?.tier ?? 3) <= 1 || gpu?.isMobile;

  const accentColor = useMemo(() => new THREE.Color(accent), [accent]);
  const ringMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#0b1020"),
      emissive: accentColor,
      emissiveIntensity: 0.85,
      metalness: 0.7,
      roughness: 0.25,
    });
    return m;
  }, [accentColor]);

  useEffect(() => {
    camera.position.set(0, 1.2, 6);
    camera.lookAt(0, 0.2, 0);
    invalidate();
  }, [camera, invalidate]);

  useFrame(({ clock }) => {
    // cap update work to ~30fps (still renders at browser rate, but the scene math stays light)
    const t = clock.elapsedTime;
    if (t - lastTick.current < 1 / 30) return;
    lastTick.current = t;

    const p = clamp01(scrollProgress);
    const eased = p * p * (3 - 2 * p); // smoothstep

    // Camera glides forward + slight orbit as you scroll.
    const targetZ = THREE.MathUtils.lerp(6, 4.4, eased);
    const targetY = THREE.MathUtils.lerp(1.2, 0.6, eased);
    const targetX = THREE.MathUtils.lerp(0, 0.65, eased);

    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, 0.08);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, 0.08);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, 0.08);
    camera.lookAt(0, 0.2, 0);
  });

  return (
    <>
      <color attach="background" args={["#030014"]} />

      <fog attach="fog" args={["#030014", 6, 18]} />

      <ambientLight intensity={0.25} />
      <directionalLight position={[4, 6, 3]} intensity={1.15} color={"#e8edff"} />
      <pointLight position={[-3, 1.5, 2]} intensity={0.9} color={accent} />

      <Environment preset={lowQuality ? "city" : "night"} />

      <group position={[0, -0.2, 0]}>
        <Grid
          infiniteGrid
          cellSize={0.6}
          cellThickness={0.6}
          sectionSize={3.6}
          sectionThickness={1.15}
          sectionColor={accent}
          cellColor={"#1d2440"}
          fadeDistance={14}
          fadeStrength={2}
        />
      </group>

      {!lowQuality && <Stars radius={80} depth={40} count={650} factor={3} saturation={0} fade speed={0.25} />}

      <Float
        enabled={!reducedMotion}
        floatIntensity={0.5}
        rotationIntensity={0.4}
        speed={0.8}
      >
        <mesh position={[0, 0.25, 0]} material={ringMat}>
          <torusKnotGeometry args={[0.9, 0.22, 220, 24]} />
        </mesh>
      </Float>

      <mesh position={[0, 0.25, 0]} rotation={[0.15, -0.25, 0]} >
        <torusGeometry args={[1.75, 0.02, 16, 280]} />
        <meshStandardMaterial
          color={"#0a0f1f"}
          emissive={accentColor}
          emissiveIntensity={0.55}
          metalness={0.85}
          roughness={0.35}
          transparent
          opacity={0.8}
        />
      </mesh>

      {!lowQuality && (
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.9} luminanceThreshold={0.25} luminanceSmoothing={0.6} />
          <Vignette eskil={false} offset={0.15} darkness={0.7} />
        </EffectComposer>
      )}
    </>
  );
}

