import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Loader2, Lock, Eye, EyeOff, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";

export default function SetupAccount() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const token = params?.get("token") || "";

  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountFirstName, setAccountFirstName] = useState("");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!token) {
        setChecking(false);
        setValid(false);
        return;
      }
      try {
        const res = await fetch(`/api/auth/setup-account/check?token=${encodeURIComponent(token)}`, { credentials: "include" });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (json.valid) {
          setValid(true);
          setAccountEmail(json.email || "");
          setAccountFirstName(json.firstName || "");
        } else {
          setValid(false);
        }
      } catch {
        if (!cancelled) setValid(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    void check();
    return () => { cancelled = true; };
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      setError("Password needs an uppercase letter, lowercase letter, and a number");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/setup-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.message || "Setup failed");
        setSubmitting(false);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      navigate("/");
    } catch {
      setError("Network error — please try again");
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#070710]">
        <Loader2 className="text-indigo-400 animate-spin" size={32} />
      </div>
    );
  }

  if (!valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#070710] px-4">
        <div className="max-w-md w-full bg-white/[0.03] border border-white/10 rounded-2xl p-8 text-center">
          <AlertCircle className="text-red-400 mx-auto mb-4" size={48} />
          <h1 className="text-2xl font-bold text-white mb-2">Setup link not valid</h1>
          <p className="text-slate-400 text-sm mb-6">
            This link may have already been used or expired. If you believe this is a mistake, contact support.
          </p>
          <button
            onClick={() => navigate("/login")}
            className="text-indigo-400 hover:text-indigo-300 text-sm font-medium"
            data-testid="button-go-to-login"
          >
            Go to log in →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#070710] px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white/[0.03] border border-white/10 rounded-2xl p-8"
      >
        <div className="flex items-center gap-2 text-indigo-400 mb-2">
          <Sparkles size={18} />
          <span className="text-xs font-bold tracking-wider uppercase">Welcome to Apex</span>
        </div>
        <h1 className="text-3xl font-bold text-white mb-2" data-testid="heading-welcome">
          {accountFirstName ? `Hi ${accountFirstName}` : "Set up your account"}
        </h1>
        <p className="text-slate-400 text-sm mb-1">
          Your subscription is already paid and active.
        </p>
        <p className="text-slate-300 text-sm mb-6">
          Just choose a password and you're in.
        </p>

        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 mb-5 flex items-center gap-2">
          <CheckCircle2 className="text-emerald-400 flex-shrink-0" size={16} />
          <span className="text-sm text-emerald-300 font-medium" data-testid="text-account-email">{accountEmail}</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs text-slate-300 mb-1 block">Choose a password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 pl-10 pr-10 text-sm text-white focus:outline-none focus:border-indigo-500"
                placeholder="At least 8 characters"
                required
                autoComplete="new-password"
                data-testid="input-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                tabIndex={-1}
                data-testid="button-toggle-password"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-300 mb-1 block">Confirm password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
              <input
                type={showPassword ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 pl-10 pr-3 text-sm text-white focus:outline-none focus:border-indigo-500"
                placeholder="Re-enter your password"
                required
                autoComplete="new-password"
                data-testid="input-confirm-password"
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-red-300" data-testid="text-error">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            data-testid="button-submit-setup"
          >
            {submitting ? (
              <><Loader2 className="animate-spin" size={16} /> Activating…</>
            ) : (
              "Activate my account"
            )}
          </button>
        </form>

        <p className="text-[10px] text-slate-500 mt-4 text-center">
          Password must include an uppercase letter, lowercase letter, and a number.
        </p>
      </motion.div>
    </div>
  );
}
