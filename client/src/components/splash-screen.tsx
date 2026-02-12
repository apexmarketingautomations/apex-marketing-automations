import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useRef } from "react";
import splashVideo from "@assets/hf_20260212_053602_1d87d9a1-2de4-416b-a5b3-d9e3a978abe8_1770934573069.mp4";

export function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [isVisible, setIsVisible] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnded = () => {
      setIsVisible(false);
      setTimeout(onComplete, 600);
    };

    const handleError = () => {
      setIsVisible(false);
      setTimeout(onComplete, 300);
    };

    video.addEventListener("ended", handleEnded);
    video.addEventListener("error", handleError);

    const fallbackTimer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onComplete, 600);
    }, 30000);

    return () => {
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
      clearTimeout(fallbackTimer);
    };
  }, [onComplete]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: "easeInOut" }}
          className="fixed inset-0 z-[100] bg-black"
          data-testid="splash-screen"
        >
          <video
            ref={videoRef}
            src={splashVideo}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
