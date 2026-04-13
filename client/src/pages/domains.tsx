import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Globe, Search, ShoppingCart, Shield, Lock, CheckCircle2, XCircle, Loader2, Link2, BookOpen, RefreshCw, AlertTriangle, Activity, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { DOMAINS_STEPS } from "@/components/tutorial-steps";
import { useAccount } from "@/hooks/use-account";

type DomainCheckResult = {
  available: boolean | null;
  domain: string;
  tld: string;
  costPrice: number;
  salePrice: number;
  reason?: string;
  error?: string;
};

type Domain = {
  id: number;
  subAccountId: number;
  domainName: string;
  status: string;
  purchasePrice: number;
  salePrice: number;
  dnsConfigured: boolean;
  sslActive: boolean;
  registrar: string | null;
  siteId: number | null;
  verificationToken: string | null;
  verifiedAt: string | null;
  createdAt: string;
};

type SavedSite = {
  id: number;
  name: string;
};

function getDomainIntelligence(domain: Domain, hasSite: boolean) {
  const issues: string[] = [];
  let score = 0;

  if (domain.dnsConfigured) score += 30;
  else issues.push("DNS not configured — site won't resolve");

  if (domain.sslActive) score += 25;
  else issues.push("SSL inactive — traffic not encrypted");

  if (domain.verifiedAt) score += 20;
  else issues.push("Domain not verified — affects deliverability");

  if (hasSite) score += 25;
  else issues.push("No site linked — domain is idle");

  const label = score >= 80 ? "Fully Live" : score >= 50 ? "Partial" : "Not Ready";
  const color = score >= 80 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
    : score >= 50 ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
    : "text-red-400 bg-red-500/10 border-red-500/20";

  return { score, label, issues, color };
}

export default function Domains() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { showTutorial, startTutorial, closeTutorial } = useTutorial("apex_tutorial_domains");
  const { activeAccountId } = useAccount();
  const subAccountId = activeAccountId || 13;
  const [searchQuery, setSearchQuery] = useState("");
  const [checkResult, setCheckResult] = useState<DomainCheckResult | null>(null);
  const [searchResults, setSearchResults] = useState<DomainCheckResult[]>([]);
  const [showConfetti, setShowConfetti] = useState(false);
  const [verifyingDomainId, setVerifyingDomainId] = useState<number | null>(null);

  const { data: domainsData = [], isLoading: domainsLoading } = useQuery<Domain[]>({
    queryKey: ["/api/domains", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/domains/${subAccountId}`);
      if (!res.ok) throw new Error("Failed to fetch domains");
      return res.json();
    },
  });

  const { data: sites = [] } = useQuery<SavedSite[]>({
    queryKey: ["/api/sites"],
    queryFn: async () => {
      const res = await fetch("/api/sites");
      if (!res.ok) throw new Error("Failed to fetch sites");
      return res.json();
    },
  });

  const checkMutation = useMutation({
    mutationFn: async (domain: string) => {
      const res = await fetch("/api/domains/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      if (!res.ok) throw new Error("Check failed");
      return res.json() as Promise<DomainCheckResult>;
    },
    onSuccess: (data) => setCheckResult(data),
  });

  const searchMutation = useMutation({
    mutationFn: async (query: string) => {
      const res = await fetch("/api/domains/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) throw new Error("Search failed");
      return res.json() as Promise<DomainCheckResult[]>;
    },
    onSuccess: (data) => setSearchResults(data),
  });

  const purchaseMutation = useMutation({
    mutationFn: async (domain: string) => {
      const res = await fetch("/api/domains/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subAccountId, domain }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Purchase failed");
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Domain Claimed!", description: data.notice || "Domain saved. Register it at your preferred registrar (Namecheap, GoDaddy, Cloudflare) to make it live." });
      queryClient.invalidateQueries({ queryKey: ["/api/domains", subAccountId] });
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
      setCheckResult(null);
      setSearchResults([]);
    },
    onError: (err: any) => {
      toast({ title: "Purchase Failed", description: err.message, variant: "destructive" });
    },
  });

  const linkSiteMutation = useMutation({
    mutationFn: async ({ domainId, siteId }: { domainId: number; siteId: number | null }) => {
      const res = await fetch(`/api/domains/${domainId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId }),
      });
      if (!res.ok) throw new Error("Failed to update domain");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Domain Updated", description: "Site linked successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/domains", subAccountId] });
    },
  });

  const startVerifyMutation = useMutation({
    mutationFn: async (domainId: number) => {
      const res = await fetch(`/api/domains/${domainId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Failed to start verification");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Verification Started",
        description: `Add a TXT record: Host = _apex-verify, Value = ${data.verificationToken}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/domains", subAccountId] });
    },
  });

  const checkVerifyMutation = useMutation({
    mutationFn: async (domainId: number) => {
      setVerifyingDomainId(domainId);
      const res = await fetch(`/api/domains/${domainId}/check-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Verification check failed");
      return res.json();
    },
    onSuccess: (data: any) => {
      setVerifyingDomainId(null);
      if (data.verified) {
        toast({ title: "Domain Verified!", description: "DNS ownership confirmed. Your domain is now active." });
      } else {
        toast({ title: "Not Yet Verified", description: data.message || "DNS record not found. Wait a few minutes and try again.", variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/domains", subAccountId] });
    },
    onError: (err: any) => {
      setVerifyingDomainId(null);
      toast({ title: "Verification Failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSearch = () => {
    if (!searchQuery.trim()) return;
    const q = searchQuery.trim().toLowerCase();
    if (q.includes(".")) {
      checkMutation.mutate(q);
    }
    searchMutation.mutate(q);
  };

  const getStatusBadge = (domain: Domain) => {
    if (domain.verifiedAt || domain.status === "verified") {
      return { label: "verified", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" };
    }
    if (domain.verificationToken && !domain.verifiedAt) {
      return { label: "pending verification", className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" };
    }
    if (domain.status === "pending_registration") {
      return { label: "needs registration", className: "bg-orange-500/20 text-orange-400 border-orange-500/30" };
    }
    return { label: domain.status, className: "bg-slate-500/20 text-slate-400 border-slate-500/30" };
  };

  const activeDomains = domainsData.filter((d) => d.verifiedAt || d.status === "verified");
  const totalSpent = domainsData.reduce((sum, d) => sum + d.salePrice, 0);

  return (
    <div className="flex-1 p-6 md:p-10 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <AnimatePresence>
          {showConfetti && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center"
              data-testid="confetti-overlay"
            >
              {Array.from({ length: 40 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute w-3 h-3 rounded-full"
                  style={{
                    background: ["#818cf8", "#06b6d4", "#a78bfa", "#34d399", "#f472b6"][i % 5],
                    left: `${Math.random() * 100}%`,
                    top: `${Math.random() * 100}%`,
                  }}
                  initial={{ opacity: 1, scale: 0 }}
                  animate={{
                    opacity: [1, 1, 0],
                    scale: [0, 1.5, 0],
                    y: [0, -200 - Math.random() * 300],
                    x: [(Math.random() - 0.5) * 200],
                  }}
                  transition={{ duration: 2, delay: Math.random() * 0.5 }}
                />
              ))}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: [0, 1.2, 1] }}
                transition={{ duration: 0.5 }}
                className="text-6xl"
              >
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 mb-4">
            <Globe size={12} /> DOMAIN MANAGER
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" data-testid="text-domains-title">
            Domain <span className="bg-gradient-to-r from-indigo-400 via-cyan-400 to-purple-400 bg-clip-text text-transparent">Manager</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">Search, purchase, and manage domains for your projects</p>
          <Button variant="ghost" size="sm" onClick={startTutorial} className="text-slate-400 hover:text-white mt-2" data-testid="button-start-tutorial">
            <BookOpen size={16} className="mr-1" /> Tutorial
          </Button>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8" data-testid="stats-row">
          {[
            { label: "Total Domains", value: domainsData.length, icon: Globe, color: "text-indigo-400" },
            { label: "Verified", value: activeDomains.length, icon: CheckCircle2, color: "text-emerald-400" },
            { label: "Total Spent", value: `$${totalSpent.toFixed(2)}`, icon: ShoppingCart, color: "text-cyan-400" },
          ].map((stat, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
              <Card className="bg-white/5 border-white/10 p-4" data-testid={`stat-card-${i}`}>
                <div className="flex items-center gap-2 mb-2">
                  <stat.icon size={16} className={stat.color} />
                  <span className="text-xs text-slate-400 font-medium">{stat.label}</span>
                </div>
                <div className="text-2xl font-black text-white" data-testid={`stat-value-${i}`}>{stat.value}</div>
              </Card>
            </motion.div>
          ))}
        </div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="bg-white/5 border-white/10 p-6 mb-8" data-testid="domain-search-card">
            <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
              <Search size={14} className="text-indigo-400" /> Search Domains
            </h3>
            <div className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Search a name (roof2roots) or exact domain (roof2roots.live)"
                className="bg-white/5 border-white/10 text-white placeholder:text-white/20 flex-1"
                data-testid="input-domain-search"
              />
              <Button
                onClick={handleSearch}
                disabled={checkMutation.isPending || searchMutation.isPending || !searchQuery.trim()}
                className="bg-indigo-600 hover:bg-indigo-500"
                data-testid="button-search-domain"
              >
                {(checkMutation.isPending || searchMutation.isPending) ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                <span className="ml-2 hidden md:inline">Search</span>
              </Button>
            </div>
            <p className="text-[11px] text-slate-600 mt-2">Supports 100+ TLDs: .com, .io, .ai, .live, .agency, .marketing, .services, .co.uk, .tech, .store, and more</p>

            {checkResult && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mt-4 p-4 rounded-lg border ${
                  checkResult.available === true
                    ? "bg-emerald-500/10 border-emerald-500/30"
                    : checkResult.available === null
                      ? "bg-yellow-500/10 border-yellow-500/30"
                      : "bg-red-500/10 border-red-500/30"
                }`}
                data-testid="domain-check-result"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {checkResult.available === true ? (
                      <CheckCircle2 className="text-emerald-400" size={20} data-testid="icon-available" />
                    ) : checkResult.available === null ? (
                      <AlertTriangle className="text-yellow-400" size={20} data-testid="icon-unknown" />
                    ) : (
                      <XCircle className="text-red-400" size={20} data-testid="icon-taken" />
                    )}
                    <div>
                      <span className="font-bold text-white" data-testid="text-check-domain">{checkResult.domain}</span>
                      <span className={`ml-2 text-sm ${
                        checkResult.available === true ? "text-emerald-400"
                          : checkResult.available === null ? "text-yellow-400"
                            : "text-red-400"
                      }`}>
                        {checkResult.available === true
                          ? "Available!"
                          : checkResult.reason === "unsupported_tld"
                            ? "Unsupported TLD"
                            : checkResult.reason === "invalid_syntax"
                              ? "Invalid domain"
                              : checkResult.available === null
                                ? "Could not verify"
                                : checkResult.reason === "already_registered"
                                  ? "Already in your account"
                                  : "Taken"}
                      </span>
                    </div>
                  </div>
                  {checkResult.available === true && (
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-black text-white" data-testid="text-check-price">${checkResult.salePrice.toFixed(2)}/yr</span>
                      <Button
                        onClick={() => purchaseMutation.mutate(checkResult.domain)}
                        disabled={purchaseMutation.isPending}
                        className="bg-emerald-600 hover:bg-emerald-500"
                        data-testid="button-buy-primary"
                      >
                        {purchaseMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <ShoppingCart size={16} />}
                        <span className="ml-2">Claim</span>
                      </Button>
                    </div>
                  )}
                </div>
                {checkResult.error && (
                  <p className="text-xs text-yellow-400/70 mt-2">{checkResult.error}</p>
                )}
              </motion.div>
            )}
          </Card>
        </motion.div>

        {searchResults.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <Card className="bg-white/5 border-white/10 p-6 mb-8" data-testid="bulk-tld-results">
              <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                <Globe size={14} className="text-cyan-400" /> All TLD Options
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {searchResults
                  .sort((a, b) => (a.available === true ? -1 : 1) - (b.available === true ? -1 : 1))
                  .map((result, i) => (
                  <div
                    key={result.domain}
                    className={`p-4 rounded-lg border transition-colors ${
                      result.available === true
                        ? "bg-white/[0.03] border-white/10 hover:border-indigo-500/30 hover:bg-white/[0.06]"
                        : result.available === null
                          ? "bg-white/[0.02] border-yellow-500/10 opacity-70"
                          : "bg-white/[0.02] border-white/5 opacity-50"
                    }`}
                    data-testid={`tld-option-${i}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono font-bold text-white text-sm" data-testid={`tld-domain-${i}`}>{result.domain}</span>
                      {result.available === true ? (
                        <CheckCircle2 size={14} className="text-emerald-400" />
                      ) : result.available === null ? (
                        <AlertTriangle size={14} className="text-yellow-400" />
                      ) : (
                        <XCircle size={14} className="text-red-400" />
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-white">${result.salePrice.toFixed(2)}/yr</span>
                      {result.available === true && (
                        <Button
                          size="sm"
                          onClick={() => purchaseMutation.mutate(result.domain)}
                          disabled={purchaseMutation.isPending}
                          className="bg-indigo-600 hover:bg-indigo-500 h-7 text-xs px-3"
                          data-testid={`button-buy-tld-${i}`}
                        >
                          Claim
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        )}

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="bg-white/5 border-white/10 p-6" data-testid="active-domains-card">
            <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
              <Link2 size={14} className="text-indigo-400" /> Your Domains
            </h3>

            {domainsLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="animate-spin text-indigo-400" size={24} />
              </div>
            ) : domainsData.length === 0 ? (
              <div className="text-center py-10">
                <Globe size={48} className="mx-auto mb-4 text-white/10" />
                <p className="text-slate-400 text-sm" data-testid="text-no-domains">No domains yet</p>
                <p className="text-slate-600 text-xs mt-1">Search and purchase your first domain above</p>
              </div>
            ) : (
              <div className="space-y-3">
                {domainsData.map((domain) => {
                  const linkedSite = sites.find((s) => s.id === domain.siteId);
                  const statusBadge = getStatusBadge(domain);
                  const needsVerification = !domain.verifiedAt && domain.status !== "verified";
                  const hasToken = !!domain.verificationToken;

                  const intel = getDomainIntelligence(domain, !!linkedSite);

                  return (
                    <div
                      key={domain.id}
                      className="flex flex-col gap-3 p-4 rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] transition-colors"
                      data-testid={`domain-row-${domain.id}`}
                    >
                      <div className="flex flex-col md:flex-row md:items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Globe size={14} className="text-indigo-400 shrink-0" />
                            <span className="font-mono font-bold text-white truncate" data-testid={`domain-name-${domain.id}`}>{domain.domainName}</span>
                            <Badge
                              className={`text-[10px] ${statusBadge.className}`}
                              data-testid={`domain-status-${domain.id}`}
                            >
                              {statusBadge.label}
                            </Badge>
                            <span
                              className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${intel.color}`}
                              data-testid={`domain-intel-score-${domain.id}`}
                            >
                              <Activity size={8} />
                              {intel.score}/100 · {intel.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-slate-500">
                            <span className="flex items-center gap-1" data-testid={`domain-dns-${domain.id}`}>
                              <Shield size={10} className={domain.dnsConfigured ? "text-emerald-400" : "text-red-400"} />
                              DNS {domain.dnsConfigured ? "Configured" : "Pending"}
                            </span>
                            <span className="flex items-center gap-1" data-testid={`domain-ssl-${domain.id}`}>
                              <Lock size={10} className={domain.sslActive ? "text-emerald-400" : "text-slate-600"} />
                              SSL {domain.sslActive ? "Active" : "Via Cloudflare"}
                            </span>
                            <span data-testid={`domain-price-${domain.id}`}>${domain.salePrice.toFixed(2)}/yr</span>
                            {linkedSite && (
                              <span className="text-indigo-400" data-testid={`domain-linked-site-${domain.id}`}>
                                Linked: {linkedSite.name}
                              </span>
                            )}
                          </div>
                          {intel.issues.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5" data-testid={`domain-intel-issues-${domain.id}`}>
                              {intel.issues.map((issue, i) => (
                                <span key={i} className="inline-flex items-center gap-1 text-[9px] text-amber-400/80 bg-amber-500/5 border border-amber-500/10 px-1.5 py-0.5 rounded">
                                  <Zap size={7} />
                                  {issue}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Select
                            value={domain.siteId?.toString() || "none"}
                            onValueChange={(val) =>
                              linkSiteMutation.mutate({
                                domainId: domain.id,
                                siteId: val === "none" ? null : parseInt(val),
                              })
                            }
                          >
                            <SelectTrigger className="w-40 bg-white/5 border-white/10 text-white text-xs h-8" data-testid={`select-link-site-${domain.id}`}>
                              <SelectValue placeholder="Link to site" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No site</SelectItem>
                              {sites.map((site) => (
                                <SelectItem key={site.id} value={site.id.toString()}>{site.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {needsVerification && (
                        <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                          {!hasToken ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => startVerifyMutation.mutate(domain.id)}
                              disabled={startVerifyMutation.isPending}
                              className="text-xs h-7 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                              data-testid={`button-start-verify-${domain.id}`}
                            >
                              <Shield size={12} className="mr-1" />
                              Start Verification
                            </Button>
                          ) : (
                            <>
                              <div className="flex-1 text-xs text-slate-500 flex items-center gap-1">
                                <AlertTriangle size={12} className="text-yellow-400" />
                                <span>Add TXT record: Host = <code className="text-yellow-300">_apex-verify</code>, Value = <code className="text-yellow-300">{domain.verificationToken}</code></span>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => checkVerifyMutation.mutate(domain.id)}
                                disabled={verifyingDomainId === domain.id}
                                className="text-xs h-7 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10"
                                data-testid={`button-check-verify-${domain.id}`}
                              >
                                {verifyingDomainId === domain.id ? (
                                  <Loader2 size={12} className="animate-spin mr-1" />
                                ) : (
                                  <RefreshCw size={12} className="mr-1" />
                                )}
                                Check DNS
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </motion.div>
      </div>
      {showTutorial && <TutorialOverlay steps={DOMAINS_STEPS} storageKey="apex_tutorial_domains" onClose={closeTutorial} accentColor="cyan" />}
    </div>
  );
}
