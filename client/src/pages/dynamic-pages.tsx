import { Suspense, useRef, useState, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  Float,
  Stars,
  MeshDistortMaterial,
  MeshWobbleMaterial,
  Environment,
  Sparkles as DreiSparkles,
  Trail,
} from "@react-three/drei";
import { EffectComposer, Bloom, ChromaticAberration, Vignette } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { motion, AnimatePresence } from "framer-motion";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Sparkles, Globe, Layers, Zap, Plus, Eye, Download, Share2,
  LayoutTemplate, ArrowRight, Search, ChevronDown, X,
  Scale, UtensilsCrossed, Stethoscope, Car, Shield, Activity,
  GraduationCap, ShoppingBag, PawPrint, Camera, Heart, Home,
  Dumbbell, Gem, Megaphone, Building2, Wrench, Scissors,
  Briefcase, Truck, Leaf, Wifi, Music, Plane, Baby, Dog,
  Coffee, Pizza, Fish, Flower, Hammer, Zap as ZapIcon,
  Star, Brain, Cpu, Rocket, Target, TrendingUp, Users,
  Building, ShoppingCart, Palette, BookOpen, Bike, Anchor,
  Sun, Moon, Droplets, Flame,
} from "lucide-react";

// ── 3D Scene ──────────────────────────────────────────────────────────────────

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
        <MeshDistortMaterial color={color} distort={distort} speed={3} roughness={0} metalness={0.8} transparent opacity={0.85} />
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

function ParticleField({ accentColor = "#a855f7" }: { accentColor?: string }) {
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
      <pointsMaterial size={0.04} color={accentColor} transparent opacity={0.7} sizeAttenuation />
    </points>
  );
}

function MouseTracker({ color = "#7c3aed" }: { color?: string }) {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(({ mouse }) => {
    if (meshRef.current) {
      meshRef.current.position.x += (mouse.x * 4 - meshRef.current.position.x) * 0.05;
      meshRef.current.position.y += (mouse.y * 4 - meshRef.current.position.y) * 0.05;
    }
  });
  return (
    <Trail width={1} length={6} color={color} attenuation={(t) => t * t}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2} />
      </mesh>
    </Trail>
  );
}

function Scene({ template }: { template: TemplateItem }) {
  const c = template.sceneColors;
  return (
    <>
      <color attach="background" args={["#030712"]} />
      <ambientLight intensity={0.3} />
      <pointLight position={[10, 10, 10]} intensity={2} color={c[0]} />
      <pointLight position={[-10, -10, -5]} intensity={1.5} color={c[1]} />
      <pointLight position={[0, 10, -10]} intensity={1} color={c[2] ?? c[0]} />
      <ParticleField accentColor={c[0]} />
      <MouseTracker color={c[0]} />
      <FloatingOrb position={[-3.5, 1, -2]} color={c[0]} speed={0.8} distort={0.5} />
      <FloatingOrb position={[3.5, -1, -1]} color={c[1]} speed={1.2} distort={0.3} />
      <FloatingOrb position={[0, 2.5, -3]} color={c[2] ?? c[1]} speed={0.6} distort={0.6} />
      <WobbleTorus position={[-2, -2, 0]} color={c[1]} />
      <WobbleTorus position={[2.5, 2, -1]} color={c[0]} />
      <DreiSparkles count={80} scale={12} size={3} speed={0.5} color={c[0]} />
      <Stars radius={80} depth={50} count={3000} factor={4} saturation={0} fade speed={1} />
      <Environment preset="city" />
      <EffectComposer>
        <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.9} intensity={1.5} />
        <ChromaticAberration blendFunction={BlendFunction.NORMAL} offset={new THREE.Vector2(0.0005, 0.0005)} />
        <Vignette eskil={false} offset={0.1} darkness={0.8} />
      </EffectComposer>
    </>
  );
}

// ── Template Data ─────────────────────────────────────────────────────────────

interface TemplateItem {
  id: string;
  name: string;
  desc: string;
  category: string;
  color: string;
  sceneColors: [string, string, string?];
  icon: any;
  tags: string[];
  style: string;
}

const CATEGORIES = [
  "All", "Legal & Finance", "Health & Wellness", "Home Services", "Food & Hospitality",
  "Automotive", "Real Estate", "Beauty & Luxury", "Fitness", "Professional Services",
  "Retail & E-Commerce", "Tech & SaaS", "Education", "Events & Entertainment",
  "Trades & Construction", "Pet & Animal", "Creative & Media", "Nonprofit & Community",
];

const TEMPLATES: TemplateItem[] = [
  // ── Legal & Finance ──────────────────────────────────────────────────────
  { id: "personal-injury-law", name: "Personal Injury Law", desc: "Bold dark site, dramatic 3D hero, animated case counter", category: "Legal & Finance", color: "#6366f1", sceneColors: ["#6366f1", "#a78bfa", "#818cf8"], icon: Scale, tags: ["3D", "Dark", "Law"], style: "dramatic" },
  { id: "bankruptcy-law", name: "Bankruptcy Attorney", desc: "Trust-building design, clean lines, relief-focused messaging", category: "Legal & Finance", color: "#64748b", sceneColors: ["#475569", "#94a3b8", "#334155"], icon: Scale, tags: ["Clean", "Trust"], style: "clean" },
  { id: "family-law", name: "Family Law", desc: "Warm tones, empathy-first design, soft animations", category: "Legal & Finance", color: "#a78bfa", sceneColors: ["#7c3aed", "#c4b5fd", "#8b5cf6"], icon: Heart, tags: ["Soft", "Animated"], style: "warm" },
  { id: "criminal-defense", name: "Criminal Defense", desc: "High contrast, authority-driven, aggressive 3D typography", category: "Legal & Finance", color: "#dc2626", sceneColors: ["#dc2626", "#991b1b", "#b91c1c"], icon: Scale, tags: ["Bold", "3D", "Dark"], style: "aggressive" },
  { id: "immigration-law", name: "Immigration Law", desc: "Flag color accents, multilingual-ready, welcoming layout", category: "Legal & Finance", color: "#2563eb", sceneColors: ["#1d4ed8", "#3b82f6", "#60a5fa"], icon: Globe, tags: ["Animated", "Color"], style: "welcoming" },
  { id: "workers-comp", name: "Workers Comp Attorney", desc: "OSHA blue, urgent CTA, injury stat counters", category: "Legal & Finance", color: "#f59e0b", sceneColors: ["#d97706", "#fbbf24", "#f59e0b"], icon: Hammer, tags: ["Urgent", "3D"], style: "urgent" },
  { id: "tax-firm", name: "Tax & Accounting Firm", desc: "Professional green, trust signals, animated savings calculator", category: "Legal & Finance", color: "#16a34a", sceneColors: ["#15803d", "#22c55e", "#4ade80"], icon: Briefcase, tags: ["Professional", "Dark"], style: "professional" },
  { id: "financial-advisor", name: "Financial Advisor", desc: "Wealth aesthetic, gold accents, 3D chart animations", category: "Legal & Finance", color: "#ca8a04", sceneColors: ["#92400e", "#d97706", "#fbbf24"], icon: TrendingUp, tags: ["Luxury", "3D", "Gold"], style: "luxury" },

  // ── Health & Wellness ────────────────────────────────────────────────────
  { id: "medspa", name: "Med Spa", desc: "Rose gold particles, smooth reveals, luxury aesthetic", category: "Health & Wellness", color: "#ec4899", sceneColors: ["#db2777", "#f472b6", "#fb7185"], icon: Sparkles, tags: ["Luxury", "3D", "Animated"], style: "luxury" },
  { id: "chiropractor", name: "Chiropractic Clinic", desc: "Emerald health tones, spine animation, booking CTA", category: "Health & Wellness", color: "#10b981", sceneColors: ["#059669", "#34d399", "#6ee7b7"], icon: Activity, tags: ["Health", "Animated"], style: "clean" },
  { id: "dentist", name: "Dental Practice", desc: "Sky blue, clean white space, smile showcase gallery", category: "Health & Wellness", color: "#0ea5e9", sceneColors: ["#0284c7", "#38bdf8", "#7dd3fc"], icon: Stethoscope, tags: ["Clean", "Trust"], style: "clean" },
  { id: "orthodontist", name: "Orthodontist", desc: "Before/after slider, bright modern, teen-friendly design", category: "Health & Wellness", color: "#06b6d4", sceneColors: ["#0891b2", "#22d3ee", "#67e8f9"], icon: Stethoscope, tags: ["Modern", "Bright"], style: "modern" },
  { id: "plastic-surgery", name: "Plastic Surgery", desc: "Ultra-luxury, dark rose gold, cinematic before/after", category: "Health & Wellness", color: "#be185d", sceneColors: ["#9d174d", "#ec4899", "#f9a8d4"], icon: Star, tags: ["Luxury", "Dark", "Cinematic"], style: "luxury" },
  { id: "mental-health", name: "Mental Health Practice", desc: "Calming purples, soft gradients, trust-focused layout", category: "Health & Wellness", color: "#8b5cf6", sceneColors: ["#7c3aed", "#a78bfa", "#c4b5fd"], icon: Brain, tags: ["Calm", "Soft"], style: "calm" },
  { id: "addiction-recovery", name: "Addiction Recovery", desc: "Hope-driven design, sunrise palette, testimonial-forward", category: "Health & Wellness", color: "#f97316", sceneColors: ["#ea580c", "#fb923c", "#fdba74"], icon: Sun, tags: ["Hope", "Warm"], style: "warm" },
  { id: "physical-therapy", name: "Physical Therapy", desc: "Active lifestyle imagery, progress tracking, movement animations", category: "Health & Wellness", color: "#14b8a6", sceneColors: ["#0d9488", "#2dd4bf", "#5eead4"], icon: Activity, tags: ["Active", "Animated"], style: "active" },
  { id: "fertility-clinic", name: "Fertility Clinic", desc: "Soft pastels, hope-focused, journey timeline animation", category: "Health & Wellness", color: "#e879f9", sceneColors: ["#a21caf", "#e879f9", "#f0abfc"], icon: Heart, tags: ["Gentle", "Pastel"], style: "gentle" },
  { id: "urgent-care", name: "Urgent Care", desc: "High contrast red/white, wait time display, emergency focus", category: "Health & Wellness", color: "#ef4444", sceneColors: ["#dc2626", "#f87171", "#fca5a5"], icon: Zap, tags: ["Urgent", "Bold"], style: "urgent" },
  { id: "pharmacy", name: "Pharmacy", desc: "Clean green/white, prescription refill CTA, health blog", category: "Health & Wellness", color: "#22c55e", sceneColors: ["#16a34a", "#4ade80", "#86efac"], icon: Droplets, tags: ["Clean", "Trust"], style: "clean" },
  { id: "acupuncture", name: "Acupuncture & TCM", desc: "Eastern-inspired, bamboo greens, zen particle animations", category: "Health & Wellness", color: "#65a30d", sceneColors: ["#4d7c0f", "#84cc16", "#bef264"], icon: Leaf, tags: ["Zen", "Nature"], style: "zen" },
  { id: "weight-loss", name: "Weight Loss Clinic", desc: "Before/after transformations, progress bar animations, bold CTA", category: "Health & Wellness", color: "#f59e0b", sceneColors: ["#d97706", "#fbbf24", "#fde68a"], icon: TrendingUp, tags: ["Bold", "Animated"], style: "energetic" },

  // ── Home Services ────────────────────────────────────────────────────────
  { id: "roofing", name: "Roofing Company", desc: "Storm blue, hail damage urgency, free estimate CTA", category: "Home Services", color: "#3b82f6", sceneColors: ["#1d4ed8", "#60a5fa", "#93c5fd"], icon: Home, tags: ["Bold", "Urgent"], style: "bold" },
  { id: "hvac", name: "HVAC / AC Repair", desc: "Cool blue/orange split, seasonal offers, 24/7 emergency badge", category: "Home Services", color: "#0ea5e9", sceneColors: ["#0369a1", "#38bdf8", "#f97316"], icon: Flame, tags: ["Bold", "Seasonal"], style: "bold" },
  { id: "plumbing", name: "Plumbing", desc: "Emergency-ready, pipe blue, 24/7 service, trust badges", category: "Home Services", color: "#0284c7", sceneColors: ["#0c4a6e", "#0ea5e9", "#38bdf8"], icon: Droplets, tags: ["Urgent", "Trust"], style: "urgent" },
  { id: "electrical", name: "Electrical Contractor", desc: "Electric yellow, safety-focused, licensed badge display", category: "Home Services", color: "#eab308", sceneColors: ["#ca8a04", "#facc15", "#fde047"], icon: ZapIcon, tags: ["Bold", "Safety"], style: "bold" },
  { id: "landscaping", name: "Landscaping", desc: "Lush green, nature particles, seasonal service showcase", category: "Home Services", color: "#16a34a", sceneColors: ["#14532d", "#22c55e", "#86efac"], icon: Leaf, tags: ["Nature", "3D"], style: "nature" },
  { id: "pest-control", name: "Pest Control", desc: "Dark green, problem-solution layout, guarantee badge", category: "Home Services", color: "#15803d", sceneColors: ["#14532d", "#16a34a", "#4ade80"], icon: Shield, tags: ["Dark", "Trust"], style: "professional" },
  { id: "cleaning", name: "Cleaning Service", desc: "Sparkling white/blue, before-after, recurring booking flow", category: "Home Services", color: "#06b6d4", sceneColors: ["#0891b2", "#22d3ee", "#a5f3fc"], icon: Sparkles, tags: ["Clean", "Animated"], style: "clean" },
  { id: "painting", name: "Painting Contractor", desc: "Colorful gradient palette, portfolio gallery, free quote form", category: "Home Services", color: "#8b5cf6", sceneColors: ["#6d28d9", "#a78bfa", "#ec4899"], icon: Palette, tags: ["Colorful", "Portfolio"], style: "colorful" },
  { id: "pool-service", name: "Pool Service", desc: "Ocean blue, crystal particles, seasonal maintenance packages", category: "Home Services", color: "#0891b2", sceneColors: ["#0c4a6e", "#06b6d4", "#67e8f9"], icon: Droplets, tags: ["Blue", "3D"], style: "cool" },
  { id: "pressure-washing", name: "Pressure Washing", desc: "High-impact before/after, dramatic reveal animation, local SEO", category: "Home Services", color: "#2563eb", sceneColors: ["#1e3a8a", "#3b82f6", "#93c5fd"], icon: Droplets, tags: ["Bold", "Animated"], style: "bold" },
  { id: "garage-door", name: "Garage Door Repair", desc: "Fast response focus, suburban aesthetic, same-day badge", category: "Home Services", color: "#475569", sceneColors: ["#334155", "#64748b", "#94a3b8"], icon: Home, tags: ["Clean", "Trust"], style: "clean" },
  { id: "solar", name: "Solar Installation", desc: "Sun-powered yellows, savings calculator, eco particle effect", category: "Home Services", color: "#f59e0b", sceneColors: ["#92400e", "#f59e0b", "#fde68a"], icon: Sun, tags: ["Eco", "Animated", "3D"], style: "energetic" },
  { id: "security-systems", name: "Home Security", desc: "Dark tech aesthetic, camera feed mockup, protection focus", category: "Home Services", color: "#dc2626", sceneColors: ["#7f1d1d", "#dc2626", "#f87171"], icon: Shield, tags: ["Dark", "Tech"], style: "tech" },

  // ── Food & Hospitality ───────────────────────────────────────────────────
  { id: "restaurant", name: "Restaurant", desc: "Rich food photography, reservation widget, chef story", category: "Food & Hospitality", color: "#ea580c", sceneColors: ["#9a3412", "#f97316", "#fb923c"], icon: UtensilsCrossed, tags: ["Warm", "Rich", "Animated"], style: "warm" },
  { id: "fine-dining", name: "Fine Dining", desc: "Ultra-dark luxury, gold accents, tasting menu reveal", category: "Food & Hospitality", color: "#ca8a04", sceneColors: ["#78350f", "#ca8a04", "#fbbf24"], icon: Star, tags: ["Luxury", "Dark", "Gold"], style: "luxury" },
  { id: "food-truck", name: "Food Truck", desc: "Street-art energy, location tracker, daily menu animation", category: "Food & Hospitality", color: "#f59e0b", sceneColors: ["#b45309", "#f59e0b", "#fcd34d"], icon: Truck, tags: ["Bold", "Colorful"], style: "energetic" },
  { id: "bakery", name: "Bakery & Pastry", desc: "Warm beige, Instagram-worthy gallery, order form", category: "Food & Hospitality", color: "#d97706", sceneColors: ["#92400e", "#d97706", "#fde68a"], icon: Coffee, tags: ["Warm", "Soft"], style: "warm" },
  { id: "coffee-shop", name: "Coffee Shop", desc: "Artisan aesthetic, brew menu, loyalty program CTA", category: "Food & Hospitality", color: "#92400e", sceneColors: ["#451a03", "#92400e", "#c2410c"], icon: Coffee, tags: ["Artisan", "Dark"], style: "artisan" },
  { id: "bar-nightclub", name: "Bar & Nightclub", desc: "Neon dark, event calendar, bottle service booking", category: "Food & Hospitality", color: "#7c3aed", sceneColors: ["#4c1d95", "#7c3aed", "#ec4899"], icon: Music, tags: ["Neon", "Dark", "3D"], style: "neon" },
  { id: "catering", name: "Catering Company", desc: "Elegant white/gold, event gallery, package pricing", category: "Food & Hospitality", color: "#ca8a04", sceneColors: ["#78350f", "#b45309", "#f59e0b"], icon: UtensilsCrossed, tags: ["Elegant", "Gold"], style: "elegant" },
  { id: "meal-prep", name: "Meal Prep Service", desc: "Fresh greens, subscription flow, macro info display", category: "Food & Hospitality", color: "#16a34a", sceneColors: ["#14532d", "#16a34a", "#bbf7d0"], icon: Leaf, tags: ["Fresh", "Health"], style: "fresh" },

  // ── Automotive ───────────────────────────────────────────────────────────
  { id: "auto-dealer", name: "Auto Dealership", desc: "Showroom dark, vehicle showcase, finance calculator", category: "Automotive", color: "#dc2626", sceneColors: ["#7f1d1d", "#dc2626", "#f87171"], icon: Car, tags: ["Dark", "3D", "Premium"], style: "premium" },
  { id: "auto-repair", name: "Auto Repair Shop", desc: "Mechanic aesthetic, service menu, online booking", category: "Automotive", color: "#1e40af", sceneColors: ["#1e3a8a", "#2563eb", "#60a5fa"], icon: Wrench, tags: ["Trust", "Bold"], style: "bold" },
  { id: "auto-detailing", name: "Auto Detailing", desc: "Gloss black, shine animations, package comparison", category: "Automotive", color: "#111827", sceneColors: ["#030712", "#1f2937", "#6366f1"], icon: Star, tags: ["Luxury", "Dark", "Shine"], style: "luxury" },
  { id: "towing", name: "Towing Service", desc: "Emergency red/yellow, 24/7 focus, GPS tracker CTA", category: "Automotive", color: "#f59e0b", sceneColors: ["#92400e", "#f59e0b", "#dc2626"], icon: Truck, tags: ["Urgent", "Bold"], style: "urgent" },
  { id: "rv-dealer", name: "RV & Boat Dealer", desc: "Adventure blue/sky, lifestyle imagery, financing widget", category: "Automotive", color: "#0369a1", sceneColors: ["#0c4a6e", "#0369a1", "#38bdf8"], icon: Anchor, tags: ["Adventure", "Blue"], style: "adventure" },
  { id: "ev-charging", name: "EV Charging Network", desc: "Electric cyan, sustainability focus, station map", category: "Automotive", color: "#06b6d4", sceneColors: ["#0e7490", "#06b6d4", "#22d3ee"], icon: ZapIcon, tags: ["Tech", "Eco", "3D"], style: "tech" },

  // ── Real Estate ──────────────────────────────────────────────────────────
  { id: "residential-realtor", name: "Residential Realtor", desc: "Clean white, property showcase, mortgage calculator", category: "Real Estate", color: "#2563eb", sceneColors: ["#1e3a8a", "#3b82f6", "#93c5fd"], icon: Home, tags: ["Clean", "Trust"], style: "clean" },
  { id: "luxury-real-estate", name: "Luxury Real Estate", desc: "Dark gold, aerial drone aesthetic, exclusive listings", category: "Real Estate", color: "#ca8a04", sceneColors: ["#78350f", "#ca8a04", "#fbbf24"], icon: Gem, tags: ["Luxury", "Dark", "Gold", "3D"], style: "luxury" },
  { id: "property-management", name: "Property Management", desc: "Professional blue, tenant portal, maintenance tracker", category: "Real Estate", color: "#1d4ed8", sceneColors: ["#1e3a8a", "#2563eb", "#60a5fa"], icon: Building2, tags: ["Professional", "Clean"], style: "professional" },
  { id: "commercial-real-estate", name: "Commercial Real Estate", desc: "Corporate dark, skyline 3D, cap rate calculator", category: "Real Estate", color: "#334155", sceneColors: ["#0f172a", "#334155", "#64748b"], icon: Building, tags: ["Corporate", "3D", "Dark"], style: "corporate" },
  { id: "short-term-rental", name: "Short-Term Rental / Airbnb", desc: "Warm lifestyle, booking calendar, amenity showcase", category: "Real Estate", color: "#f43f5e", sceneColors: ["#be123c", "#f43f5e", "#fb7185"], icon: Home, tags: ["Warm", "Airbnb", "Animated"], style: "warm" },

  // ── Beauty & Luxury ──────────────────────────────────────────────────────
  { id: "luxury-salon", name: "Luxury Salon", desc: "Black gold, animated before/after, celebrity stylist bio", category: "Beauty & Luxury", color: "#ca8a04", sceneColors: ["#1c1917", "#ca8a04", "#fbbf24"], icon: Scissors, tags: ["Luxury", "Gold", "Dark"], style: "luxury" },
  { id: "barber-shop", name: "Barber Shop", desc: "Masculine dark, razor animations, booking widget", category: "Beauty & Luxury", color: "#1f2937", sceneColors: ["#030712", "#1f2937", "#dc2626"], icon: Scissors, tags: ["Dark", "Bold"], style: "bold" },
  { id: "nail-salon", name: "Nail Salon", desc: "Pastel palette, nail art gallery, gel menu showcase", category: "Beauty & Luxury", color: "#f9a8d4", sceneColors: ["#be185d", "#f472b6", "#f9a8d4"], icon: Sparkles, tags: ["Pastel", "Colorful"], style: "soft" },
  { id: "tattoo-studio", name: "Tattoo Studio", desc: "Dark ink aesthetic, portfolio masonry, artist profiles", category: "Beauty & Luxury", color: "#1c1917", sceneColors: ["#030712", "#292524", "#dc2626"], icon: Palette, tags: ["Dark", "Portfolio", "Edgy"], style: "dark" },
  { id: "makeup-artist", name: "Makeup Artist", desc: "Glam rose gold, wedding packages, video portfolio", category: "Beauty & Luxury", color: "#e11d48", sceneColors: ["#9f1239", "#e11d48", "#fb7185"], icon: Star, tags: ["Glam", "Rose Gold"], style: "glam" },
  { id: "massage-therapy", name: "Massage Therapy", desc: "Zen earth tones, relaxation focus, package booking", category: "Beauty & Luxury", color: "#78716c", sceneColors: ["#44403c", "#78716c", "#a8a29e"], icon: Leaf, tags: ["Zen", "Calm"], style: "zen" },
  { id: "spray-tan", name: "Spray Tan", desc: "Warm bronze, glowing skin aesthetic, session packages", category: "Beauty & Luxury", color: "#d97706", sceneColors: ["#92400e", "#d97706", "#fde68a"], icon: Sun, tags: ["Warm", "Glow"], style: "warm" },
  { id: "lash-studio", name: "Lash & Brow Studio", desc: "Minimalist luxury, close-up gallery, loyalty booking", category: "Beauty & Luxury", color: "#be185d", sceneColors: ["#831843", "#be185d", "#f9a8d4"], icon: Star, tags: ["Luxury", "Minimal"], style: "luxury" },
  { id: "cosmetic-surgery", name: "Cosmetic Surgery", desc: "Ultra-premium dark, before/after cinematic, virtual consult", category: "Beauty & Luxury", color: "#7c3aed", sceneColors: ["#4c1d95", "#7c3aed", "#f472b6"], icon: Gem, tags: ["Premium", "Dark", "3D"], style: "premium" },

  // ── Fitness ──────────────────────────────────────────────────────────────
  { id: "gym", name: "Gym & Fitness Center", desc: "Powerful dark, energy particles, membership CTA", category: "Fitness", color: "#dc2626", sceneColors: ["#7f1d1d", "#dc2626", "#f59e0b"], icon: Dumbbell, tags: ["Bold", "3D", "Energy"], style: "energetic" },
  { id: "crossfit", name: "CrossFit Box", desc: "Raw industrial, workout-of-the-day feed, community focus", category: "Fitness", color: "#f97316", sceneColors: ["#9a3412", "#f97316", "#1f2937"], icon: Dumbbell, tags: ["Bold", "Community"], style: "raw" },
  { id: "yoga-studio", name: "Yoga Studio", desc: "Serene earth tones, class schedule, online stream CTA", category: "Fitness", color: "#a16207", sceneColors: ["#78350f", "#b45309", "#d97706"], icon: Leaf, tags: ["Zen", "Calm", "Animated"], style: "zen" },
  { id: "personal-trainer", name: "Personal Trainer", desc: "Transformation-focused, client results, 1-on-1 booking", category: "Fitness", color: "#16a34a", sceneColors: ["#14532d", "#15803d", "#f59e0b"], icon: Target, tags: ["Bold", "Results"], style: "bold" },
  { id: "pilates-studio", name: "Pilates Studio", desc: "Elegant white/green, mind-body focus, class tiers", category: "Fitness", color: "#4ade80", sceneColors: ["#14532d", "#4ade80", "#86efac"], icon: Activity, tags: ["Elegant", "Clean"], style: "elegant" },
  { id: "martial-arts", name: "Martial Arts / BJJ", desc: "Warrior dark, belt progression, trial class CTA", category: "Fitness", color: "#dc2626", sceneColors: ["#1c1917", "#dc2626", "#1e3a8a"], icon: Shield, tags: ["Dark", "Bold", "Warrior"], style: "warrior" },
  { id: "swim-school", name: "Swim School", desc: "Ocean blue, age group classes, progress tracking", category: "Fitness", color: "#0ea5e9", sceneColors: ["#0c4a6e", "#0ea5e9", "#38bdf8"], icon: Droplets, tags: ["Blue", "Clean"], style: "fresh" },

  // ── Professional Services ─────────────────────────────────────────────────
  { id: "marketing-agency", name: "Marketing Agency", desc: "Vibrant dark, case study showcase, results-driven", category: "Professional Services", color: "#06b6d4", sceneColors: ["#0e7490", "#06b6d4", "#7c3aed"], icon: Megaphone, tags: ["Bold", "3D", "Vibrant"], style: "bold" },
  { id: "web-design-agency", name: "Web Design Agency", desc: "Portfolio masonry, live demo embed, glassmorphism", category: "Professional Services", color: "#7c3aed", sceneColors: ["#4c1d95", "#7c3aed", "#06b6d4"], icon: Cpu, tags: ["Tech", "3D", "Dark"], style: "tech" },
  { id: "seo-agency", name: "SEO Agency", desc: "Data-driven dark, ranking graph animation, audit CTA", category: "Professional Services", color: "#16a34a", sceneColors: ["#14532d", "#16a34a", "#3b82f6"], icon: TrendingUp, tags: ["Data", "Animated"], style: "data" },
  { id: "pr-firm", name: "PR & Branding Firm", desc: "Editorial luxury, media logo wall, retainer CTA", category: "Professional Services", color: "#1c1917", sceneColors: ["#030712", "#1c1917", "#ca8a04"], icon: Star, tags: ["Luxury", "Editorial"], style: "editorial" },
  { id: "staffing-agency", name: "Staffing / Recruiting", desc: "Corporate blue, job board integration, candidate portal", category: "Professional Services", color: "#2563eb", sceneColors: ["#1e3a8a", "#2563eb", "#60a5fa"], icon: Users, tags: ["Corporate", "Clean"], style: "corporate" },
  { id: "business-coach", name: "Business Coach", desc: "Authority dark, ROI calculator, program tiers", category: "Professional Services", color: "#7c3aed", sceneColors: ["#4c1d95", "#7c3aed", "#a78bfa"], icon: GraduationCap, tags: ["Authority", "Dark", "3D"], style: "authority" },
  { id: "life-coach", name: "Life Coach", desc: "Warm sunlit palette, transformation journey, video hero", category: "Professional Services", color: "#f59e0b", sceneColors: ["#92400e", "#f59e0b", "#ec4899"], icon: Sun, tags: ["Warm", "Inspiring"], style: "inspiring" },
  { id: "insurance-agency", name: "Insurance Agency", desc: "Trust-blue, quote calculator, coverage comparison", category: "Professional Services", color: "#1d4ed8", sceneColors: ["#1e3a8a", "#2563eb", "#93c5fd"], icon: Shield, tags: ["Trust", "Clean"], style: "trust" },
  { id: "mortgage-broker", name: "Mortgage Broker", desc: "Calculator-first, rate display, approval flow", category: "Professional Services", color: "#0369a1", sceneColors: ["#0c4a6e", "#0369a1", "#22c55e"], icon: Home, tags: ["Finance", "Trust"], style: "trust" },

  // ── Retail & E-Commerce ───────────────────────────────────────────────────
  { id: "boutique-clothing", name: "Boutique Clothing", desc: "Editorial fashion, lookbook scroll, size guide", category: "Retail & E-Commerce", color: "#1c1917", sceneColors: ["#030712", "#1c1917", "#f9a8d4"], icon: ShoppingBag, tags: ["Editorial", "Dark", "Fashion"], style: "editorial" },
  { id: "jewelry-store", name: "Jewelry Store", desc: "Gold/black luxury, ring configurator, certificate display", category: "Retail & E-Commerce", color: "#ca8a04", sceneColors: ["#1c1917", "#ca8a04", "#fbbf24"], icon: Gem, tags: ["Luxury", "Gold", "3D"], style: "luxury" },
  { id: "supplement-store", name: "Supplement Store", desc: "High-energy fitness, stack builder, subscription widget", category: "Retail & E-Commerce", color: "#f97316", sceneColors: ["#9a3412", "#f97316", "#dc2626"], icon: Dumbbell, tags: ["Bold", "Energy"], style: "energetic" },
  { id: "cannabis-dispensary", name: "Cannabis Dispensary", desc: "Emerald green, compliance-ready, menu display", category: "Retail & E-Commerce", color: "#16a34a", sceneColors: ["#14532d", "#16a34a", "#65a30d"], icon: Leaf, tags: ["Green", "Clean"], style: "nature" },
  { id: "furniture-store", name: "Furniture Store", desc: "Interior lifestyle, room visualizer, customization tool", category: "Retail & E-Commerce", color: "#92400e", sceneColors: ["#78350f", "#92400e", "#d97706"], icon: Home, tags: ["Warm", "Lifestyle"], style: "warm" },
  { id: "outdoor-gear", name: "Outdoor & Adventure Gear", desc: "Mountain aesthetic, trail finder, seasonal collections", category: "Retail & E-Commerce", color: "#15803d", sceneColors: ["#14532d", "#15803d", "#854d0e"], icon: Bike, tags: ["Adventure", "Nature"], style: "adventure" },

  // ── Tech & SaaS ───────────────────────────────────────────────────────────
  { id: "saas-dark", name: "SaaS Dark", desc: "WebGL hero, particle bg, floating 3D shapes, pricing tiers", category: "Tech & SaaS", color: "#7c3aed", sceneColors: ["#4c1d95", "#7c3aed", "#06b6d4"], icon: Rocket, tags: ["3D", "Particles", "Dark", "WebGL"], style: "tech" },
  { id: "saas-light", name: "SaaS Light", desc: "Clean white, feature grid, demo video, product screenshots", category: "Tech & SaaS", color: "#6366f1", sceneColors: ["#4338ca", "#6366f1", "#a5b4fc"], icon: Cpu, tags: ["Clean", "Modern"], style: "clean" },
  { id: "mobile-app", name: "Mobile App Landing", desc: "Phone mockup 3D, feature carousel, App Store CTA", category: "Tech & SaaS", color: "#06b6d4", sceneColors: ["#0e7490", "#06b6d4", "#7c3aed"], icon: Cpu, tags: ["3D", "App", "Modern"], style: "modern" },
  { id: "ai-startup", name: "AI Startup", desc: "Neural network particles, gradient mesh, waitlist CTA", category: "Tech & SaaS", color: "#7c3aed", sceneColors: ["#4c1d95", "#7c3aed", "#ec4899"], icon: Brain, tags: ["AI", "3D", "Dark", "Particles"], style: "futuristic" },
  { id: "cybersecurity", name: "Cybersecurity Firm", desc: "Matrix dark, threat visualization, enterprise CTA", category: "Tech & SaaS", color: "#00ff41", sceneColors: ["#030712", "#065f46", "#10b981"], icon: Shield, tags: ["Dark", "Matrix", "Tech"], style: "matrix" },
  { id: "dev-agency", name: "Dev Agency", desc: "Code aesthetic, tech stack showcase, GitHub stats", category: "Tech & SaaS", color: "#1f2937", sceneColors: ["#030712", "#1f2937", "#7c3aed"], icon: Cpu, tags: ["Code", "Dark", "Tech"], style: "code" },

  // ── Education ─────────────────────────────────────────────────────────────
  { id: "tutoring", name: "Tutoring Center", desc: "Bright academic, subject cards, parent testimonials", category: "Education", color: "#2563eb", sceneColors: ["#1e3a8a", "#2563eb", "#f59e0b"], icon: BookOpen, tags: ["Bright", "Friendly"], style: "friendly" },
  { id: "online-course", name: "Online Course Platform", desc: "Educator dark, curriculum preview, enrollment CTA", category: "Education", color: "#7c3aed", sceneColors: ["#4c1d95", "#7c3aed", "#f59e0b"], icon: GraduationCap, tags: ["Dark", "Premium"], style: "premium" },
  { id: "music-school", name: "Music School", desc: "Vinyl dark, instrument gallery, trial lesson booking", category: "Education", color: "#7c3aed", sceneColors: ["#1c1917", "#7c3aed", "#ec4899"], icon: Music, tags: ["Dark", "Artistic"], style: "artistic" },
  { id: "dance-studio", name: "Dance Studio", desc: "Glam stage aesthetic, class schedule, recital countdown", category: "Education", color: "#ec4899", sceneColors: ["#9d174d", "#ec4899", "#7c3aed"], icon: Music, tags: ["Glam", "Colorful"], style: "glam" },
  { id: "language-school", name: "Language School", desc: "World map globe, flag accents, culture-forward design", category: "Education", color: "#0ea5e9", sceneColors: ["#0369a1", "#0ea5e9", "#22c55e"], icon: Globe, tags: ["Global", "Colorful"], style: "global" },
  { id: "driving-school", name: "Driving School", desc: "Road aesthetic, pass rate badge, lesson packages", category: "Education", color: "#f59e0b", sceneColors: ["#92400e", "#f59e0b", "#1e3a8a"], icon: Car, tags: ["Bold", "Trust"], style: "bold" },

  // ── Events & Entertainment ────────────────────────────────────────────────
  { id: "wedding-planner", name: "Wedding Planner", desc: "Romantic floral, venue gallery, vendor network", category: "Events & Entertainment", color: "#f9a8d4", sceneColors: ["#9d174d", "#ec4899", "#f9a8d4"], icon: Heart, tags: ["Romantic", "Soft"], style: "romantic" },
  { id: "event-venue", name: "Event Venue", desc: "Dramatic dark, capacity showcase, virtual tour", category: "Events & Entertainment", color: "#ca8a04", sceneColors: ["#1c1917", "#ca8a04", "#7c3aed"], icon: Building2, tags: ["Luxury", "Dark", "3D"], style: "luxury" },
  { id: "dj-entertainment", name: "DJ & Entertainment", desc: "Neon nightlife, mix preview, booking calendar", category: "Events & Entertainment", color: "#7c3aed", sceneColors: ["#1c1917", "#7c3aed", "#06b6d4"], icon: Music, tags: ["Neon", "Dark", "Energy"], style: "neon" },
  { id: "photography-studio", name: "Photography Studio", desc: "Cinematic dark, portfolio grid, session packages", category: "Events & Entertainment", color: "#1c1917", sceneColors: ["#030712", "#1c1917", "#ca8a04"], icon: Camera, tags: ["Cinematic", "Dark", "Portfolio"], style: "cinematic" },
  { id: "videography", name: "Videography", desc: "Film aesthetic, reel showcase, production tiers", category: "Events & Entertainment", color: "#dc2626", sceneColors: ["#1c1917", "#dc2626", "#ca8a04"], icon: Camera, tags: ["Film", "Dark", "Portfolio"], style: "cinematic" },
  { id: "escape-room", name: "Escape Room", desc: "Mystery dark, countdown timer, booking widget", category: "Events & Entertainment", color: "#7c3aed", sceneColors: ["#030712", "#4c1d95", "#dc2626"], icon: Shield, tags: ["Dark", "Mystery", "Animated"], style: "mystery" },

  // ── Trades & Construction ─────────────────────────────────────────────────
  { id: "general-contractor", name: "General Contractor", desc: "Industrial dark, project gallery, license display", category: "Trades & Construction", color: "#f59e0b", sceneColors: ["#92400e", "#f59e0b", "#1f2937"], icon: Hammer, tags: ["Bold", "Industrial"], style: "industrial" },
  { id: "flooring", name: "Flooring Company", desc: "Material showcase, room visualizer, free estimate", category: "Trades & Construction", color: "#92400e", sceneColors: ["#78350f", "#92400e", "#d97706"], icon: Home, tags: ["Warm", "Material"], style: "warm" },
  { id: "kitchen-bath", name: "Kitchen & Bath Remodel", desc: "Luxury before/after, 3D room render, design consultation", category: "Trades & Construction", color: "#0369a1", sceneColors: ["#0c4a6e", "#0369a1", "#ca8a04"], icon: Home, tags: ["Luxury", "3D", "Remodel"], style: "luxury" },
  { id: "concrete", name: "Concrete & Masonry", desc: "Heavy industry, project portfolio, free estimate form", category: "Trades & Construction", color: "#64748b", sceneColors: ["#1e293b", "#475569", "#94a3b8"], icon: Hammer, tags: ["Industrial", "Bold"], style: "industrial" },
  { id: "tree-service", name: "Tree Service & Arborist", desc: "Nature green, hazard assessment, seasonal offers", category: "Trades & Construction", color: "#15803d", sceneColors: ["#14532d", "#15803d", "#65a30d"], icon: Leaf, tags: ["Nature", "Green"], style: "nature" },

  // ── Pet & Animal ──────────────────────────────────────────────────────────
  { id: "veterinarian", name: "Veterinary Clinic", desc: "Caring teal, pet gallery, wellness plan packages", category: "Pet & Animal", color: "#0d9488", sceneColors: ["#134e4a", "#0d9488", "#2dd4bf"], icon: PawPrint, tags: ["Caring", "Teal"], style: "caring" },
  { id: "dog-grooming", name: "Dog Grooming", desc: "Playful colors, before/after, breed service menu", category: "Pet & Animal", color: "#f97316", sceneColors: ["#9a3412", "#f97316", "#fbbf24"], icon: PawPrint, tags: ["Playful", "Colorful"], style: "playful" },
  { id: "dog-training", name: "Dog Training", desc: "Outdoorsy green, training packages, video demos", category: "Pet & Animal", color: "#16a34a", sceneColors: ["#14532d", "#16a34a", "#f59e0b"], icon: Dog, tags: ["Active", "Green"], style: "active" },
  { id: "pet-boarding", name: "Pet Boarding & Daycare", desc: "Playful and warm, webcam CTA, facility gallery", category: "Pet & Animal", color: "#f59e0b", sceneColors: ["#b45309", "#f59e0b", "#fb923c"], icon: PawPrint, tags: ["Playful", "Warm"], style: "playful" },
  { id: "pet-photography", name: "Pet Photography", desc: "Warm portraits, booking form, package gallery", category: "Pet & Animal", color: "#d97706", sceneColors: ["#92400e", "#d97706", "#fde68a"], icon: Camera, tags: ["Warm", "Portfolio"], style: "warm" },

  // ── Creative & Media ──────────────────────────────────────────────────────
  { id: "graphic-designer", name: "Graphic Designer", desc: "Portfolio masonry, colorful identity, client logos", category: "Creative & Media", color: "#ec4899", sceneColors: ["#9d174d", "#ec4899", "#f97316"], icon: Palette, tags: ["Colorful", "Portfolio", "Creative"], style: "creative" },
  { id: "copywriter", name: "Copywriter / Content Writer", desc: "Editorial clean, voice showcase, package pricing", category: "Creative & Media", color: "#1c1917", sceneColors: ["#030712", "#1c1917", "#6366f1"], icon: BookOpen, tags: ["Editorial", "Clean"], style: "editorial" },
  { id: "podcast-studio", name: "Podcast Studio", desc: "Audio wave animations, episode embed, sponsor CTA", category: "Creative & Media", color: "#7c3aed", sceneColors: ["#030712", "#4c1d95", "#7c3aed"], icon: Music, tags: ["Dark", "Audio", "Animated"], style: "audio" },
  { id: "influencer", name: "Influencer / Content Creator", desc: "Social feed integration, brand kit, collab inquiry", category: "Creative & Media", color: "#ec4899", sceneColors: ["#9d174d", "#ec4899", "#7c3aed"], icon: Star, tags: ["Social", "Vibrant", "3D"], style: "vibrant" },
  { id: "record-label", name: "Record Label", desc: "Music dark, artist roster, streaming links, merch", category: "Creative & Media", color: "#030712", sceneColors: ["#030712", "#7c3aed", "#dc2626"], icon: Music, tags: ["Dark", "Music", "Neon"], style: "neon" },

  // ── Nonprofit & Community ─────────────────────────────────────────────────
  { id: "nonprofit", name: "Nonprofit Organization", desc: "Mission-first, donation widget, impact counter", category: "Nonprofit & Community", color: "#0ea5e9", sceneColors: ["#0369a1", "#0ea5e9", "#16a34a"], icon: Heart, tags: ["Mission", "Trust", "Animated"], style: "mission" },
  { id: "church", name: "Church & Ministry", desc: "Warm faith tones, sermon archive, event calendar", category: "Nonprofit & Community", color: "#7c3aed", sceneColors: ["#4c1d95", "#7c3aed", "#f59e0b"], icon: Star, tags: ["Warm", "Faith", "Community"], style: "warm" },
  { id: "community-center", name: "Community Center", desc: "Welcoming palette, program directory, volunteer CTA", category: "Nonprofit & Community", color: "#16a34a", sceneColors: ["#14532d", "#16a34a", "#f59e0b"], icon: Users, tags: ["Community", "Bright"], style: "welcoming" },
];

// ── Template Card ─────────────────────────────────────────────────────────────

function TemplateCard({ template, selected, onSelect }: { template: TemplateItem; selected: string; onSelect: (id: string) => void }) {
  return (
    <motion.div
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onSelect(template.id)}
      className={`relative cursor-pointer rounded-xl border p-3 transition-all ${
        selected === template.id
          ? "border-purple-500 bg-purple-500/10"
          : "border-white/10 bg-white/5 hover:border-white/20"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
          style={{ backgroundColor: template.color + "22", border: `1px solid ${template.color}44` }}>
          <template.icon className="w-4 h-4" style={{ color: template.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-xs leading-tight">{template.name}</p>
          <p className="text-[10px] text-white/40 mt-0.5 leading-relaxed line-clamp-2">{template.desc}</p>
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {template.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/50">{tag}</span>
            ))}
          </div>
        </div>
      </div>
      {selected === template.id && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
          className="absolute top-2.5 right-2.5 w-4 h-4 rounded-full bg-purple-500 flex items-center justify-center">
          <div className="w-1.5 h-1.5 rounded-full bg-white" />
        </motion.div>
      )}
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DynamicPages() {
  const [selectedTemplate, setSelectedTemplate] = useState(TEMPLATES[0].id);
  const [tab, setTab] = useState<"templates" | "builder">("templates");
  const [pageName, setPageName] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [showCatMenu, setShowCatMenu] = useState(false);

  const activeTemplate = TEMPLATES.find(t => t.id === selectedTemplate) ?? TEMPLATES[0];

  const filtered = useMemo(() => {
    return TEMPLATES.filter(t => {
      const matchCat = category === "All" || t.category === category;
      const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.category.toLowerCase().includes(search.toLowerCase()) || t.tags.some(tag => tag.toLowerCase().includes(search.toLowerCase()));
      return matchCat && matchSearch;
    });
  }, [category, search]);

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
            <p className="text-white/40 text-xs">{TEMPLATES.length} 3D Templates · WebGL Powered</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-purple-500/30 text-purple-400 text-xs">
            React Three Fiber
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
          <div className="flex border-b border-white/5">
            {(["templates", "builder"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 py-2.5 text-xs font-medium capitalize transition-colors ${
                  tab === t ? "text-white border-b-2 border-purple-500" : "text-white/40 hover:text-white/70"
                }`}>
                {t === "templates" ? `Templates (${TEMPLATES.length})` : "Builder"}
              </button>
            ))}
          </div>

          {tab === "templates" && (
            <>
              {/* Search + Category */}
              <div className="p-3 space-y-2 border-b border-white/5">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search templates..."
                    className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-white text-xs placeholder:text-white/30 outline-none focus:border-purple-500/50"
                  />
                  {search && <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2"><X className="w-3 h-3 text-white/40" /></button>}
                </div>
                <div className="relative">
                  <button onClick={() => setShowCatMenu(!showCatMenu)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/70 flex items-center justify-between hover:border-white/20">
                    <span className="truncate">{category}</span>
                    <ChevronDown className="w-3 h-3 shrink-0 ml-1" />
                  </button>
                  {showCatMenu && (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                      className="absolute top-full mt-1 left-0 right-0 bg-neutral-900 border border-white/10 rounded-lg z-50 overflow-hidden shadow-2xl max-h-48 overflow-y-auto">
                      {CATEGORIES.map(cat => (
                        <button key={cat} onClick={() => { setCategory(cat); setShowCatMenu(false); }}
                          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors ${category === cat ? "text-purple-400" : "text-white/70"}`}>
                          {cat}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </div>
                <p className="text-white/30 text-[10px]">{filtered.length} template{filtered.length !== 1 ? "s" : ""}</p>
              </div>

              {/* Template List */}
              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {filtered.length === 0 ? (
                  <div className="text-center text-white/30 text-xs py-8">No templates match</div>
                ) : (
                  filtered.map(t => (
                    <TemplateCard key={t.id} template={t} selected={selectedTemplate} onSelect={setSelectedTemplate} />
                  ))
                )}
              </div>

              {/* Generate CTA */}
              <div className="p-3 border-t border-white/5 space-y-2">
                <input
                  value={pageName}
                  onChange={e => setPageName(e.target.value)}
                  placeholder="Page name (optional)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder:text-white/30 outline-none focus:border-purple-500/50"
                />
                <Button onClick={handleGenerate} disabled={isGenerating}
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white text-sm h-9 gap-2">
                  {isGenerating ? (
                    <>
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full" />
                      Building 3D Scene...
                    </>
                  ) : (
                    <><Sparkles className="w-3.5 h-3.5" /> Generate · {activeTemplate.name}</>
                  )}
                </Button>
              </div>
            </>
          )}

          {tab === "builder" && (
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              <p className="text-white/40 text-xs px-1">Add sections</p>
              {[
                { label: "3D Hero", icon: Globe, desc: "Interactive WebGL hero" },
                { label: "Feature Grid", icon: Layers, desc: "Animated feature cards" },
                { label: "Stats Counter", icon: TrendingUp, desc: "Counting number reveal" },
                { label: "Testimonials", icon: Star, desc: "Scroll carousel" },
                { label: "3D CTA", icon: Rocket, desc: "Floating 3D call to action" },
                { label: "Pricing Table", icon: Target, desc: "Tiered pricing comparison" },
                { label: "Photo Gallery", icon: Camera, desc: "Masonry grid gallery" },
                { label: "Contact Form", icon: LayoutTemplate, desc: "Glassmorphism form" },
                { label: "FAQ Accordion", icon: BookOpen, desc: "Animated expand/collapse" },
                { label: "Team Section", icon: Users, desc: "Bio cards with hover fx" },
                { label: "Video Hero", icon: Cpu, desc: "Autoplay background video" },
                { label: "Map Section", icon: Globe, desc: "Interactive location map" },
              ].map(s => (
                <motion.div key={s.label} whileHover={{ x: 2 }}
                  className="flex items-center gap-3 p-2.5 rounded-xl border border-white/10 hover:border-purple-500/30 hover:bg-purple-500/5 cursor-pointer transition-all">
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

        {/* 3D Canvas */}
        <div className="flex-1 relative overflow-hidden">
          <Canvas camera={{ position: [0, 0, 8], fov: 60 }} gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }} dpr={[1, 2]}>
            <Suspense fallback={null}>
              <Scene template={activeTemplate} />
              <OrbitControls enablePan={false} enableZoom={false} autoRotate autoRotateSpeed={0.4}
                maxPolarAngle={Math.PI / 1.8} minPolarAngle={Math.PI / 3} />
            </Suspense>
          </Canvas>

          {/* Overlay */}
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
            <AnimatePresence mode="wait">
              {!generated ? (
                <motion.div key="idle" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="text-center px-8">
                  <motion.div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs border mb-4"
                    style={{ borderColor: activeTemplate.color + "44", color: activeTemplate.color, backgroundColor: activeTemplate.color + "11" }}>
                    <activeTemplate.icon className="w-3 h-3" />
                    {activeTemplate.name}
                  </motion.div>
                  <motion.h2 className="text-4xl font-black text-white mb-2"
                    style={{ textShadow: `0 0 60px ${activeTemplate.color}99` }}
                    animate={{ opacity: [0.8, 1, 0.8] }} transition={{ duration: 3, repeat: Infinity }}>
                    {activeTemplate.category}
                  </motion.h2>
                  <p className="text-white/50 text-sm max-w-xs mx-auto">{activeTemplate.desc}</p>
                  <div className="flex gap-2 justify-center mt-4 flex-wrap">
                    {activeTemplate.tags.map(tag => (
                      <Badge key={tag} className="text-[10px]" style={{ backgroundColor: activeTemplate.color + "22", borderColor: activeTemplate.color + "44", color: activeTemplate.color }}>{tag}</Badge>
                    ))}
                  </div>
                </motion.div>
              ) : (
                <motion.div key="done" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center pointer-events-auto">
                  <motion.div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                    style={{ backgroundColor: activeTemplate.color + "22", border: `1px solid ${activeTemplate.color}44` }}
                    animate={{ boxShadow: [`0 0 20px ${activeTemplate.color}44`, `0 0 40px ${activeTemplate.color}88`, `0 0 20px ${activeTemplate.color}44`] }}
                    transition={{ duration: 2, repeat: Infinity }}>
                    <Sparkles className="w-8 h-8" style={{ color: activeTemplate.color }} />
                  </motion.div>
                  <h3 className="text-3xl font-bold text-white mb-2">{pageName || activeTemplate.name} is ready</h3>
                  <p className="text-white/50 text-sm mb-4">3D scene built · Animations wired · Ready to publish</p>
                  <div className="flex gap-2 justify-center">
                    <Button size="sm" variant="outline" className="border-white/20 text-white/70 hover:text-white gap-1.5 text-xs">
                      <Eye className="w-3.5 h-3.5" /> Live Preview
                    </Button>
                    <Button size="sm" className="gap-1.5 text-xs" style={{ backgroundColor: activeTemplate.color }}>
                      <ArrowRight className="w-3.5 h-3.5" /> Publish Now
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="absolute bottom-4 left-4 flex items-center gap-2 pointer-events-none">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-white/40 text-xs">WebGL Active · Drag to explore · {TEMPLATES.length} templates</span>
          </div>
        </div>
      </div>
    </div>
  );
}
