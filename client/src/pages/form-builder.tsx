import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutTemplate, Sparkles, Plus, Trash2, GripVertical, Copy, Check,
  Loader2, ChevronUp, ChevronDown, Eye, Code, Edit3, AlertTriangle, Shield, BookOpen
} from "lucide-react";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { FORM_BUILDER_STEPS } from "@/components/tutorial-steps";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAccount } from "@/hooks/use-account";
import { AddressAutocomplete } from "@/components/address-autocomplete";

interface FormField {
  id: string;
  label: string;
  type: "text" | "email" | "phone" | "textarea" | "select" | "checkbox" | "date" | "address";
  required: boolean;
  placeholder: string;
  helpText?: string;
  options?: string[];
}

const POPULAR_INDUSTRIES = [
  "Personal Injury Law",
  "Real Estate",
  "Dental",
  "MedSpa",
  "Chiropractic",
  "HVAC",
  "Roofing",
  "Plumbing",
  "Auto Repair",
  "Insurance",
  "Mortgage",
  "Financial Planning",
  "Home Cleaning",
  "Landscaping",
  "Gym / Fitness",
  "Veterinary",
  "Photography",
  "Wedding Planning",
];

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "textarea", label: "Text Area" },
  { value: "select", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
  { value: "date", label: "Date" },
  { value: "address", label: "Address" },
];

export default function FormBuilder() {
  const { showTutorial, startTutorial, closeTutorial } = useTutorial("apex_tutorial_form_builder");
  const { toast } = useToast();
  const { activeAccountId } = useAccount();
  const [industry, setIndustry] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const [complianceNotes, setComplianceNotes] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("generate");
  const [copied, setCopied] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const filteredIndustries = POPULAR_INDUSTRIES.filter((ind) =>
    ind.toLowerCase().includes(industry.toLowerCase())
  );

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/forms/generate", {
        industry,
        businessName: businessName || undefined,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setFields(data.fields);
      setComplianceNotes(data.complianceNotes || []);
      setActiveTab("edit");
      toast({ title: "Form Generated", description: `Created ${data.fields.length} fields for ${industry}` });
    },
    onError: () => toast({ title: "Generation failed", description: "Could not generate form. Please try again.", variant: "destructive" }),
  });

  const updateField = useCallback((id: string, updates: Partial<FormField>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  }, []);

  const removeField = useCallback((id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const addField = useCallback(() => {
    const newField: FormField = {
      id: `field_${Date.now()}`,
      label: "New Field",
      type: "text",
      required: false,
      placeholder: "",
    };
    setFields((prev) => [...prev, newField]);
    setEditingField(newField.id);
  }, []);

  const moveField = useCallback((index: number, direction: "up" | "down") => {
    setFields((prev) => {
      const newFields = [...prev];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= newFields.length) return prev;
      [newFields[index], newFields[targetIndex]] = [newFields[targetIndex], newFields[index]];
      return newFields;
    });
  }, []);

  const generateEmbedCode = () => {
    const formHtml = fields
      .map((f) => {
        const req = f.required ? ' required' : '';
        const help = f.helpText ? `\n      <small style="color:#94a3b8;font-size:12px;">${f.helpText}</small>` : '';
        switch (f.type) {
          case "textarea":
            return `    <div style="margin-bottom:16px;">
      <label style="display:block;margin-bottom:4px;font-weight:600;color:#e2e8f0;">${f.label}${f.required ? ' *' : ''}</label>
      <textarea name="${f.id}" placeholder="${f.placeholder}"${req} rows="4" style="width:100%;padding:10px;border:1px solid #475569;border-radius:8px;background:#1e293b;color:#f1f5f9;font-size:14px;"></textarea>${help}
    </div>`;
          case "select":
            const opts = (f.options || []).map((o) => `<option value="${o}">${o}</option>`).join("\n        ");
            return `    <div style="margin-bottom:16px;">
      <label style="display:block;margin-bottom:4px;font-weight:600;color:#e2e8f0;">${f.label}${f.required ? ' *' : ''}</label>
      <select name="${f.id}"${req} style="width:100%;padding:10px;border:1px solid #475569;border-radius:8px;background:#1e293b;color:#f1f5f9;font-size:14px;">
        <option value="">${f.placeholder || 'Select...'}</option>
        ${opts}
      </select>${help}
    </div>`;
          case "checkbox":
            return `    <div style="margin-bottom:16px;display:flex;align-items:flex-start;gap:8px;">
      <input type="checkbox" name="${f.id}"${req} style="margin-top:4px;" />
      <label style="color:#e2e8f0;font-size:14px;">${f.label}</label>${help}
    </div>`;
          case "address":
            return `    <div style="margin-bottom:16px;">
      <label style="display:block;margin-bottom:4px;font-weight:600;color:#e2e8f0;">${f.label}${f.required ? ' *' : ''}</label>
      <input type="text" name="${f.id}" id="apex-address-${f.id}" placeholder="${f.placeholder || 'Start typing an address...'}"${req} autocomplete="street-address" style="width:100%;padding:10px;border:1px solid #475569;border-radius:8px;background:#1e293b;color:#f1f5f9;font-size:14px;" />
      <input type="hidden" name="${f.id}_city" id="apex-city-${f.id}" />
      <input type="hidden" name="${f.id}_state" id="apex-state-${f.id}" />
      <input type="hidden" name="${f.id}_zip" id="apex-zip-${f.id}" />${help}
    </div>`;
          default:
            const inputType = f.type === "phone" ? "tel" : f.type;
            return `    <div style="margin-bottom:16px;">
      <label style="display:block;margin-bottom:4px;font-weight:600;color:#e2e8f0;">${f.label}${f.required ? ' *' : ''}</label>
      <input type="${inputType}" name="${f.id}" placeholder="${f.placeholder}"${req} style="width:100%;padding:10px;border:1px solid #475569;border-radius:8px;background:#1e293b;color:#f1f5f9;font-size:14px;" />${help}
    </div>`;
        }
      })
      .join("\n");

    const addressFields = fields.filter(f => f.type === "address");
    const baseUrl = window.location.origin;
    return `<form id="apex-lead-form" style="max-width:480px;margin:0 auto;padding:32px;background:#0f172a;border-radius:16px;border:1px solid #334155;font-family:system-ui,-apple-system,sans-serif;">
  <h2 style="color:#f1f5f9;font-size:24px;font-weight:700;margin-bottom:8px;">Contact Us</h2>
  <p style="color:#94a3b8;font-size:14px;margin-bottom:24px;">Fill out the form below and we'll get back to you shortly.</p>
${formHtml}
    <button type="submit" style="width:100%;padding:12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;">Submit</button>
    <div id="apex-form-msg" style="display:none;margin-top:12px;padding:12px;border-radius:8px;background:#059669;color:white;text-align:center;font-size:14px;">Thank you! Your submission has been received.</div>
</form>
<script>
(function(){
  var form = document.getElementById('apex-lead-form');
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var data = {};
    var inputs = form.querySelectorAll('input,textarea,select');
    inputs.forEach(function(el) {
      if (el.name && el.type !== 'submit') {
        if (el.type === 'checkbox') data[el.name] = el.checked;
        else data[el.name] = el.value;
      }
    });
    data.subAccountId = '${activeAccountId || 7}';
    data.formName = '${industry || "Lead Form"}';
    var btn = form.querySelector('button[type=submit]');
    btn.textContent = 'Sending...';
    btn.disabled = true;
    fetch('${baseUrl}/api/form-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function(r) { return r.json(); }).then(function() {
      document.getElementById('apex-form-msg').style.display = 'block';
      btn.textContent = 'Submitted';
      form.reset();
    }).catch(function() {
      btn.textContent = 'Submit';
      btn.disabled = false;
      alert('Something went wrong. Please try again.');
    });
  });
${addressFields.length > 0 ? `
  function initApexAutocomplete() {
    if (!window.google || !window.google.maps || !window.google.maps.places) return;
${addressFields.map(f => `    var input_${f.id} = document.getElementById('apex-address-${f.id}');
    if (input_${f.id}) {
      var ac_${f.id} = new google.maps.places.Autocomplete(input_${f.id}, { componentRestrictions: { country: 'us' }, types: ['address'], fields: ['address_components','formatted_address'] });
      ac_${f.id}.addListener('place_changed', function() {
        var place = ac_${f.id}.getPlace();
        if (!place.address_components) return;
        var city='',state='',zip='';
        place.address_components.forEach(function(c){
          if(c.types[0]==='locality')city=c.long_name;
          if(c.types[0]==='administrative_area_level_1')state=c.short_name;
          if(c.types[0]==='postal_code')zip=c.long_name;
        });
        document.getElementById('apex-city-${f.id}').value=city;
        document.getElementById('apex-state-${f.id}').value=state;
        document.getElementById('apex-zip-${f.id}').value=zip;
      });
    }`).join('\n')}
  }
  fetch('${baseUrl}/api/config/google-api-key').then(function(r){return r.json()}).then(function(d){
    if(d.apiKey){
      var s=document.createElement('script');
      s.src='https://maps.googleapis.com/maps/api/js?key='+d.apiKey+'&libraries=places&callback=__apexPlacesReady';
      s.async=true;
      window.__apexPlacesReady=initApexAutocomplete;
      document.head.appendChild(s);
    }
  }).catch(function(){});
` : ''}})();
</script>`;

  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generateEmbedCode());
    setCopied(true);
    toast({ title: "Copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3" data-testid="text-page-title">
            <LayoutTemplate className="h-8 w-8 text-indigo-500" />
            AI Form Builder
          </h1>
          <p className="text-slate-400 mt-1">
            Generate industry-specific lead capture forms with AI-powered compliance notes.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={startTutorial} className="text-slate-400 hover:text-white" data-testid="button-start-tutorial">
          <BookOpen size={16} className="mr-1" /> Tutorial
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-slate-800/50 border border-slate-700/50">
          <TabsTrigger value="generate" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white" data-testid="tab-generate">
            <Sparkles className="w-4 h-4 mr-2" /> Generate
          </TabsTrigger>
          <TabsTrigger value="edit" disabled={fields.length === 0} className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white" data-testid="tab-edit">
            <Edit3 className="w-4 h-4 mr-2" /> Edit Fields
          </TabsTrigger>
          <TabsTrigger value="preview" disabled={fields.length === 0} className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white" data-testid="tab-preview">
            <Eye className="w-4 h-4 mr-2" /> Preview
          </TabsTrigger>
          <TabsTrigger value="embed" disabled={fields.length === 0} className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white" data-testid="tab-embed">
            <Code className="w-4 h-4 mr-2" /> Embed Code
          </TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Card className="bg-slate-800/40 border-slate-700/50">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-indigo-400" /> Generate Form
                  </CardTitle>
                  <CardDescription>
                    Enter your industry or niche and let AI create a custom lead capture form with compliance-aware fields.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2 relative">
                    <Label className="text-slate-300">Industry / Niche</Label>
                    <Input
                      value={industry}
                      onChange={(e) => { setIndustry(e.target.value); setShowSuggestions(true); }}
                      onFocus={() => setShowSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                      placeholder="e.g. Personal Injury Law, Dental, MedSpa..."
                      className="bg-slate-900 border-slate-700 text-white"
                      data-testid="input-industry"
                    />
                    <AnimatePresence>
                      {showSuggestions && industry.length > 0 && filteredIndustries.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -5 }}
                          className="absolute z-50 top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-lg overflow-hidden max-h-48 overflow-y-auto"
                        >
                          {filteredIndustries.map((ind) => (
                            <button
                              key={ind}
                              className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-indigo-500/20 hover:text-white transition-colors"
                              onMouseDown={() => { setIndustry(ind); setShowSuggestions(false); }}
                              data-testid={`button-industry-${ind.toLowerCase().replace(/\s+/g, "-")}`}
                            >
                              {ind}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-slate-300">Business Name (optional)</Label>
                    <Input
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="e.g. Smith & Associates Law Firm"
                      className="bg-slate-900 border-slate-700 text-white"
                      data-testid="input-business-name"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2">
                    {["Personal Injury Law", "Dental", "MedSpa", "Real Estate", "HVAC", "Roofing"].map((quick) => (
                      <Badge
                        key={quick}
                        variant="outline"
                        className="cursor-pointer bg-slate-700/30 text-slate-300 border-slate-600 hover:bg-indigo-500/20 hover:text-indigo-300 hover:border-indigo-500/30 transition-colors"
                        onClick={() => setIndustry(quick)}
                        data-testid={`badge-quick-${quick.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        {quick}
                      </Badge>
                    ))}
                  </div>

                  <Button
                    onClick={() => generateMutation.mutate()}
                    disabled={!industry || generateMutation.isPending}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white mt-4"
                    data-testid="button-generate-form"
                  >
                    {generateMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating Form...</>
                    ) : (
                      <><Sparkles className="w-4 h-4 mr-2" /> Generate Form</>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="bg-slate-800/40 border-slate-700/50">
                <CardHeader>
                  <CardTitle className="text-white text-sm flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-400" /> How It Works
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-400">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold flex-shrink-0">1</div>
                    <p>Enter your industry or niche</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold flex-shrink-0">2</div>
                    <p>AI generates fields with compliance notes</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold flex-shrink-0">3</div>
                    <p>Customize fields, labels, and order</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold flex-shrink-0">4</div>
                    <p>Copy the embed code for your website</p>
                  </div>
                </CardContent>
              </Card>

              {complianceNotes.length > 0 && (
                <Card className="bg-amber-500/5 border-amber-500/20">
                  <CardHeader>
                    <CardTitle className="text-amber-300 text-sm flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" /> Compliance Notes
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {complianceNotes.map((note, i) => (
                      <p key={i} className="text-xs text-amber-400/80 flex items-start gap-2" data-testid={`text-compliance-note-${i}`}>
                        <span className="text-amber-400 mt-0.5">•</span>
                        {note}
                      </p>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="edit" className="mt-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white" data-testid="text-edit-heading">Edit Form Fields</h2>
                <p className="text-sm text-slate-400">{fields.length} fields — Drag to reorder, click to edit</p>
              </div>
              <Button
                onClick={addField}
                className="bg-indigo-600 hover:bg-indigo-500"
                data-testid="button-add-field"
              >
                <Plus className="w-4 h-4 mr-2" /> Add Field
              </Button>
            </div>

            <AnimatePresence>
              {fields.map((field, index) => (
                <motion.div
                  key={field.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  layout
                >
                  <Card
                    className={`bg-slate-800/40 border-slate-700/50 transition-all ${editingField === field.id ? "border-indigo-500/50 ring-1 ring-indigo-500/20" : ""}`}
                    data-testid={`card-field-${field.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => moveField(index, "up")}
                            disabled={index === 0}
                            className="text-slate-500 hover:text-white disabled:opacity-30 transition-colors"
                            data-testid={`button-move-up-${field.id}`}
                          >
                            <ChevronUp className="w-4 h-4" />
                          </button>
                          <GripVertical className="w-4 h-4 text-slate-600" />
                          <button
                            onClick={() => moveField(index, "down")}
                            disabled={index === fields.length - 1}
                            className="text-slate-500 hover:text-white disabled:opacity-30 transition-colors"
                            data-testid={`button-move-down-${field.id}`}
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="flex-1 min-w-0">
                          {editingField === field.id ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs text-slate-400">Label</Label>
                                <Input
                                  value={field.label}
                                  onChange={(e) => updateField(field.id, { label: e.target.value })}
                                  className="bg-slate-900 border-slate-700 text-white text-sm h-9"
                                  data-testid={`input-field-label-${field.id}`}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-slate-400">Type</Label>
                                <Select
                                  value={field.type}
                                  onValueChange={(v) => updateField(field.id, { type: v as FormField["type"] })}
                                >
                                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white text-sm h-9" data-testid={`select-field-type-${field.id}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {FIELD_TYPES.map((ft) => (
                                      <SelectItem key={ft.value} value={ft.value}>{ft.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-slate-400">Placeholder</Label>
                                <Input
                                  value={field.placeholder}
                                  onChange={(e) => updateField(field.id, { placeholder: e.target.value })}
                                  className="bg-slate-900 border-slate-700 text-white text-sm h-9"
                                  data-testid={`input-field-placeholder-${field.id}`}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-slate-400">Help Text</Label>
                                <Input
                                  value={field.helpText || ""}
                                  onChange={(e) => updateField(field.id, { helpText: e.target.value })}
                                  className="bg-slate-900 border-slate-700 text-white text-sm h-9"
                                  data-testid={`input-field-help-${field.id}`}
                                />
                              </div>
                              {field.type === "select" && (
                                <div className="md:col-span-2 space-y-1">
                                  <Label className="text-xs text-slate-400">Options (comma-separated)</Label>
                                  <Input
                                    value={(field.options || []).join(", ")}
                                    onChange={(e) => updateField(field.id, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                                    className="bg-slate-900 border-slate-700 text-white text-sm h-9"
                                    data-testid={`input-field-options-${field.id}`}
                                  />
                                </div>
                              )}
                              <div className="flex items-center gap-2 md:col-span-2">
                                <Switch
                                  checked={field.required}
                                  onCheckedChange={(v) => updateField(field.id, { required: v })}
                                  data-testid={`switch-field-required-${field.id}`}
                                />
                                <Label className="text-sm text-slate-300">Required</Label>
                              </div>
                            </div>
                          ) : (
                            <div
                              className="cursor-pointer"
                              onClick={() => setEditingField(field.id)}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-white font-medium text-sm">{field.label}</span>
                                {field.required && (
                                  <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px]">Required</Badge>
                                )}
                                <Badge variant="outline" className="bg-slate-700/30 text-slate-400 border-slate-600 text-[10px]">{field.type}</Badge>
                              </div>
                              {field.helpText && (
                                <p className="text-xs text-amber-400/70 mt-1">{field.helpText}</p>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setEditingField(editingField === field.id ? null : field.id)}
                            className="text-slate-400 hover:text-white transition-colors"
                            data-testid={`button-edit-field-${field.id}`}
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => removeField(field.id)}
                            className="text-slate-400 hover:text-red-400 transition-colors"
                            data-testid={`button-remove-field-${field.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>

            {complianceNotes.length > 0 && (
              <Card className="bg-amber-500/5 border-amber-500/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-medium text-amber-300">Compliance Notes</span>
                  </div>
                  {complianceNotes.map((note, i) => (
                    <p key={i} className="text-xs text-amber-400/80 ml-6 mb-1">• {note}</p>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="preview" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-slate-800/40 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Eye className="w-5 h-5 text-indigo-400" /> Form Preview
                </CardTitle>
                <CardDescription>
                  This is how your form will look when embedded on a website.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-slate-900/80 rounded-xl border border-slate-700/30 p-6 space-y-4">
                  <div>
                    <h2 className="text-xl font-bold text-white mb-1" data-testid="text-preview-title">Contact Us</h2>
                    <p className="text-sm text-slate-400">Fill out the form below and we'll get back to you shortly.</p>
                  </div>

                  {fields.map((field) => (
                    <div key={field.id} className={field.type === "checkbox" ? "flex items-start gap-2" : ""} data-testid={`preview-field-${field.id}`}>
                      {field.type === "checkbox" ? (
                        <>
                          <input type="checkbox" className="mt-1 accent-indigo-500" disabled />
                          <div>
                            <label className="text-sm text-slate-200">{field.label}</label>
                            {field.helpText && <p className="text-xs text-slate-500 mt-0.5">{field.helpText}</p>}
                          </div>
                        </>
                      ) : (
                        <>
                          <label className="block text-sm font-semibold text-slate-200 mb-1">
                            {field.label}{field.required && <span className="text-red-400 ml-1">*</span>}
                          </label>
                          {field.type === "textarea" ? (
                            <Textarea
                              placeholder={field.placeholder}
                              className="bg-slate-800 border-slate-700 text-white text-sm"
                              rows={3}
                              disabled
                            />
                          ) : field.type === "select" ? (
                            <Select disabled>
                              <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-400 text-sm">
                                <SelectValue placeholder={field.placeholder || "Select..."} />
                              </SelectTrigger>
                            </Select>
                          ) : field.type === "address" ? (
                            <AddressAutocomplete
                              onAddressSelect={() => {}}
                              placeholder={field.placeholder || "Start typing an address..."}
                              className="bg-slate-800 border-slate-700 text-white text-sm"
                              data-testid={`preview-address-${field.id}`}
                            />
                          ) : (
                            <Input
                              type={field.type === "phone" ? "tel" : field.type}
                              placeholder={field.placeholder}
                              className="bg-slate-800 border-slate-700 text-white text-sm"
                              disabled
                            />
                          )}
                          {field.helpText && <p className="text-xs text-amber-400/70 mt-1">{field.helpText}</p>}
                        </>
                      )}
                    </div>
                  ))}

                  <Button className="w-full bg-indigo-600 hover:bg-indigo-500 text-white" disabled data-testid="button-preview-submit">
                    Submit
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="bg-slate-800/40 border-slate-700/50">
                <CardHeader>
                  <CardTitle className="text-white text-sm">Form Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Industry</span>
                    <span className="text-white font-medium" data-testid="text-summary-industry">{industry}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Total Fields</span>
                    <span className="text-white font-mono" data-testid="text-summary-fields">{fields.length}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Required Fields</span>
                    <span className="text-white font-mono">{fields.filter((f) => f.required).length}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Compliance Fields</span>
                    <span className="text-white font-mono">{fields.filter((f) => f.helpText).length}</span>
                  </div>
                </CardContent>
              </Card>

              {complianceNotes.length > 0 && (
                <Card className="bg-amber-500/5 border-amber-500/20">
                  <CardHeader>
                    <CardTitle className="text-amber-300 text-sm flex items-center gap-2">
                      <Shield className="w-4 h-4" /> Compliance Notes
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {complianceNotes.map((note, i) => (
                      <p key={i} className="text-xs text-amber-400/80 flex items-start gap-2">
                        <span className="text-amber-400 mt-0.5">•</span>
                        {note}
                      </p>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="embed" className="mt-6">
          <Card className="bg-slate-800/40 border-slate-700/50">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Code className="w-5 h-5 text-cyan-400" /> Embed Code
              </CardTitle>
              <CardDescription>
                Copy this HTML and paste it into your website to display the lead capture form.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <pre className="bg-slate-900/80 border border-slate-700/30 rounded-xl p-4 text-xs text-emerald-400 font-mono overflow-x-auto max-h-96 whitespace-pre-wrap" data-testid="text-embed-code">
                  {generateEmbedCode()}
                </pre>
                <Button
                  size="sm"
                  variant="outline"
                  className="absolute top-3 right-3 border-slate-600 text-slate-300 hover:bg-slate-700"
                  onClick={handleCopy}
                  data-testid="button-copy-embed"
                >
                  {copied ? <Check className="w-4 h-4 mr-1 text-emerald-400" /> : <Copy className="w-4 h-4 mr-1" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>

              <div className="flex items-center gap-3 p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/20">
                <AlertTriangle className="w-5 h-5 text-indigo-400 flex-shrink-0" />
                <div>
                  <p className="text-sm text-indigo-300 font-medium">Integration Tip</p>
                  <p className="text-xs text-indigo-400/70">
                    Paste this code just before the closing &lt;/body&gt; tag on your client's website, or add it inside any container div.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      {showTutorial && <TutorialOverlay steps={FORM_BUILDER_STEPS} storageKey="apex_tutorial_form_builder" onClose={closeTutorial} accentColor="purple" />}
    </div>
  );
}
