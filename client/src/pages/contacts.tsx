import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import AppLayout from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Mail, Phone, Loader2, Search, Plus, Zap, Globe, Building2, MapPin, X, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function ContactsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({ companyName: "", website: "", phone: "", city: "", state: "" });

  const { data, isLoading } = useQuery<{ ok: boolean; companies: any[] }>({
    queryKey: ["/api/companies"],
  });

  const companies = data?.companies || [];

  const filtered = useMemo(() => {
    if (!search.trim()) return companies;
    const q = search.toLowerCase();
    return companies.filter((c: any) =>
      c.companyName?.toLowerCase().includes(q) ||
      c.primaryDMName?.toLowerCase().includes(q) ||
      c.city?.toLowerCase().includes(q) ||
      c.website?.toLowerCase().includes(q)
    );
  }, [companies, search]);

  const withDM = companies.filter((c: any) => c.primaryDMName);
  const withEmail = companies.filter((c: any) => c.primaryDMEmail);
  const withPhone = companies.filter((c: any) => c.primaryDMPhone);

  const addMutation = useMutation({
    mutationFn: async (formData: typeof addForm) => {
      const res = await apiRequest("POST", "/api/companies/add", formData);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `${data.companyName} added`, description: "You can now enrich this lead." });
      setAddForm({ companyName: "", website: "", phone: "", city: "", state: "" });
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

  const metrics = [
    { label: "Total Companies", value: companies.length, icon: Building2 },
    { label: "With Decision Maker", value: withDM.length, icon: Users },
    { label: "With Email", value: withEmail.length, icon: Mail },
  ];

  return (
    <AppLayout showBackToChip>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-xs font-mono tracking-wider uppercase" style={{ color: "#94A3B8" }}>Contacts / Lead Management</span>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <h1 className="text-2xl font-bold" style={{ color: "#0F172A" }} data-testid="text-page-title">Contacts</h1>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: "#10B981", color: "#FFFFFF" }}
            data-testid="button-add-lead"
          >
            <Plus className="w-4 h-4" />
            Add Lead
          </button>
        </div>

        {showAddForm && (
          <Card style={{ border: "1px solid #E2E8F0" }} data-testid="form-add-lead">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-bold" style={{ color: "#0F172A" }}>New Lead</span>
                <button onClick={() => setShowAddForm(false)} data-testid="button-close-add">
                  <X className="w-4 h-4" style={{ color: "#94A3B8" }} />
                </button>
              </div>
              <form
                onSubmit={(e) => { e.preventDefault(); if (addForm.companyName) addMutation.mutate(addForm); }}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
              >
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: "#64748B" }}>Company Name *</label>
                  <input
                    value={addForm.companyName}
                    onChange={(e) => setAddForm(prev => ({ ...prev, companyName: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-sm"
                    style={{ border: "1px solid #E2E8F0", color: "#0F172A" }}
                    placeholder="Acme Industrial"
                    data-testid="input-company-name"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: "#64748B" }}>Website</label>
                  <input
                    value={addForm.website}
                    onChange={(e) => setAddForm(prev => ({ ...prev, website: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-sm"
                    style={{ border: "1px solid #E2E8F0", color: "#0F172A" }}
                    placeholder="https://acme-industrial.com"
                    data-testid="input-website"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: "#64748B" }}>Phone</label>
                  <input
                    value={addForm.phone}
                    onChange={(e) => setAddForm(prev => ({ ...prev, phone: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-sm"
                    style={{ border: "1px solid #E2E8F0", color: "#0F172A" }}
                    placeholder="(409) 555-1234"
                    data-testid="input-phone"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: "#64748B" }}>City</label>
                  <input
                    value={addForm.city}
                    onChange={(e) => setAddForm(prev => ({ ...prev, city: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-sm"
                    style={{ border: "1px solid #E2E8F0", color: "#0F172A" }}
                    placeholder="Port Arthur"
                    data-testid="input-city"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: "#64748B" }}>State</label>
                  <input
                    value={addForm.state}
                    onChange={(e) => setAddForm(prev => ({ ...prev, state: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-sm"
                    style={{ border: "1px solid #E2E8F0", color: "#0F172A" }}
                    placeholder="TX"
                    data-testid="input-state"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={addMutation.isPending || !addForm.companyName}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: "#0F172A", color: "#FFFFFF" }}
                    data-testid="button-submit-lead"
                  >
                    {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Add Lead
                  </button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {metrics.map((m) => (
            <Card key={m.label} data-testid={`card-${m.label.toLowerCase().replace(/\s+/g, "-")}`} style={{ border: "1px solid #E2E8F0" }}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium" style={{ color: "#64748B" }}>{m.label}</CardTitle>
                <m.icon className="w-4 h-4" style={{ color: "#10B981" }} />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" style={{ color: "#0F172A" }} data-testid={`value-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
                  {isLoading ? <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#94A3B8" }} /> : m.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#94A3B8" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm"
            style={{ border: "1px solid #E2E8F0", color: "#0F172A" }}
            placeholder="Search companies, contacts, cities..."
            data-testid="input-search"
          />
        </div>

        <Card style={{ border: "1px solid #E2E8F0" }}>
          <CardContent className="p-0">
            <div className="hidden md:flex items-center border-b" style={{ height: 40 }}>
              <div className="px-4 py-2 text-xs font-medium" style={{ color: "#64748B", flexBasis: "22%" }}>Company</div>
              <div className="px-4 py-2 text-xs font-medium" style={{ color: "#64748B", flexBasis: "16%" }}>Decision Maker</div>
              <div className="px-4 py-2 text-xs font-medium" style={{ color: "#64748B", flexBasis: "14%" }}>Title</div>
              <div className="px-4 py-2 text-xs font-medium" style={{ color: "#64748B", flexBasis: "20%" }}>Email</div>
              <div className="px-4 py-2 text-xs font-medium" style={{ color: "#64748B", flexBasis: "13%" }}>Phone</div>
              <div className="px-4 py-2 text-xs font-medium" style={{ color: "#64748B", flexBasis: "15%" }}>Actions</div>
            </div>
            <div data-testid="table-contacts">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#94A3B8" }} />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-8 text-sm" style={{ color: "#94A3B8" }}>
                  {search ? "No companies match your search" : "No companies found — add a lead to get started"}
                </div>
              ) : (
                filtered.map((c: any, i: number) => {
                  const isEnriching = enrichingId === c.id;
                  const isExpanded = expandedId === c.id;
                  const hasDM = !!c.primaryDMName;
                  const hasIntel = !!c.rankReason;
                  return (
                    <div key={c.id} data-testid={`row-company-${i}`}>
                      <div className="hidden md:flex items-center border-b hover:bg-gray-50 transition-colors" style={{ minHeight: 48 }}>
                        <div className="flex-1 min-w-0 px-4 py-2" style={{ flexBasis: "22%" }}>
                          <div className="text-sm font-medium truncate" style={{ color: "#0F172A" }}>{c.companyName}</div>
                          {c.city && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3 h-3" style={{ color: "#94A3B8" }} />
                              <span className="text-xs" style={{ color: "#94A3B8" }}>{c.city}{c.state ? `, ${c.state}` : ""}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 px-4 py-2 text-sm truncate" style={{ color: hasDM ? "#0F172A" : "#94A3B8", flexBasis: "16%" }}>
                          {c.primaryDMName || "Not found"}
                        </div>
                        <div className="flex-1 min-w-0 px-4 py-2 text-sm truncate" style={{ color: "#334155", flexBasis: "14%" }}>
                          {c.primaryDMTitle || <span style={{ color: "#94A3B8" }}>-</span>}
                        </div>
                        <div className="flex-1 min-w-0 px-4 py-2 text-sm truncate" style={{ flexBasis: "20%" }}>
                          {c.primaryDMEmail ? (
                            <a href={`mailto:${c.primaryDMEmail}`} className="underline" style={{ color: "#10B981" }}>{c.primaryDMEmail}</a>
                          ) : <span style={{ color: "#94A3B8" }}>-</span>}
                        </div>
                        <div className="flex-1 min-w-0 px-4 py-2 text-sm truncate" style={{ color: "#334155", flexBasis: "13%" }}>
                          {c.primaryDMPhone || c.phone || <span style={{ color: "#94A3B8" }}>-</span>}
                        </div>
                        <div className="flex items-center gap-2 px-4 py-2" style={{ flexBasis: "15%" }}>
                          <button
                            onClick={() => enrichMutation.mutate(c.id)}
                            disabled={isEnriching}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                            style={{ background: isEnriching ? "#F8FAFC" : "rgba(16,185,129,0.08)", color: isEnriching ? "#94A3B8" : "#10B981", border: `1px solid ${isEnriching ? "#E2E8F0" : "rgba(16,185,129,0.2)"}` }}
                            title="Run DM enrichment + web intel"
                            data-testid={`button-enrich-${i}`}
                          >
                            {isEnriching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                            {isEnriching ? "Enriching..." : "Enrich"}
                          </button>
                          {(hasDM || hasIntel) && (
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : c.id)}
                              className="p-1 rounded hover:bg-gray-100 transition-colors"
                              data-testid={`button-expand-${i}`}
                            >
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" style={{ color: "#94A3B8" }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: "#94A3B8" }} />}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="md:hidden border-b p-3 space-y-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="text-sm font-medium" style={{ color: "#0F172A" }}>{c.companyName}</div>
                            {c.city && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <MapPin className="w-3 h-3" style={{ color: "#94A3B8" }} />
                                <span className="text-xs" style={{ color: "#94A3B8" }}>{c.city}{c.state ? `, ${c.state}` : ""}</span>
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => enrichMutation.mutate(c.id)}
                            disabled={isEnriching}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold"
                            style={{ background: "rgba(16,185,129,0.08)", color: "#10B981", border: "1px solid rgba(16,185,129,0.2)" }}
                            data-testid={`button-enrich-mobile-${i}`}
                          >
                            {isEnriching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                            {isEnriching ? "..." : "Enrich"}
                          </button>
                        </div>
                        {hasDM && (
                          <div className="text-xs" style={{ color: "#334155" }}>
                            <span className="font-medium">{c.primaryDMName}</span>
                            {c.primaryDMTitle && <span> - {c.primaryDMTitle}</span>}
                          </div>
                        )}
                        {c.primaryDMEmail && (
                          <a href={`mailto:${c.primaryDMEmail}`} className="text-xs underline block" style={{ color: "#10B981" }}>{c.primaryDMEmail}</a>
                        )}
                      </div>

                      {isExpanded && (
                        <div className="border-b px-4 py-3" style={{ background: "#F8FAFC" }}>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                            {c.website && (
                              <div className="flex items-center gap-1.5">
                                <Globe className="w-3 h-3" style={{ color: "#3B82F6" }} />
                                <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noopener" className="underline" style={{ color: "#3B82F6" }}>{c.website}</a>
                              </div>
                            )}
                            {c.enrichmentStatus && (
                              <div className="text-xs"><span style={{ color: "#64748B" }}>Enrichment:</span> <span className="font-medium" style={{ color: "#0F172A" }}>{c.enrichmentStatus}</span></div>
                            )}
                            {c.leadStatus && (
                              <div className="text-xs"><span style={{ color: "#64748B" }}>Status:</span> <span className="font-medium" style={{ color: "#0F172A" }}>{c.leadStatus}</span></div>
                            )}
                          </div>
                          {hasIntel && (
                            <div className="mt-2 text-xs" style={{ color: "#64748B" }}>
                              <span className="font-medium" style={{ color: "#0F172A" }}>Intel: </span>
                              {c.rankReason.substring(0, 300)}{c.rankReason.length > 300 ? "..." : ""}
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
              <div className="px-4 py-2 text-xs" style={{ color: "#94A3B8", borderTop: "1px solid #E2E8F0" }}>
                Showing {filtered.length} of {companies.length} companies
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
