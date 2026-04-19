import { useEffect, useMemo, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { apiRequest } from "@/lib/queryClient";

interface InventoryResp {
  campaignId: number;
  slug: string;
  name: string;
  total: number;
  remaining: number;
  trialDays: number;
  postTrialAmountCents: number;
  isOpen: boolean;
}

export default function EventSignup() {
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [inventory, setInventory] = useState<InventoryResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Free NFC Card + 30 Days of Apex";
    Promise.all([
      apiRequest("GET", "/api/event/config").then(r => r.json()),
      apiRequest("GET", "/api/event/inventory").then(r => r.json()),
    ]).then(([cfg, inv]) => {
      if (cfg?.publishableKey) setStripePromise(loadStripe(cfg.publishableKey));
      setInventory(inv);
    }).catch(e => console.error("Event config load error:", e))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="min-h-screen bg-black text-white flex items-center justify-center">Loading…</div>;
  }
  if (!inventory) {
    return <div className="min-h-screen bg-black text-white flex items-center justify-center">Campaign unavailable.</div>;
  }
  if (!inventory.isOpen) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-3xl font-bold mb-4">All 50 cards claimed.</h1>
          <p className="text-gray-400 mb-6">The free-card window for this event is closed. Watch for the next one.</p>
          <a href="/pricing" className="inline-block px-6 py-3 bg-cyan-500 text-black font-bold rounded-lg" data-testid="link-pricing">See plans</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-md mx-auto px-5 py-8">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-cyan-500/10 border border-cyan-500/30 rounded-full text-xs uppercase tracking-widest text-cyan-400 mb-4" data-testid="text-inventory">
            {inventory.remaining} of {inventory.total} cards left
          </div>
          <h1 className="text-3xl font-black leading-tight mb-3" data-testid="text-headline">Get a free NFC business card.<br/>Keep it forever.</h1>
          <p className="text-gray-400 text-sm">30 days of Apex on us. The system that makes the card actually work.</p>
        </div>

        <ul className="space-y-2 mb-6 text-sm">
          <li className="flex gap-2"><span className="text-cyan-400">✓</span> Real NFC card mailed to your door — yours to keep no matter what</li>
          <li className="flex gap-2"><span className="text-cyan-400">✓</span> 30 days of full Apex access (lead capture, AI follow-up, booking)</li>
          <li className="flex gap-2"><span className="text-cyan-400">✓</span> One tap shares your contact AND tells you who's interested</li>
          <li className="flex gap-2"><span className="text-cyan-400">✓</span> Cancel in two clicks. No retention calls.</li>
        </ul>

        {stripePromise ? (
          <Elements stripe={stripePromise} options={{ appearance: { theme: "night" } }}>
            <SignupForm inventory={inventory} />
          </Elements>
        ) : (
          <div className="text-red-400 text-sm">Payment system unavailable. Try again in a moment.</div>
        )}

        <p className="text-[10px] text-gray-500 mt-6 leading-relaxed">
          We validate your card on file via Stripe so we can ship and so your account is ready when the trial ends.
          On day 31, your card is charged ${(inventory.postTrialAmountCents / 100).toFixed(0)}/month for the Starter plan
          unless you cancel before then. We send reminders on day 23 and day 28. Cancel anytime in your dashboard.
          Your NFC card is yours to keep regardless.
        </p>
      </div>
    </div>
  );
}

function SignupForm({ inventory }: { inventory: InventoryResp }) {
  const stripe = useStripe();
  const elements = useElements();
  const [step, setStep] = useState<"info" | "card" | "done">("info");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [setupIntentId, setSetupIntentId] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: "", email: "",
    shippingStreet: "", shippingCity: "", shippingState: "", shippingZip: "",
  });

  const canSubmitInfo = useMemo(() =>
    form.fullName.trim().length >= 2 &&
    /\S+@\S+\.\S+/.test(form.email) &&
    form.shippingStreet.trim().length > 2 &&
    form.shippingCity.trim().length > 0 &&
    form.shippingState.trim().length > 0 &&
    form.shippingZip.trim().length >= 3,
    [form]
  );

  async function handleSubmitInfo(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmitInfo) return;
    setSubmitting(true); setError(null);
    try {
      const r = await apiRequest("POST", "/api/event/signup", { ...form, shippingCountry: "US" });
      const data = await r.json();
      if (!data?.clientSecret) throw new Error(data?.error || "Signup failed");
      setClientSecret(data.clientSecret);
      setSetupIntentId(data.setupIntentId);
      setStep("card");
    } catch (err: any) {
      setError(err?.message || "Signup failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmCard() {
    if (!stripe || !elements || !clientSecret) return;
    setSubmitting(true); setError(null);
    try {
      const { error: stripeErr, setupIntent } = await stripe.confirmSetup({
        elements,
        clientSecret,
        confirmParams: { return_url: window.location.origin + "/event?completed=1" },
        redirect: "if_required",
      });
      if (stripeErr) throw new Error(stripeErr.message || "Card validation failed");
      if (!setupIntent || setupIntent.status !== "succeeded") throw new Error("Card validation incomplete");

      const r = await apiRequest("POST", "/api/event/finalize", { setupIntentId: setupIntentId || setupIntent.id });
      const data = await r.json();
      if (!data?.ok) throw new Error(data?.error || "Finalize failed");
      setStep("done");
    } catch (err: any) {
      setError(err?.message || "Card validation failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "done") {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6 text-center">
        <div className="text-4xl mb-3">✅</div>
        <h2 className="text-xl font-bold mb-2" data-testid="text-success-headline">You're in.</h2>
        <p className="text-sm text-gray-300 mb-1">Your trial is active. The operator will program your card now.</p>
        <p className="text-xs text-gray-500">Check your email for your dashboard link.</p>
      </div>
    );
  }

  if (step === "card") {
    return (
      <div className="bg-white/5 rounded-2xl p-5 border border-white/10">
        <h2 className="text-lg font-bold mb-3">Add card on file</h2>
        <p className="text-xs text-gray-400 mb-4">$0 today. Stripe verifies the card so we can ship.</p>
        <PaymentElement options={{ layout: "tabs" }} />
        {error && <p className="text-red-400 text-sm mt-3" data-testid="text-error">{error}</p>}
        <button
          onClick={handleConfirmCard}
          disabled={!stripe || submitting}
          className="w-full mt-4 py-3 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black font-bold rounded-lg"
          data-testid="button-confirm-card"
        >
          {submitting ? "Validating…" : "Validate & start trial"}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmitInfo} className="space-y-3 bg-white/5 rounded-2xl p-5 border border-white/10">
      <Field label="Full name">
        <input type="text" required value={form.fullName} onChange={e => setForm({...form, fullName: e.target.value})}
          className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white"
          data-testid="input-fullname" autoComplete="name" />
      </Field>
      <Field label="Email">
        <input type="email" required value={form.email} onChange={e => setForm({...form, email: e.target.value})}
          className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white"
          data-testid="input-email" autoComplete="email" />
      </Field>
      <Field label="Shipping address">
        <input type="text" required placeholder="Street" value={form.shippingStreet}
          onChange={e => setForm({...form, shippingStreet: e.target.value})}
          className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white"
          data-testid="input-street" autoComplete="street-address" />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <input type="text" required placeholder="City" value={form.shippingCity}
          onChange={e => setForm({...form, shippingCity: e.target.value})}
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white col-span-2"
          data-testid="input-city" autoComplete="address-level2" />
        <input type="text" required placeholder="State" value={form.shippingState}
          onChange={e => setForm({...form, shippingState: e.target.value.toUpperCase().slice(0, 2)})}
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white"
          data-testid="input-state" autoComplete="address-level1" maxLength={2} />
      </div>
      <input type="text" required placeholder="ZIP" value={form.shippingZip}
        onChange={e => setForm({...form, shippingZip: e.target.value})}
        className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white"
        data-testid="input-zip" autoComplete="postal-code" />
      {error && <p className="text-red-400 text-sm" data-testid="text-error">{error}</p>}
      <button type="submit" disabled={!canSubmitInfo || submitting}
        className="w-full mt-2 py-3 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black font-bold rounded-lg"
        data-testid="button-continue">
        {submitting ? "Reserving card…" : "Continue to payment validation"}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-widest text-gray-500 mb-1">{label}</div>
      {children}
    </label>
  );
}
