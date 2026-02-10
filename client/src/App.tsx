import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import NotFound from "@/pages/not-found";
import SmsDashboard from "@/pages/sms-dashboard";
import WorkflowBuilder from "@/pages/workflow-builder";
import GymLanding from "@/pages/gym-landing";
import Onboarding from "@/pages/onboarding";
import BotTrainer from "@/pages/bot-trainer";

function Router() {
  return (
    <Switch>
      {/* Landing Page (No Sidebar) */}
      <Route path="/gym" component={GymLanding} />
      <Route path="/onboarding" component={Onboarding} />

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
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
