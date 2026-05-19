import { Suspense, useRef, useState, useMemo, useCallback } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
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
import { PromptDesignPanel } from "@/components/dynamic-pages/PromptDesignPanel";
import { DynamicPageRenderer } from "@/components/dynamic-pages/DynamicPageRenderer";
import type { DynamicPageSchema } from "@/lib/dynamic-pages/schema";
import { useAuth } from "@/hooks/use-auth";
import { useActiveSubAccountId } from "@/components/account-required";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles, Globe, Layers, Zap, Eye, Download, Share2,
  Search, X, ImagePlus,
  Scale, UtensilsCrossed, Stethoscope, Car, Shield, Activity,
  GraduationCap, ShoppingBag, PawPrint, Camera, Heart, Home,
  Dumbbell, Gem, Megaphone, Building2, Wrench, Scissors,
  Briefcase, Truck, Leaf, Music, Baby, Dog,
  Coffee, Fish, Flower, Hammer, Zap as ZapIcon,
  Star, Brain, Cpu, Rocket, Target, TrendingUp, Users,
  Building, ShoppingCart, Palette, BookOpen, Bike, Anchor,
  Sun, Moon, Droplets, Flame, ArrowLeft, Check, RefreshCw,
  ChevronRight,
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

// ── Prompt Intent Extraction ──────────────────────────────────────────────────

interface PromptIntent {
  businessName: string;
  focalObject: string;
  displayLabel: string;
  templateHint: string;
  conflict: boolean;
}

const INTENT_MAP: Array<[RegExp, string, string]> = [
  [/barber\s*shop|barber\s*chair|fade\s*cut|hair\s*cut\s*shop/i, "Barber Shop", "barber-shop"],
  [/coffee\s*shop|espresso|cafe|latte|cappuccino/i, "Coffee Shop", "coffee-shop"],
  [/med\s*spa|medspa|botox|filler|aesthetics|microneedling/i, "Med Spa", "medspa"],
  [/roofing|roof\s*repair|storm\s*damage\s*roof/i, "Roofing Company", "roofing"],
  [/criminal\s*defense|criminal\s*lawyer|defense\s*attorney/i, "Criminal Defense Attorney", "criminal-defense"],
  [/personal\s*injury|accident\s*lawyer|injury\s*attorney/i, "Personal Injury Law", "personal-injury-law"],
  [/dental|dentist|tooth|teeth|smile/i, "Dental Practice", "dentist"],
  [/dog\s*groo|pet\s*groo|puppy\s*wash/i, "Dog Grooming", "dog-grooming"],
  [/gym|fitness\s*center|weight\s*room|workout/i, "Gym & Fitness", "gym"],
  [/yoga/i, "Yoga Studio", "yoga-studio"],
  [/realtor|real\s*estate|property\s*listing/i, "Real Estate", "residential-realtor"],
  [/restaurant|bistro|eatery|dining\s*room/i, "Restaurant", "restaurant"],
  [/pizza/i, "Pizzeria", "restaurant"],
  [/auto\s*repair|mechanic|car\s*shop/i, "Auto Repair", "auto-repair"],
  [/plumb/i, "Plumbing", "plumbing"],
  [/hvac|air\s*condition/i, "HVAC", "hvac"],
  [/law\s*firm|attorney|lawyer/i, "Law Firm", "personal-injury-law"],
  [/solar/i, "Solar Company", "solar"],
  [/tattoo/i, "Tattoo Studio", "tattoo-studio"],
  [/nail\s*salon/i, "Nail Salon", "nail-salon"],
  [/chiropract/i, "Chiropractic Clinic", "chiropractor"],
  [/financial\s*advisor|wealth\s*manag/i, "Financial Advisor", "financial-advisor"],
  [/saas|software|app\s*landing|tech\s*startup/i, "SaaS / Tech", "saas-dark"],
  [/wedding\s*plann/i, "Wedding Planner", "wedding-planner"],
  [/nonprofit|charity|donation/i, "Nonprofit", "nonprofit"],
  [/church|ministry|congregation/i, "Church", "church"],
  [/landscap|lawn\s*care|gardening/i, "Landscaping", "landscaping"],
  [/photography|photo\s*studio/i, "Photography Studio", "photography-studio"],
  [/food\s*truck/i, "Food Truck", "food-truck"],
  [/bakery|pastry|cake\s*shop/i, "Bakery", "bakery"],
  [/insurance/i, "Insurance Agency", "insurance-agency"],
  [/contractor|construction|remodel/i, "Contractor", "general-contractor"],
  [/pet\s*board|doggy\s*daycare/i, "Pet Boarding", "pet-boarding"],
  [/vet|veterinar/i, "Veterinary Clinic", "veterinarian"],
  [/massage|spa\s*therapy/i, "Massage Therapy", "massage-therapy"],
  [/pilates/i, "Pilates Studio", "pilates-studio"],
  [/crossfit/i, "CrossFit Box", "crossfit"],
  [/martial\s*arts|bjj|karate|judo/i, "Martial Arts", "martial-arts"],
  [/luxury\s*real\s*estate/i, "Luxury Real Estate", "luxury-real-estate"],
];

function extractPromptIntent(prompt: string, selectedTemplateId: string): PromptIntent {
  if (!prompt.trim()) {
    return { businessName: "", focalObject: "", displayLabel: "", templateHint: "", conflict: false };
  }
  let businessName = "";
  let templateHint = "";
  for (const [pattern, name, tid] of INTENT_MAP) {
    if (pattern.test(prompt)) { businessName = name; templateHint = tid; break; }
  }
  const focalMatch = prompt.match(
    /(?:spinning|rotating|3d|interactive|floating|animated|a\s+giant|hero\s+(?:is\s+a|shows?)\s+(?:a\s+)?|featuring\s+a\s+|with\s+a\s+(?:spinning\s+|rotating\s+|3d\s+)?)([a-z][a-z\s]{2,30}?)(?:\s+in\s+|\s+as\s+|\s+for\s+|[,.]|$)/i
  );
  const focalObject = focalMatch ? focalMatch[1].trim() : "";
  const displayLabel = businessName || (focalObject ? focalObject : "");
  const conflict = !!templateHint && templateHint !== selectedTemplateId && !!businessName;
  return { businessName, focalObject, displayLabel, templateHint, conflict };
}

// ── Example Prompts ───────────────────────────────────────────────────────────

const EXAMPLE_PROMPTS = [
  "Barber shop with a spinning 3D razor, dark masculine aesthetic",
  "Dog grooming studio with playful floating paw prints",
  "Dark luxury med spa with rose gold particles and cinematic lighting",
  "Roofing company, storm damage urgency, bold emergency CTA",
  "Coffee shop with a giant espresso machine rotating in 3D hero",
  "AI startup with neural network particles and neon glow",
  "Wedding planner with romantic floating petals and soft pastels",
  "CrossFit box with explosive fire energy and bold dark aesthetic",
];

// ── Template Swatch Card ──────────────────────────────────────────────────────

function TemplateSwatchCard({ template, selected, onSelect }: { template: TemplateItem; selected: string; onSelect: (id: string) => void }) {
  const isSelected = selected === template.id;
  return (
    <motion.button
      whileHover={{ scale: 1.03, y: -2 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => onSelect(template.id)}
      className={`relative w-full text-left rounded-xl overflow-hidden transition-all ${
        isSelected
          ? "ring-2 ring-purple-500 ring-offset-2 ring-offset-[#080a14]"
          : "ring-1 ring-white/[0.07] hover:ring-white/20"
      }`}
    >
      {/* Color swatch preview */}
      <div
        className="h-14 relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${template.sceneColors[0]}dd 0%, ${template.sceneColors[1]}dd 100%)`,
        }}
      >
        {/* Subtle icon watermark */}
        <div className="absolute inset-0 flex items-center justify-center opacity-[0.18]">
          <template.icon className="w-9 h-9 text-white" />
        </div>
        {/* Color dots */}
        <div className="absolute bottom-2 left-2 flex gap-1">
          {template.sceneColors.filter(Boolean).map((c, i) => (
            <div
              key={i}
              className="w-2.5 h-2.5 rounded-full border border-white/25 shadow-sm"
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        {/* Selected checkmark */}
        {isSelected && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute top-2 right-2 w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center shadow-lg"
          >
            <Check className="w-3 h-3 text-white" strokeWidth={3} />
          </motion.div>
        )}
      </div>
      {/* Name + tags */}
      <div className="px-2.5 py-2 bg-[#0d0f1c]">
        <p className="text-white text-[11px] font-semibold truncate leading-tight">{template.name}</p>
        <div className="flex gap-1 mt-1">
          {template.tags.slice(0, 2).map(tag => (
            <span
              key={tag}
              className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0 font-medium"
              style={{ backgroundColor: template.color + "28", color: template.color }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </motion.button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DynamicPages() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.isAdmin === "true" || (user as any)?.role === "DEV_ADMIN";
  const subAccountId = useActiveSubAccountId();

  const [selectedTemplate, setSelectedTemplate] = useState(TEMPLATES[0].id);
  const [phase, setPhase] = useState<"design" | "build">("design");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [currentSchema, setCurrentSchema] = useState<DynamicPageSchema | null>(null);
  const [previewSchema, setPreviewSchema] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [generatedBusinessName, setGeneratedBusinessName] = useState("");
  const [uploadedImageUrl, setUploadedImageUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [showAllExamples, setShowAllExamples] = useState(false);
  const [generationMode, setGenerationMode] = useState<"stitch-style" | "apex-fast" | "stitch-import">("stitch-style");
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const promptIntent = useMemo(
    () => extractPromptIntent(customPrompt, selectedTemplate),
    [customPrompt, selectedTemplate]
  );

  const handleImageUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("files", file);
      const res = await fetch("/api/media/upload", { method: "POST", body: fd, credentials: "include" });
      const json = await res.json();
      const url = json.uploaded?.[0]?.url ?? json.url ?? "";
      if (url) setUploadedImageUrl(url);
    } catch { /* silent */ }
    finally { setIsUploading(false); }
  }, []);

  const activeTemplate = TEMPLATES.find(t => t.id === selectedTemplate) ?? TEMPLATES[0];

  const handleSchemaUpdate = useCallback((schema: DynamicPageSchema) => {
    setCurrentSchema(schema);
    setGenerated(true);
  }, []);

  const filtered = useMemo(() => {
    return TEMPLATES.filter(t => {
      const matchCat = category === "All" || t.category === category;
      const matchSearch = !search
        || t.name.toLowerCase().includes(search.toLowerCase())
        || t.category.toLowerCase().includes(search.toLowerCase())
        || t.tags.some(tag => tag.toLowerCase().includes(search.toLowerCase()));
      return matchCat && matchSearch;
    });
  }, [category, search]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    const userTyped = customPrompt.trim();
    try {
      const templateVisual = [
        `Visual style: ${activeTemplate.style}`,
        `Color palette: ${activeTemplate.sceneColors.filter(Boolean).join(", ")}`,
        `Mood tags: ${activeTemplate.tags.join(", ")}`,
      ].join(". ");

      let prompt: string;
      if (userTyped) {
        const focalHint = promptIntent.focalObject ? `Primary 3D focal object: ${promptIntent.focalObject}. ` : "";
        const visualLayer = !promptIntent.conflict ? ` ${templateVisual}.` : "";
        prompt = `${focalHint}${userTyped}.${visualLayer}`;
      } else {
        prompt = `${activeTemplate.name}: ${activeTemplate.desc}. ${templateVisual}.`;
      }

      const res = await apiRequest("POST", "/api/dynamic-pages/generate", {
        prompt,
        subAccountId,
        imageUrl: uploadedImageUrl || undefined,
        templateId: activeTemplate.id,
        generationMode,
      });
      const data = await res.json();
      if (data?.schema) {
        setCurrentSchema(data.schema);
        setGenerated(true);
        setPhase("build");
        setGeneratedBusinessName(
          data.schema?.meta?.title || promptIntent.businessName || activeTemplate.name
        );
      }
    } catch (err: any) {
      const msg = err?.message?.replace(/^\d+:\s*/, "") || "Could not generate page. Try again.";
      toast({ title: "Generation Failed", description: msg, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const exampleChips = showAllExamples ? EXAMPLE_PROMPTS : EXAMPLE_PROMPTS.slice(0, 3);

  return (
    <div className="h-screen w-full flex flex-col bg-[#030712] overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-white/[0.06] px-5 py-2.5 flex items-center justify-between bg-[#05070f]">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
            <Layers className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div>
            <h1 className="text-white font-bold text-sm leading-none">Dynamic Pages</h1>
            <p className="text-white/30 text-[11px] mt-0.5">{TEMPLATES.length} AI templates · WebGL 3D scenes</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-purple-500/30 text-purple-400 text-[10px] h-6 px-2">
            React Three Fiber
          </Badge>
          {generated && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex gap-1.5"
            >
              {currentSchema && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPreviewSchema(v => !v)}
                    className="h-7 text-xs text-white/50 hover:text-white gap-1.5"
                  >
                    <Eye className="w-3 h-3" />
                    {previewSchema ? "3D Scene" : "Full Preview"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowDebugPanel(v => !v)}
                    className="h-7 text-xs text-white/50 hover:text-white gap-1.5"
                  >
                    <Zap className="w-3 h-3" />
                    Debug
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" className="h-7 text-xs text-white/50 hover:text-white gap-1.5">
                <Share2 className="w-3 h-3" /> Publish
              </Button>
              <Button size="sm" className="h-7 text-xs bg-purple-600 hover:bg-purple-700 gap-1.5">
                <Download className="w-3 h-3" /> Export
              </Button>
            </motion.div>
          )}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">

        {/* ── Left Panel ─────────────────────────────────────────────────────── */}
        <aside className="w-[380px] shrink-0 border-r border-white/[0.06] flex flex-col overflow-hidden bg-[#060810]">

          {/* Phase toggle */}
          <div className="flex border-b border-white/[0.06] px-4 pt-3 gap-4">
            <button
              onClick={() => setPhase("design")}
              className={`pb-2.5 text-xs font-semibold transition-colors border-b-2 ${
                phase === "design"
                  ? "text-white border-purple-500"
                  : "text-white/35 border-transparent hover:text-white/60"
              }`}
            >
              Design
            </button>
            <button
              onClick={() => setPhase("build")}
              disabled={!generated}
              className={`pb-2.5 text-xs font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
                phase === "build" && generated
                  ? "text-white border-purple-500"
                  : "text-white/25 border-transparent"
              } disabled:cursor-not-allowed`}
            >
              Edit
              {generated && (
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              )}
            </button>
          </div>

          {/* ──────────────────────────────────────── DESIGN PHASE */}
          {phase === "design" && (
            <div className="flex-1 flex flex-col overflow-hidden">

              {/* SECTION A: Prompt */}
              <div className="px-4 pt-4 pb-3 space-y-3 border-b border-white/[0.05]">

                {/* Section label */}
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-[11px] font-bold text-white/70 uppercase tracking-widest">Describe Your Page</span>
                </div>

                {/* Intent badge — appears as user types */}
                <AnimatePresence>
                  {promptIntent.displayLabel && (
                    <motion.div
                      initial={{ opacity: 0, height: 0, marginTop: 0 }}
                      animate={{ opacity: 1, height: "auto", marginTop: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-purple-500/30 bg-purple-500/[0.08]"
                    >
                      <Zap className="w-3 h-3 text-purple-400 shrink-0" />
                      <span className="text-purple-300 text-[11px]">
                        Detected: <span className="font-bold text-white">{promptIntent.displayLabel}</span>
                      </span>
                      {promptIntent.conflict && (
                        <span className="ml-auto text-[10px] text-amber-400 shrink-0">overrides template</span>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Prompt textarea */}
                <textarea
                  value={customPrompt}
                  onChange={e => setCustomPrompt(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleGenerate(); } }}
                  placeholder={'Describe your business and vibe...\ne.g. "Barber shop with spinning 3D razor, dark masculine aesthetic"'}
                  rows={4}
                  maxLength={1500}
                  className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3.5 py-3 text-white text-[12px] placeholder:text-white/25 resize-none outline-none focus:border-purple-500/50 focus:bg-white/[0.06] transition-all leading-relaxed"
                />

                {/* Example chips */}
                <div>
                  <p className="text-[10px] text-white/25 mb-1.5 uppercase tracking-wider font-medium">Try an example</p>
                  <div className="flex flex-wrap gap-1.5">
                    {exampleChips.map((ex, i) => (
                      <button
                        key={i}
                        onClick={() => setCustomPrompt(ex)}
                        className="px-2.5 py-1 rounded-full text-[10px] font-medium bg-white/[0.04] border border-white/[0.08] text-white/45 hover:text-white/80 hover:bg-white/[0.08] hover:border-white/20 transition-all text-left"
                      >
                        {ex.length > 36 ? ex.slice(0, 36) + "…" : ex}
                      </button>
                    ))}
                    <button
                      onClick={() => setShowAllExamples(v => !v)}
                      className="px-2 py-1 rounded-full text-[10px] text-white/25 hover:text-white/50 transition-colors"
                    >
                      {showAllExamples ? "less" : "more…"}
                    </button>
                  </div>
                </div>
              </div>

              {/* SECTION B: Image upload + Generate */}
              <div className="px-4 py-3 space-y-2.5 border-b border-white/[0.05]">

                {/* Image upload row */}
                <input
                  ref={uploadRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => e.target.files?.[0] && void handleImageUpload(e.target.files[0])}
                />
                <div
                  onClick={() => uploadRef.current?.click()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void handleImageUpload(f); }}
                  onDragOver={e => e.preventDefault()}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-dashed border-white/[0.08] hover:border-purple-500/35 cursor-pointer transition-colors group"
                >
                  {uploadedImageUrl ? (
                    <>
                      <img src={uploadedImageUrl} className="w-8 h-8 rounded-lg object-cover shrink-0" alt="uploaded" />
                      <span className="text-white/60 text-[11px] flex-1 truncate">Image attached</span>
                      <button
                        onClick={e => { e.stopPropagation(); setUploadedImageUrl(""); }}
                        className="w-5 h-5 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors shrink-0"
                      >
                        <X className="w-3 h-3 text-white/60" />
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/10 flex items-center justify-center group-hover:border-purple-500/30 transition-colors shrink-0">
                        <ImagePlus className="w-4 h-4 text-white/25 group-hover:text-purple-400 transition-colors" />
                      </div>
                      <div>
                        <p className="text-white/40 text-[11px] font-medium">
                          {isUploading ? "Uploading…" : "Add image"}
                        </p>
                        <p className="text-white/20 text-[10px]">logo, photo, product</p>
                      </div>
                    </>
                  )}
                </div>

                {/* Generation mode selector */}
                <div className="flex gap-1 p-1 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                  {(["stitch-style", "apex-fast", "stitch-import"] as const).map(m => {
                    const labels: Record<string, string> = {
                      "stitch-style": "✦ Stitch Visual",
                      "apex-fast": "⚡ Apex Fast",
                      "stitch-import": "⬇ Import",
                    };
                    return (
                      <button
                        key={m}
                        onClick={() => setGenerationMode(m)}
                        className={`flex-1 py-1.5 rounded-md text-[10px] font-semibold transition-all ${
                          generationMode === m
                            ? "bg-purple-600 text-white shadow"
                            : "text-white/35 hover:text-white/60"
                        }`}
                      >
                        {labels[m]}
                      </button>
                    );
                  })}
                </div>

                {/* Generate button */}
                <button
                  onClick={() => void handleGenerate()}
                  disabled={isGenerating}
                  className="w-full h-11 rounded-xl font-bold text-sm flex items-center justify-center gap-2.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    background: isGenerating
                      ? "linear-gradient(135deg, #4c1d95, #1e3a8a)"
                      : `linear-gradient(135deg, ${activeTemplate.sceneColors[0]}, ${activeTemplate.sceneColors[1]})`,
                    boxShadow: isGenerating ? "none" : `0 4px 24px ${activeTemplate.sceneColors[0]}55`,
                  }}
                >
                  {isGenerating ? (
                    <>
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                      />
                      <span className="text-white">
                        {promptIntent.displayLabel ? `Building ${promptIntent.displayLabel}…` : "Generating…"}
                      </span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-white" />
                      <span className="text-white">
                        Generate · {promptIntent.displayLabel || activeTemplate.name}
                      </span>
                    </>
                  )}
                </button>
                <p className="text-white/20 text-[10px] text-center">⌘ Enter to generate · Prompt overrides template</p>
              </div>

              {/* SECTION C: Style Seeds (Template Gallery) */}
              <div className="flex-1 flex flex-col overflow-hidden">

                {/* Section label + count */}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Style Seeds</span>
                  <span className="text-[10px] text-white/20">{filtered.length} of {TEMPLATES.length}</span>
                </div>

                {/* Category pills — horizontal scroll */}
                <div className="flex gap-1.5 px-4 pb-2.5 overflow-x-auto"
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setCategory(cat)}
                      className={`shrink-0 px-3 py-1 rounded-full text-[10px] font-semibold transition-all border ${
                        category === cat
                          ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
                          : "bg-white/[0.03] text-white/35 border-white/[0.07] hover:text-white/60 hover:bg-white/[0.06]"
                      }`}
                    >
                      {cat === "All" ? `All (${TEMPLATES.length})` : cat.replace(" & ", " & ")}
                    </button>
                  ))}
                </div>

                {/* Search */}
                <div className="px-4 pb-2.5">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25" />
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search templates…"
                      className="w-full bg-white/[0.03] border border-white/[0.07] rounded-lg pl-8 pr-8 py-1.5 text-white text-[11px] placeholder:text-white/20 outline-none focus:border-purple-500/40 transition-colors"
                    />
                    {search && (
                      <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2">
                        <X className="w-3 h-3 text-white/30 hover:text-white/60 transition-colors" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Template 2-col grid */}
                <div className="flex-1 overflow-y-auto px-4 pb-4">
                  {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <Search className="w-8 h-8 text-white/10 mb-3" />
                      <p className="text-white/30 text-xs">No templates match "{search}"</p>
                      <button onClick={() => { setSearch(""); setCategory("All"); }} className="mt-2 text-purple-400 text-xs hover:text-purple-300 transition-colors">Clear filters</button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {filtered.map(t => (
                        <TemplateSwatchCard
                          key={t.id}
                          template={t}
                          selected={selectedTemplate}
                          onSelect={setSelectedTemplate}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ──────────────────────────────────────── BUILD PHASE */}
          {phase === "build" && (
            <div className="flex-1 flex flex-col overflow-hidden">

              {/* Generated page info banner */}
              {generatedBusinessName && (
                <div
                  className="mx-4 mt-4 px-4 py-3 rounded-xl border flex items-center gap-3"
                  style={{
                    borderColor: activeTemplate.sceneColors[0] + "44",
                    backgroundColor: activeTemplate.sceneColors[0] + "11",
                  }}
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: activeTemplate.sceneColors[0] + "22" }}
                  >
                    <activeTemplate.icon className="w-4.5 h-4.5" style={{ color: activeTemplate.sceneColors[0] }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-bold truncate">{generatedBusinessName}</p>
                    <p className="text-white/40 text-[10px]">AI generated · WebGL scene live</p>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
                </div>
              )}

              {/* PromptDesignPanel */}
              <div className="flex-1 overflow-y-auto px-4 py-4">
                <PromptDesignPanel
                  currentSchema={currentSchema}
                  onSchemaUpdate={handleSchemaUpdate}
                  isAdmin={isAdmin}
                  subAccountId={subAccountId ?? undefined}
                />
              </div>

              {/* Back to design */}
              <div className="px-4 py-3 border-t border-white/[0.05]">
                <button
                  onClick={() => setPhase("design")}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-white/[0.08] hover:border-purple-500/30 hover:bg-purple-500/[0.04] text-white/35 hover:text-white/70 text-[11px] font-medium transition-all"
                >
                  <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
                  Back to Design — generate a new page
                </button>
              </div>
            </div>
          )}
        </aside>

        {/* ── Right: 3D Canvas / Preview ────────────────────────────────────── */}
        <main className="flex-1 relative overflow-hidden">

          {/* Full-page schema preview */}
          {currentSchema && previewSchema ? (
            <div className="absolute inset-0 overflow-y-auto">
              <DynamicPageRenderer schema={currentSchema} isPreview heroHeight="400px" />
            </div>
          ) : (
            <Canvas
              camera={{ position: [0, 0, 8], fov: 60 }}
              gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
              dpr={[1, 2]}
            >
              <Suspense fallback={null}>
                <Scene template={activeTemplate} />
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
          )}

          {/* Canvas overlay — idle state */}
          {!previewSchema && (
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
              <AnimatePresence mode="wait">
                {!generated ? (
                  <motion.div
                    key="idle"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="text-center px-8 max-w-lg"
                  >
                    {promptIntent.displayLabel ? (
                      <>
                        <motion.div
                          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs border mb-5 border-purple-500/40 text-purple-300 bg-purple-500/10"
                        >
                          <Zap className="w-3 h-3" />
                          Prompt detected
                        </motion.div>
                        <motion.h2
                          className="text-5xl font-black text-white mb-3 leading-none"
                          style={{ textShadow: "0 0 80px #a855f766" }}
                          animate={{ opacity: [0.85, 1, 0.85] }}
                          transition={{ duration: 3, repeat: Infinity }}
                        >
                          {promptIntent.businessName || promptIntent.focalObject || "Custom Site"}
                        </motion.h2>
                        {promptIntent.focalObject && (
                          <p className="text-white/50 text-sm mb-3">
                            3D object: <span className="text-purple-400 font-semibold">{promptIntent.focalObject}</span>
                          </p>
                        )}
                        <p className="text-white/35 text-sm">Hit Generate to build your custom WebGL page</p>
                      </>
                    ) : (
                      <>
                        <motion.div
                          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs border mb-5"
                          style={{
                            borderColor: activeTemplate.color + "55",
                            color: activeTemplate.color,
                            backgroundColor: activeTemplate.color + "14",
                          }}
                        >
                          <activeTemplate.icon className="w-3 h-3" />
                          {activeTemplate.name}
                        </motion.div>
                        <motion.h2
                          className="text-5xl font-black text-white mb-3 leading-none"
                          style={{ textShadow: `0 0 80px ${activeTemplate.color}66` }}
                          animate={{ opacity: [0.85, 1, 0.85] }}
                          transition={{ duration: 3, repeat: Infinity }}
                        >
                          {activeTemplate.category}
                        </motion.h2>
                        <p className="text-white/45 text-sm max-w-xs mx-auto mb-5">{activeTemplate.desc}</p>
                        <div className="flex gap-2 justify-center flex-wrap">
                          {activeTemplate.tags.map(tag => (
                            <Badge
                              key={tag}
                              className="text-[10px] border"
                              style={{
                                backgroundColor: activeTemplate.color + "20",
                                borderColor: activeTemplate.color + "40",
                                color: activeTemplate.color,
                              }}
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="done"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-center pointer-events-auto"
                  >
                    <motion.div
                      className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-5"
                      style={{
                        backgroundColor: activeTemplate.sceneColors[0] + "22",
                        border: `1px solid ${activeTemplate.sceneColors[0]}44`,
                      }}
                      animate={{
                        boxShadow: [
                          `0 0 20px ${activeTemplate.sceneColors[0]}44`,
                          `0 0 60px ${activeTemplate.sceneColors[0]}77`,
                          `0 0 20px ${activeTemplate.sceneColors[0]}44`,
                        ],
                      }}
                      transition={{ duration: 2.5, repeat: Infinity }}
                    >
                      <Check className="w-9 h-9" style={{ color: activeTemplate.sceneColors[0] }} />
                    </motion.div>
                    <h3 className="text-4xl font-black text-white mb-2">
                      {generatedBusinessName || currentSchema?.meta?.title || activeTemplate.name} is live
                    </h3>
                    <p className="text-white/45 text-sm mb-6 max-w-sm mx-auto">
                      WebGL scene active · AI sections generated · Ready to publish
                    </p>
                    <div className="flex gap-2.5 justify-center">
                      {currentSchema && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPreviewSchema(true)}
                          className="border-white/20 text-white/70 hover:text-white gap-1.5 h-9 px-4"
                        >
                          <Eye className="w-3.5 h-3.5" /> Full Preview
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => setPhase("build")}
                        className="gap-1.5 h-9 px-4"
                        style={{ backgroundColor: activeTemplate.sceneColors[0] }}
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Edit Page
                      </Button>
                      <Button
                        size="sm"
                        className="gap-1.5 h-9 px-4 bg-white text-black hover:bg-white/90"
                      >
                        Publish Now <ChevronRight className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Exit preview */}
          {previewSchema && (
            <div className="absolute top-4 right-4 z-20">
              <Button
                size="sm"
                onClick={() => setPreviewSchema(false)}
                className="bg-black/70 backdrop-blur-sm border border-white/20 text-white hover:bg-black/80 gap-1.5 text-xs h-8"
              >
                <X className="w-3 h-3" /> Exit Preview
              </Button>
            </div>
          )}

          {/* Status bar */}
          <div className="absolute bottom-4 left-4 flex items-center gap-2 pointer-events-none">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-white/30 text-[11px]">
              {currentSchema
                ? `${generatedBusinessName || "Page"} · WebGL active · ${currentSchema.meta.niche.replace(/_/g, " ")} · ${(currentSchema as any).designSource ?? "apex-generator"}`
                : `WebGL live · ${activeTemplate.style} aesthetic · ${TEMPLATES.length} templates`
              }
            </span>
          </div>
        </main>
      </div>

      {/* ── Debug Panel ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showDebugPanel && currentSchema && (
          <motion.div
            key="debug-panel"
            initial={{ opacity: 0, x: 400 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 400 }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 h-full w-[420px] bg-[#060810] border-l border-white/[0.08] z-50 flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-purple-400" />
                <span className="text-white font-bold text-sm">Debug Panel</span>
                <Badge className="ml-1 text-[9px] h-4 px-1.5 bg-purple-500/20 text-purple-400 border-purple-500/30">
                  {(currentSchema as any).designSource ?? "apex-generator"}
                </Badge>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowDebugPanel(false)}
                className="h-7 w-7 p-0 text-white/40 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs font-mono">

              {/* Parsed Intent */}
              <details open className="group">
                <summary className="cursor-pointer text-purple-400 font-bold uppercase tracking-widest text-[10px] mb-2 list-none flex items-center gap-1.5">
                  <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                  Parsed Intent
                </summary>
                <div className="bg-white/[0.03] rounded-lg p-3 space-y-1 border border-white/[0.05]">
                  <div className="flex gap-2"><span className="text-white/40 w-28 shrink-0">businessType</span><span className="text-green-400">{currentSchema.meta.businessType}</span></div>
                  <div className="flex gap-2"><span className="text-white/40 w-28 shrink-0">niche</span><span className="text-green-400">{currentSchema.meta.niche}</span></div>
                  <div className="flex gap-2"><span className="text-white/40 w-28 shrink-0">designSource</span><span className="text-cyan-400">{(currentSchema as any).designSource ?? "—"}</span></div>
                  <div className="flex gap-2"><span className="text-white/40 w-28 shrink-0">sceneObjects</span><span className="text-yellow-400">{currentSchema.scene.objects.length}</span></div>
                  <div className="flex gap-2"><span className="text-white/40 w-28 shrink-0">ctaText</span><span className="text-orange-400">{currentSchema.cta.primaryText}</span></div>
                  <div className="flex gap-2"><span className="text-white/40 w-28 shrink-0">crmTag</span><span className="text-pink-400">{currentSchema.crm.automationTag}</span></div>
                </div>
              </details>

              {/* Scene Objects */}
              <details open className="group">
                <summary className="cursor-pointer text-purple-400 font-bold uppercase tracking-widest text-[10px] mb-2 list-none flex items-center gap-1.5">
                  <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                  Scene Objects ({currentSchema.scene.objects.length})
                </summary>
                <div className="space-y-1.5">
                  {currentSchema.scene.objects.map(obj => (
                    <div key={obj.id} className="bg-white/[0.03] rounded-lg p-2.5 border border-white/[0.05]">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ background: obj.color }} />
                        <span className="text-white font-bold">{obj.label}</span>
                        <span className="ml-auto text-white/30 text-[10px]">{obj.type}</span>
                      </div>
                      <div className="flex gap-3 text-[10px]">
                        <span className="text-white/30">anim: <span className="text-cyan-400">{obj.animation}</span></span>
                        <span className="text-white/30">mat: <span className="text-yellow-400">{obj.material}</span></span>
                        {(obj as any).semanticType && <span className="text-white/30">type: <span className="text-green-400">{(obj as any).semanticType}</span></span>}
                      </div>
                    </div>
                  ))}
                </div>
              </details>

              {/* Copy Validation */}
              <details open className="group">
                <summary className="cursor-pointer text-purple-400 font-bold uppercase tracking-widest text-[10px] mb-2 list-none flex items-center gap-1.5">
                  <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                  Generated Copy
                </summary>
                <div className="bg-white/[0.03] rounded-lg p-3 space-y-2 border border-white/[0.05]">
                  <div>
                    <span className="text-white/40 block text-[10px] mb-0.5">Headline</span>
                    <span className="text-white">{currentSchema.copy.headline}</span>
                  </div>
                  <div>
                    <span className="text-white/40 block text-[10px] mb-0.5">Subheadline</span>
                    <span className="text-white/70">{currentSchema.copy.subheadline}</span>
                  </div>
                  <div>
                    <span className="text-white/40 block text-[10px] mb-0.5">CTA</span>
                    <span className="text-green-400 font-bold">{currentSchema.cta.primaryText}</span>
                  </div>
                </div>
              </details>

              {/* Sections */}
              <details className="group">
                <summary className="cursor-pointer text-purple-400 font-bold uppercase tracking-widest text-[10px] mb-2 list-none flex items-center gap-1.5">
                  <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                  Sections ({currentSchema.sections.length})
                </summary>
                <div className="space-y-1">
                  {currentSchema.sections.map((s, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <span className="text-white/25 w-4 shrink-0">{i}</span>
                      <span className="text-cyan-400 w-20 shrink-0">{s.type}</span>
                      <span className="text-white/60 truncate">{s.title}</span>
                    </div>
                  ))}
                </div>
              </details>

              {/* Raw Schema */}
              <details className="group">
                <summary className="cursor-pointer text-purple-400 font-bold uppercase tracking-widest text-[10px] mb-2 list-none flex items-center gap-1.5">
                  <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                  Raw Schema JSON
                </summary>
                <pre className="bg-black/40 rounded-lg p-3 text-[9px] text-white/50 overflow-auto max-h-64 leading-relaxed border border-white/[0.05]">
                  {JSON.stringify({ meta: currentSchema.meta, cta: currentSchema.cta, crm: currentSchema.crm }, null, 2)}
                </pre>
              </details>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
