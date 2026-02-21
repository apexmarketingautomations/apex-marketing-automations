import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { Link } from "wouter";

// Component: Hero_Section_Video_Background
const HeroSection = ({ headline, subheadline, cta_button }: { headline: string, subheadline: string, cta_button: string }) => {
  return (
    <div className="relative h-screen w-full overflow-hidden flex items-center justify-center bg-black">
      {/* Background "Video" Placeholder */}
      <div 
        className="absolute inset-0 bg-cover bg-center opacity-60 mix-blend-overlay"
        style={{ 
          backgroundImage: `url('https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=2070&auto=format&fit=crop')`, // Gym texture
          filter: "grayscale(100%) contrast(120%)"
        }} 
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/40 to-black/90" />
      
      {/* Content */}
      <div className="relative z-10 text-center px-4 max-w-4xl mx-auto space-y-8">
        <h1 
          className="text-6xl md:text-9xl font-black tracking-tighter text-white uppercase italic"
          style={{ textShadow: "0 0 40px rgba(255,255,255,0.1)" }}
        >
          {headline}
        </h1>
        
        <p 
          className="text-xl md:text-2xl text-gray-300 font-light tracking-wide max-w-2xl mx-auto"
        >
          {subheadline}
        </p>
        
        <div>
          <Button 
            size="lg" 
            className="bg-red-600 hover:bg-red-700 text-white border-0 text-lg px-10 py-8 rounded-none font-bold tracking-widest uppercase hover:scale-105 transition-transform"
          >
            {cta_button}
          </Button>
        </div>
      </div>

      {/* Scroll indicator */}
      <div 
        className="absolute bottom-10 left-1/2 -translate-x-1/2 text-white/30"
      >
        <div className="w-[1px] h-16 bg-gradient-to-b from-transparent via-white to-transparent" />
      </div>
    </div>
  );
};

// Component: Pricing_Table_3_Col
const PricingSection = ({ tiers }: { tiers: any[] }) => {
  return (
    <div className="py-24 px-4 bg-zinc-950">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-black text-white uppercase tracking-tighter mb-4">Membership</h2>
          <div className="w-24 h-1 bg-red-600 mx-auto" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
          {tiers.map((tier, idx) => (
            <div
              key={idx}
              className={`relative p-8 border ${
                tier.name === "Unlimited" 
                  ? "border-red-600 bg-zinc-900/50" 
                  : "border-zinc-800 bg-zinc-900/20"
              } flex flex-col group hover:border-red-600/50 transition-colors duration-300`}
            >
              {tier.name === "Unlimited" && (
                <div className="absolute top-0 right-0 bg-red-600 text-white text-xs font-bold px-3 py-1 uppercase tracking-wider">
                  Best Value
                </div>
              )}
              
              <h3 className="text-2xl font-bold text-white uppercase tracking-tight mb-2">{tier.name}</h3>
              <div className="flex items-baseline gap-1 mb-8">
                <span className="text-5xl font-black text-white">{tier.price}</span>
                <span className="text-zinc-500 font-medium">/month</span>
              </div>
              
              <ul className="space-y-4 mb-8 flex-1">
                {[1, 2, 3, 4].map((i) => (
                  <li key={i} className="flex items-center gap-3 text-zinc-400">
                    <Check className="h-5 w-5 text-red-600" />
                    <span>Access to all equipment</span>
                  </li>
                ))}
              </ul>
              
              <Button className={`w-full py-6 rounded-none font-bold uppercase tracking-wider transition-all ${
                 tier.name === "Unlimited"
                 ? "bg-white text-black hover:bg-gray-200"
                 : "bg-transparent border border-zinc-700 text-white hover:bg-zinc-800"
              }`}>
                Choose {tier.name}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// --- Dynamic Component Registry ---
const COMPONENT_REGISTRY: Record<string, React.ComponentType<any>> = {
  "Hero_Section_Video_Background": HeroSection,
  "Pricing_Table_3_Col": PricingSection,
};

const ComponentRegistry = ({ type, props }: { type: string, props: any }) => {
  const Component = COMPONENT_REGISTRY[type];
  if (!Component) {
    return <div className="p-4 bg-red-900 text-white">Unknown Component: {type}</div>;
  }
  return <Component {...props} />;
};

export default function GymLanding() {
  const data = {
    theme: "dark_mode_aggressive",
    sections: [
      {
        component: "Hero_Section_Video_Background",
        headline: "FORGE YOUR BODY",
        subheadline: "The hardest workout in town. First class free.",
        cta_button: "Join the Cult"
      },
      {
        component: "Pricing_Table_3_Col",
        tiers: [
          { name: "Drop In", price: "$20" },
          { name: "Unlimited", price: "$150" },
          { name: "Personal Training", price: "$400" }
        ]
      }
    ]
  };

  return (
    <div className="bg-black min-h-screen text-white font-sans selection:bg-red-600 selection:text-white">
      {/* Navigation Overlay */}
      <nav className="absolute top-0 w-full z-50 p-6 flex justify-between items-center">
        <div className="font-black text-2xl tracking-tighter italic">FORGE.</div>
        <div className="flex gap-6 text-sm font-bold uppercase tracking-widest text-zinc-400">
          <Link href="/">Back to Dashboard</Link>
          <a href="#" className="hover:text-white transition-colors">Locations</a>
          <a href="#" className="text-red-600 hover:text-red-500 transition-colors">Login</a>
        </div>
      </nav>

      {/* Dynamic Rendering Loop */}
      {data.sections.map((section, idx) => (
        <ComponentRegistry 
          key={idx} 
          type={section.component} 
          props={section} 
        />
      ))}

      <footer className="bg-black py-12 border-t border-zinc-900 text-center text-zinc-600 text-sm">
        <p>© 2026 FORGE FITNESS. ALL RIGHTS RESERVED.</p>
      </footer>
    </div>
  );
}
