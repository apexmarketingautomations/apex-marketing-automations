import { useState, useEffect } from "react";
import { Link } from "wouter";
import { X } from "lucide-react";

const BLITZ_END_DATE = new Date("2026-03-18T23:59:59Z");

export function BlitzBanner() {
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem("blitz-dismissed") === "true");
  const [daysLeft, setDaysLeft] = useState(0);

  useEffect(() => {
    const now = new Date();
    const diff = BLITZ_END_DATE.getTime() - now.getTime();
    setDaysLeft(Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24))));
  }, []);

  if (dismissed || daysLeft <= 0) return null;

  return (
    <div className="bg-gradient-to-r from-red-600 via-purple-600 to-cyan-500 p-[1px]" data-testid="banner-blitz">
      <div className="bg-black py-2 px-4 flex justify-between items-center">
        <span className="text-[10px] font-black tracking-[0.3em] text-white">
          APEX BLITZ: 50% OFF FOR LIFE (ENDS IN {daysLeft} DAYS)
        </span>
        <div className="flex items-center gap-3">
          <Link href="/pricing" className="text-[10px] font-bold text-cyan-400 hover:text-white underline uppercase">
            Claim Grandfather Status
          </Link>
          <button
            onClick={() => { setDismissed(true); sessionStorage.setItem("blitz-dismissed", "true"); }}
            className="text-gray-500 hover:text-white"
            data-testid="button-dismiss-blitz"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
