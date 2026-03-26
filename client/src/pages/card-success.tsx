import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Check, Copy, ExternalLink, Loader2, Mail, Edit3 } from "lucide-react";

export default function CardSuccess() {
  const [status, setStatus] = useState<"processing" | "complete" | "error">("processing");
  const [card, setCard] = useState<any>(null);
  const [editToken, setEditToken] = useState<string>("");
  const [slug, setSlug] = useState<string>("");
  const [copiedCard, setCopiedCard] = useState(false);
  const [copiedEdit, setCopiedEdit] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (!sessionId) { setStatus("error"); return; }

    let attempts = 0;
    const poll = () => {
      fetch(`/api/card/session/${sessionId}`)
        .then(r => r.json())
        .then(data => {
          if (data.status === "complete") {
            setCard(data.card);
            setEditToken(data.editToken || "");
            setSlug(data.slug || "");
            setStatus("complete");
          } else if (attempts < 20) {
            attempts++;
            setTimeout(poll, 2000);
          } else {
            setStatus("error");
          }
        })
        .catch(() => {
          if (attempts < 20) { attempts++; setTimeout(poll, 2000); }
          else setStatus("error");
        });
    };
    poll();
  }, []);

  const baseUrl = window.location.origin;
  const cardUrl = `${baseUrl}/card/${slug}`;
  const editUrl = `${baseUrl}/card/edit/${editToken}`;

  const copy = (text: string, setter: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  if (status === "processing") {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center p-8">
          <Loader2 size={40} className="text-indigo-400 animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Setting up your card...</h2>
          <p className="text-slate-400 text-sm">This will only take a moment</p>
        </motion.div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center p-8 max-w-md">
          <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
          <p className="text-slate-400 text-sm mb-4">Your payment was received. Please check your email for your card details, or contact support.</p>
          <button onClick={() => window.location.reload()} className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold" data-testid="button-retry">
            Try Again
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4" data-testid="card-success-page">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center mx-auto mb-4">
            <Check size={28} className="text-green-400" />
          </div>
          <h1 className="text-3xl font-black text-white mb-2" data-testid="text-success-title">Your Card is Live!</h1>
          <p className="text-slate-400">Your digital business card is ready to share</p>
        </div>

        <div className="space-y-4">
          <div className="p-5 rounded-2xl bg-white/[0.04] border border-white/[0.08]">
            <div className="flex items-center gap-2 mb-3">
              <ExternalLink size={16} className="text-indigo-400" />
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Your Card URL</p>
            </div>
            <div className="flex items-center gap-2">
              <p className="flex-1 text-sm text-white font-mono truncate bg-black/30 px-3 py-2 rounded-lg" data-testid="text-card-url">{cardUrl}</p>
              <button onClick={() => copy(cardUrl, setCopiedCard)}
                className={`px-3 py-2 rounded-lg text-xs font-bold shrink-0 ${copiedCard ? "bg-green-500/20 text-green-400" : "bg-indigo-500/20 text-indigo-400"}`}
                data-testid="button-copy-card-url">
                {copiedCard ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            <a href={cardUrl} target="_blank" rel="noopener noreferrer"
              className="mt-3 w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-bold flex items-center justify-center gap-2 hover:from-indigo-500 hover:to-purple-500 transition-all"
              data-testid="link-view-card">
              <ExternalLink size={14} /> View Your Card
            </a>
          </div>

          <div className="p-5 rounded-2xl bg-white/[0.04] border border-white/[0.08]">
            <div className="flex items-center gap-2 mb-3">
              <Edit3 size={16} className="text-amber-400" />
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Edit Link (bookmark this!)</p>
            </div>
            <div className="flex items-center gap-2">
              <p className="flex-1 text-sm text-white font-mono truncate bg-black/30 px-3 py-2 rounded-lg" data-testid="text-edit-url">{editUrl}</p>
              <button onClick={() => copy(editUrl, setCopiedEdit)}
                className={`px-3 py-2 rounded-lg text-xs font-bold shrink-0 ${copiedEdit ? "bg-green-500/20 text-green-400" : "bg-indigo-500/20 text-indigo-400"}`}
                data-testid="button-copy-edit-url">
                {copiedEdit ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
              <Mail size={12} /> This link was also sent to your email. No login needed.
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-slate-600 mt-8">
          Need help? Contact support@apexmarketingautomations.com
        </p>
      </motion.div>
    </div>
  );
}
