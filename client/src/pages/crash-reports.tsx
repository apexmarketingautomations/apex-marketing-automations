import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  FileText, ChevronLeft, Car, Users, MapPin,
  CheckCircle2, XCircle, Loader2, Eye, FileWarning, Upload, AlertCircle,
  Clock, Database, Shield
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/hooks/use-account";
import type { SubAccount } from "@shared/schema";

interface CrashReportSummary {
  id: number;
  reportNumber: string;
  status: string;
  requesterRole: string | null;
  reason: string | null;
  subAccountId: number | null;
  retryCount: number;
  hasData: boolean;
  errorLog: string | null;
  createdAt: string;
  updatedAt: string;
}

interface VehicleData {
  VehicleNumber: number;
  Year: string;
  Make: string;
  Model: string;
  Color: string;
  TagNumber: string;
  TagState: string;
  InsuranceCompany: string;
  Driver: {
    Name: string;
    Address: string;
    InjuryType: string;
  };
}

interface PassengerData {
  Name: string;
  VehicleNumber: number;
  InjuryType: string;
}

interface CrashReportData {
  ReportNumber: string;
  CrashDate: string;
  CrashTime: string;
  CrashCity: string;
  CrashCounty: string;
  CrashStreet: string;
  IntersectingStreet: string;
  Latitude: number;
  Longitude: number;
  TotalVehicles: number;
  TotalInjuries: number;
  TotalFatalities: number;
  WeatherCondition: string;
  LightCondition: string;
  RoadSurfaceCondition: string;
  Vehicles: VehicleData[];
  Passengers: PassengerData[];
  Narrative: string;
  DiagramUrl: string | null;
}

interface CrashReportStoredData {
  searchResult?: any;
  detail?: CrashReportData;
  fetchedAt?: string;
  source?: string;
}

interface CrashReportDetail {
  id: number;
  reportNumber: string;
  status: string;
  requesterRole: string | null;
  reason: string | null;
  data: CrashReportStoredData | CrashReportData | null;
  errorLog: string | null;
  createdAt: string;
  updatedAt: string;
}

function extractReportData(raw: CrashReportStoredData | CrashReportData | null): CrashReportData | null {
  if (!raw) return null;
  if ('detail' in raw && raw.detail) return raw.detail as CrashReportData;
  if ('ReportNumber' in raw) return raw as CrashReportData;
  return null;
}

function getDataSource(raw: CrashReportStoredData | CrashReportData | null): string {
  if (!raw) return "none";
  if ('source' in raw && raw.source) return raw.source as string;
  return "unknown";
}

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; bg: string; label: string }> = {
  COMPLETED: { icon: CheckCircle2, color: "text-green-400", bg: "bg-green-500/20 border-green-500/30", label: "Completed" },
  PENDING: { icon: Loader2, color: "text-amber-400", bg: "bg-amber-500/20 border-amber-500/30", label: "Pending" },
  PROCESSING: { icon: Loader2, color: "text-cyan-400", bg: "bg-cyan-500/20 border-cyan-500/30", label: "Processing" },
  FAILED: { icon: XCircle, color: "text-red-400", bg: "bg-red-500/20 border-red-500/30", label: "Failed" },
  NOT_FOUND: { icon: FileWarning, color: "text-slate-400", bg: "bg-slate-500/20 border-slate-500/30", label: "Not Found" },
};

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  } catch {
    return dateStr || "—";
  }
}

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${config.bg} ${config.color}`} data-testid={`badge-status-${status}`}>
      <Icon size={12} className={status === "PENDING" || status === "PROCESSING" ? "animate-spin" : ""} />
      {config.label}
    </span>
  );
}

function DataSourceBadge({ source }: { source: string }) {
  if (source === "FLHSMV") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border bg-blue-500/20 border-blue-500/30 text-blue-400" data-testid="badge-source-flhsmv">
        <Shield size={12} />
        FLHSMV Official
      </span>
    );
  }
  if (source === "manual") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border bg-orange-500/20 border-orange-500/30 text-orange-400" data-testid="badge-source-manual">
        <Upload size={12} />
        Manual Entry
      </span>
    );
  }
  if (source === "sentinel") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border bg-purple-500/20 border-purple-500/30 text-purple-400" data-testid="badge-source-sentinel">
        <Database size={12} />
        Sentinel Incident
      </span>
    );
  }
  return null;
}

function RawDataSubmitForm({ reportId, onSuccess }: { reportId: number; onSuccess: () => void }) {
  const [rawDataInput, setRawDataInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const data = JSON.parse(rawDataInput);
      const res = await fetch(`/api/crash-reports/${reportId}/data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to submit data");
      }

      onSuccess();
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        setSubmitError("Invalid JSON format. Please check your input.");
      } else {
        setSubmitError(err.message || "Submission failed");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Upload size={14} className="text-orange-400" />
          Submit Raw Crash Report Data
        </h3>
      </div>
      <p className="text-slate-400 text-xs mb-3">
        Paste crash report data as JSON. The system will normalize field names automatically.
        Supports both PascalCase (CrashDate) and camelCase (crashDate) field names.
      </p>
      <textarea
        value={rawDataInput}
        onChange={(e) => setRawDataInput(e.target.value)}
        placeholder={`{
  "CrashDate": "01/15/2025",
  "CrashTime": "14:30",
  "CrashCity": "Miami",
  "CrashCounty": "Miami-Dade",
  "CrashStreet": "NW 7th St",
  "Narrative": "Vehicle 1 rear-ended Vehicle 2...",
  "Vehicles": [
    {
      "VehicleNumber": 1,
      "Year": "2020",
      "Make": "Toyota",
      "Model": "Camry",
      "Driver": { "Name": "John Doe", "InjuryType": "None" }
    }
  ]
}`}
        className="w-full h-72 bg-black/50 border border-white/10 rounded-lg p-3 text-slate-300 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-orange-500"
        data-testid="textarea-raw-data"
      />
      {submitError && (
        <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-300 text-xs flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {submitError}
        </div>
      )}
      <Button
        onClick={handleSubmit}
        disabled={isSubmitting || !rawDataInput.trim()}
        className="mt-3 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="button-submit-raw-data-form"
      >
        {isSubmitting ? (
          <>
            <Loader2 size={16} className="mr-2 animate-spin" />
            Submitting...
          </>
        ) : (
          <>
            <CheckCircle2 size={16} className="mr-2" />
            Save Report Data
          </>
        )}
      </Button>
    </div>
  );
}

function ReportDetailView({ reportId, onBack }: { reportId: number; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [showRawDataForm, setShowRawDataForm] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const { data: report, isLoading } = useQuery<CrashReportDetail>({
    queryKey: ["/api/crash-reports", reportId],
    queryFn: async () => {
      const res = await fetch(`/api/crash-reports/${reportId}`);
      if (!res.ok) throw new Error("Failed to fetch report");
      return res.json();
    },
  });

  const handleRawDataSuccess = () => {
    setSubmitSuccess(true);
    setShowRawDataForm(false);
    queryClient.invalidateQueries({ queryKey: ["/api/crash-reports", reportId] });
    queryClient.invalidateQueries({ queryKey: ["/api/crash-reports"] });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-red-400" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="text-center py-20">
        <FileWarning size={48} className="mx-auto text-slate-600 mb-4" />
        <p className="text-slate-400">Report not found</p>
        <Button variant="ghost" onClick={onBack} className="mt-4 text-slate-400">
          <ChevronLeft size={16} className="mr-1" /> Back to list
        </Button>
      </div>
    );
  }

  const d = extractReportData(report.data);
  const source = getDataSource(report.data);
  const isSentinelOnly = source === "sentinel" && !d;
  const isWaitingForReport = report.status === "PENDING" || report.status === "PROCESSING";
  const isFailedOrNotFound = report.status === "FAILED" || report.status === "NOT_FOUND";
  const retryCount = report.retryCount ?? 0;
  const updatedAt = report.updatedAt ? new Date(report.updatedAt).getTime() : 0;
  const ageMinutes = updatedAt ? (Date.now() - updatedAt) / 60000 : 0;
  const isStuck = isWaitingForReport && (retryCount >= 3 || ageMinutes > 15);
  const showManualSubmit = (isFailedOrNotFound || isStuck) && !d;

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
      <Button variant="ghost" onClick={onBack} className="text-slate-400 hover:text-white mb-4" data-testid="button-back-to-list">
        <ChevronLeft size={16} className="mr-1" /> Back to Crash Reports
      </Button>

      <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <h2 className="text-2xl font-black text-white" data-testid="text-report-number">
              Report #{report.reportNumber}
            </h2>
            <p className="text-slate-500 text-sm">Requested {formatDate(report.createdAt)}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={report.status} />
            <DataSourceBadge source={source} />
          </div>
        </div>

        {report.status === "FAILED" && report.errorLog && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-300 text-sm mb-4" data-testid="text-error-log">
            {report.errorLog}
          </div>
        )}

        {report.status === "NOT_FOUND" && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-amber-300 text-sm mb-4" data-testid="text-not-found-info">
            <div className="flex items-start gap-2">
              <Clock size={16} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold mb-1">Report Not Yet Available</p>
                <p className="text-amber-300/80 text-xs">
                  {report.errorLog || "FLHSMV crash reports typically take 10+ days after the incident to appear in the state system. The system will continue checking automatically."}
                </p>
              </div>
            </div>
          </div>
        )}

        {isWaitingForReport && (
          <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-3 text-cyan-300 text-sm mb-4" data-testid="text-processing-info">
            <div className="flex items-start gap-2">
              <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" />
              <div>
                <p className="font-semibold mb-1">Searching for Report</p>
                <p className="text-cyan-300/80 text-xs">
                  The system is checking FLHSMV for this report. Reports typically become available 10+ days after the crash date.
                  {retryCount > 0 && ` (Attempt ${retryCount}/5)`}
                </p>
              </div>
            </div>
          </div>
        )}

        {submitSuccess && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-green-300 text-sm mb-4 flex items-center gap-2" data-testid="text-submit-success">
            <CheckCircle2 size={16} />
            Crash report data saved successfully!
          </div>
        )}

        {showManualSubmit && (
          <div className="mt-4">
            {isStuck && !isFailedOrNotFound && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-amber-300 text-sm mb-3 flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <p className="text-xs">This report appears stuck. You can submit raw data manually while the system continues retrying.</p>
              </div>
            )}
            {!showRawDataForm ? (
              <Button
                onClick={() => setShowRawDataForm(true)}
                className="bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 text-white"
                data-testid="button-submit-raw-data"
              >
                <Upload size={16} className="mr-2" />
                Submit Raw Data Manually
              </Button>
            ) : (
              <RawDataSubmitForm reportId={reportId} onSuccess={handleRawDataSuccess} />
            )}
          </div>
        )}
      </div>

      {d ? (
        <div className="space-y-6">
          <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <MapPin size={14} className="text-red-400" /> Crash Location & Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <InfoField label="Date" value={d.CrashDate} testId="text-crash-date" />
              <InfoField label="Time" value={d.CrashTime} testId="text-crash-time" />
              <InfoField label="City" value={d.CrashCity} testId="text-crash-city" />
              <InfoField label="County" value={d.CrashCounty} testId="text-crash-county" />
              <InfoField label="Street" value={d.CrashStreet} testId="text-crash-street" />
              <InfoField label="Intersecting Street" value={d.IntersectingStreet} testId="text-crash-intersection" />
              {d.Latitude && d.Longitude && (
                <InfoField label="Coordinates" value={`${d.Latitude}, ${d.Longitude}`} testId="text-crash-coords" />
              )}
              <InfoField label="Total Vehicles" value={String(d.TotalVehicles || 0)} testId="text-total-vehicles" />
              <InfoField label="Total Injuries" value={String(d.TotalInjuries || 0)} testId="text-total-injuries" />
              <InfoField label="Total Fatalities" value={String(d.TotalFatalities || 0)} testId="text-total-fatalities" />
              <InfoField label="Weather" value={d.WeatherCondition} testId="text-weather" />
              <InfoField label="Light Condition" value={d.LightCondition} testId="text-light" />
              <InfoField label="Road Surface" value={d.RoadSurfaceCondition} testId="text-road-surface" />
            </div>
          </div>

          {d.Vehicles && d.Vehicles.length > 0 && (
            <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Car size={14} className="text-orange-400" /> Vehicles & Drivers
              </h3>
              <div className="space-y-4">
                {d.Vehicles.map((v, i) => (
                  <div key={i} className="bg-white/5 border border-white/5 rounded-xl p-4" data-testid={`card-vehicle-${i}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-bold text-white bg-white/10 px-2 py-0.5 rounded">Vehicle {v.VehicleNumber || i + 1}</span>
                      <span className="text-sm text-slate-300">
                        {[v.Year, v.Make, v.Model].filter(Boolean).join(" ") || "Unknown Vehicle"}
                      </span>
                      {v.Color && <span className="text-xs text-slate-500">({v.Color})</span>}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      <InfoField label="Tag Number" value={v.TagNumber} testId={`text-tag-${i}`} />
                      <InfoField label="Tag State" value={v.TagState} testId={`text-tag-state-${i}`} />
                      <InfoField label="Insurance Company" value={v.InsuranceCompany} testId={`text-insurance-${i}`} />
                      {v.Driver && (
                        <>
                          <InfoField label="Driver Name" value={v.Driver.Name} testId={`text-driver-name-${i}`} />
                          <InfoField label="Driver Address" value={v.Driver.Address} testId={`text-driver-address-${i}`} />
                          <InfoField label="Driver Injury" value={v.Driver.InjuryType} testId={`text-driver-injury-${i}`} />
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {d.Passengers && d.Passengers.length > 0 && (
            <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Users size={14} className="text-cyan-400" /> Passengers
              </h3>
              <div className="space-y-3">
                {d.Passengers.map((p, i) => (
                  <div key={i} className="bg-white/5 border border-white/5 rounded-xl p-4 grid grid-cols-1 md:grid-cols-3 gap-3" data-testid={`card-passenger-${i}`}>
                    <InfoField label="Name" value={p.Name} testId={`text-passenger-name-${i}`} />
                    <InfoField label="Vehicle" value={`Vehicle ${p.VehicleNumber}`} testId={`text-passenger-vehicle-${i}`} />
                    <InfoField label="Injury" value={p.InjuryType} testId={`text-passenger-injury-${i}`} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {d.Narrative && (
            <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <FileText size={14} className="text-emerald-400" /> Narrative
              </h3>
              <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap" data-testid="text-narrative">
                {d.Narrative}
              </p>
            </div>
          )}
        </div>
      ) : report.status === "COMPLETED" && !d && (
        <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6 text-center">
          <FileWarning size={36} className="mx-auto text-slate-600 mb-3" />
          <h3 className="text-white font-bold mb-1">Data Format Issue</h3>
          <p className="text-slate-500 text-sm max-w-md mx-auto">
            This report has data attached but it could not be parsed into the expected format.
            You can re-submit raw data to fix this.
          </p>
          <Button
            onClick={() => setShowRawDataForm(true)}
            className="mt-4 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 text-white"
            data-testid="button-resubmit-raw-data"
          >
            <Upload size={16} className="mr-2" />
            Re-submit Data
          </Button>
          {showRawDataForm && (
            <div className="mt-4 text-left">
              <RawDataSubmitForm reportId={reportId} onSuccess={handleRawDataSuccess} />
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

function InfoField({ label, value, testId }: { label: string; value: string | undefined | null; testId: string }) {
  return (
    <div>
      <p className="text-[10px] text-slate-600 uppercase font-bold tracking-widest mb-0.5">{label}</p>
      <p className="text-sm text-white font-medium" data-testid={testId}>{value || "—"}</p>
    </div>
  );
}

export default function CrashReports() {
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const { activeAccountId } = useAccount();
  const { data: accounts = [] } = useQuery<SubAccount[]>({ queryKey: ["/api/accounts"] });
  const currentAccount = accounts.find(a => a.id === activeAccountId) || accounts[0];

  const { data: reports = [], isLoading } = useQuery<CrashReportSummary[]>({
    queryKey: ["/api/crash-reports", currentAccount?.id],
    enabled: !!currentAccount?.id,
    queryFn: async () => {
      const res = await fetch(`/api/crash-reports?subAccountId=${currentAccount!.id}`);
      if (!res.ok) throw new Error("Failed to fetch crash reports");
      return res.json();
    },
    refetchInterval: 15000,
  });

  if (selectedReportId !== null) {
    return (
      <div className="p-6 md:p-10 max-w-6xl mx-auto">
        <ReportDetailView reportId={selectedReportId} onBack={() => setSelectedReportId(null)} />
      </div>
    );
  }

  const completedReports = reports.filter(r => r.status === "COMPLETED");
  const pendingReports = reports.filter(r => r.status === "PENDING" || r.status === "PROCESSING");
  const failedReports = reports.filter(r => r.status === "FAILED" || r.status === "NOT_FOUND");

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-600 to-orange-500 flex items-center justify-center">
            <FileText size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight" data-testid="text-crash-reports-title">
              Crash Reports
            </h1>
            <p className="text-slate-400 text-sm">
              FLHSMV crash report data — reports typically available 10+ days after incident
            </p>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Reports" value={reports.length} icon={FileText} color="red" delay={0.05} testId="card-total-reports" />
        <StatCard label="Completed" value={completedReports.length} icon={CheckCircle2} color="green" delay={0.1} testId="card-completed-reports" />
        <StatCard label="Processing" value={pendingReports.length} icon={Loader2} color="amber" delay={0.15} testId="card-processing-reports" />
        <StatCard label="Failed" value={failedReports.length} icon={XCircle} color="red" delay={0.2} testId="card-failed-reports" />
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
        className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6"
      >
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-white/5 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : reports.length === 0 ? (
          <div className="text-center py-16">
            <FileText size={48} className="mx-auto text-slate-700 mb-4" />
            <h3 className="text-white font-bold text-lg mb-2">No Crash Reports</h3>
            <p className="text-slate-500 text-sm max-w-md mx-auto">
              Request a crash report from the Sentinel page to see it here.
              Reports typically become available 10+ days after the crash date.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {reports.map((report, i) => (
              <motion.div
                key={report.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 hover:border-white/10 cursor-pointer transition-all group"
                onClick={() => setSelectedReportId(report.id)}
                data-testid={`row-report-${report.id}`}
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="shrink-0">
                    <StatusBadge status={report.status} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white font-bold text-sm" data-testid={`text-report-number-${report.id}`}>
                      #{report.reportNumber}
                    </p>
                    <p className="text-slate-500 text-xs truncate">
                      {report.reason || "No reason specified"} · {formatDate(report.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {report.hasData && (
                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider" data-testid={`text-data-available-${report.id}`}>Data Available</span>
                  )}
                  <Eye size={16} className="text-slate-600 group-hover:text-white transition-colors" />
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color, delay, testId }: {
  label: string; value: number; icon: typeof FileText; color: string; delay: number; testId: string;
}) {
  const colorMap: Record<string, string> = {
    red: "border-red-500/30",
    green: "border-green-500/30",
    amber: "border-amber-500/30",
    cyan: "border-cyan-500/30",
  };
  const textMap: Record<string, string> = {
    red: "text-red-500",
    green: "text-green-500",
    amber: "text-amber-500",
    cyan: "text-cyan-500",
  };
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      className={`bg-[#0a0a0a] border ${colorMap[color]} p-4 rounded-2xl`}
      data-testid={testId}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} className={textMap[color]} />
        <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">{label}</p>
      </div>
      <p className="text-3xl font-black text-white">{value}</p>
    </motion.div>
  );
}
