import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, Copy, ExternalLink, Loader2, Shield, Sparkles, MessageSquare, ThumbsUp, ThumbsDown, Eye, EyeOff, Save, BookOpen } from "lucide-react";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { REPUTATION_STEPS } from "@/components/tutorial-steps";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const SUB_ACCOUNT_ID = 1;

function StarDisplay({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          size={size}
          className={s <= rating ? "text-yellow-400 fill-yellow-400" : "text-white/20"}
        />
      ))}
    </div>
  );
}

export default function Reputation() {
  const { showTutorial, startTutorial, closeTutorial } = useTutorial("apex_tutorial_reputation");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [googleLink, setGoogleLink] = useState("");
  const [trustpilotLink, setTrustpilotLink] = useState("");
  const [linksLoaded, setLinksLoaded] = useState(false);
  const [generatingAi, setGeneratingAi] = useState<number | null>(null);

  const { data: reviews = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/reviews", SUB_ACCOUNT_ID],
    queryFn: async () => {
      const res = await fetch(`/api/reviews/${SUB_ACCOUNT_ID}`);
      if (!res.ok) throw new Error("Failed to fetch reviews");
      return res.json();
    },
  });

  const { data: config } = useQuery<{ googleReviewLink: string; trustpilotLink: string; name: string }>({
    queryKey: ["/api/review-config", SUB_ACCOUNT_ID],
    queryFn: async () => {
      const res = await fetch(`/api/review-config/${SUB_ACCOUNT_ID}`);
      if (!res.ok) throw new Error("Failed to fetch config");
      return res.json();
    },
    onSuccess: (data: any) => {
      if (!linksLoaded) {
        setGoogleLink(data.googleReviewLink || "");
        setTrustpilotLink(data.trustpilotLink || "");
        setLinksLoaded(true);
      }
    },
  } as any);

  const saveConfigMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/review-config/${SUB_ACCOUNT_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleReviewLink: googleLink, trustpilotLink }),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Review links updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/review-config", SUB_ACCOUNT_ID] });
    },
  });

  const togglePublicMutation = useMutation({
    mutationFn: async ({ id, isPublic }: { id: number; isPublic: boolean }) => {
      const res = await fetch(`/api/reviews/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reviews", SUB_ACCOUNT_ID] });
    },
  });

  const handleGenerateAi = async (reviewId: number, comment: string, customerName: string) => {
    setGeneratingAi(reviewId);
    try {
      const aiRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: `A customer named ${customerName} left this negative review: "${comment}". Write a brief, professional, empathetic response apologizing and offering to resolve their issue. Keep it under 3 sentences.`,
            },
          ],
        }),
      });

      let aiText = "";
      if (aiRes.ok) {
        const data = await aiRes.json();
        aiText = data.choices?.[0]?.message?.content || data.response || data.message || "Thank you for your feedback. We sincerely apologize for your experience and would love to make it right. Please reach out to us directly so we can resolve this for you.";
      } else {
        aiText = "Thank you for your feedback. We sincerely apologize for your experience and would love to make it right. Please reach out to us directly so we can resolve this for you.";
      }

      await fetch(`/api/reviews/${reviewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiResponse: aiText }),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/reviews", SUB_ACCOUNT_ID] });
      toast({ title: "AI Response Generated", description: "Response has been saved to the review." });
    } catch {
      toast({ title: "Error", description: "Failed to generate AI response.", variant: "destructive" });
    } finally {
      setGeneratingAi(null);
    }
  };

  const totalReviews = reviews.length;
  const avgRating = totalReviews > 0 ? reviews.reduce((sum: number, r: any) => sum + r.rating, 0) / totalReviews : 0;
  const positiveCount = reviews.filter((r: any) => r.rating >= 4).length;
  const negativeCount = reviews.filter((r: any) => r.rating <= 3).length;

  const reviewLink = `${window.location.origin}/review/${SUB_ACCOUNT_ID}`;

  const copyLink = () => {
    navigator.clipboard.writeText(reviewLink);
    toast({ title: "Copied!", description: "Review link copied to clipboard." });
  };

  return (
    <div className="flex-1 p-6 md:p-10 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-yellow-500/30 bg-yellow-500/10 text-yellow-400 mb-4">
            <Star size={12} /> REPUTATION MANAGER
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl md:text-4xl font-black tracking-tight" data-testid="text-reputation-title">
              Review <span className="bg-gradient-to-r from-yellow-400 via-orange-400 to-red-400 bg-clip-text text-transparent">Dashboard</span>
            </h1>
            <Button variant="ghost" size="sm" onClick={startTutorial} className="text-slate-400 hover:text-white" data-testid="button-start-tutorial">
              <BookOpen size={16} className="mr-1" /> Tutorial
            </Button>
          </div>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total Reviews", value: totalReviews, icon: MessageSquare, color: "text-indigo-400" },
            { label: "Avg Rating", value: avgRating.toFixed(1), icon: Star, color: "text-yellow-400", extra: <StarDisplay rating={Math.round(avgRating)} size={12} /> },
            { label: "Positive", value: positiveCount, icon: ThumbsUp, color: "text-emerald-400" },
            { label: "Negative", value: negativeCount, icon: ThumbsDown, color: "text-red-400" },
          ].map((stat, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
              <Card className="bg-white/5 border-white/10 p-4" data-testid={`stat-card-${i}`}>
                <div className="flex items-center gap-2 mb-2">
                  <stat.icon size={16} className={stat.color} />
                  <span className="text-xs text-slate-400 font-medium">{stat.label}</span>
                </div>
                <div className="text-2xl font-black text-white">{stat.value}</div>
                {stat.extra && <div className="mt-1">{stat.extra}</div>}
              </Card>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card className="bg-white/5 border-white/10 p-5">
            <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
              <ExternalLink size={14} className="text-indigo-400" /> Google Review Link
            </h3>
            <div className="flex gap-2">
              <Input
                value={googleLink}
                onChange={(e) => setGoogleLink(e.target.value)}
                placeholder="https://g.page/r/..."
                className="bg-white/5 border-white/10 text-white placeholder:text-white/20 flex-1"
                data-testid="input-google-review-link"
              />
            </div>
            <p className="text-[10px] text-slate-600 mt-2">Paste your Google Business review URL</p>
          </Card>

          <Card className="bg-white/5 border-white/10 p-5">
            <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
              <Star size={14} className="text-green-400" /> Trustpilot Link
            </h3>
            <div className="flex gap-2">
              <Input
                value={trustpilotLink}
                onChange={(e) => setTrustpilotLink(e.target.value)}
                placeholder="https://www.trustpilot.com/review/..."
                className="bg-white/5 border-white/10 text-white placeholder:text-white/20 flex-1"
                data-testid="input-trustpilot-link"
              />
            </div>
            <p className="text-[10px] text-slate-600 mt-2">Paste your Trustpilot business page URL</p>
          </Card>

          <Card className="bg-white/5 border-white/10 p-5">
            <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
              <Shield size={14} className="text-cyan-400" /> Shareable Review Link
            </h3>
            <div className="flex gap-2">
              <Input
                value={reviewLink}
                readOnly
                className="bg-white/5 border-white/10 text-white/70 flex-1"
                data-testid="input-review-link"
              />
              <Button
                onClick={copyLink}
                variant="outline"
                className="border-white/10 hover:bg-white/10"
                data-testid="button-copy-review-link"
              >
                <Copy size={16} />
              </Button>
            </div>
            <p className="text-[10px] text-slate-600 mt-2">Share this link with customers to collect reviews</p>
          </Card>
        </div>

        <div className="flex justify-end mb-8">
          <Button
            onClick={() => saveConfigMutation.mutate()}
            disabled={saveConfigMutation.isPending}
            className="bg-indigo-600 hover:bg-indigo-500 px-6"
            data-testid="button-save-review-links"
          >
            {saveConfigMutation.isPending ? <><Loader2 size={16} className="animate-spin mr-2" /> Saving...</> : <><Save size={16} className="mr-2" /> Save Review Links</>}
          </Button>
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <MessageSquare size={18} className="text-indigo-400" /> Review Feed
          </h2>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="animate-spin text-indigo-400" size={32} />
            </div>
          ) : reviews.length === 0 ? (
            <Card className="bg-white/5 border-white/10 p-12 text-center">
              <Star size={48} className="mx-auto mb-4 text-white/10" />
              <p className="text-slate-400 text-sm">No reviews yet</p>
              <p className="text-slate-600 text-xs mt-1">Share your review link with customers to start collecting feedback</p>
            </Card>
          ) : (
            reviews.map((review: any) => {
              const isNegative = review.rating <= 3;
              return (
                <motion.div
                  key={review.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <Card className="bg-white/5 border-white/10 p-5" data-testid={`review-card-${review.id}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <span className="font-bold text-white" data-testid={`review-name-${review.id}`}>{review.customerName}</span>
                          <Badge
                            className={isNegative ? "bg-red-500/20 text-red-400 border-red-500/30" : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"}
                            data-testid={`review-badge-${review.id}`}
                          >
                            {review.isPublic ? "Public" : "Private"}
                          </Badge>
                        </div>
                        <StarDisplay rating={review.rating} />
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => togglePublicMutation.mutate({ id: review.id, isPublic: !review.isPublic })}
                          className="text-slate-400 hover:text-white"
                          data-testid={`button-toggle-public-${review.id}`}
                        >
                          {review.isPublic ? <EyeOff size={14} /> : <Eye size={14} />}
                          <span className="ml-1 text-xs">{review.isPublic ? "Make Private" : "Make Public"}</span>
                        </Button>
                      </div>
                    </div>

                    <p className="text-sm text-slate-300 mb-3" data-testid={`review-comment-${review.id}`}>{review.comment}</p>

                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-600">
                        {new Date(review.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {isNegative && !review.aiResponse && (
                        <Button
                          size="sm"
                          onClick={() => handleGenerateAi(review.id, review.comment, review.customerName)}
                          disabled={generatingAi === review.id}
                          className="bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 border border-purple-500/30"
                          data-testid={`button-generate-ai-${review.id}`}
                        >
                          {generatingAi === review.id ? (
                            <><Loader2 size={12} className="animate-spin mr-1" /> Generating...</>
                          ) : (
                            <><Sparkles size={12} className="mr-1" /> Generate AI Response</>
                          )}
                        </Button>
                      )}
                    </div>

                    {review.aiResponse && (
                      <div className="mt-3 p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Sparkles size={12} className="text-purple-400" />
                          <span className="text-xs font-bold text-purple-400">AI Response</span>
                        </div>
                        <p className="text-sm text-slate-300" data-testid={`review-ai-response-${review.id}`}>{review.aiResponse}</p>
                      </div>
                    )}
                  </Card>
                </motion.div>
              );
            })
          )}
        </div>
      </div>
      {showTutorial && <TutorialOverlay steps={REPUTATION_STEPS} storageKey="apex_tutorial_reputation" onClose={closeTutorial} accentColor="amber" />}
    </div>
  );
}