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
import { useFirebaseAnalytics, useFirebaseNotifications } from "@/hooks/use-firebase";

const DigitalCard = lazy(() => import("@/pages/digital-card"));
const DigitalCardBuilder = lazy(() => import("@/pages/digital-card-builder"));
const CardSuccess = lazy(() => import("@/pages/card-success"));
const CardEdit = lazy(() => import("@/pages/card-edit"));
const CardsLanding = lazy(() => import("@/pages/cards-landing"));
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
const ExternalSentinelPage = lazy(() => import("@/pages/external-sentinel"));
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
const MetaOpsPage = lazy(() => import("@/pages/meta-ops"));
const MetaMessagingPage = lazy(() => import("@/pages/meta-messaging"));
const MetaMessaging2027Page = lazy(() => import("@/pages/meta-messaging-2027"));
const NexusDemo = lazy(() => import("@/pages/nexus-demo"));
const AdminConsolePage = lazy(() => import("@/pages/admin-console"));
const LaunchReadinessPage = lazy(() => import("@/pages/launch-readiness"));
const AccountSettingsPage = lazy(() => import("@/pages/account-settings"));
const ClientPortal = lazy(() => import("@/pages/client-portal"));
const IntegrationsPage = lazy(() => import("@/pages/integrations"));
const WebhookEventsPage = lazy(() => import("@/pages/webhook-events"));
const SponsorshipManager = lazy(() => import("@/pages/sponsorship-manager"));
const RevenueCommand = lazy(() => import("@/pages/revenue-command"));
const LocationSearchPage = lazy(() => import("@/pages/location-search"));
const NotificationPreferencesPage = lazy(() => import("@/pages/notification-preferences"));
const ABTestingPage = lazy(() => import("@/pages/ab-testing"));
const CrashReportsPage = lazy(() => import("@/pages/crash-reports"));
const ExecutionTimelinePage = lazy(() => import("@/pages/execution-timeline"));
const WhatsAppTemplatesPage = lazy(() => import("@/pages/whatsapp-templates"));
const ContentPlannerPage = lazy(() => import("@/pages/content-planner"));
const RoomOSPage = lazy(() => import("@/pages/roomos"));
const RoomOSDashboardPage = lazy(() => import("@/pages/roomos-dashboard"));
const IntelligenceDashboardPage = lazy(() => import("@/pages/intelligence-dashboard"));
const ApexIntelligencePage = lazy(() => import("@/pages/apex-intelligence"));
const StandaloneCardLanding = lazy(() => import("@/pages/standalone-card-landing"));
const StandaloneCardCreate = lazy(() => import("@/pages/standalone-card-create"));
const StandaloneCardPreview = lazy(() => import("@/pages/standalone-card-preview"));
const StandaloneCardSuccess = lazy(() => import("@/pages/standalone-card-success"));
const StandaloneCardUpsell = lazy(() => import("@/pages/standalone-card-upsell"));
const StandaloneCardUpsellConfirm = lazy(() => import("@/pages/standalone-card-upsell-confirm"));
const StandaloneCardView = lazy(() => import("@/pages/standalone-card-view"));
const StandaloneCardDashboard = lazy(() => import("@/pages/standalone-card-dashboard"));
const StandaloneCardAdmin = lazy(() => import("@/pages/standalone-card-admin"));
const StandaloneCardEdit = lazy(() => import("@/pages/standalone-card-edit"));
const NotFound = lazy(() => import("@/pages/not-found"));
const LandingPage = lazy(() => import("@/pages/landing"));
const MarketersLanding = lazy(() => import("@/pages/marketers-landing"));
const RealtorsLanding = lazy(() => import("@/pages/realtors-landing"));
const HomeServiceLanding = lazy(() => import("@/pages/home-service-landing"));
const LawyersLanding = lazy(() => import("@/pages/lawyers-landing"));
const RestaurantsLanding = lazy(() => import("@/pages/restaurants-landing"));
const DentistsLanding = lazy(() => import("@/pages/dentists-landing"));
const MedspaLanding = lazy(() => import("@/pages/medspa-landing"));
const AutoDealersLanding = lazy(() => import("@/pages/auto-dealers-landing"));
const InsuranceLanding = lazy(() => import("@/pages/insurance-landing"));
const ChiropractorsLanding = lazy(() => import("@/pages/chiropractors-landing"));
const CoachesLanding = lazy(() => import("@/pages/coaches-landing"));
const EcommerceLanding = lazy(() => import("@/pages/ecommerce-landing"));
const PetServicesLanding = lazy(() => import("@/pages/pet-services-landing"));
const PhotographyLanding = lazy(() => import("@/pages/photography-landing"));
const WeddingLanding = lazy(() => import("@/pages/wedding-landing"));
const NicheDirectory = lazy(() => import("@/pages/niche-directory"));
const LoginPage = lazy(() => import("@/pages/login"));
const PrivacyPage = lazy(() => import("@/pages/privacy"));
const TermsPage = lazy(() => import("@/pages/terms"));
const DataDeletionPage = lazy(() => import("@/pages/data-deletion"));
const LawyersFunnel = lazy(() => import("@/pages/lawyers-funnel"));
const RestaurantsFunnel = lazy(() => import("@/pages/restaurants-funnel"));
const DentistsFunnel = lazy(() => import("@/pages/dentists-funnel"));
const MedspaFunnel = lazy(() => import("@/pages/medspa-funnel"));
const AutoDealersFunnel = lazy(() => import("@/pages/auto-dealers-funnel"));
const InsuranceFunnel = lazy(() => import("@/pages/insurance-funnel"));
const ChiropractorsFunnel = lazy(() => import("@/pages/chiropractors-funnel"));
const CoachesFunnel = lazy(() => import("@/pages/coaches-funnel"));
const EcommerceFunnel = lazy(() => import("@/pages/ecommerce-funnel"));
const PetServicesFunnel = lazy(() => import("@/pages/pet-services-funnel"));
const PhotographyFunnel = lazy(() => import("@/pages/photography-funnel"));
const WeddingFunnel = lazy(() => import("@/pages/wedding-funnel"));
const RealtorsFunnel = lazy(() => import("@/pages/realtors-funnel"));
const HomeServiceFunnel = lazy(() => import("@/pages/home-service-funnel"));
const GymFunnel = lazy(() => import("@/pages/gym-funnel"));
const LuxeFunnel = lazy(() => import("@/pages/luxe-funnel"));
const MarketersFunnel = lazy(() => import("@/pages/marketers-funnel"));

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

function useAutoSaveContact() {
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('share') === 'true') {
      window.location.href = '/contact.vcf';
    }
  }, []);
}

function Router() {
  useAutoSaveContact();
  useFirebaseAnalytics();
  useFirebaseNotifications();
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <PageLoader />;

  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        {/* Public routes — no auth required */}
        <Route path="/DanteS">{() => { window.location.replace("/card/dantes"); return null; }}</Route>
        <Route path="/dantes">{() => { window.location.replace("/card/dantes"); return null; }}</Route>
        <Route path="/card/success" component={CardSuccess} />
        <Route path="/card/edit/:token" component={CardEdit} />
        <Route path="/card/:slug" component={DigitalCard} />
        <Route path="/cards" component={CardsLanding} />
        <Route path="/portal/:token" component={ClientPortal} />
        <Route path="/sentinel/:token" component={ExternalSentinelPage} />
        <Route path="/standalone/card" component={StandaloneCardLanding} />
        <Route path="/standalone/create" component={StandaloneCardCreate} />
        <Route path="/standalone/preview" component={StandaloneCardPreview} />
        <Route path="/standalone/success" component={StandaloneCardSuccess} />
        <Route path="/standalone/upsell" component={StandaloneCardUpsell} />
        <Route path="/standalone/upsell-confirm" component={StandaloneCardUpsellConfirm} />
        <Route path="/standalone/c/:slug" component={StandaloneCardView} />
        <Route path="/standalone/card/:slug" component={StandaloneCardView} />
        <Route path="/standalone/dashboard" component={StandaloneCardDashboard} />
        <Route path="/standalone/edit/:token" component={StandaloneCardEdit} />
        <Route path="/standalone/admin" component={StandaloneCardAdmin} />
        <Route path="/review/:subAccountId" component={ReviewBuffer} />
        <Route path="/login" component={LoginPage} />
        <Route path="/privacy" component={PrivacyPage} />
        <Route path="/terms" component={TermsPage} />
        <Route path="/data-deletion" component={DataDeletionPage} />
        <Route path="/demo" component={NexusDemo} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/gym" component={GymLanding} />
        <Route path="/luxe" component={LuxeLanding} />
        <Route path="/marketers" component={MarketersLanding} />
        <Route path="/realtors" component={RealtorsLanding} />
        <Route path="/home-services" component={HomeServiceLanding} />
        <Route path="/lawyers" component={LawyersLanding} />
        <Route path="/restaurants" component={RestaurantsLanding} />
        <Route path="/dentists" component={DentistsLanding} />
        <Route path="/dental" component={DentistsLanding} />
        <Route path="/medspa" component={MedspaLanding} />
        <Route path="/med-spa" component={MedspaLanding} />
        <Route path="/auto-dealers" component={AutoDealersLanding} />
        <Route path="/auto-detailing" component={AutoDealersLanding} />
        <Route path="/insurance" component={InsuranceLanding} />
        <Route path="/chiropractors" component={ChiropractorsLanding} />
        <Route path="/chiropractic" component={ChiropractorsLanding} />
        <Route path="/coaches" component={CoachesLanding} />
        <Route path="/ecommerce" component={EcommerceLanding} />
        <Route path="/pet-services" component={PetServicesLanding} />
        <Route path="/pet-grooming" component={PetServicesLanding} />
        <Route path="/photography" component={PhotographyLanding} />
        <Route path="/wedding" component={WeddingLanding} />
        <Route path="/hvac" component={HomeServiceLanding} />
        <Route path="/plumbing" component={HomeServiceLanding} />
        <Route path="/roofing" component={HomeServiceLanding} />
        <Route path="/solar" component={HomeServiceLanding} />
        <Route path="/landscaping" component={HomeServiceLanding} />
        <Route path="/pest-control" component={HomeServiceLanding} />
        <Route path="/pressure-washing" component={HomeServiceLanding} />
        <Route path="/junk-removal" component={HomeServiceLanding} />
        <Route path="/electrical" component={HomeServiceLanding} />
        <Route path="/real-estate" component={RealtorsLanding} />
        <Route path="/personal-injury" component={LawyersLanding} />
        <Route path="/niches" component={NicheDirectory} />
        <Route path="/lawyers/funnel" component={LawyersFunnel} />
        <Route path="/restaurants/funnel" component={RestaurantsFunnel} />
        <Route path="/dentists/funnel" component={DentistsFunnel} />
        <Route path="/medspa/funnel" component={MedspaFunnel} />
        <Route path="/auto-dealers/funnel" component={AutoDealersFunnel} />
        <Route path="/insurance/funnel" component={InsuranceFunnel} />
        <Route path="/chiropractors/funnel" component={ChiropractorsFunnel} />
        <Route path="/coaches/funnel" component={CoachesFunnel} />
        <Route path="/ecommerce/funnel" component={EcommerceFunnel} />
        <Route path="/pet-services/funnel" component={PetServicesFunnel} />
        <Route path="/photography/funnel" component={PhotographyFunnel} />
        <Route path="/wedding/funnel" component={WeddingFunnel} />
        <Route path="/realtors/funnel" component={RealtorsFunnel} />
        <Route path="/home-services/funnel" component={HomeServiceFunnel} />
        <Route path="/gym/funnel" component={GymFunnel} />
        <Route path="/luxe/funnel" component={LuxeFunnel} />
        <Route path="/marketers/funnel" component={MarketersFunnel} />

        {/* roomOS billboard — accessible without login */}
        <Route path="/roomos">
          <Suspense fallback={<PageLoader />}>
            <RoomOSPage />
          </Suspense>
        </Route>
        <Route path="/roomos-dashboard">
          <Suspense fallback={<PageLoader />}>
            <RoomOSDashboardPage />
          </Suspense>
        </Route>

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
                  <Route path="/launch-readiness" component={LaunchReadinessPage} />
                  <Route path="/marketplace" component={MarketplacePage} />
                  <Route path="/affiliate" component={AffiliateDashboard} />
                  <Route path="/command-center" component={CommandCenterPage} />
                  <Route path="/apex-intelligence" component={ApexIntelligencePage} />
                  <Route path="/snapshots" component={SnapshotsPage} />
                  <Route path="/sentinel" component={SentinelPage} />
                  <Route path="/crash-reports" component={CrashReportsPage} />
                  <Route path="/property-radar" component={PropertyRadarPage} />
                  <Route path="/website-integration" component={WebsiteIntegration} />
                  <Route path="/form-builder" component={FormBuilder} />
                  <Route path="/analytics" component={AnalyticsPage} />
                  <Route path="/pipeline" component={PipelinePage} />
                  <Route path="/calendar" component={CalendarPage} />
                  <Route path="/email-campaigns" component={EmailCampaignsPage} />
                  <Route path="/digital-card-builder" component={DigitalCardBuilder} />
                  <Route path="/white-label" component={WhiteLabelPage} />
                  <Route path="/webhooks" component={WebhooksPage} />
                  <Route path="/reports" component={ReportsPage} />
                  <Route path="/meta-messaging" component={MetaMessagingPage} />
                  <Route path="/meta-messaging-2027" component={MetaMessaging2027Page} />
                  <Route path="/meta-ops" component={MetaOpsPage} />
                  <Route path="/meta-ads" component={MetaAdsPage} />
                  <Route path="/meta-leads" component={MetaLeadsPage} />
                  <Route path="/instagram-inbox" component={InstagramInboxPage} />
                  <Route path="/account-settings" component={AccountSettingsPage} />
                  <Route path="/integrations" component={IntegrationsPage} />
                  <Route path="/webhook-events" component={WebhookEventsPage} />
                  <Route path="/sponsorship-manager" component={SponsorshipManager} />
                  <Route path="/revenue-command" component={RevenueCommand} />
                  <Route path="/location-search" component={LocationSearchPage} />
                  <Route path="/notification-preferences" component={NotificationPreferencesPage} />
                  <Route path="/ab-testing" component={ABTestingPage} />
                  <Route path="/execution-timeline" component={ExecutionTimelinePage} />
                  <Route path="/whatsapp-templates" component={WhatsAppTemplatesPage} />
                  <Route path="/content-planner" component={ContentPlannerPage} />
                  <Route path="/roomos" component={RoomOSPage} />
                  <Route path="/roomos-dashboard" component={RoomOSDashboardPage} />
                  <Route path="/intelligence" component={IntelligenceDashboardPage} />
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
  const [showSplash, setShowSplash] = useState(() => {
    return !localStorage.getItem("apex_intro_seen");
  });

  useEffect(() => {
    initVibe();
  }, []);

  const handleSplashComplete = () => {
    localStorage.setItem("apex_intro_seen", "true");
    setShowSplash(false);
  };

  return (
    <QueryClientProvider client={queryClient}>
      <AccountProvider>
        <TooltipProvider>
          <Toaster />
          {showSplash && <SplashScreen onComplete={handleSplashComplete} />}
          <Router />
        </TooltipProvider>
      </AccountProvider>
    </QueryClientProvider>
  );
}

export default App;
