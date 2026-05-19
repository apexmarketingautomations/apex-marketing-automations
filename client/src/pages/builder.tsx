import { useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Layers, LayoutTemplate } from "lucide-react";

import DynamicPages from "@/pages/dynamic-pages";
import SiteBuilder from "@/pages/site-builder";

type Mode = "site" | "pages";

function parseMode(pathname: string): Mode {
  if (pathname.startsWith("/builder/pages")) return "pages";
  if (pathname.startsWith("/builder/site")) return "site";
  return "site";
}

export default function UnifiedBuilderPage() {
  const [location, setLocation] = useLocation();
  const mode = useMemo(() => parseMode(location), [location]);

  // Canonicalize /builder → /builder/site
  useEffect(() => {
    if (location === "/builder") setLocation("/builder/site");
  }, [location, setLocation]);

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden">
      <div className="shrink-0 px-4 md:px-6 pt-4 pb-3 border-b border-white/[0.06] bg-black/20 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-white font-bold text-sm leading-none">3D Site Builder</div>
            <div className="text-white/35 text-[11px] mt-1 truncate">
              One workspace for WebGL scenes, pages, and multi-page sites
            </div>
          </div>

          <Tabs
            value={mode}
            onValueChange={(v) => setLocation(v === "pages" ? "/builder/pages" : "/builder/site")}
          >
            <TabsList className="bg-white/5 border border-white/10">
              <TabsTrigger value="site" className="text-xs gap-2">
                <LayoutTemplate className="w-3.5 h-3.5" />
                Site
              </TabsTrigger>
              <TabsTrigger value="pages" className="text-xs gap-2">
                <Layers className="w-3.5 h-3.5" />
                Pages
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {mode === "pages" ? <DynamicPages /> : <SiteBuilder />}
      </div>
    </div>
  );
}

