import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import AppLayout from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Target, Phone, Mail, Users, Search, Filter, Save,
  ChevronRight, ChevronDown, AlertTriangle, CheckCircle2, XCircle,
  Loader2, Building2, User, MapPin, Briefcase, Zap,
  Download, Send, Clock, Bookmark, Trash2, Eye, EyeOff,
  SlidersHorizontal, ToggleLeft, ToggleRight, RefreshCw,
  ArrowRight, PhoneCall, MailPlus, FileSearch, Heart, RotateCcw, Info
} from "lucide-react";

const EMERALD = "#10B981";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const BLUE = "#3B82F6";
const AMBER = "#F59E0B";
const ERROR = "#EF4444";
const PURPLE = "#8B5CF6";
const SUBTLE = "#F8FAFC";

interface TargetFilters {
  industry: string;
  territory: string;
  role: string;
  matchMode: "broad" | "balanced" | "strict";
  priority: string;
  mustHavePhone: boolean;
  mustHaveDM: boolean;
  mustHaveEmail: boolean;
  mustHaveSignal: boolean;
  warmLeads: boolean;
  staleLeads: boolean;
  freshLeads: boolean;
  hasDM: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
}

interface TargetResult {
  id: number;
  companyId: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  phone: string | null;
  title: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  lastOutcome: string | null;
  pipelineStatus: string;
  updatedAt: string;
  matchReasons: string[];
  dataSignals: string[];
  priorityReasons: string[];
  recommendedAction: string;
  recommendedActionType: string;
  verifiedQualityScore: number | null;
  verifiedQualityLabel: string | null;
  outcomeSource: string | null;
}

interface TargetQueryResponse {
  total: number;
  allCount: number;
  summary: { hasPhone: number; hasEmail: number; hasDM: number; warmCount: number };
  results: TargetResult[];
  exclusions: Array<{ reason: string; count: number }>;
  filterOptions: { industries: string[]; states: string[] };
}

interface SavedProfile {
  id: number;
  name: string;
  filters: string;
  createdAt: string;
}

const DEFAULT_FILTERS: TargetFilters = {
  industry: "",
  territory: "",
  role: "",
  matchMode: "broad",
  priority: "",
  mustHavePhone: false,
  mustHaveDM: false,
  mustHaveEmail: false,
  mustHaveSignal: false,
  warmLeads: false,
  staleLeads: false,
  freshLeads: false,
  hasDM: false,
  hasPhone: false,
  hasEmail: false,
};

function Toggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all" style={{
      background: active ? `${EMERALD}10` : SUBTLE,
      border: `1px solid ${active ? EMERALD : BORDER}`,
      color: active ? EMERALD : TEXT,
    }}>
      {active ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" style={{ color: MUTED }} />}
      {label}
    </button>
  );
}

export default function TargetingPage() {
  const { getToken } = useAuth();
  const token = getToken();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [filters, setFilters] = useState<TargetFilters>({ ...DEFAULT_FILTERS });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveName, setSaveName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [debouncedFilters, setDebouncedFilters] = useState<TargetFilters>({ ...DEFAULT_FILTERS });
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters({ ...filters });
      setSelected(new Set());
    }, 400);
    return () => clearTimeout(timer);
  }, [filters]);

  const { data, isLoading, isError } = useQuery<TargetQueryResponse>({
    queryKey: ["/api/targeting/query", debouncedFilters],
    queryFn: async () => {
      const res = await fetch("/api/targeting/query", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(debouncedFilters),
      });
      if (!res.ok) throw new Error("Query failed");
      return res.json();
    },
    enabled: !!token,
  });

  const { data: profiles, refetch: refetchProfiles } = useQuery<SavedProfile[]>({
    queryKey: ["/api/targeting/profiles"],
    enabled: !!token,
  });

  const saveMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/targeting/profiles", { name, filters });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Profile saved" });
      setSaveName("");
      setShowSaveInput(false);
      refetchProfiles();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/targeting/profiles/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Profile deleted" });
      refetchProfiles();
    },
  });

  const sendToFocusMutation = useMutation({
    mutationFn: async (companyIds: string[]) => {
      const res = await apiRequest("POST", "/api/targeting/send-to-focus", { companyIds });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Sent to Focus Mode", description: `${data.created} added, ${data.skipped} already queued` });
      setSelected(new Set());
    },
  });

  const addToFollowupMutation = useMutation({
    mutationFn: async (companyIds: string[]) => {
      const res = await apiRequest("POST", "/api/targeting/add-to-followup", { companyIds });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Added to follow-up", description: `${data.created} flows created, ${data.skipped} already active` });
      setSelected(new Set());
    },
  });

  const syncTranscriptsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/targeting/sync-transcripts", {});
      return res.json();
    },
    onSuccess: (data: any) => {
      const desc = [];
      if (data.analyzed) desc.push(`${data.analyzed} transcripts analyzed`);
      if (data.outcomesUpdated) desc.push(`${data.outcomesUpdated} outcomes updated`);
      if (data.downgraded) desc.push(`${data.downgraded} downgraded`);
      if (data.synced) desc.push(`${data.synced} already synced`);
      toast({ title: "Transcript sync complete", description: desc.join(", ") || "No new data to sync" });
      queryClient.invalidateQueries({ queryKey: ["/api/targeting/query"] });
    },
    onError: () => {
      toast({ title: "Sync failed", variant: "destructive" });
    },
  });

  const loadProfile = (profile: SavedProfile) => {
    try {
      const parsed = JSON.parse(profile.filters);
      setFilters({ ...DEFAULT_FILTERS, ...parsed });
      toast({ title: `Loaded: ${profile.name}` });
    } catch { }
  };

  const toggleAll = () => {
    if (!visibleResults.length) return;
    if (selected.size === visibleResults.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleResults.map(r => r.companyId)));
    }
  };

  const toggleOne = (companyId: string) => {
    const next = new Set(selected);
    if (next.has(companyId)) next.delete(companyId);
    else next.add(companyId);
    setSelected(next);
  };

  const toggleExpanded = (id: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const markIgnored = (companyIds: string[]) => {
    setIgnoredIds(prev => {
      const next = new Set(prev);
      companyIds.forEach(id => next.add(id));
      return next;
    });
    setSelected(new Set());
    toast({ title: `${companyIds.length} lead(s) marked as ignored` });
  };

  const visibleResults = (data?.results || []).filter(r => !ignoredIds.has(r.companyId));

  const saveSegmentMutation = useMutation({
    mutationFn: async () => {
      const segmentName = `Segment ${new Date().toLocaleDateString()} (${selected.size} leads)`;
      const segmentFilters = { ...filters, _segmentCompanyIds: Array.from(selected) };
      const res = await apiRequest("POST", "/api/targeting/profiles", { name: segmentName, filters: segmentFilters });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved as segment", description: `${selected.size} leads saved` });
      setSelected(new Set());
      refetchProfiles();
    },
  });

  const exportCSV = () => {
    if (!data?.results) return;
    const rows = visibleResults.filter(r => selected.size === 0 || selected.has(r.companyId));
    const header = "Company,Contact,Title,Phone,Email,Industry,City,State,Last Outcome,Match Reasons,Priority Reasons,Recommended Action";
    const csv = [header, ...rows.map(r =>
      `"${r.companyName}","${r.contactName || ""}","${r.title || ""}","${r.phone || ""}","${r.contactEmail || ""}","${r.industry || ""}","${r.city || ""}","${r.state || ""}","${r.lastOutcome || ""}","${r.matchReasons.join("; ")}","${r.priorityReasons.join("; ")}","${r.recommendedAction}"`
    )].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `targeting_export_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const updateFilter = <K extends keyof TargetFilters>(key: K, value: TargetFilters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const activeFilterCount = [
    filters.industry, filters.territory, filters.role,
    filters.mustHavePhone, filters.mustHaveDM, filters.mustHaveEmail, filters.mustHaveSignal,
    filters.warmLeads, filters.staleLeads, filters.freshLeads,
    filters.hasDM, filters.hasPhone, filters.hasEmail,
    filters.matchMode !== "broad",
    filters.priority,
  ].filter(Boolean).length;

  const selIds = Array.from(selected);

  return (
    <AppLayout>
      <div className="p-4 md:p-6" style={{ minHeight: "calc(100vh - 56px)" }}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold tracking-tight" style={{ color: TEXT }} data-testid="text-targeting-title">
              Targeting Control Panel
            </h1>
            <p className="text-xs mt-0.5" style={{ color: MUTED }}>
              Shape your targeting. Filter, preview, and deploy leads to outreach.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => syncTranscriptsMutation.mutate()} disabled={syncTranscriptsMutation.isPending} className="gap-1.5 text-xs" style={{ borderColor: BORDER, color: syncTranscriptsMutation.isPending ? MUTED : BLUE }} data-testid="button-sync-transcripts">
              <RefreshCw className={`w-3.5 h-3.5 ${syncTranscriptsMutation.isPending ? "animate-spin" : ""}`} />
              {syncTranscriptsMutation.isPending ? "Syncing..." : "Sync Transcripts"}
            </Button>
            {activeFilterCount > 0 && (
              <Button variant="outline" size="sm" onClick={() => setFilters({ ...DEFAULT_FILTERS })} className="gap-1.5 text-xs" style={{ borderColor: BORDER, color: MUTED }} data-testid="button-clear-filters">
                <RefreshCw className="w-3.5 h-3.5" /> Clear Filters
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          <div className="lg:col-span-1 space-y-4">
            <div className="rounded-xl p-4" style={{ background: "white", border: `1px solid ${BORDER}` }}>
              <div className="flex items-center gap-2 mb-3">
                <Filter className="w-4 h-4" style={{ color: BLUE }} />
                <span className="text-sm font-bold" style={{ color: TEXT }}>Core Filters</span>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Industry</label>
                  <Input
                    placeholder="e.g. HVAC, Industrial"
                    value={filters.industry}
                    onChange={e => updateFilter("industry", e.target.value)}
                    className="mt-1 h-8 text-xs"
                    list="industry-options"
                    data-testid="input-industry"
                  />
                  {data?.filterOptions?.industries && (
                    <datalist id="industry-options">
                      {data.filterOptions.industries.map(i => <option key={i} value={i!} />)}
                    </datalist>
                  )}
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Territory / Region</label>
                  <Input
                    placeholder="e.g. Houston, TX"
                    value={filters.territory}
                    onChange={e => updateFilter("territory", e.target.value)}
                    className="mt-1 h-8 text-xs"
                    list="state-options"
                    data-testid="input-territory"
                  />
                  {data?.filterOptions?.states && (
                    <datalist id="state-options">
                      {data.filterOptions.states.map(s => <option key={s} value={s!} />)}
                    </datalist>
                  )}
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Role / Function</label>
                  <Input
                    placeholder="e.g. Owner, Manager"
                    value={filters.role}
                    onChange={e => updateFilter("role", e.target.value)}
                    className="mt-1 h-8 text-xs"
                    data-testid="input-role"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-xl p-4" style={{ background: "white", border: `1px solid ${BORDER}` }}>
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4" style={{ color: AMBER }} />
                <span className="text-sm font-bold" style={{ color: TEXT }}>Signal Filters</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Toggle active={filters.warmLeads} onClick={() => updateFilter("warmLeads", !filters.warmLeads)} label="Warm Leads" />
                <Toggle active={filters.freshLeads} onClick={() => updateFilter("freshLeads", !filters.freshLeads)} label="Fresh / Untouched" />
                <Toggle active={filters.staleLeads} onClick={() => updateFilter("staleLeads", !filters.staleLeads)} label="Stale (7+ days)" />
                <Toggle active={filters.hasDM} onClick={() => updateFilter("hasDM", !filters.hasDM)} label="DM Identified" />
                <Toggle active={filters.hasPhone} onClick={() => updateFilter("hasPhone", !filters.hasPhone)} label="Phone Found" />
                <Toggle active={filters.hasEmail} onClick={() => updateFilter("hasEmail", !filters.hasEmail)} label="Email Found" />
              </div>
            </div>

            <div className="rounded-xl p-4" style={{ background: "white", border: `1px solid ${BORDER}` }}>
              <div className="flex items-center gap-2 mb-3">
                <SlidersHorizontal className="w-4 h-4" style={{ color: PURPLE }} />
                <span className="text-sm font-bold" style={{ color: TEXT }}>Strictness & Priority</span>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Match Mode</label>
                  <div className="flex gap-1 mt-1">
                    {(["broad", "balanced", "strict"] as const).map(mode => (
                      <button
                        key={mode}
                        onClick={() => updateFilter("matchMode", mode)}
                        className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all"
                        style={{
                          background: filters.matchMode === mode ? `${PURPLE}12` : SUBTLE,
                          border: `1px solid ${filters.matchMode === mode ? PURPLE : BORDER}`,
                          color: filters.matchMode === mode ? PURPLE : MUTED,
                        }}
                        data-testid={`match-mode-${mode}`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Priority Objective</label>
                  <select
                    value={filters.priority}
                    onChange={e => updateFilter("priority", e.target.value)}
                    className="w-full mt-1 h-8 text-xs rounded-lg px-2"
                    style={{ border: `1px solid ${BORDER}`, background: "white", color: TEXT }}
                    data-testid="select-priority"
                  >
                    <option value="">Default (most recent)</option>
                    <option value="most_likely_to_answer">Most likely to answer</option>
                    <option value="fresh_untouched">Fresh untouched leads</option>
                    <option value="fastest_to_meeting">Fastest path to meeting</option>
                    <option value="highest_value">Highest-value accounts</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Required Fields</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <Toggle active={filters.mustHavePhone} onClick={() => updateFilter("mustHavePhone", !filters.mustHavePhone)} label="Phone" />
                    <Toggle active={filters.mustHaveDM} onClick={() => updateFilter("mustHaveDM", !filters.mustHaveDM)} label="DM" />
                    <Toggle active={filters.mustHaveEmail} onClick={() => updateFilter("mustHaveEmail", !filters.mustHaveEmail)} label="Email" />
                    <Toggle active={filters.mustHaveSignal} onClick={() => updateFilter("mustHaveSignal", !filters.mustHaveSignal)} label="Signal" />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl p-4" style={{ background: "white", border: `1px solid ${BORDER}` }}>
              <div className="flex items-center gap-2 mb-3">
                <Bookmark className="w-4 h-4" style={{ color: EMERALD }} />
                <span className="text-sm font-bold" style={{ color: TEXT }}>Saved Profiles</span>
              </div>
              {showSaveInput ? (
                <div className="flex gap-2 mb-2">
                  <Input
                    placeholder="Profile name..."
                    value={saveName}
                    onChange={e => setSaveName(e.target.value)}
                    className="h-8 text-xs flex-1"
                    data-testid="input-profile-name"
                  />
                  <Button size="sm" className="h-8 text-xs px-3" style={{ background: EMERALD, color: "white" }} onClick={() => saveMutation.mutate(saveName)} disabled={!saveName || saveMutation.isPending} data-testid="button-save-profile">
                    {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 text-xs px-2" onClick={() => setShowSaveInput(false)}>
                    <XCircle className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setShowSaveInput(true)} className="w-full h-8 text-xs gap-1.5 mb-2" style={{ borderColor: BORDER, color: MUTED }} data-testid="button-show-save">
                  <Save className="w-3.5 h-3.5" /> Save Current Filters
                </Button>
              )}
              {(profiles || []).length > 0 ? (
                <div className="space-y-1">
                  {profiles!.map(p => (
                    <div key={p.id} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: SUBTLE }} data-testid={`profile-${p.id}`}>
                      <button onClick={() => loadProfile(p)} className="flex-1 text-left text-xs font-medium truncate" style={{ color: TEXT }}>
                        {p.name}
                      </button>
                      <button onClick={() => deleteMutation.mutate(p.id)} className="flex-shrink-0" data-testid={`delete-profile-${p.id}`}>
                        <Trash2 className="w-3 h-3" style={{ color: ERROR }} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-center py-2" style={{ color: MUTED }}>No saved profiles yet</p>
              )}
            </div>
          </div>

          <div className="lg:col-span-3 space-y-4">
            {data && (
              <div className="rounded-xl p-4" style={{ background: "white", border: `1px solid ${BORDER}` }} data-testid="target-summary-bar">
                <div className="flex items-center gap-2 mb-3">
                  <Target className="w-4 h-4" style={{ color: EMERALD }} />
                  <span className="text-sm font-bold" style={{ color: TEXT }}>Target Summary</span>
                  <span className="text-[10px] font-medium ml-auto" style={{ color: MUTED }}>
                    {data.total} of {data.allCount} records match
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {[
                    { label: "Matching", value: data.total, color: EMERALD, icon: Users },
                    { label: "With Phone", value: data.summary.hasPhone, color: BLUE, icon: Phone },
                    { label: "With Email", value: data.summary.hasEmail, color: PURPLE, icon: Mail },
                    { label: "With DM", value: data.summary.hasDM, color: AMBER, icon: User },
                    { label: "Warm Leads", value: data.summary.warmCount, color: ERROR, icon: Target },
                  ].map(s => (
                    <div key={s.label} className="rounded-lg p-3 text-center" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }} data-testid={`summary-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      <s.icon className="w-4 h-4 mx-auto mb-1" style={{ color: s.color }} />
                      <div className="text-lg font-bold" style={{ color: TEXT }}>{s.value}</div>
                      <div className="text-[10px] font-medium" style={{ color: MUTED }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data && data.exclusions.length > 0 && (
              <div className="rounded-xl p-4" style={{ background: `${AMBER}06`, border: `1px solid ${AMBER}20` }} data-testid="coverage-diagnostics">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4" style={{ color: AMBER }} />
                  <span className="text-sm font-bold" style={{ color: TEXT }}>Coverage Diagnostics</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {data.exclusions.map((ex, i) => (
                    <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "white", border: `1px solid ${BORDER}` }}>
                      <XCircle className="w-3 h-3" style={{ color: AMBER }} />
                      <span style={{ color: TEXT }}>{ex.reason}</span>
                      <span className="font-bold" style={{ color: AMBER }}>{ex.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selected.size > 0 && (
              <div className="rounded-xl p-3" style={{ background: `${EMERALD}06`, border: `1px solid ${EMERALD}30` }} data-testid="action-bar">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ background: EMERALD, color: "white" }}>{selected.size} selected</span>
                  <div className="h-5 w-px mx-1" style={{ background: BORDER }} />
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    style={{ background: EMERALD, color: "white" }}
                    onClick={() => sendToFocusMutation.mutate(selIds)}
                    disabled={sendToFocusMutation.isPending}
                    data-testid="button-send-to-focus"
                  >
                    {sendToFocusMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    Send to Focus
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    style={{ borderColor: AMBER, color: AMBER }}
                    onClick={() => addToFollowupMutation.mutate(selIds)}
                    disabled={addToFollowupMutation.isPending}
                    data-testid="button-add-followup"
                  >
                    {addToFollowupMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
                    Follow-up Queue
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    style={{ borderColor: PURPLE, color: PURPLE }}
                    onClick={() => saveSegmentMutation.mutate()}
                    disabled={saveSegmentMutation.isPending}
                    data-testid="button-save-segment"
                  >
                    <Bookmark className="w-3 h-3" /> Save as Segment
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" style={{ borderColor: BORDER, color: MUTED }} onClick={exportCSV} data-testid="button-export">
                    <Download className="w-3 h-3" /> Export
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    style={{ borderColor: ERROR, color: ERROR }}
                    onClick={() => markIgnored(selIds)}
                    data-testid="button-mark-ignored"
                  >
                    <EyeOff className="w-3 h-3" /> Mark Ignored
                  </Button>
                </div>
              </div>
            )}

            <div className="rounded-xl" style={{ background: "white", border: `1px solid ${BORDER}` }}>
              <div className="flex items-center justify-between p-4 pb-2">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4" style={{ color: BLUE }} />
                  <span className="text-sm font-bold" style={{ color: TEXT }}>Results Preview</span>
                  {ignoredIds.size > 0 && (
                    <button onClick={() => setIgnoredIds(new Set())} className="text-[10px] font-medium ml-2 underline" style={{ color: MUTED }} data-testid="button-show-ignored">
                      Show {ignoredIds.size} ignored
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {visibleResults.length > 0 && (
                    <>
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" style={{ borderColor: BORDER, color: MUTED }} onClick={toggleAll} data-testid="button-select-all">
                        {selected.size === visibleResults.length ? "Deselect All" : "Select All"}
                      </Button>
                      {selected.size === 0 && (
                        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" style={{ borderColor: BORDER, color: MUTED }} onClick={exportCSV} data-testid="button-export-all">
                          <Download className="w-3 h-3" /> Export All
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: EMERALD }} />
                </div>
              ) : isError ? (
                <div className="text-center py-12">
                  <XCircle className="w-8 h-8 mx-auto mb-2" style={{ color: ERROR }} />
                  <p className="text-sm font-medium" style={{ color: TEXT }}>Failed to load results</p>
                </div>
              ) : data && visibleResults.length === 0 ? (
                <div className="text-center py-12 px-6">
                  <Search className="w-8 h-8 mx-auto mb-2" style={{ color: MUTED }} />
                  <p className="text-sm font-semibold mb-1" style={{ color: TEXT }}>No matching records</p>
                  <p className="text-xs mb-3" style={{ color: MUTED }}>Try loosening your filters to see more results.</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {filters.matchMode !== "broad" && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => updateFilter("matchMode", "broad")} data-testid="suggestion-broad">
                        Switch to Broad mode
                      </Button>
                    )}
                    {(filters.mustHavePhone || filters.mustHaveDM || filters.mustHaveEmail) && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { updateFilter("mustHavePhone", false); updateFilter("mustHaveDM", false); updateFilter("mustHaveEmail", false); }} data-testid="suggestion-remove-required">
                        Remove required field filters
                      </Button>
                    )}
                    {filters.industry && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => updateFilter("industry", "")} data-testid="suggestion-clear-industry">
                        Clear industry filter
                      </Button>
                    )}
                    {filters.territory && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => updateFilter("territory", "")} data-testid="suggestion-clear-territory">
                        Clear territory filter
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div data-testid="results-table">
                  {visibleResults.map((r, i) => {
                    const isExpanded = expandedRows.has(r.id);
                    const actionIcon = r.recommendedActionType === "call" ? PhoneCall
                      : r.recommendedActionType === "email" ? MailPlus
                      : r.recommendedActionType === "research" ? FileSearch
                      : r.recommendedActionType === "reengage" ? RotateCcw
                      : r.recommendedActionType === "nurture" ? Heart
                      : Info;
                    const ActionIcon = actionIcon;
                    const actionColor = r.recommendedActionType === "call" ? EMERALD
                      : r.recommendedActionType === "email" ? BLUE
                      : r.recommendedActionType === "research" ? AMBER
                      : r.recommendedActionType === "reengage" ? PURPLE
                      : MUTED;

                    return (
                      <div
                        key={r.id}
                        className="transition-all"
                        style={{ borderBottom: `1px solid ${BORDER}`, background: selected.has(r.companyId) ? `${EMERALD}06` : i % 2 === 0 ? "white" : SUBTLE }}
                        data-testid={`result-row-${i}`}
                      >
                        <div className="flex items-center gap-3 p-3">
                          <input
                            type="checkbox"
                            checked={selected.has(r.companyId)}
                            onChange={() => toggleOne(r.companyId)}
                            className="rounded flex-shrink-0"
                            data-testid={`checkbox-${r.companyId}`}
                          />

                          <button onClick={() => toggleExpanded(r.id)} className="flex-shrink-0" data-testid={`expand-${r.id}`}>
                            {isExpanded ? <ChevronDown className="w-4 h-4" style={{ color: MUTED }} /> : <ChevronRight className="w-4 h-4" style={{ color: MUTED }} />}
                          </button>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <button onClick={() => navigate(`/machine/company/${r.companyId}`)} className="text-left" data-testid={`link-company-${r.companyId}`}>
                                <span className="text-xs font-bold" style={{ color: TEXT }}>{r.companyName}</span>
                              </button>
                              {r.industry && <span className="text-[10px]" style={{ color: MUTED }}>{r.industry}</span>}
                              <span className="text-[10px]" style={{ color: MUTED }}>{[r.city, r.state].filter(Boolean).join(", ")}</span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-1">
                              {r.contactName && <span className="text-[10px] font-medium" style={{ color: TEXT }}>{r.contactName}</span>}
                              {r.title && <span className="text-[10px]" style={{ color: MUTED }}>{r.contactName ? "·" : ""} {r.title}</span>}
                              <div className="flex gap-1 ml-1">
                                {r.phone && <Phone className="w-2.5 h-2.5" style={{ color: BLUE }} />}
                                {r.contactEmail && <Mail className="w-2.5 h-2.5" style={{ color: PURPLE }} />}
                                {r.contactName && <User className="w-2.5 h-2.5" style={{ color: AMBER }} />}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {r.matchReasons.slice(0, 2).map((reason, ri) => (
                                <span key={ri} className="px-1.5 py-0.5 rounded text-[9px] font-medium whitespace-nowrap" style={{ background: `${EMERALD}10`, color: EMERALD }} data-testid={`match-badge-${i}-${ri}`}>
                                  {reason}
                                </span>
                              ))}
                              {r.matchReasons.length > 2 && (
                                <span className="text-[9px] font-medium" style={{ color: MUTED }}>+{r.matchReasons.length - 2}</span>
                              )}
                            </div>

                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap" style={{
                              background: r.lastOutcome && ["interested", "meeting_requested", "followup_scheduled", "replied", "live_answer"].includes(r.lastOutcome) ? `${EMERALD}12` : r.lastOutcome ? `${MUTED}12` : `${BLUE}12`,
                              color: r.lastOutcome && ["interested", "meeting_requested", "followup_scheduled", "replied", "live_answer"].includes(r.lastOutcome) ? EMERALD : r.lastOutcome ? MUTED : BLUE,
                            }} title={r.outcomeSource || undefined}>
                              {r.outcomeSource ? r.outcomeSource.replace("Airtable: ", "") : r.lastOutcome?.replace(/_/g, " ") || "New"}
                            </span>

                            <button
                              onClick={() => {
                                if (r.recommendedActionType === "call" && r.phone) navigate(`/machine/company/${r.companyId}`);
                                else if (r.recommendedActionType === "email") navigate(`/machine/company/${r.companyId}`);
                                else navigate(`/machine/company/${r.companyId}`);
                              }}
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap transition-all hover:opacity-80"
                              style={{ background: `${actionColor}12`, color: actionColor, border: `1px solid ${actionColor}30` }}
                              data-testid={`cta-${r.companyId}`}
                            >
                              <ActionIcon className="w-3 h-3" />
                              {r.recommendedAction.length > 30 ? r.recommendedAction.slice(0, 28) + "..." : r.recommendedAction}
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="px-12 pb-4 space-y-3" data-testid={`expanded-${r.id}`}>
                            {r.verifiedQualityScore !== null && (
                              <div className="rounded-lg p-3 flex items-center gap-3" style={{
                                background: r.verifiedQualityScore <= 3 ? `${ERROR}08` : r.verifiedQualityScore >= 7 ? `${EMERALD}08` : `${AMBER}08`,
                                border: `1px solid ${r.verifiedQualityScore <= 3 ? ERROR : r.verifiedQualityScore >= 7 ? EMERALD : AMBER}20`,
                              }} data-testid={`quality-banner-${r.companyId}`}>
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold" style={{
                                    background: r.verifiedQualityScore <= 3 ? ERROR : r.verifiedQualityScore >= 7 ? EMERALD : AMBER,
                                    color: "white",
                                  }}>
                                    {r.verifiedQualityScore}
                                  </div>
                                  <div>
                                    <div className="text-xs font-bold" style={{ color: TEXT }}>
                                      Transcript Verified: {r.verifiedQualityLabel}
                                    </div>
                                    <div className="text-[10px]" style={{ color: MUTED }}>
                                      {r.verifiedQualityScore <= 3 ? "This lead was scored low after transcript analysis — the conversation was not productive" :
                                       r.verifiedQualityScore <= 5 ? "Moderate quality — some signals but unclear fit" :
                                       r.verifiedQualityScore <= 7 ? "Good quality — interest signals detected in conversation" :
                                       "High quality — strong buying signals in conversation"}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div className="rounded-lg p-3" style={{ background: `${EMERALD}06`, border: `1px solid ${EMERALD}15` }}>
                                <div className="flex items-center gap-1.5 mb-2">
                                  <CheckCircle2 className="w-3.5 h-3.5" style={{ color: EMERALD }} />
                                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: EMERALD }}>Match Reasons</span>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {r.matchReasons.map((reason, ri) => (
                                    <span key={ri} className="px-2 py-1 rounded-md text-[10px] font-medium" style={{ background: `${EMERALD}12`, color: EMERALD }} data-testid={`match-detail-${i}-${ri}`}>
                                      {reason}
                                    </span>
                                  ))}
                                  {r.dataSignals && r.dataSignals.map((sig, si) => (
                                    <span key={`ds-${si}`} className="px-2 py-1 rounded-md text-[10px] font-medium" style={{ background: `${MUTED}12`, color: MUTED }} data-testid={`signal-badge-${i}-${si}`}>
                                      {sig}
                                    </span>
                                  ))}
                                  {r.matchReasons.length === 0 && (!r.dataSignals || r.dataSignals.length === 0) && <span className="text-[10px]" style={{ color: MUTED }}>No specific filter match</span>}
                                </div>
                              </div>

                              <div className="rounded-lg p-3" style={{ background: `${BLUE}06`, border: `1px solid ${BLUE}15` }}>
                                <div className="flex items-center gap-1.5 mb-2">
                                  <ArrowRight className="w-3.5 h-3.5" style={{ color: BLUE }} />
                                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: BLUE }}>Priority Reasons</span>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {r.priorityReasons.map((reason, ri) => (
                                    <span key={ri} className="px-2 py-1 rounded-md text-[10px] font-medium" style={{ background: `${BLUE}12`, color: BLUE }} data-testid={`priority-badge-${i}-${ri}`}>
                                      {reason}
                                    </span>
                                  ))}
                                </div>
                              </div>

                              <div className="rounded-lg p-3" style={{ background: `${actionColor}06`, border: `1px solid ${actionColor}15` }}>
                                <div className="flex items-center gap-1.5 mb-2">
                                  <ActionIcon className="w-3.5 h-3.5" style={{ color: actionColor }} />
                                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: actionColor }}>Recommended Action</span>
                                </div>
                                <p className="text-xs font-semibold mb-2" style={{ color: TEXT }} data-testid={`action-text-${r.companyId}`}>{r.recommendedAction}</p>
                                <button
                                  onClick={() => navigate(`/machine/company/${r.companyId}`)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all hover:opacity-80"
                                  style={{ background: actionColor, color: "white" }}
                                  data-testid={`action-button-${r.companyId}`}
                                >
                                  <ActionIcon className="w-3 h-3" />
                                  Take Action
                                </button>
                              </div>
                            </div>

                            <div className="flex items-center gap-4 pt-1" style={{ borderTop: `1px solid ${BORDER}` }}>
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-medium" style={{ color: MUTED }}>Phone:</span>
                                <span className="text-[10px] font-semibold" style={{ color: r.phone ? TEXT : ERROR }}>{r.phone || "Missing"}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-medium" style={{ color: MUTED }}>Email:</span>
                                <span className="text-[10px] font-semibold" style={{ color: r.contactEmail ? TEXT : ERROR }}>{r.contactEmail || "Missing"}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-medium" style={{ color: MUTED }}>DM:</span>
                                <span className="text-[10px] font-semibold" style={{ color: r.contactName ? TEXT : AMBER }}>{r.contactName || "Not identified"}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-medium" style={{ color: MUTED }}>Pipeline:</span>
                                <span className="text-[10px] font-semibold" style={{ color: TEXT }}>{r.pipelineStatus}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
