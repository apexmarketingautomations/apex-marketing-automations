import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Star, Loader2, Send, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Phase = "select" | "thankyou" | "redirect" | "feedback" | "submitted";

export default function ReviewBuffer() {
  const params = useParams<{ subAccountId: string }>();
  const subAccountId = parseInt(params.subAccountId || "1", 10);
  const [phase, setPhase] = useState<Phase>("select");
  const [hoveredStar, setHoveredStar] = useState(0);
  const [selectedRating, setSelectedRating] = useState(0);
  const [businessName, setBusinessName] = useState("");
  const [googleLink, setGoogleLink] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/review-config/${subAccountId}`)
      .then((r) => r.json())
      .then((data) => {
        setBusinessName(data.name || "Our Business");
        setGoogleLink(data.googleReviewLink || "");
      })
      .catch(() => {});
  }, [subAccountId]);

  const handleStarClick = (rating: number) => {
    setSelectedRating(rating);
    if (rating >= 4) {
      setPhase("thankyou");
      setTimeout(() => {
        if (googleLink) {
          setPhase("redirect");
          setTimeout(() => {
            window.location.href = googleLink;
          }, 500);
        } else {
          setPhase("redirect");
        }
      }, 1500);
    } else {
      setPhase("feedback");
    }
  };

  const handleSubmitFeedback = async () => {
    if (!name.trim() || !comment.trim()) return;
    setSubmitting(true);
    try {
      await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subAccountId,
          rating: selectedRating,
          comment: comment.trim(),
          customerName: name.trim(),
          customerEmail: email.trim() || null,
          isPublic: false,
        }),
      });

      await fetch("/api/alert-owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subAccountId,
          customerName: name.trim(),
          rating: selectedRating,
          comment: comment.trim(),
        }),
      });

      setPhase("submitted");
    } catch {
      setPhase("submitted");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-gradient-to-b from-indigo-900/10 to-transparent pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-lg"
      >
        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-white mb-1" data-testid="text-business-name">{businessName}</h1>
            <p className="text-sm text-slate-400">We'd love to hear your feedback</p>
          </div>

          <AnimatePresence mode="wait">
            {phase === "select" && (
              <motion.div
                key="select"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="text-center"
              >
                <p className="text-slate-300 mb-6 text-sm">How was your experience?</p>
                <div className="flex justify-center gap-3" data-testid="star-selector">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button
                      key={s}
                      onMouseEnter={() => setHoveredStar(s)}
                      onMouseLeave={() => setHoveredStar(0)}
                      onClick={() => handleStarClick(s)}
                      className="transition-transform hover:scale-125 focus:outline-none"
                      data-testid={`button-star-${s}`}
                    >
                      <Star
                        size={48}
                        className={`transition-colors ${
                          s <= (hoveredStar || selectedRating)
                            ? "text-yellow-400 fill-yellow-400 drop-shadow-[0_0_12px_rgba(250,204,21,0.5)]"
                            : "text-white/20"
                        }`}
                      />
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-600 mt-4">Tap a star to rate</p>
              </motion.div>
            )}

            {phase === "thankyou" && (
              <motion.div
                key="thankyou"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                className="text-center py-8"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", bounce: 0.5 }}
                >
                  <CheckCircle2 size={64} className="mx-auto text-emerald-400 mb-4" />
                </motion.div>
                <h2 className="text-2xl font-bold text-white mb-2" data-testid="text-thankyou">Thank you!</h2>
                <p className="text-slate-400 text-sm">Redirecting you to leave a review...</p>
              </motion.div>
            )}

            {phase === "redirect" && (
              <motion.div
                key="redirect"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-8"
              >
                <CheckCircle2 size={64} className="mx-auto text-emerald-400 mb-4" />
                {googleLink ? (
                  <>
                    <h2 className="text-2xl font-bold text-white mb-2">Redirecting...</h2>
                    <Loader2 className="mx-auto text-indigo-400 animate-spin mt-4" size={24} />
                  </>
                ) : (
                  <>
                    <h2 className="text-2xl font-bold text-white mb-2" data-testid="text-thankyou-final">Thank you for your feedback!</h2>
                    <p className="text-slate-400 text-sm">We really appreciate you taking the time to share your experience.</p>
                  </>
                )}
              </motion.div>
            )}

            {phase === "feedback" && (
              <motion.div
                key="feedback"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-4"
              >
                <div className="text-center mb-4">
                  <p className="text-slate-300 text-sm">We're sorry to hear that. Please share your feedback — it goes directly to our manager.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Your Name *</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John Smith"
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
                    data-testid="input-feedback-name"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Email (optional)</label>
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="john@email.com"
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
                    data-testid="input-feedback-email"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">What happened? *</label>
                  <Textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Tell us about your experience..."
                    rows={4}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/20 resize-none"
                    data-testid="input-feedback-comment"
                  />
                </div>

                <Button
                  onClick={handleSubmitFeedback}
                  disabled={submitting || !name.trim() || !comment.trim()}
                  className="w-full py-5 bg-indigo-600 hover:bg-indigo-500 font-bold"
                  data-testid="button-submit-feedback"
                >
                  {submitting ? (
                    <><Loader2 size={16} className="animate-spin mr-2" /> Submitting...</>
                  ) : (
                    <><Send size={16} className="mr-2" /> Submit Feedback</>
                  )}
                </Button>
              </motion.div>
            )}

            {phase === "submitted" && (
              <motion.div
                key="submitted"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-8"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", bounce: 0.5 }}
                >
                  <CheckCircle2 size={64} className="mx-auto text-emerald-400 mb-4" />
                </motion.div>
                <h2 className="text-xl font-bold text-white mb-2" data-testid="text-submitted">Thank you for your feedback</h2>
                <p className="text-slate-400 text-sm">Our manager has been notified personally.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}