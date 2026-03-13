import { motion } from "framer-motion";
import { Sparkles, Zap, MessageSquare, Bot, Globe, Phone, BarChart3, ArrowRight, Mail, Lock, User, Eye, EyeOff, Loader2, Flame } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { signInWithGoogle as firebaseSignInWithGoogle, getFirebaseIdToken } from "@/lib/firebase";

const FEATURES = [
  { icon: MessageSquare, title: "Unified Inbox", desc: "SMS, Instagram, WhatsApp & Messenger in one place" },
  { icon: Bot, title: "AI Voice Agent", desc: "Deploy AI receptionists that handle calls 24/7" },
  { icon: Globe, title: "AI Site Builder", desc: "Generate stunning landing pages with one click" },
  { icon: Phone, title: "Smart Dialer", desc: "Power dial leads with AI-powered conversations" },
  { icon: BarChart3, title: "Usage & Billing", desc: "Track every SMS, call, and AI interaction" },
  { icon: Zap, title: "God Mode", desc: "One-click empire builder — deploy everything at once" },
];

export default function Login() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [firebaseLoading, setFirebaseLoading] = useState(false);
  const [error, setError] = useState("");

  const idleLogout = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("reason") === "idle";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint = mode === "login" ? "/api/auth/email-login" : "/api/auth/register";
      const body = mode === "login"
        ? { email, password }
        : { email, password, firstName, lastName };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Something went wrong");
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      navigate("/");
    } catch (err) {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleFirebaseLogin() {
    setError("");
    setFirebaseLoading(true);
    try {
      await firebaseSignInWithGoogle();
      const idToken = await getFirebaseIdToken();
      if (!idToken) {
        setError("Failed to get Firebase credentials");
        return;
      }
      const res = await fetch("/api/auth/firebase-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ idToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Firebase login failed");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      navigate("/");
    } catch (err: any) {
      if (err?.code === "auth/popup-closed-by-user") return;
      setError("Firebase login failed. Please try again.");
    } finally {
      setFirebaseLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex relative overflow-hidden" style={{ backgroundColor: "#030014" }}>
      <div className="absolute inset-0 bg-grid z-0 pointer-events-none" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-to-b from-indigo-600/20 via-purple-600/10 to-transparent rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-gradient-to-t from-cyan-600/10 to-transparent rounded-full blur-3xl pointer-events-none" />

      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative z-10">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 mb-8">
            <Sparkles size={12} /> APEX MARKETING AUTOMATIONS
          </div>
          <h1 className="text-5xl font-black text-white tracking-tight leading-tight mb-4" data-testid="text-login-title">
            Your AI-Powered
            <br />
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              Business Command Center
            </span>
          </h1>
          <p className="text-lg text-slate-400 max-w-md">
            Manage communications, deploy AI agents, build websites, and automate workflows — all from one platform.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="grid grid-cols-2 gap-3 mt-8"
        >
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.08 }}
              className="flex items-start gap-3 p-3 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
                <f.icon size={14} className="text-indigo-400" />
              </div>
              <div>
                <p className="text-xs font-bold text-white/80">{f.title}</p>
                <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{f.desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>

        <p className="text-xs text-slate-600 mt-8">&copy; {new Date().getFullYear()} Apex Marketing Automations. All rights reserved.</p>
      </div>

      <div className="flex-1 flex items-center justify-center relative z-10 p-8">
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 mb-4">
              <Sparkles size={12} /> APEX MARKETING AUTOMATIONS
            </div>
            <h1 className="text-3xl font-black text-white tracking-tight">
              AI-Powered <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Command Center</span>
            </h1>
          </div>

          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl shadow-indigo-500/5">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-white mb-2" data-testid="text-auth-heading">
                {mode === "login" ? "Welcome Back" : "Create Account"}
              </h2>
              <p className="text-sm text-slate-400">
                {mode === "login" ? "Sign in to your Apex account" : "Start your free Apex account"}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "register" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="relative">
                    <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      placeholder="First name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/25 transition-all"
                      data-testid="input-first-name"
                    />
                  </div>
                  <div className="relative">
                    <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      placeholder="Last name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/25 transition-all"
                      data-testid="input-last-name"
                    />
                  </div>
                </div>
              )}

              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/25 transition-all"
                  data-testid="input-email"
                />
              </div>

              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full pl-10 pr-12 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/25 transition-all"
                  data-testid="input-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {idleLogout && !error && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-2"
                  data-testid="text-idle-logout-notice"
                >
                  You were logged out due to inactivity. Please sign in again.
                </motion.div>
              )}

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2"
                  data-testid="text-auth-error"
                >
                  {error}
                </motion.div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-3 text-sm shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
                data-testid="button-submit-auth"
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <>
                    {mode === "login" ? "Sign In" : "Create Account"}
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>

            <div className="mt-5 flex items-center gap-3">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-slate-500">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            <a
              href="/api/auth/google"
              className="mt-4 w-full py-3 border border-white/10 bg-white/5 hover:bg-white/10 text-white/80 font-medium rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
              data-testid="button-google-login"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </a>

            <button
              onClick={handleFirebaseLogin}
              disabled={firebaseLoading}
              className="mt-3 w-full py-3 border border-orange-500/30 bg-orange-500/10 hover:bg-orange-500/20 text-orange-300 font-medium rounded-xl transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
              data-testid="button-firebase-login"
            >
              {firebaseLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Flame className="w-4 h-4" />
              )}
              Continue with Firebase
            </button>

            <div className="mt-5 text-center">
              <button
                onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
                className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
                data-testid="button-toggle-mode"
              >
                {mode === "login" ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
              </button>
            </div>

            <p className="text-[10px] text-slate-600 text-center mt-4">
              Free forever plan. No credit card required.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
