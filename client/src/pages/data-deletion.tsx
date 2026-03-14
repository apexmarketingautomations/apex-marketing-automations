import { useState } from "react";
import { Link } from "wouter";

export default function DataDeletion() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    try {
      const res = await fetch("/api/data-deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (data.confirmation_code) {
        setConfirmationCode(data.confirmation_code);
      }
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again or contact support.");
    }
  };

  return (
    <div className="min-h-screen bg-[#030014] text-white" data-testid="data-deletion-page">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <Link href="/" className="text-indigo-400 hover:text-indigo-300 text-sm mb-6 inline-block" data-testid="link-back-home">&larr; Back to Home</Link>
        <h1 className="text-3xl font-bold mb-2" data-testid="text-page-title">User Data Deletion</h1>
        <p className="text-sm text-slate-400 mb-8">Request deletion of your data from Apex Marketing Automations</p>

        {submitted ? (
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-6" data-testid="status-deletion-submitted">
            <h2 className="text-lg font-semibold text-green-400 mb-2">Request Received</h2>
            <p className="text-slate-300 text-sm mb-4">
              Your data deletion request has been submitted. We will process it within 30 days in accordance with applicable privacy laws.
            </p>
            {confirmationCode && (
              <p className="text-slate-300 text-sm mb-4">
                Your confirmation code: <strong className="text-white font-mono" data-testid="text-confirmation-code">{confirmationCode}</strong>
              </p>
            )}
            <p className="text-slate-400 text-xs">
              You will receive a confirmation email once the deletion is complete. If you have questions, contact us at <a href="mailto:support@apexmarketingautomations.com" className="text-indigo-400 hover:underline">support@apexmarketingautomations.com</a>.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4 text-sm text-slate-300 leading-relaxed">
              <section>
                <h2 className="text-lg font-semibold text-white mb-3">What Data We Delete</h2>
                <p>When you request data deletion, we will remove:</p>
                <ul className="list-disc list-inside mt-2 space-y-1 text-slate-400">
                  <li>Your account profile and login credentials</li>
                  <li>Contact records and messaging history</li>
                  <li>Automation and workflow configurations</li>
                  <li>AI bot training data and conversation logs</li>
                  <li>Campaign data and analytics</li>
                  <li>Any data received through Facebook or Instagram integrations</li>
                </ul>
              </section>
              <section>
                <h2 className="text-lg font-semibold text-white mb-3">What We May Retain</h2>
                <p>We may retain certain information as required by law, including:</p>
                <ul className="list-disc list-inside mt-2 space-y-1 text-slate-400">
                  <li>Transaction and billing records (required for tax/legal compliance)</li>
                  <li>Anonymized, aggregated analytics data</li>
                  <li>Records required to comply with legal obligations</li>
                </ul>
              </section>
              <section>
                <h2 className="text-lg font-semibold text-white mb-3">Processing Time</h2>
                <p>Data deletion requests are processed within 30 days. You will receive an email confirmation when the process is complete.</p>
              </section>
            </div>

            <form onSubmit={handleSubmit} className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
              <h2 className="text-lg font-semibold text-white">Submit a Deletion Request</h2>
              <div>
                <label htmlFor="email" className="block text-sm text-slate-300 mb-1">Email address associated with your account</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-2.5 rounded-lg bg-black/40 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm"
                  data-testid="input-email"
                />
              </div>
              {error && <p className="text-red-400 text-sm" data-testid="text-error">{error}</p>}
              <button
                type="submit"
                className="px-6 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors"
                data-testid="button-submit-deletion"
              >
                Request Data Deletion
              </button>
            </form>
          </div>
        )}

        <div className="mt-12 pt-8 border-t border-white/10 text-xs text-slate-500 space-y-2">
          <p>This page is provided in compliance with Meta Platform requirements and applicable privacy regulations.</p>
          <div className="flex gap-4">
            <Link href="/privacy" className="text-indigo-400 hover:underline">Privacy Policy</Link>
            <Link href="/terms" className="text-indigo-400 hover:underline">Terms of Service</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
