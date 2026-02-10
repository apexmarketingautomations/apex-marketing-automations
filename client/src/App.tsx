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
    <Switch>
      {/* Full-screen pages (No Sidebar) */}
      <Route path="/gym" component={GymLanding} />
      <Route path="/luxe" component={LuxeLanding} />
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/site-builder" component={SiteBuilder} />
      <Route path="/liquid" component={LiquidWebsite} />
      <Route path="/ad-launcher" component={AdLauncher} />
      <Route path="/voice-agent" component={VoiceAgent} />
      <Route path="/growth" component={GrowthCenter} />

      {/* Dashboard Routes (With Sidebar) */}
      <Route path="/">
        <Layout>
          <SmsDashboard />
        </Layout>
      </Route>
      <Route path="/workflows">
        <Layout>
          <WorkflowBuilder />
        </Layout>
      </Route>
      <Route path="/bot-trainer">
        <Layout>
          <BotTrainer />
        </Layout>
      </Route>
      
      {/* Fallback */}
      <Route>
        <Layout>
          <NotFound />
        </Layout>
      </Route>
    </Switch>
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
