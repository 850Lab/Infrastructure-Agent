import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import AppLayout from "@/components/app-layout";
import {
  Search, Loader2, Building2, Users, Newspaper, MapPin, Calendar,
  Bookmark, BookmarkCheck, Trash2, ChevronDown, ChevronUp, ExternalLink,
  Briefcase, Globe, Phone, Mail, Linkedin, StickyNote, Filter,
  Flame, HardHat, DollarSign, Clock, FileText, Megaphone, UserCheck
} from "lucide-react";

const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const EMERALD = "#10B981";
const BG = "#FFFFFF";
const SUBTLE = "#F8FAFC";

const CATEGORY_LABELS: Record<string, { label: string; color: string; icon: any }> = {
  hiring: { label: "Hiring", color: "#8B5CF6", icon: Briefcase },
  press_release: { label: "Press Release", color: "#3B82F6", icon: Megaphone },
  event: { label: "Event", color: "#F59E0B", icon: Calendar },
  regulatory: { label: "Regulatory", color: "#EF4444", icon: FileText },
  construction_update: { label: "Construction", color: "#10B981", icon: HardHat },
  social_media: { label: "Social", color: "#EC4899", icon: Globe },
  contract_award: { label: "Contract", color: "#14B8A6", icon: DollarSign },
  partnership: { label: "Partnership", color: "#6366F1", icon: UserCheck },
  community: { label: "Community", color: "#8B5CF6", icon: Users },
  procurement: { label: "Procurement", color: "#F97316", icon: DollarSign },
  networking: { label: "Networking", color: "#06B6D4", icon: Users },
  general: { label: "General", color: MUTED, icon: Newspaper },
};

const QUICK_SEARCHES = [
  "LNG projects Gulf Coast Texas Louisiana 2025 2026",
  "Golden Pass LNG Port Arthur procurement supply chain",
  "Driftwood LNG Lake Charles vendor contractor",
  "Rio Grande LNG Brownsville operations maintenance",
  "Sabine Pass LNG Cheniere procurement purchasing manager",
  "Plaquemines LNG Venture Global supplier prequalification",
  "LNG terminal procurement manager vendor management Gulf Coast",
  "LNG facility operations maintenance supervisor plant manager",
  "CERAWeek Gastech OTC LNG conference networking 2026",
  "Gulf Coast energy industry golf tournament charity gala mixer",
  "Lake Charles Port Arthur chamber of commerce Rotary energy",
  "LNG supplier diversity vendor fair prequalification RFP 2026",
];

type TabView = "search" | "saved_projects" | "saved_contacts" | "saved_intel";

interface SearchProject {
  projectName: string;
  operator: string;
  location: string;
  state: string;
  status: string;
  capacity: string;
  estimatedValue: string;
  description: string;
  contractors: string;
  timeline: string;
  source: string;
  sourceUrl: string;
}

interface SearchContact {
  fullName: string;
  title: string;
  company: string;
  email: string;
  phone: string;
  linkedin: string;
  projectName: string;
  source: string;
  communityInvolvement: string;
  upcomingEvents: string;
  interests: string;
  socialMedia: string;
  personalNotes: string;
}

interface SearchIntelItem {
  category: string;
  title: string;
  summary: string;
  url: string;
  date: string;
  projectName: string;
}

interface SearchResults {
  projects: SearchProject[];
  contacts: SearchContact[];
  intel: SearchIntelItem[];
  query: string;
}

export default function LngProjectsPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabView>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [resultTab, setResultTab] = useState<"projects" | "contacts" | "intel">("projects");
  const [expandedProject, setExpandedProject] = useState<number | null>(null);
  const [expandedContact, setExpandedContact] = useState<number | null>(null);
  const [expandedSavedContact, setExpandedSavedContact] = useState<number | null>(null);
  const [expandedSaved, setExpandedSaved] = useState<number | null>(null);
  const [noteText, setNoteText] = useState<Record<number, string>>({});

  const savedProjectsQuery = useQuery<any[]>({
    queryKey: ["/api/lng/projects"],
    enabled: activeTab === "saved_projects",
  });

  const savedContactsQuery = useQuery<any[]>({
    queryKey: ["/api/lng/contacts"],
    enabled: activeTab === "saved_contacts",
  });

  const savedIntelQuery = useQuery<any[]>({
    queryKey: ["/api/lng/intel"],
    enabled: activeTab === "saved_intel",
  });

  const searchMutation = useMutation({
    mutationFn: async (query: string) => {
      const res = await apiRequest("POST", "/api/lng/search", { query });
      return res.json();
    },
    onSuccess: (data: SearchResults) => {
      setSearchResults(data);
      toast({ title: "Search complete", description: `Found ${data.projects.length} projects, ${data.contacts.length} contacts, ${data.intel.length} intel items` });
    },
    onError: (err: any) => {
      toast({ title: "Search failed", description: err.message, variant: "destructive" });
    },
  });

  const saveProjectMutation = useMutation({
    mutationFn: async (project: SearchProject) => {
      const res = await apiRequest("POST", "/api/lng/projects/save", { project });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Project saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/lng/projects"] });
    },
  });

  const saveContactMutation = useMutation({
    mutationFn: async (contact: SearchContact) => {
      const res = await apiRequest("POST", "/api/lng/contacts/save", { contact });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Contact saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/lng/contacts"] });
    },
  });

  const saveIntelMutation = useMutation({
    mutationFn: async (item: SearchIntelItem) => {
      const res = await apiRequest("POST", "/api/lng/intel/save", { item });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Intel saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/lng/intel"] });
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/lng/projects/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Project removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/lng/projects"] });
    },
  });

  const deleteContactMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/lng/contacts/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Contact removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/lng/contacts"] });
    },
  });

  const deleteIntelMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/lng/intel/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Intel removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/lng/intel"] });
    },
  });

  const updateNotesMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: number; notes: string }) => {
      const res = await apiRequest("PUT", `/api/lng/projects/${id}/notes`, { notes });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Notes saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/lng/projects"] });
    },
  });

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) return;
    searchMutation.mutate(searchQuery.trim());
  }, [searchQuery]);

  const tabs = [
    { key: "search" as TabView, label: "Search", icon: Search },
    { key: "saved_projects" as TabView, label: "Saved Projects", icon: Building2 },
    { key: "saved_contacts" as TabView, label: "Saved Contacts", icon: Users },
    { key: "saved_intel" as TabView, label: "Saved Intel", icon: Newspaper },
  ];

  return (
    <AppLayout>
      <div className="min-h-screen" style={{ background: SUBTLE }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${EMERALD}15` }}>
              <Flame className="w-5 h-5" style={{ color: EMERALD }} />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: TEXT }} data-testid="heading-lng">LNG Projects</h1>
              <p className="text-xs" style={{ color: MUTED }}>Search, track, and monitor LNG projects, decision makers, and intelligence</p>
            </div>
          </div>

          <div className="flex gap-1 mb-6 p-1 rounded-xl" style={{ background: BG, border: `1px solid ${BORDER}` }}>
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all flex-1 justify-center"
                  style={{
                    background: active ? EMERALD : "transparent",
                    color: active ? "#FFF" : MUTED,
                  }}
                  data-testid={`tab-${tab.key}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {activeTab === "search" && (
            <div>
              <div className="rounded-xl p-4 mb-4" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                <form
                  onSubmit={(e) => { e.preventDefault(); handleSearch(); }}
                  className="flex gap-2"
                >
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search for LNG projects, companies, decision makers, events..."
                    className="flex-1 px-4 py-2.5 rounded-lg text-sm"
                    style={{ border: `1px solid ${BORDER}`, color: TEXT }}
                    data-testid="input-lng-search"
                  />
                  <button
                    type="submit"
                    disabled={searchMutation.isPending || !searchQuery.trim()}
                    className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: EMERALD, color: "#FFF" }}
                    data-testid="button-lng-search"
                  >
                    {searchMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    Search
                  </button>
                </form>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {QUICK_SEARCHES.map((qs) => (
                    <button
                      key={qs}
                      onClick={() => { setSearchQuery(qs); searchMutation.mutate(qs); }}
                      className="px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors hover:opacity-80"
                      style={{ background: `${EMERALD}10`, color: EMERALD, border: `1px solid ${EMERALD}30` }}
                      data-testid={`quick-search-${qs.slice(0, 20)}`}
                    >
                      {qs}
                    </button>
                  ))}
                </div>
              </div>

              {searchMutation.isPending && (
                <div className="rounded-xl p-12 text-center" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" style={{ color: EMERALD }} />
                  <p className="text-sm font-semibold" style={{ color: TEXT }}>Searching LNG intelligence...</p>
                  <p className="text-xs mt-1" style={{ color: MUTED }}>Scanning web sources, news, and project databases</p>
                </div>
              )}

              {searchResults && !searchMutation.isPending && (
                <div>
                  <div className="flex gap-1 mb-4 p-1 rounded-lg" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                    {[
                      { key: "projects" as const, label: `Projects (${searchResults.projects.length})`, icon: Building2 },
                      { key: "contacts" as const, label: `Decision Makers (${searchResults.contacts.length})`, icon: Users },
                      { key: "intel" as const, label: `Intel (${searchResults.intel.length})`, icon: Newspaper },
                    ].map((t) => {
                      const Icon = t.icon;
                      const active = resultTab === t.key;
                      return (
                        <button
                          key={t.key}
                          onClick={() => setResultTab(t.key)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex-1 justify-center"
                          style={{
                            background: active ? TEXT : "transparent",
                            color: active ? "#FFF" : MUTED,
                          }}
                          data-testid={`result-tab-${t.key}`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {t.label}
                        </button>
                      );
                    })}
                  </div>

                  {resultTab === "projects" && (
                    <div className="space-y-3">
                      {searchResults.projects.length === 0 ? (
                        <div className="rounded-xl p-8 text-center" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                          <p className="text-sm" style={{ color: MUTED }}>No projects found. Try a different search.</p>
                        </div>
                      ) : searchResults.projects.map((project, i) => (
                        <div key={i} className="rounded-xl p-4" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="text-sm font-bold" style={{ color: TEXT }}>{project.projectName}</h3>
                                {project.status && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase" style={{ background: `${EMERALD}15`, color: EMERALD }}>
                                    {project.status}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: MUTED }}>
                                {project.operator && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{project.operator}</span>}
                                {project.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{project.location}{project.state ? `, ${project.state}` : ""}</span>}
                                {project.capacity && <span className="flex items-center gap-1"><Flame className="w-3 h-3" />{project.capacity}</span>}
                                {project.estimatedValue && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />{project.estimatedValue}</span>}
                                {project.timeline && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{project.timeline}</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => saveProjectMutation.mutate(project)}
                                disabled={saveProjectMutation.isPending}
                                className="p-1.5 rounded-lg transition-colors hover:opacity-80"
                                style={{ color: EMERALD }}
                                data-testid={`save-project-${i}`}
                              >
                                <Bookmark className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setExpandedProject(expandedProject === i ? null : i)}
                                className="p-1.5 rounded-lg transition-colors hover:opacity-80"
                                style={{ color: MUTED }}
                              >
                                {expandedProject === i ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                          {expandedProject === i && (
                            <div className="mt-3 pt-3 space-y-2" style={{ borderTop: `1px solid ${BORDER}` }}>
                              {project.description && <p className="text-xs" style={{ color: TEXT }}>{project.description}</p>}
                              {project.contractors && (
                                <div className="text-xs">
                                  <span className="font-semibold" style={{ color: TEXT }}>Contractors: </span>
                                  <span style={{ color: MUTED }}>{project.contractors}</span>
                                </div>
                              )}
                              {project.sourceUrl && (
                                <a href={project.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: EMERALD }}>
                                  <ExternalLink className="w-3 h-3" />Source: {project.source || project.sourceUrl}
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {resultTab === "contacts" && (
                    <div className="space-y-2">
                      {searchResults.contacts.length === 0 ? (
                        <div className="rounded-xl p-8 text-center" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                          <p className="text-sm" style={{ color: MUTED }}>No decision makers found. Try searching for specific companies.</p>
                        </div>
                      ) : searchResults.contacts.map((contact, i) => {
                        const hasPersonalIntel = contact.communityInvolvement || contact.upcomingEvents || contact.interests || contact.socialMedia || contact.personalNotes;
                        const isExpanded = expandedContact === i;
                        return (
                          <div key={i} className="rounded-xl p-3" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-bold" style={{ color: TEXT }}>{contact.fullName}</p>
                                  {hasPersonalIntel && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase" style={{ background: "rgba(245,158,11,0.1)", color: "#F59E0B" }}>
                                      Personal Intel
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs" style={{ color: MUTED }}>
                                  {contact.title && <span>{contact.title}</span>}
                                  {contact.company && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{contact.company}</span>}
                                  {contact.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{contact.email}</span>}
                                  {contact.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{contact.phone}</span>}
                                  {contact.linkedin && (
                                    <a href={contact.linkedin} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1" style={{ color: EMERALD }}>
                                      <Linkedin className="w-3 h-3" />LinkedIn
                                    </a>
                                  )}
                                  {contact.projectName && <span className="flex items-center gap-1"><Flame className="w-3 h-3" />{contact.projectName}</span>}
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                {hasPersonalIntel && (
                                  <button
                                    onClick={() => setExpandedContact(isExpanded ? null : i)}
                                    className="p-1.5 rounded-lg transition-colors hover:opacity-80"
                                    style={{ color: MUTED }}
                                  >
                                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                  </button>
                                )}
                                <button
                                  onClick={() => saveContactMutation.mutate(contact)}
                                  disabled={saveContactMutation.isPending}
                                  className="p-1.5 rounded-lg transition-colors hover:opacity-80"
                                  style={{ color: EMERALD }}
                                  data-testid={`save-contact-${i}`}
                                >
                                  <Bookmark className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                            {isExpanded && hasPersonalIntel && (
                              <div className="mt-3 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                                {contact.communityInvolvement && (
                                  <div className="rounded-lg p-2.5" style={{ background: SUBTLE }}>
                                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1" style={{ color: "#8B5CF6" }}>
                                      <Users className="w-3 h-3" />Community
                                    </p>
                                    <p className="text-xs" style={{ color: TEXT }}>{contact.communityInvolvement}</p>
                                  </div>
                                )}
                                {contact.upcomingEvents && (
                                  <div className="rounded-lg p-2.5" style={{ background: SUBTLE }}>
                                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1" style={{ color: "#F59E0B" }}>
                                      <Calendar className="w-3 h-3" />Events
                                    </p>
                                    <p className="text-xs" style={{ color: TEXT }}>{contact.upcomingEvents}</p>
                                  </div>
                                )}
                                {contact.interests && (
                                  <div className="rounded-lg p-2.5" style={{ background: SUBTLE }}>
                                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1" style={{ color: "#10B981" }}>
                                      <Globe className="w-3 h-3" />Interests
                                    </p>
                                    <p className="text-xs" style={{ color: TEXT }}>{contact.interests}</p>
                                  </div>
                                )}
                                {contact.socialMedia && (
                                  <div className="rounded-lg p-2.5" style={{ background: SUBTLE }}>
                                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1" style={{ color: "#EC4899" }}>
                                      <Globe className="w-3 h-3" />Social
                                    </p>
                                    <p className="text-xs" style={{ color: TEXT }}>{contact.socialMedia}</p>
                                  </div>
                                )}
                                {contact.personalNotes && (
                                  <div className="rounded-lg p-2.5 sm:col-span-2" style={{ background: SUBTLE }}>
                                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1" style={{ color: "#3B82F6" }}>
                                      <StickyNote className="w-3 h-3" />Background
                                    </p>
                                    <p className="text-xs" style={{ color: TEXT }}>{contact.personalNotes}</p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {resultTab === "intel" && (
                    <div className="space-y-2">
                      {searchResults.intel.length === 0 ? (
                        <div className="rounded-xl p-8 text-center" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                          <p className="text-sm" style={{ color: MUTED }}>No intelligence items found.</p>
                        </div>
                      ) : searchResults.intel.map((item, i) => {
                        const cat = CATEGORY_LABELS[item.category] || CATEGORY_LABELS.general;
                        const CatIcon = cat.icon;
                        return (
                          <div key={i} className="rounded-xl p-3 flex items-start justify-between" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                            <div className="flex gap-2.5 flex-1">
                              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: `${cat.color}15` }}>
                                <CatIcon className="w-3.5 h-3.5" style={{ color: cat.color }} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase" style={{ background: `${cat.color}15`, color: cat.color }}>
                                    {cat.label}
                                  </span>
                                  {item.date && <span className="text-[10px]" style={{ color: MUTED }}>{item.date}</span>}
                                </div>
                                <p className="text-xs font-semibold" style={{ color: TEXT }}>{item.title}</p>
                                {item.summary && <p className="text-xs mt-0.5" style={{ color: MUTED }}>{item.summary}</p>}
                                {item.url && (
                                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] font-medium mt-1" style={{ color: EMERALD }}>
                                    <ExternalLink className="w-2.5 h-2.5" />View source
                                  </a>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => saveIntelMutation.mutate(item)}
                              disabled={saveIntelMutation.isPending}
                              className="p-1.5 rounded-lg transition-colors hover:opacity-80 flex-shrink-0"
                              style={{ color: EMERALD }}
                              data-testid={`save-intel-${i}`}
                            >
                              <Bookmark className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "saved_projects" && (
            <div className="space-y-3">
              {savedProjectsQuery.isLoading && (
                <div className="rounded-xl p-8 text-center" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                  <Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: EMERALD }} />
                </div>
              )}
              {savedProjectsQuery.data?.length === 0 && (
                <div className="rounded-xl p-12 text-center" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                  <BookmarkCheck className="w-8 h-8 mx-auto mb-2" style={{ color: MUTED }} />
                  <p className="text-sm font-semibold" style={{ color: TEXT }}>No saved projects yet</p>
                  <p className="text-xs mt-1" style={{ color: MUTED }}>Search for LNG projects and save the ones you want to track</p>
                </div>
              )}
              {savedProjectsQuery.data?.map((project: any) => (
                <div key={project.id} className="rounded-xl p-4" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-bold" style={{ color: TEXT }}>{project.projectName}</h3>
                        {project.status && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase" style={{ background: `${EMERALD}15`, color: EMERALD }}>
                            {project.status}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: MUTED }}>
                        {project.operator && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{project.operator}</span>}
                        {project.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{project.location}{project.state ? `, ${project.state}` : ""}</span>}
                        {project.capacity && <span className="flex items-center gap-1"><Flame className="w-3 h-3" />{project.capacity}</span>}
                        {project.estimatedValue && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />{project.estimatedValue}</span>}
                        {project.timeline && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{project.timeline}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setExpandedSaved(expandedSaved === project.id ? null : project.id)}
                        className="p-1.5 rounded-lg transition-colors hover:opacity-80"
                        style={{ color: MUTED }}
                      >
                        {expandedSaved === project.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => deleteProjectMutation.mutate(project.id)}
                        className="p-1.5 rounded-lg transition-colors hover:opacity-80"
                        style={{ color: "#EF4444" }}
                        data-testid={`delete-project-${project.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {expandedSaved === project.id && (
                    <div className="mt-3 pt-3 space-y-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                      {project.description && <p className="text-xs" style={{ color: TEXT }}>{project.description}</p>}
                      {project.contractors && (
                        <div className="text-xs">
                          <span className="font-semibold" style={{ color: TEXT }}>Contractors: </span>
                          <span style={{ color: MUTED }}>{project.contractors}</span>
                        </div>
                      )}
                      {project.sourceUrl && (
                        <a href={project.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: EMERALD }}>
                          <ExternalLink className="w-3 h-3" />Source
                        </a>
                      )}
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: MUTED }}>Notes</label>
                        <textarea
                          value={noteText[project.id] ?? project.notes ?? ""}
                          onChange={(e) => setNoteText(prev => ({ ...prev, [project.id]: e.target.value }))}
                          className="w-full px-3 py-2 rounded-lg text-xs resize-none"
                          style={{ border: `1px solid ${BORDER}`, color: TEXT, minHeight: 60 }}
                          placeholder="Add notes about this project..."
                          data-testid={`notes-project-${project.id}`}
                        />
                        <button
                          onClick={() => updateNotesMutation.mutate({ id: project.id, notes: noteText[project.id] ?? project.notes ?? "" })}
                          disabled={updateNotesMutation.isPending}
                          className="mt-1 px-3 py-1 rounded-md text-[10px] font-bold transition-opacity hover:opacity-80"
                          style={{ background: TEXT, color: "#FFF" }}
                          data-testid={`save-notes-${project.id}`}
                        >
                          {updateNotesMutation.isPending ? "Saving..." : "Save Notes"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {activeTab === "saved_contacts" && (
            <div className="space-y-2">
              {savedContactsQuery.isLoading && (
                <div className="rounded-xl p-8 text-center" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                  <Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: EMERALD }} />
                </div>
              )}
              {savedContactsQuery.data?.length === 0 && (
                <div className="rounded-xl p-12 text-center" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                  <Users className="w-8 h-8 mx-auto mb-2" style={{ color: MUTED }} />
                  <p className="text-sm font-semibold" style={{ color: TEXT }}>No saved contacts yet</p>
                  <p className="text-xs mt-1" style={{ color: MUTED }}>Search for LNG projects and save key decision makers</p>
                </div>
              )}
              {savedContactsQuery.data?.map((contact: any) => {
                const hasPersonalIntel = contact.communityInvolvement || contact.upcomingEvents || contact.interests || contact.socialMedia || contact.personalNotes;
                const isExpanded = expandedSavedContact === contact.id;
                return (
                  <div key={contact.id} className="rounded-xl p-3" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold" style={{ color: TEXT }}>{contact.fullName}</p>
                          {hasPersonalIntel && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase" style={{ background: "rgba(245,158,11,0.1)", color: "#F59E0B" }}>
                              Personal Intel
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs" style={{ color: MUTED }}>
                          {contact.title && <span>{contact.title}</span>}
                          {contact.company && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{contact.company}</span>}
                          {contact.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{contact.email}</span>}
                          {contact.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{contact.phone}</span>}
                          {contact.linkedin && (
                            <a href={contact.linkedin} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1" style={{ color: EMERALD }}>
                              <Linkedin className="w-3 h-3" />LinkedIn
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {hasPersonalIntel && (
                          <button
                            onClick={() => setExpandedSavedContact(isExpanded ? null : contact.id)}
                            className="p-1.5 rounded-lg transition-colors hover:opacity-80"
                            style={{ color: MUTED }}
                          >
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        )}
                        <button
                          onClick={() => deleteContactMutation.mutate(contact.id)}
                          className="p-1.5 rounded-lg transition-colors hover:opacity-80"
                          style={{ color: "#EF4444" }}
                          data-testid={`delete-contact-${contact.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {isExpanded && hasPersonalIntel && (
                      <div className="mt-3 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                        {contact.communityInvolvement && (
                          <div className="rounded-lg p-2.5" style={{ background: SUBTLE }}>
                            <p className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1" style={{ color: "#8B5CF6" }}>
                              <Users className="w-3 h-3" />Community
                            </p>
                            <p className="text-xs" style={{ color: TEXT }}>{contact.communityInvolvement}</p>
                          </div>
                        )}
                        {contact.upcomingEvents && (
                          <div className="rounded-lg p-2.5" style={{ background: SUBTLE }}>
                            <p className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1" style={{ color: "#F59E0B" }}>
                              <Calendar className="w-3 h-3" />Events
                            </p>
                            <p className="text-xs" style={{ color: TEXT }}>{contact.upcomingEvents}</p>
                          </div>
                        )}
                        {contact.interests && (
                          <div className="rounded-lg p-2.5" style={{ background: SUBTLE }}>
                            <p className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1" style={{ color: "#10B981" }}>
                              <Globe className="w-3 h-3" />Interests
                            </p>
                            <p className="text-xs" style={{ color: TEXT }}>{contact.interests}</p>
                          </div>
                        )}
                        {contact.socialMedia && (
                          <div className="rounded-lg p-2.5" style={{ background: SUBTLE }}>
                            <p className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1" style={{ color: "#EC4899" }}>
                              <Globe className="w-3 h-3" />Social
                            </p>
                            <p className="text-xs" style={{ color: TEXT }}>{contact.socialMedia}</p>
                          </div>
                        )}
                        {contact.personalNotes && (
                          <div className="rounded-lg p-2.5 sm:col-span-2" style={{ background: SUBTLE }}>
                            <p className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1" style={{ color: "#3B82F6" }}>
                              <StickyNote className="w-3 h-3" />Background
                            </p>
                            <p className="text-xs" style={{ color: TEXT }}>{contact.personalNotes}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === "saved_intel" && (
            <div className="space-y-2">
              {savedIntelQuery.isLoading && (
                <div className="rounded-xl p-8 text-center" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                  <Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: EMERALD }} />
                </div>
              )}
              {savedIntelQuery.data?.length === 0 && (
                <div className="rounded-xl p-12 text-center" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                  <Newspaper className="w-8 h-8 mx-auto mb-2" style={{ color: MUTED }} />
                  <p className="text-sm font-semibold" style={{ color: TEXT }}>No saved intel yet</p>
                  <p className="text-xs mt-1" style={{ color: MUTED }}>Search and save hiring posts, events, press releases, and more</p>
                </div>
              )}
              {savedIntelQuery.data?.map((item: any) => {
                const cat = CATEGORY_LABELS[item.category] || CATEGORY_LABELS.general;
                const CatIcon = cat.icon;
                return (
                  <div key={item.id} className="rounded-xl p-3 flex items-start justify-between" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                    <div className="flex gap-2.5 flex-1">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: `${cat.color}15` }}>
                        <CatIcon className="w-3.5 h-3.5" style={{ color: cat.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase" style={{ background: `${cat.color}15`, color: cat.color }}>
                            {cat.label}
                          </span>
                          {item.date && <span className="text-[10px]" style={{ color: MUTED }}>{item.date}</span>}
                        </div>
                        <p className="text-xs font-semibold" style={{ color: TEXT }}>{item.title}</p>
                        {item.summary && <p className="text-xs mt-0.5" style={{ color: MUTED }}>{item.summary}</p>}
                        {item.url && (
                          <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] font-medium mt-1" style={{ color: EMERALD }}>
                            <ExternalLink className="w-2.5 h-2.5" />View source
                          </a>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => deleteIntelMutation.mutate(item.id)}
                      className="p-1.5 rounded-lg transition-colors hover:opacity-80 flex-shrink-0"
                      style={{ color: "#EF4444" }}
                      data-testid={`delete-intel-${item.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
