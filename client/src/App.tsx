import { useState } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { SplashScreen } from "@/components/splash-screen";
import NotFound from "@/pages/not-found";
import SmsDashboard from "@/pages/sms-dashboard";
import WorkflowBuilder from "@/pages/workflow-builder";
import GymLanding from "@/pages/gym-landing";
import LuxeLanding from "@/pages/luxe-landing";
import Onboarding from "@/pages/onboarding";
import BotTrainer from "@/pages/bot-trainer";
import SiteBuilder from "@/pages/site-builder";
import LiquidWebsite from "@/pages/liquid-website";
import AdLauncher from "@/pages/ad-launcher";
import VoiceAgent from "@/pages/voice-agent";
import GrowthCenter from "@/pages/growth-center";

function Router() {
  return (
    <Layout>
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
