import { Suspense, useRef, useState, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  Text3D,
  Center,
  Float,
  Stars,
  MeshDistortMaterial,
  MeshWobbleMaterial,
  Sphere,
  Box,
  Torus,
  Environment,
  Sparkles as DreiSparkles,
  Billboard,
  Trail,
  useTexture,
} from "@react-three/drei";
import { EffectComposer, Bloom, ChromaticAberration, Vignette } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { motion, AnimatePresence } from "framer-motion";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Globe,
  Layers,
  Zap,
  Plus,
  Eye,
  Download,
  Share2,
  Palette,
  LayoutTemplate,
  ArrowRight,
  Star,
  Box as BoxIcon,
  Triangle,
  Circle,
} from "lucide-react";

// ── 3D Scene Components ───────────────────────────────────────────────────────

function FloatingOrb({ position, color, speed = 1, distort = 0.4 }: any) {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (meshRef.current) {
      meshRef.current.rotation.x = clock.getElapsedTime() * 0.3 * speed;
      meshRef.current.rotation.y = clock.getElapsedTime() * 0.5 * speed;
    }
  });
  return (
    <Float speed={speed * 2} rotationIntensity={0.5} floatIntensity={1.5}>
      <mesh ref={meshRef} position={position}>
        <sphereGeometry args={[0.8, 64, 64]} />
        <MeshDistortMaterial
          color={color}
          distort={distort}
          speed={3}
          roughness={0}
          metalness={0.8}
          transparent
          opacity={0.85}
        />
      </mesh>
    </Float>
  );
}

function WobbleTorus({ position, color }: any) {
  return (
    <Float speed={1.5} rotationIntensity={1} floatIntensity={2}>
      <mesh position={position}>
        <torusGeometry args={[0.6, 0.2, 32, 100]} />
        <MeshWobbleMaterial color={color} factor={0.4} speed={2} metalness={1} roughness={0} />
      </mesh>
    </Float>
  );
}

function ParticleField() {
  const count = 800;
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3]     = (Math.random() - 0.5) * 20;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 20;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 20;
    }
    return arr;
  }, []);

  const ref = useRef<THREE.Points>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.getElapsedTime() * 0.03;
      ref.current.rotation.x = clock.getElapsedTime() * 0.01;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.04} color="#a855f7" transparent opacity={0.7} sizeAttenuation />
    </points>
  );
}

function MouseTracker() {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  useFrame(({ mouse }) => {
    if (meshRef.current) {
      meshRef.current.position.x += (mouse.x * 4 - meshRef.current.position.x) * 0.05;
      meshRef.current.position.y += (mouse.y * 4 - meshRef.current.position.y) * 0.05;
    }
  });
  return (
    <Trail width={1} length={6} color="#7c3aed" attenuation={(t) => t * t}>
      <mesh ref={meshRef} position={[0, 0, 0]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color="#a855f7" emissive="#7c3aed" emissiveIntensity={2} />
      </mesh>
    </Trail>
  );
}

function HeroScene() {
  return (
    <>
      <color attach="background" args={["#030712"]} />
      <ambientLight intensity={0.3} />
      <pointLight position={[10, 10, 10]} intensity={2} color="#7c3aed" />
      <pointLight position={[-10, -10, -5]} intensity={1.5} color="#06b6d4" />
      <pointLight position={[0, 10, -10]} intensity={1} color="#ec4899" />

      <ParticleField />
      <MouseTracker />

      <FloatingOrb position={[-3.5, 1, -2]} color="#7c3aed" speed={0.8} distort={0.5} />
      <FloatingOrb position={[3.5, -1, -1]} color="#06b6d4" speed={1.2} distort={0.3} />
      <FloatingOrb position={[0, 2.5, -3]} color="#ec4899" speed={0.6} distort={0.6} />

      <WobbleTorus position={[-2, -2, 0]} color="#f59e0b" />
      <WobbleTorus position={[2.5, 2, -1]} color="#10b981" />

      <DreiSparkles count={80} scale={12} size={3} speed={0.5} color="#a855f7" />

      <Stars radius={80} depth={50} count={3000} factor={4} saturation={0} fade speed={1} />

      <Environment preset="city" />

      <EffectComposer>
        <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.9} intensity={1.5} />
        <ChromaticAberration
          blendFunction={BlendFunction.NORMAL}
          offset={new THREE.Vector2(0.0005, 0.0005)}
        />
        <Vignette eskil={false} offset={0.1} darkness={0.8} />
      </EffectComposer>
    </>
  );
}

// ── Template Cards ────────────────────────────────────────────────────────────

const TEMPLATES = [
  { id: "saas", name: "SaaS Dark", desc: "WebGL hero, particle bg, floating 3D shapes", color: "#7c3aed", icon: Zap, tags: ["3D", "Particles", "Dark"] },
  { id: "agency", name: "Agency Luxe", desc: "Metallic 3D logo, scroll-driven scenes, bloom fx", color: "#06b6d4", icon: Globe, tags: ["3D", "Scroll", "Premium"] },
  { id: "legal", name: "Legal Pro", desc: "Professional dark, animated stats, glassmorphism", color: "#64748b", icon: Star, tags: ["Animated", "Clean"] },
  { id: "medspa", name: "Med Spa Elite", desc: "Rose gold particles, smooth reveals, luxury feel", color: "#ec4899", icon: Sparkles, tags: ["Luxury", "3D", "Animated"] },
  { id: "gym", name: "Gym Power", desc: "Dynamic motion, energy particles, bold 3D type", color: "#f59e0b", icon: Zap, tags: ["Bold", "3D", "Motion"] },
  { id: "realestate", name: "Real Estate", desc: "3D property showcase, aerial parallax, clean UX", color: "#10b981", icon: BoxIcon, tags: ["3D", "Interactive"] },
];

function TemplateCard({ template, selected, onSelect }: any) {
  return (
    <motion.div
      whileHover={{ scale: 1.03, y: -4 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onSelect(template.id)}
      className={`relative cursor-pointer rounded-2xl border p-4 transition-all ${
        selected === template.id
          ? "border-purple-500 bg-purple-500/10"
          : "border-white/10 bg-white/5 hover:border-white/20"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: template.color + "22", border: `1px solid ${template.color}44` }}>
          <template.icon className="w-5 h-5" style={{ color: template.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-sm">{template.name}</p>
          <p className="text-xs text-white/50 mt-0.5 leading-relaxed">{template.desc}</p>
          <div className="flex gap-1 mt-2 flex-wrap">
            {template.tags.map((tag: string) => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/60">{tag}</span>
            ))}
          </div>
        </div>
      </div>
      {selected === template.id && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute top-3 right-3 w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center"
        >
          <div className="w-2 h-2 rounded-full bg-white" />
        </motion.div>
      )}
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DynamicPages() {
  const [selectedTemplate, setSelectedTemplate] = useState("saas");
  const [tab, setTab] = useState<"templates" | "builder">("templates");
  const [pageName, setPageName] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);

  const handleGenerate = async () => {
    setIsGenerating(true);
    await new Promise(r => setTimeout(r, 2800));
    setIsGenerating(false);
    setGenerated(true);
    setTab("builder");
  };

  return (
    <div className="h-screen w-full flex flex-col bg-[#030712] overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-white/5 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
            <Layers className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <h1 className="text-white font-semibold text-sm">Dynamic Pages</h1>
            <p className="text-white/40 text-xs">3D Interactive Website Builder</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-purple-500/30 text-purple-400 text-xs">
            WebGL Powered
          </Badge>
          {generated && (
            <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2">
              <Button size="sm" variant="ghost" className="text-white/60 hover:text-white h-7 text-xs gap-1">
                <Eye className="w-3 h-3" /> Preview
              </Button>
              <Button size="sm" variant="ghost" className="text-white/60 hover:text-white h-7 text-xs gap-1">
                <Share2 className="w-3 h-3" /> Publish
              </Button>
              <Button size="sm" className="bg-purple-600 hover:bg-purple-700 h-7 text-xs gap-1">
                <Download className="w-3 h-3" /> Export
              </Button>
            </motion.div>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel */}
        <div className="w-72 shrink-0 border-r border-white/5 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-white/5">
            {(["templates", "builder"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 text-xs font-medium capitalize transition-colors ${
                  tab === t ? "text-white border-b-2 border-purple-500" : "text-white/40 hover:text-white/70"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {tab === "templates" && (
              <>
                <p className="text-white/40 text-xs px-1 pb-1">Pick a 3D template to start</p>
                {TEMPLATES.map(t => (
                  <TemplateCard key={t.id} template={t} selected={selectedTemplate} onSelect={setSelectedTemplate} />
                ))}

                <div className="pt-2 space-y-2">
                  <input
                    value={pageName}
                    onChange={e => setPageName(e.target.value)}
                    placeholder="Page name (e.g. Our Services)"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-white/30 outline-none focus:border-purple-500/50"
                  />
                  <Button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white text-sm h-9 gap-2"
                  >
                    {isGenerating ? (
                      <>
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                          className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full"
                        />
                        Building 3D Scene...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        Generate Page
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}

            {tab === "builder" && (
              <div className="space-y-3">
                <p className="text-white/40 text-xs px-1">Add sections</p>
                {[
                  { label: "3D Hero", icon: Globe, desc: "Interactive WebGL hero" },
                  { label: "Feature Grid", icon: Layers, desc: "Animated feature cards" },
                  { label: "Stats Counter", icon: Zap, desc: "Counting numbers reveal" },
                  { label: "Testimonials", icon: Star, desc: "Scroll carousel" },
                  { label: "3D CTA", icon: BoxIcon, desc: "Floating 3D call to action" },
                  { label: "Contact Form", icon: LayoutTemplate, desc: "Glassmorphism form" },
                ].map(s => (
                  <motion.div
                    key={s.label}
                    whileHover={{ x: 2 }}
                    className="flex items-center gap-3 p-2.5 rounded-xl border border-white/10 hover:border-purple-500/30 hover:bg-purple-500/5 cursor-pointer transition-all"
                  >
                    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                      <s.icon className="w-4 h-4 text-purple-400" />
                    </div>
                    <div>
                      <p className="text-white text-xs font-medium">{s.label}</p>
                      <p className="text-white/40 text-[10px]">{s.desc}</p>
                    </div>
                    <Plus className="w-3.5 h-3.5 text-white/30 ml-auto" />
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 3D Canvas Preview */}
        <div className="flex-1 relative overflow-hidden">
          <Canvas
            camera={{ position: [0, 0, 8], fov: 60 }}
            gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
            dpr={[1, 2]}
          >
            <Suspense fallback={null}>
              <HeroScene />
              <OrbitControls
                enablePan={false}
                enableZoom={false}
                autoRotate
                autoRotateSpeed={0.4}
                maxPolarAngle={Math.PI / 1.8}
                minPolarAngle={Math.PI / 3}
              />
            </Suspense>
          </Canvas>

          {/* Overlay UI on canvas */}
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
            <AnimatePresence>
              {!generated ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="text-center"
                >
                  <motion.h2
                    className="text-5xl font-black text-white mb-3"
                    style={{ textShadow: "0 0 60px rgba(168,85,247,0.8)" }}
                    animate={{ opacity: [0.8, 1, 0.8] }}
                    transition={{ duration: 3, repeat: Infinity }}
                  >
                    Dynamic Pages
                  </motion.h2>
                  <p className="text-white/50 text-lg">
                    Interactive 3D websites, built in seconds
                  </p>
                  <div className="flex gap-3 justify-center mt-6 pointer-events-auto">
                    <Badge className="bg-purple-500/20 border-purple-500/30 text-purple-300 text-xs">
                      WebGL + Three.js
                    </Badge>
                    <Badge className="bg-cyan-500/20 border-cyan-500/30 text-cyan-300 text-xs">
                      Framer Motion
                    </Badge>
                    <Badge className="bg-pink-500/20 border-pink-500/30 text-pink-300 text-xs">
                      React Three Fiber
                    </Badge>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center"
                >
                  <motion.div
                    className="w-16 h-16 rounded-2xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center mx-auto mb-4"
                    animate={{ boxShadow: ["0 0 20px rgba(168,85,247,0.3)", "0 0 40px rgba(168,85,247,0.6)", "0 0 20px rgba(168,85,247,0.3)"] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    <Sparkles className="w-8 h-8 text-purple-400" />
                  </motion.div>
                  <h3 className="text-3xl font-bold text-white mb-2">
                    {pageName || "Your Page"} is ready
                  </h3>
                  <p className="text-white/50 text-sm mb-4">
                    3D scene built · Animations wired · Ready to publish
                  </p>
                  <div className="flex gap-2 justify-center pointer-events-auto">
                    <Button size="sm" variant="outline" className="border-white/20 text-white/70 hover:text-white gap-1.5 text-xs">
                      <Eye className="w-3.5 h-3.5" /> Live Preview
                    </Button>
                    <Button size="sm" className="bg-purple-600 hover:bg-purple-700 gap-1.5 text-xs">
                      <ArrowRight className="w-3.5 h-3.5" /> Publish Now
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Corner info */}
          <div className="absolute bottom-4 left-4 flex items-center gap-2 pointer-events-none">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-white/40 text-xs">WebGL Active · Drag to explore</span>
          </div>
          <div className="absolute bottom-4 right-4 pointer-events-none">
            <span className="text-white/20 text-xs">React Three Fiber</span>
          </div>
        </div>
      </div>
    </div>
  );
}
