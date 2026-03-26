import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2, CheckCircle, AlertTriangle } from "lucide-react";
import { trackEvent } from "../lib/analytics";

export default function StandaloneCardUpsellConfirm() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id") || "";
    const upsellSessionId = params.get("upsell_session_id") || "";

    if (!sessionId || !upsellSessionId) {
      setLocation("/standalone/card");
      return;
    }

    const fulfill = async () => {
      try {
        const res = await fetch(
          `/api/standalone/upsell-fulfill/${upsellSessionId}?original_session_id=${sessionId}`
        );
        const data = await res.json();
        if (data.fulfilled) {
          trackEvent("purchase_completed", { type: "pro_bundle" });
          setStatus("success");
          setTimeout(() => {
            setLocation(`/standalone/success?session_id=${sessionId}`);
          }, 2000);
        } else {
          let attempts = 0;
          const poll = setInterval(async () => {
            attempts++;
            try {
              const r2 = await fetch(
                `/api/standalone/upsell-fulfill/${upsellSessionId}?original_session_id=${sessionId}`
              );
              const d2 = await r2.json();
              if (d2.fulfilled) {
                clearInterval(poll);
                trackEvent("purchase_completed", { type: "pro_bundle" });
                setStatus("success");
                setTimeout(() => {
                  setLocation(`/standalone/success?session_id=${sessionId}`);
                }, 2000);
              } else if (attempts >= 10) {
                clearInterval(poll);
                setStatus("error");
              }
            } catch {
              if (attempts >= 10) {
                clearInterval(poll);
                setStatus("error");
              }
            }
          }, 2000);
        }
      } catch {
        setStatus("error");
      }
    };
    fulfill();
  }, [setLocation]);

  return (
    <div className="min-h-screen bg-[#09090b] text-white flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        {status === "verifying" && (
          <>
            <Loader2 className="w-12 h-12 text-cyan-400 animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Verifying Your Upgrade...</h2>
            <p className="text-neutral-400 text-sm">Confirming payment and activating Pro features.</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Pro Bundle Activated!</h2>
            <p className="text-neutral-400 text-sm">Your card has been upgraded. Redirecting...</p>
          </>
        )}
        {status === "error" && (
          <>
            <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Verification Issue</h2>
            <p className="text-neutral-400 text-sm mb-4">
              We're still processing your payment. Your upgrade will be applied shortly.
            </p>
            <button
              onClick={() => {
                const params = new URLSearchParams(window.location.search);
                setLocation(`/standalone/success?session_id=${params.get("session_id") || ""}`);
              }}
              className="px-6 py-3 bg-cyan-500 hover:bg-cyan-400 rounded-xl font-bold transition"
            >
              Continue to Your Card
            </button>
          </>
        )}
      </div>
    </div>
  );
}
