import { useState, Suspense, lazy } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { SplashScreen } from "@/components/splash-screen";
import { Spinner } from "@/components/ui/spinner";

const SmsDashboard = lazy(() => import("@/pages/sms-dashboard"));
const WorkflowBuilder = lazy(() => import("@/pages/workflow-builder"));
const GymLanding = lazy(() => import("@/pages/gym-landing"));
const LuxeLanding = lazy(() => import("@/pages/luxe-landing"));
const Onboarding = lazy(() => import("@/pages/onboarding"));
const BotTrainer = lazy(() => import("@/pages/bot-trainer"));
const SiteBuilder = lazy(() => import("@/pages/site-builder"));
const LiquidWebsite = lazy(() => import("@/pages/liquid-website"));
const AdLauncher = lazy(() => import("@/pages/ad-launcher"));
const VoiceAgent = lazy(() => import("@/pages/voice-agent"));
const GrowthCenter = lazy(() => import("@/pages/growth-center"));
const NotFound = lazy(() => import("@/pages/not-found"));

function PageLoader() {
  return (
    <div className="h-screen w-full flex items-center justify-center bg-neutral-950">
      <Spinner className="size-8 text-cyan-500" />
    </div>
  );
}

function Router() {
  return (
    <Layout>
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/" component={SmsDashboard} />
          <Route path="/workflows" component={WorkflowBuilder} />
          <Route path="/bot-trainer" component={BotTrainer} />
          <Route path="/onboarding" component={Onboarding} />
          <Route path="/site-builder" component={SiteBuilder} />
          <Route path="/liquid" component={LiquidWebsite} />
          <Route path="/ad-launcher" component={AdLauncher} />
          <Route path="/voice-agent" component={VoiceAgent} />
          <Route path="/growth" component={GrowthCenter} />
          <Route path="/gym" component={GymLanding} />
          <Route path="/luxe" component={LuxeLanding} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Layout>
  );
}

function App() {
  const [showSplash, setShowSplash] = useState(true);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
