import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useAccount } from "@/hooks/use-account";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Settings, Save, Building2, Phone, Globe, Star, Palette, Languages, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import type { SubAccount } from "@shared/schema";

const INDUSTRIES = [
  { id: "gym", label: "Gym & Fitness" },
  { id: "real_estate", label: "Real Estate" },
  { id: "dental", label: "Dental & Medical" },
  { id: "contractor", label: "Home Services" },
  { id: "law_firm", label: "Law Firm" },
  { id: "auto_dealer", label: "Auto Dealership" },
  { id: "salon", label: "Salon & Spa" },
  { id: "education", label: "Education & Coaching" },
  { id: "restaurant", label: "Restaurant & Bar" },
  { id: "insurance", label: "Insurance Agency" },
  { id: "medspa", label: "Med Spa & Aesthetics" },
  { id: "property_mgmt", label: "Property Management" },
  { id: "logistics", label: "Logistics & Moving" },
  { id: "veterinary", label: "Veterinary Clinic" },
  { id: "photography", label: "Photography & Video" },
  { id: "nonprofit", label: "Nonprofit & Charity" },
  { id: "auto_repair", label: "Auto Repair Shop" },
  { id: "travel", label: "Travel & Hospitality" },
  { id: "financial", label: "Financial Services" },
];

const THEMES = [
  { id: "cyber-glass", label: "Cyber Glass", color: "from-blue-500 to-cyan-500" },
  { id: "midnight-pro", label: "Midnight Pro", color: "from-slate-700 to-slate-900" },
  { id: "sunset-warm", label: "Sunset Warm", color: "from-orange-500 to-rose-500" },
  { id: "forest-green", label: "Forest Green", color: "from-emerald-500 to-green-700" },
  { id: "royal-purple", label: "Royal Purple", color: "from-purple-500 to-indigo-700" },
];

const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "pt", label: "Portuguese" },
  { id: "de", label: "German" },
  { id: "zh", label: "Chinese" },
];

export default function AccountSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeAccountId } = useAccount();

  const [form, setForm] = useState({
    name: "",
    ownerPhone: "",
    twilioNumber: "",
    googleReviewLink: "",
    industry: "",
    vibeTheme: "cyber-glass",
    language: "en",
  });

  const { data: accounts = [], isLoading } = useQuery<SubAccount[]>({
    queryKey: ["/api/accounts"],
  });

  const account = accounts.find(a => a.id === activeAccountId);

  useEffect(() => {
    if (account) {
      setForm({
        name: account.name || "",
        ownerPhone: account.ownerPhone || "",
        twilioNumber: account.twilioNumber || "",
        googleReviewLink: account.googleReviewLink || "",
        industry: account.industry || "",
        vibeTheme: account.vibeTheme || "cyber-glass",
        language: account.language || "en",
      });
    }
  }, [account]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeAccountId) throw new Error("No account selected");
      const res = await apiRequest("PATCH", `/api/accounts/${activeAccountId}`, form);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Settings Saved", description: "Your account has been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
    },
    onError: (err: any) => {
      toast({ title: "Save Failed", description: err.message || "Could not save settings.", variant: "destructive" });
    },
  });

  const hasChanges = account && (
    form.name !== (account.name || "") ||
    form.ownerPhone !== (account.ownerPhone || "") ||
    form.twilioNumber !== (account.twilioNumber || "") ||
    form.googleReviewLink !== (account.googleReviewLink || "") ||
    form.industry !== (account.industry || "") ||
    form.vibeTheme !== (account.vibeTheme || "cyber-glass") ||
    form.language !== (account.language || "en")
  );

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]" data-testid="status-loading">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-400">Loading account...</p>
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]" data-testid="status-no-account">
        <div className="text-center space-y-3">
          <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
          <p className="text-slate-400" data-testid="text-no-account">No account selected. Go to the sidebar and pick an account.</p>
        </div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="p-4 md:p-8 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white flex items-center gap-3" data-testid="text-settings-title">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <Settings size={20} className="text-white" />
            </div>
            Account Settings
          </h1>
          <p className="text-slate-400 mt-1">Customize your sub-account details and preferences</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="border-slate-600 text-slate-400">
            {account.plan?.toUpperCase() || "STARTER"} Plan
          </Badge>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!hasChanges || saveMutation.isPending}
            className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700"
            data-testid="button-save-settings"
          >
            {saveMutation.isPending ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Save size={16} className="mr-2" />}
            Save Changes
          </Button>
        </div>
      </div>

      <Card className="bg-black/40 border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Building2 size={18} className="text-violet-400" />
            Business Information
          </CardTitle>
          <CardDescription className="text-slate-400">Your business name and industry</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-slate-300">Business Name</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Your Business Name"
                className="bg-neutral-900/50 border-white/10 text-white"
                data-testid="input-business-name"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Industry</Label>
              <Select value={form.industry} onValueChange={v => setForm(f => ({ ...f, industry: v }))}>
                <SelectTrigger className="bg-neutral-900/50 border-white/10 text-white" data-testid="select-industry">
                  <SelectValue placeholder="Select industry" />
                </SelectTrigger>
                <SelectContent className="bg-neutral-900 border-white/10">
                  {INDUSTRIES.map(ind => (
                    <SelectItem key={ind.id} value={ind.id}>{ind.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-black/40 border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Phone size={18} className="text-green-400" />
            Contact & Communication
          </CardTitle>
          <CardDescription className="text-slate-400">Phone numbers and communication settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-slate-300">Owner Phone</Label>
              <Input
                value={form.ownerPhone}
                onChange={e => setForm(f => ({ ...f, ownerPhone: e.target.value }))}
                placeholder="+1 (555) 123-4567"
                className="bg-neutral-900/50 border-white/10 text-white"
                data-testid="input-owner-phone"
              />
              <p className="text-xs text-slate-500">Your personal contact number for alerts</p>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Twilio Number</Label>
              <Input
                value={form.twilioNumber}
                onChange={e => setForm(f => ({ ...f, twilioNumber: e.target.value }))}
                placeholder="+15551234567"
                className="bg-neutral-900/50 border-white/10 text-white"
                data-testid="input-twilio-number"
              />
              <p className="text-xs text-slate-500">The phone number used for SMS messaging</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-black/40 border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Star size={18} className="text-amber-400" />
            Reputation & Reviews
          </CardTitle>
          <CardDescription className="text-slate-400">Your Google Business review link for the reputation system</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-slate-300">Google Review Link</Label>
            <Input
              value={form.googleReviewLink}
              onChange={e => setForm(f => ({ ...f, googleReviewLink: e.target.value }))}
              placeholder="https://g.page/r/..."
              className="bg-neutral-900/50 border-white/10 text-white"
              data-testid="input-google-review"
            />
            <p className="text-xs text-slate-500">Paste your Google Business review link here. Used by the Reputation Manager to send review requests.</p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-black/40 border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Palette size={18} className="text-pink-400" />
            Appearance & Language
          </CardTitle>
          <CardDescription className="text-slate-400">Theme and language preferences</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-slate-300">Dashboard Theme</Label>
              <Select value={form.vibeTheme} onValueChange={v => setForm(f => ({ ...f, vibeTheme: v }))}>
                <SelectTrigger className="bg-neutral-900/50 border-white/10 text-white" data-testid="select-theme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-neutral-900 border-white/10">
                  {THEMES.map(theme => (
                    <SelectItem key={theme.id} value={theme.id}>
                      <div className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded-full bg-gradient-to-r ${theme.color}`} />
                        {theme.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Language</Label>
              <Select value={form.language} onValueChange={v => setForm(f => ({ ...f, language: v }))}>
                <SelectTrigger className="bg-neutral-900/50 border-white/10 text-white" data-testid="select-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-neutral-900 border-white/10">
                  {LANGUAGES.map(lang => (
                    <SelectItem key={lang.id} value={lang.id}>
                      <div className="flex items-center gap-2">
                        <Languages size={14} className="text-slate-400" />
                        {lang.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            {THEMES.map(theme => (
              <button
                key={theme.id}
                onClick={() => setForm(f => ({ ...f, vibeTheme: theme.id }))}
                className={`w-8 h-8 rounded-lg bg-gradient-to-r ${theme.color} border-2 transition-all ${form.vibeTheme === theme.id ? "border-white scale-110" : "border-transparent opacity-60 hover:opacity-100"}`}
                title={theme.label}
                data-testid={`button-theme-${theme.id}`}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {saveMutation.isSuccess && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 text-green-400 text-sm"
          data-testid="status-save-success"
        >
          <CheckCircle2 size={16} />
          Settings saved successfully
        </motion.div>
      )}
      {saveMutation.isError && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 text-red-400 text-sm"
          data-testid="status-save-error"
        >
          <AlertTriangle size={16} />
          {(saveMutation.error as any)?.message || "Failed to save settings"}
        </motion.div>
      )}
    </motion.div>
  );
}
