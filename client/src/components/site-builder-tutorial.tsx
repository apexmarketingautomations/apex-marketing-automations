import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { SITE_BUILDER_STEPS } from "@/components/tutorial-steps";

const STORAGE_KEY = "apex_site_tutorial_completed";

export function SiteBuilderTutorial({ onClose }: { onClose: () => void }) {
  return (
    <TutorialOverlay
      steps={SITE_BUILDER_STEPS}
      storageKey={STORAGE_KEY}
      onClose={onClose}
      accentColor="indigo"
      finishLabel="Start Building"
    />
  );
}

export function useSiteBuilderTutorial() {
  return useTutorial(STORAGE_KEY);
}
