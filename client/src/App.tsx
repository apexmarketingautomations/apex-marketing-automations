import { useState, useEffect, Suspense, lazy } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { SplashScreen } from "@/components/splash-screen";
import { Spinner } from "@/components/ui/spinner";
import { initVibe } from "@/components/vibe-switcher";
import { useAuth } from "@/hooks/use-auth";
import { AccountProvider } from "@/hooks/use-account";

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
const GodMode = lazy(() => import("@/pages/god-mode"));
const Reputation = lazy(() => import("@/pages/reputation"));
const Billing = lazy(() => import("@/pages/billing"));
const Domains = lazy(() => import("@/pages/domains"));
const ReviewBuffer = lazy(() => import("@/pages/review-buffer"));
const Pricing = lazy(() => import("@/pages/pricing"));
const MarketplacePage = lazy(() => import("@/pages/marketplace"));
const AffiliateDashboard = lazy(() => import("@/pages/affiliate"));
const CommandCenterPage = lazy(() => import("@/pages/command-center"));
const SnapshotsPage = lazy(() => import("@/pages/snapshots"));
const SentinelPage = lazy(() => import("@/pages/sentinel"));
const PropertyRadarPage = lazy(() => import("@/pages/property-radar"));
const WebsiteIntegration = lazy(() => import("@/pages/website-integration"));
const FormBuilder = lazy(() => import("@/pages/form-builder"));
const AnalyticsPage = lazy(() => import("@/pages/analytics"));
const PipelinePage = lazy(() => import("@/pages/pipeline"));
const CalendarPage = lazy(() => import("@/pages/calendar"));
const EmailCampaignsPage = lazy(() => import("@/pages/email-campaigns"));
const WhiteLabelPage = lazy(() => import("@/pages/white-label"));
const WebhooksPage = lazy(() => import("@/pages/webhooks"));
const ReportsPage = lazy(() => import("@/pages/reports"));
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const MetaAdsPage = lazy(() => import("@/pages/meta-ads"));
const MetaLeadsPage = lazy(() => import("@/pages/meta-leads"));
const InstagramInboxPage = lazy(() => import("@/pages/instagram-inbox"));
const NexusDemo = lazy(() => import("@/pages/nexus-demo"));
const AdminConsolePage = lazy(() => import("@/pages/admin-console"));
const AccountSettingsPage = lazy(() => import("@/pages/account-settings"));
const ClientPortal = lazy(() => import("@/pages/client-portal"));
const IntegrationsPage = lazy(() => import("@/pages/integrations"));
const WebhookEventsPage = lazy(() => import("@/pages/webhook-events"));
const NotFound = lazy(() => import("@/pages/not-found"));
const LandingPage = lazy(() => import("@/pages/landing"));
const MarketersLanding = lazy(() => import("@/pages/marketers-landing"));
const RealtorsLanding = lazy(() => import("@/pages/realtors-landing"));
const HomeServiceLanding = lazy(() => import("@/pages/home-service-landing"));

function PageLoader() {
  return (
    <div className="h-screen w-full flex items-center justify-center bg-neutral-950">
      <Spinner className="size-8 text-cyan-500" />
    </div>
  );
}

function Redirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation(to); }, [to, setLocation]);
  return null;
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <PageLoader />;

  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        {/* Public routes — no auth required */}
        <Route path="/portal/:token" component={ClientPortal} />
        <Route path="/review/:subAccountId" component={ReviewBuffer} />
        <Route path="/demo" component={NexusDemo} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/gym" component={GymLanding} />
        <Route path="/luxe" component={LuxeLanding} />
        <Route path="/marketers" component={MarketersLanding} />
        <Route path="/realtors" component={RealtorsLanding} />
        <Route path="/home-services" component={HomeServiceLanding} />

        {/* Landing page for unauthenticated, dashboard for authenticated */}
        <Route path="/">
          {isAuthenticated ? (
            <Layout>
              <Suspense fallback={<PageLoader />}>
                <DashboardPage />
              </Suspense>
            </Layout>
          ) : (
            <LandingPage />
          )}
        </Route>

        {/* All authenticated routes */}
        <Route>
          {!isAuthenticated ? (
            <Redirect to="/" />
          ) : (
            <Layout>
              <Suspense fallback={<PageLoader />}>
                <Switch>
                  <Route path="/dashboard" component={DashboardPage} />
                  <Route path="/inbox" component={SmsDashboard} />
                  <Route path="/workflows" component={WorkflowBuilder} />
                  <Route path="/bot-trainer" component={BotTrainer} />
                  <Route path="/onboarding" component={Onboarding} />
                  <Route path="/site-builder" component={SiteBuilder} />
                  <Route path="/liquid" component={LiquidWebsite} />
                  <Route path="/ad-launcher" component={AdLauncher} />
                  <Route path="/voice-agent" component={VoiceAgent} />
                  <Route path="/growth" component={GrowthCenter} />
                  <Route path="/reputation" component={Reputation} />
                  <Route path="/billing" component={Billing} />
                  <Route path="/domains" component={Domains} />
                  <Route path="/god-mode" component={GodMode} />
                  <Route path="/admin-console" component={AdminConsolePage} />
                  <Route path="/marketplace" component={MarketplacePage} />
                  <Route path="/affiliate" component={AffiliateDashboard} />
                  <Route path="/command-center" component={CommandCenterPage} />
                  <Route path="/snapshots" component={SnapshotsPage} />
                  <Route path="/sentinel" component={SentinelPage} />
                  <Route path="/property-radar" component={PropertyRadarPage} />
                  <Route path="/website-integration" component={WebsiteIntegration} />
                  <Route path="/form-builder" component={FormBuilder} />
                  <Route path="/analytics" component={AnalyticsPage} />
                  <Route path="/pipeline" component={PipelinePage} />
                  <Route path="/calendar" component={CalendarPage} />
                  <Route path="/email-campaigns" component={EmailCampaignsPage} />
                  <Route path="/white-label" component={WhiteLabelPage} />
                  <Route path="/webhooks" component={WebhooksPage} />
                  <Route path="/reports" component={ReportsPage} />
                  <Route path="/meta-ads" component={MetaAdsPage} />
                  <Route path="/meta-leads" component={MetaLeadsPage} />
                  <Route path="/instagram-inbox" component={InstagramInboxPage} />
                  <Route path="/account-settings" component={AccountSettingsPage} />
                  <Route path="/integrations" component={IntegrationsPage} />
                  <Route path="/webhook-events" component={WebhookEventsPage} />
                  <Route component={NotFound} />
                </Switch>
              </Suspense>
            </Layout>
          )}
        </Route>
      </Switch>
    </Suspense>
  );
}

function App() {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    initVibe();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AccountProvider>
        <TooltipProvider>
          <Toaster />
          {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
          <Router />
        </TooltipProvider>
      </AccountProvider>
    </QueryClientProvider>
  );
}

export default App;
