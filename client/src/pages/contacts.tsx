import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import AppLayout from "@/components/app-layout";
import {
  Users, Mail, Phone, Loader2, Search, Plus, Zap, Globe, Building2,
  MapPin, X, ChevronDown, ChevronUp, Filter, ChevronLeft, ChevronRight,
  ExternalLink, UserCheck, AlertCircle, PhoneCall, Target
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const EMERALD = "#10B981";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";
const AMBER = "#F59E0B";
const BLUE = "#3B82F6";
const RED = "#EF4444";
const PAGE_SIZE = 25;

type Company = {
  id: string;
  companyName: string;
  website: string;
  phone: string;
  city: string;
  state: string;
  leadStatus: string;
  enrichmentStatus: string;
  dmCoverageStatus: string;
  primaryDMName: string;
  primaryDMTitle: string;
  primaryDMEmail: string;
  primaryDMPhone: string;
  offerDMName: string;
  offerDMTitle: string;
  offerDMEmail: string;
  offerDMPhone: string;
  lastOutcome: string;
  todayCallList: boolean;
  touchCount: number;
  rankReason: string;
  industry: string;
};

type FilterState = {
  dmStatus: string;
  leadStatus: string;
  onTodayList: string;
};

function StatusBadge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
      style={{ color, background: bg }}
      data-testid={`badge-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {label}
    </span>
  );
}

function getDMStatusBadge(c: Company) {
  if (c.offerDMName) return <StatusBadge label="DM Ready" color={EMERALD} bg="rgba(16,185,129,0.08)" />;
  if (c.primaryDMName) return <StatusBadge label="DM Found" color={BLUE} bg="rgba(59,130,246,0.08)" />;
  return <StatusBadge label="No DM" color={MUTED} bg="rgba(148,163,184,0.08)" />;
}

function getLeadStatusBadge(status: string) {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === "won") return <StatusBadge label="Won" color={EMERALD} bg="rgba(16,185,129,0.1)" />;
  if (s === "lost" || s === "dead") return <StatusBadge label={status} color={RED} bg="rgba(239,68,68,0.08)" />;
  if (s === "active" || s === "engaged") return <StatusBadge label={status} color={BLUE} bg="rgba(59,130,246,0.08)" />;
  if (s === "new") return <StatusBadge label="New" color={AMBER} bg="rgba(245,158,11,0.08)" />;
  return <StatusBadge label={status} color={MUTED} bg="rgba(148,163,184,0.08)" />;
}

function getTouchBadge(count: number) {
  if (count === 0) return null;
  const color = count >= 4 ? EMERALD : count >= 2 ? AMBER : MUTED;
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold" style={{ color }}>
      <Target className="w-2.5 h-2.5" />
      {count}/6
    </span>
  );
}

export default function ContactsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<FilterState>({ dmStatus: "all", leadStatus: "all", onTodayList: "all" });
  const [addForm, setAddForm] = useState({ companyName: "", website: "", phone: "", city: "", state: "", contactName: "", contactTitle: "", contactEmail: "", contactPhone: "" });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(val), 200);
  }, []);

  const { data, isLoading } = useQuery<{ ok: boolean; companies: Company[] }>({
    queryKey: ["/api/companies"],
  });

  const companies = data?.companies || [];

  const filtered = useMemo(() => {
    let result = companies;

    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase().trim();
      result = result.filter((c) =>
        c.companyName?.toLowerCase().includes(q) ||
        c.primaryDMName?.toLowerCase().includes(q) ||
        c.offerDMName?.toLowerCase().includes(q) ||
        c.city?.toLowerCase().includes(q) ||
        c.website?.toLowerCase().includes(q) ||
        c.industry?.toLowerCase().includes(q) ||
        c.primaryDMEmail?.toLowerCase().includes(q) ||
        c.offerDMEmail?.toLowerCase().includes(q)
      );
    }

    if (filters.dmStatus !== "all") {
      if (filters.dmStatus === "dm_ready") result = result.filter(c => c.offerDMName);
      else if (filters.dmStatus === "dm_found") result = result.filter(c => c.primaryDMName && !c.offerDMName);
      else if (filters.dmStatus === "no_dm") result = result.filter(c => !c.primaryDMName && !c.offerDMName);
    }

    if (filters.leadStatus !== "all") {
      result = result.filter(c => c.leadStatus.toLowerCase() === filters.leadStatus.toLowerCase());
    }

    if (filters.onTodayList === "yes") result = result.filter(c => c.todayCallList);
    else if (filters.onTodayList === "no") result = result.filter(c => !c.todayCallList);

    return result;
  }, [companies, debouncedSearch, filters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const withDM = companies.filter(c => c.offerDMName || c.primaryDMName).length;
  const withEmail = companies.filter(c => c.primaryDMEmail || c.offerDMEmail).length;
  const onTodayList = companies.filter(c => c.todayCallList).length;

  const activeFilterCount = [filters.dmStatus, filters.leadStatus, filters.onTodayList].filter(f => f !== "all").length;

  const leadStatuses = useMemo(() => {
    const statuses = new Set<string>();
    companies.forEach(c => { if (c.leadStatus) statuses.add(c.leadStatus); });
    return Array.from(statuses).sort();
  }, [companies]);

  const addMutation = useMutation({
    mutationFn: async (formData: typeof addForm) => {
      const res = await apiRequest("POST", "/api/companies/add", formData);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `${data.companyName} added`, description: "You can now enrich this lead." });
      setAddForm({ companyName: "", website: "", phone: "", city: "", state: "", contactName: "", contactTitle: "", contactEmail: "", contactPhone: "" });
      setShowAddForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to add company", description: err.message, variant: "destructive" });
    },
  });

  const enrichMutation = useMutation({
    mutationFn: async (id: string) => {
      setEnrichingId(id);
      const res = await apiRequest("POST", `/api/companies/${id}/enrich`);
      return res.json();
    },
    onSuccess: (data) => {
      const dmCount = data.dm?.decisionMakersFound || 0;
      const intelConf = data.intel?.confidence || "n/a";
      toast({
        title: `${data.companyName} enriched`,
        description: `${dmCount} decision maker(s) found. Intel confidence: ${intelConf}.${data.errors?.length ? ` Warnings: ${data.errors.join("; ")}` : ""}`,
      });
      setEnrichingId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
    },
    onError: (err: any) => {
      toast({ title: "Enrichment failed", description: err.message, variant: "destructive" });
      setEnrichingId(null);
    },
  });

  const clearFilters = () => {
    setFilters({ dmStatus: "all", leadStatus: "all", onTodayList: "all" });
    setPage(1);
  };

  return (
    <AppLayout showBackToChip>
      <div className="p-4 sm:p-6 space-y-5 max-w-[1400px] mx-auto">
        <div>
          <span className="text-[10px] font-mono tracking-widest uppercase" style={{ color: MUTED }}>
            Contacts / Lead Management
          </span>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mt-1">
            <h1 className="text-xl font-bold" style={{ color: TEXT }} data-testid="text-page-title">Contacts</h1>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all hover:opacity-90"
              style={{ background: EMERALD, color: "#FFF" }}
              data-testid="button-add-lead"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Lead
            </button>
          </div>
        </div>

        {showAddForm && (
          <div className="rounded-xl p-5" style={{ background: "#FFF", border: `1px solid ${BORDER}`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }} data-testid="form-add-lead">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-bold" style={{ color: TEXT }}>New Lead</span>
              <button onClick={() => setShowAddForm(false)} data-testid="button-close-add">
                <X className="w-4 h-4" style={{ color: MUTED }} />
              </button>
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); if (addForm.companyName) addMutation.mutate(addForm); }}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
            >
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: MUTED }}>Company Name *</label>
                <input
                  value={addForm.companyName}
                  onChange={(e) => setAddForm(prev => ({ ...prev, companyName: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ border: `1px solid ${BORDER}`, color: TEXT, background: "#FFF" }}
                  placeholder="Acme Industrial"
                  data-testid="input-company-name"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: MUTED }}>Website</label>
                <input
                  value={addForm.website}
                  onChange={(e) => setAddForm(prev => ({ ...prev, website: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ border: `1px solid ${BORDER}`, color: TEXT, background: "#FFF" }}
                  placeholder="https://acme-industrial.com"
                  data-testid="input-website"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: MUTED }}>Phone</label>
                <input
                  value={addForm.phone}
                  onChange={(e) => setAddForm(prev => ({ ...prev, phone: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ border: `1px solid ${BORDER}`, color: TEXT, background: "#FFF" }}
                  placeholder="(409) 555-1234"
                  data-testid="input-phone"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: MUTED }}>City</label>
                <input
                  value={addForm.city}
                  onChange={(e) => setAddForm(prev => ({ ...prev, city: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ border: `1px solid ${BORDER}`, color: TEXT, background: "#FFF" }}
                  placeholder="Port Arthur"
                  data-testid="input-city"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: MUTED }}>State</label>
                <input
                  value={addForm.state}
                  onChange={(e) => setAddForm(prev => ({ ...prev, state: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ border: `1px solid ${BORDER}`, color: TEXT, background: "#FFF" }}
                  placeholder="TX"
                  data-testid="input-state"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3 pt-2 border-t" style={{ borderColor: BORDER }}>
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>Decision Maker (optional)</span>
              </div>
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: MUTED }}>Contact Name</label>
                <input
                  value={addForm.contactName}
                  onChange={(e) => setAddForm(prev => ({ ...prev, contactName: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ border: `1px solid ${BORDER}`, color: TEXT, background: "#FFF" }}
                  placeholder="John Smith"
                  data-testid="input-contact-name"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: MUTED }}>Title</label>
                <input
                  value={addForm.contactTitle}
                  onChange={(e) => setAddForm(prev => ({ ...prev, contactTitle: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ border: `1px solid ${BORDER}`, color: TEXT, background: "#FFF" }}
                  placeholder="Safety Director"
                  data-testid="input-contact-title"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: MUTED }}>Email</label>
                <input
                  value={addForm.contactEmail}
                  onChange={(e) => setAddForm(prev => ({ ...prev, contactEmail: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ border: `1px solid ${BORDER}`, color: TEXT, background: "#FFF" }}
                  placeholder="john@acme-industrial.com"
                  data-testid="input-contact-email"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: MUTED }}>Contact Phone</label>
                <input
                  value={addForm.contactPhone}
                  onChange={(e) => setAddForm(prev => ({ ...prev, contactPhone: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ border: `1px solid ${BORDER}`, color: TEXT, background: "#FFF" }}
                  placeholder="(409) 555-5678"
                  data-testid="input-contact-phone"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={addMutation.isPending || !addForm.companyName}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: TEXT, color: "#FFF" }}
                  data-testid="button-submit-lead"
                >
                  {addMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Add Lead
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total", value: companies.length, icon: Building2, color: TEXT },
            { label: "With DM", value: withDM, icon: UserCheck, color: EMERALD },
            { label: "With Email", value: withEmail, icon: Mail, color: BLUE },
            { label: "Today's List", value: onTodayList, icon: PhoneCall, color: AMBER },
          ].map((m) => (
            <div
              key={m.label}
              className="rounded-xl p-4"
              style={{ background: "#FFF", border: `1px solid ${BORDER}` }}
              data-testid={`card-${m.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: MUTED }}>{m.label}</span>
                <m.icon className="w-3.5 h-3.5" style={{ color: m.color }} />
              </div>
              <div className="text-2xl font-bold" style={{ color: TEXT }} data-testid={`value-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" style={{ color: MUTED }} /> : m.value}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: MUTED }} />
            <input
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm"
              style={{ border: `1px solid ${BORDER}`, color: TEXT, background: "#FFF" }}
              placeholder="Search by company, contact, email, city, industry..."
              data-testid="input-search"
            />
            {search && (
              <button onClick={() => { setSearch(""); setDebouncedSearch(""); setPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2" data-testid="button-clear-search">
                <X className="w-3.5 h-3.5" style={{ color: MUTED }} />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors"
            style={{
              border: `1px solid ${activeFilterCount > 0 ? EMERALD : BORDER}`,
              color: activeFilterCount > 0 ? EMERALD : MUTED,
              background: activeFilterCount > 0 ? "rgba(16,185,129,0.04)" : "#FFF",
            }}
            data-testid="button-toggle-filters"
          >
            <Filter className="w-3.5 h-3.5" />
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
        </div>

        {showFilters && (
          <div className="rounded-xl p-4 flex flex-wrap gap-4 items-end" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }} data-testid="panel-filters">
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wide block mb-1.5" style={{ color: MUTED }}>DM Status</label>
              <select
                value={filters.dmStatus}
                onChange={(e) => { setFilters(f => ({ ...f, dmStatus: e.target.value })); setPage(1); }}
                className="px-3 py-2 rounded-lg text-xs"
                style={{ border: `1px solid ${BORDER}`, color: TEXT, background: "#FFF" }}
                data-testid="select-dm-status"
              >
                <option value="all">All</option>
                <option value="dm_ready">DM Ready (Offer DM set)</option>
                <option value="dm_found">DM Found (Primary only)</option>
                <option value="no_dm">No DM</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wide block mb-1.5" style={{ color: MUTED }}>Lead Status</label>
              <select
                value={filters.leadStatus}
                onChange={(e) => { setFilters(f => ({ ...f, leadStatus: e.target.value })); setPage(1); }}
                className="px-3 py-2 rounded-lg text-xs"
                style={{ border: `1px solid ${BORDER}`, color: TEXT, background: "#FFF" }}
                data-testid="select-lead-status"
              >
                <option value="all">All</option>
                {leadStatuses.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wide block mb-1.5" style={{ color: MUTED }}>Today's List</label>
              <select
                value={filters.onTodayList}
                onChange={(e) => { setFilters(f => ({ ...f, onTodayList: e.target.value })); setPage(1); }}
                className="px-3 py-2 rounded-lg text-xs"
                style={{ border: `1px solid ${BORDER}`, color: TEXT, background: "#FFF" }}
                data-testid="select-today-list"
              >
                <option value="all">All</option>
                <option value="yes">On Today's List</option>
                <option value="no">Not on Today's List</option>
              </select>
            </div>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-xs font-semibold px-3 py-2 rounded-lg transition-colors hover:bg-white"
                style={{ color: RED }}
                data-testid="button-clear-filters"
              >
                Clear All
              </button>
            )}
          </div>
        )}

        <div className="rounded-xl overflow-hidden" style={{ background: "#FFF", border: `1px solid ${BORDER}`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <span className="text-xs font-medium" style={{ color: MUTED }}>
              {isLoading ? "Loading..." : `${filtered.length} companies`}
              {debouncedSearch && ` matching "${debouncedSearch}"`}
              {activeFilterCount > 0 && ` (filtered)`}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="p-1 rounded hover:bg-gray-50 disabled:opacity-30 transition-colors"
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="w-4 h-4" style={{ color: TEXT }} />
                </button>
                <span className="text-xs font-medium" style={{ color: TEXT }}>
                  {safePage} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="p-1 rounded hover:bg-gray-50 disabled:opacity-30 transition-colors"
                  data-testid="button-next-page"
                >
                  <ChevronRight className="w-4 h-4" style={{ color: TEXT }} />
                </button>
              </div>
            )}
          </div>

          <div className="hidden lg:grid items-center px-4 py-2" style={{ borderBottom: `1px solid ${BORDER}`, gridTemplateColumns: "2fr 1.2fr 1.5fr 1fr 0.8fr 1fr" }}>
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Company</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Decision Maker</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Contact</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Status</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Pipeline</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-right" style={{ color: MUTED }}>Actions</span>
          </div>

          <div data-testid="table-contacts">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: EMERALD }} />
                <span className="text-xs" style={{ color: MUTED }}>Loading companies...</span>
              </div>
            ) : paged.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <AlertCircle className="w-6 h-6" style={{ color: MUTED }} />
                <span className="text-sm" style={{ color: MUTED }}>
                  {debouncedSearch || activeFilterCount > 0 ? "No companies match your search or filters" : "No companies found"}
                </span>
              </div>
            ) : (
              paged.map((c, i) => {
                const isEnriching = enrichingId === c.id;
                const isExpanded = expandedId === c.id;
                const dmName = c.offerDMName || c.primaryDMName;
                const dmTitle = c.offerDMTitle || c.primaryDMTitle;
                const dmEmail = c.offerDMEmail || c.primaryDMEmail;
                const dmPhone = c.offerDMPhone || c.primaryDMPhone || c.phone;
                const hasDetails = dmName || c.rankReason || c.website;

                return (
                  <div key={c.id} data-testid={`row-company-${i}`}>
                    <div
                      className="hidden lg:grid items-center px-4 py-3 transition-colors hover:bg-gray-50/50 cursor-pointer"
                      style={{
                        borderBottom: `1px solid ${BORDER}`,
                        gridTemplateColumns: "2fr 1.2fr 1.5fr 1fr 0.8fr 1fr",
                        background: c.todayCallList ? "rgba(245,158,11,0.02)" : undefined,
                      }}
                      onClick={() => hasDetails && setExpandedId(isExpanded ? null : c.id)}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
                          <Building2 className="w-3.5 h-3.5" style={{ color: MUTED }} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold truncate" style={{ color: TEXT }}>{c.companyName}</span>
                            {c.todayCallList && (
                              <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full" style={{ background: AMBER }} title="On today's call list" />
                            )}
                          </div>
                          {(c.city || c.industry) && (
                            <div className="flex items-center gap-2 mt-0.5">
                              {c.city && (
                                <span className="flex items-center gap-0.5 text-[11px]" style={{ color: MUTED }}>
                                  <MapPin className="w-2.5 h-2.5" />
                                  {c.city}{c.state ? `, ${c.state}` : ""}
                                </span>
                              )}
                              {c.industry && (
                                <span className="text-[11px]" style={{ color: MUTED }}>{c.industry}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="min-w-0">
                        {dmName ? (
                          <div>
                            <span className="text-sm font-medium truncate block" style={{ color: TEXT }}>{dmName}</span>
                            {dmTitle && <span className="text-[11px] truncate block" style={{ color: MUTED }}>{dmTitle}</span>}
                          </div>
                        ) : (
                          <span className="text-xs" style={{ color: MUTED }}>Not found</span>
                        )}
                      </div>

                      <div className="min-w-0">
                        {dmEmail ? (
                          <a
                            href={`mailto:${dmEmail}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs truncate block hover:underline"
                            style={{ color: EMERALD }}
                            data-testid={`link-email-${i}`}
                          >
                            {dmEmail}
                          </a>
                        ) : (
                          <span className="text-xs" style={{ color: MUTED }}>-</span>
                        )}
                        {dmPhone && (
                          <a
                            href={`tel:${dmPhone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-[11px] truncate block mt-0.5 hover:underline"
                            style={{ color: TEXT }}
                            data-testid={`link-phone-${i}`}
                          >
                            {dmPhone}
                          </a>
                        )}
                      </div>

                      <div className="flex flex-col gap-1">
                        {getDMStatusBadge(c)}
                        {getLeadStatusBadge(c.leadStatus)}
                      </div>

                      <div>
                        {getTouchBadge(c.touchCount)}
                        {c.lastOutcome && (
                          <div className="text-[10px] mt-0.5 truncate" style={{ color: MUTED }}>{c.lastOutcome}</div>
                        )}
                      </div>

                      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => enrichMutation.mutate(c.id)}
                          disabled={isEnriching}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:opacity-90 disabled:opacity-50"
                          style={{
                            background: isEnriching ? SUBTLE : "rgba(16,185,129,0.06)",
                            color: isEnriching ? MUTED : EMERALD,
                            border: `1px solid ${isEnriching ? BORDER : "rgba(16,185,129,0.15)"}`,
                          }}
                          title="Run DM enrichment + web intel"
                          data-testid={`button-enrich-${i}`}
                        >
                          {isEnriching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                          {isEnriching ? "..." : "Enrich"}
                        </button>
                        {hasDetails && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : c.id); }}
                            className="p-1.5 rounded-lg transition-colors hover:bg-gray-100"
                            data-testid={`button-expand-${i}`}
                          >
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" style={{ color: MUTED }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: MUTED }} />}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="lg:hidden p-3 space-y-2" style={{ borderBottom: `1px solid ${BORDER}`, background: c.todayCallList ? "rgba(245,158,11,0.02)" : undefined }}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold" style={{ color: TEXT }}>{c.companyName}</span>
                            {c.todayCallList && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: AMBER }} />}
                          </div>
                          {c.city && (
                            <span className="flex items-center gap-0.5 text-[11px] mt-0.5" style={{ color: MUTED }}>
                              <MapPin className="w-2.5 h-2.5" />{c.city}{c.state ? `, ${c.state}` : ""}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => enrichMutation.mutate(c.id)}
                            disabled={isEnriching}
                            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold"
                            style={{ background: "rgba(16,185,129,0.06)", color: EMERALD, border: "1px solid rgba(16,185,129,0.15)" }}
                            data-testid={`button-enrich-mobile-${i}`}
                          >
                            {isEnriching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                            {isEnriching ? "..." : "Enrich"}
                          </button>
                          {hasDetails && (
                            <button onClick={() => setExpandedId(isExpanded ? null : c.id)} className="p-1" data-testid={`button-expand-mobile-${i}`}>
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" style={{ color: MUTED }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: MUTED }} />}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center flex-wrap gap-1.5">
                        {getDMStatusBadge(c)}
                        {getLeadStatusBadge(c.leadStatus)}
                        {getTouchBadge(c.touchCount)}
                      </div>
                      {dmName && (
                        <div className="text-xs" style={{ color: TEXT }}>
                          <span className="font-medium">{dmName}</span>
                          {dmTitle && <span style={{ color: MUTED }}> - {dmTitle}</span>}
                        </div>
                      )}
                      {dmEmail && (
                        <a href={`mailto:${dmEmail}`} className="text-xs hover:underline block" style={{ color: EMERALD }}>{dmEmail}</a>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="px-4 py-4" style={{ background: SUBTLE, borderBottom: `1px solid ${BORDER}` }}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {c.website && (
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wide block mb-1" style={{ color: MUTED }}>Website</span>
                              <a
                                href={c.website.startsWith("http") ? c.website : `https://${c.website}`}
                                target="_blank"
                                rel="noopener"
                                className="text-xs flex items-center gap-1 hover:underline"
                                style={{ color: BLUE }}
                                data-testid={`link-website-${i}`}
                              >
                                <Globe className="w-3 h-3" />{c.website}
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            </div>
                          )}
                          {c.enrichmentStatus && (
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wide block mb-1" style={{ color: MUTED }}>Enrichment</span>
                              <span className="text-xs font-medium" style={{ color: TEXT }}>{c.enrichmentStatus}</span>
                            </div>
                          )}
                          {c.dmCoverageStatus && (
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wide block mb-1" style={{ color: MUTED }}>DM Coverage</span>
                              <span className="text-xs font-medium" style={{ color: TEXT }}>{c.dmCoverageStatus}</span>
                            </div>
                          )}
                          {c.offerDMName && c.primaryDMName && c.offerDMName !== c.primaryDMName && (
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wide block mb-1" style={{ color: MUTED }}>Primary DM</span>
                              <span className="text-xs" style={{ color: TEXT }}>{c.primaryDMName}</span>
                              {c.primaryDMTitle && <span className="text-[11px] block" style={{ color: MUTED }}>{c.primaryDMTitle}</span>}
                            </div>
                          )}
                          {c.offerDMName && (
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wide block mb-1" style={{ color: MUTED }}>Offer DM</span>
                              <span className="text-xs font-medium" style={{ color: TEXT }}>{c.offerDMName}</span>
                              {c.offerDMTitle && <span className="text-[11px] block" style={{ color: MUTED }}>{c.offerDMTitle}</span>}
                              {c.offerDMEmail && (
                                <a href={`mailto:${c.offerDMEmail}`} className="text-[11px] block hover:underline" style={{ color: EMERALD }}>{c.offerDMEmail}</a>
                              )}
                            </div>
                          )}
                          {c.lastOutcome && (
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wide block mb-1" style={{ color: MUTED }}>Last Outcome</span>
                              <span className="text-xs" style={{ color: TEXT }}>{c.lastOutcome}</span>
                            </div>
                          )}
                        </div>
                        {c.rankReason && (
                          <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                            <span className="text-[10px] font-semibold uppercase tracking-wide block mb-1" style={{ color: MUTED }}>Intel</span>
                            <p className="text-xs leading-relaxed" style={{ color: TEXT }}>
                              {c.rankReason.substring(0, 500)}{c.rankReason.length > 500 ? "..." : ""}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {!isLoading && filtered.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: `1px solid ${BORDER}`, background: SUBTLE }}>
              <span className="text-[11px]" style={{ color: MUTED }}>
                Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(1)}
                    disabled={safePage <= 1}
                    className="px-2 py-1 rounded text-[11px] font-medium transition-colors hover:bg-white disabled:opacity-30"
                    style={{ color: TEXT }}
                    data-testid="button-first-page"
                  >
                    First
                  </button>
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    className="p-1 rounded hover:bg-white disabled:opacity-30 transition-colors"
                    data-testid="button-prev-page-bottom"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" style={{ color: TEXT }} />
                  </button>
                  <span className="text-[11px] font-medium px-2" style={{ color: TEXT }}>{safePage} / {totalPages}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    className="p-1 rounded hover:bg-white disabled:opacity-30 transition-colors"
                    data-testid="button-next-page-bottom"
                  >
                    <ChevronRight className="w-3.5 h-3.5" style={{ color: TEXT }} />
                  </button>
                  <button
                    onClick={() => setPage(totalPages)}
                    disabled={safePage >= totalPages}
                    className="px-2 py-1 rounded text-[11px] font-medium transition-colors hover:bg-white disabled:opacity-30"
                    style={{ color: TEXT }}
                    data-testid="button-last-page"
                  >
                    Last
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
