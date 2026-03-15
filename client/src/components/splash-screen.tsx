import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useRef, useCallback } from "react";
import splashVideo from "@assets/hf_20260212_053602_1d87d9a1-2de4-416b-a5b3-d9e3a978abe8_1770934573069.mp4";

export function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [isVisible, setIsVisible] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  const dismiss = useCallback(() => {
    setIsVisible(false);
    setTimeout(onComplete, 300);
  }, [onComplete]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      dismiss();
      return;
    }

    video.addEventListener("ended", dismiss);
    video.addEventListener("error", dismiss);

    const fallbackTimer = setTimeout(dismiss, 8000);

    return () => {
      video.removeEventListener("ended", dismiss);
      video.removeEventListener("error", dismiss);
      clearTimeout(fallbackTimer);
    };
  }, [dismiss]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
          className="fixed inset-0 z-[100] bg-black cursor-pointer"
          onClick={dismiss}
          data-testid="splash-screen"
        >
          <video
            ref={videoRef}
            src={splashVideo}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover pointer-events-none"
          />
          <div className="absolute bottom-8 left-0 right-0 text-center">
            <span className="text-white/50 text-sm animate-pulse">Tap anywhere to skip</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
