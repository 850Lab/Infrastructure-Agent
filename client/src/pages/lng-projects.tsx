import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Loader2, Bookmark, Trash2, Building2,
  Users, MapPin, Target, Zap, MessageSquare,
  Star, ArrowRight, Shield, Calendar, Globe,
  Flame, ExternalLink, StickyNote, ChevronDown, ChevronUp,
} from "lucide-react";

const BG = "#FFFFFF";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";
const EMERALD = "#10B981";

const ROLE_COLORS: Record<string, string> = {
  decision_maker: "#EF4444",
  influencer: "#F59E0B",
  connector: "#8B5CF6",
};

const ENV_COLORS: Record<string, string> = {
  trade_association: "#3B82F6",
  safety_council: "#EF4444",
  conference: "#8B5CF6",
  vendor_event: "#F97316",
  networking: "#10B981",
  training: "#06B6D4",
};

const QUICK_SEARCHES = [
  "LNG contractors Gulf Coast Texas Louisiana",
  "Golden Pass LNG Port Arthur industrial contractors",
  "Driftwood LNG Lake Charles maintenance turnaround",
  "Sabine Pass Cheniere operations procurement",
  "Refinery turnaround contractors Houston Beaumont",
  "Industrial maintenance contractors Gulf Coast safety",
  "Petrochemical plant shutdown contractors Texas",
  "Gulf Coast industrial contractor networking events 2026",
  "ABC Associated Builders Contractors Gulf Coast chapter",
  "Industrial safety council Houston Beaumont Lake Charles",
];

type TabView = "search" | "saved_cards" | "saved_projects";

interface OperatorCard {
  companyName: string;
  industryType: string;
  region: string;
  priorityPeople: Array<{
    name: string;
    title: string;
    score: number;
    roleCategory: string;
    whyTheyMatter: string;
    publicSourceUrl: string;
  }>;
  whatTheyCareAbout: string[];
  professionalEnvironments: Array<{
    name: string;
    type: string;
    organizer: string;
    location: string;
    date: string;
    score: number;
    publicUrl: string;
    whyItMatters: string;
  }>;
  bestConnectors: Array<{
    type: string;
    name: string;
    organization: string;
    reason: string;
    score: number;
  }>;
  bestNextRoom: string;
  bestConnector: string;
  bestAction: string;
  backupAction: string;
  talkingAngle: string;
  whyThisPathMakesSense: string;
  confidence: number;
}

function ConfidenceBadge({ score }: { score: number }) {
  const color = score >= 75 ? "#10B981" : score >= 50 ? "#F59E0B" : "#EF4444";
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: `${color}15`, color }}>
      {score}% confidence
    </span>
  );
}

function ScoreDot({ score }: { score: number }) {
  const color = score >= 85 ? "#10B981" : score >= 70 ? "#F59E0B" : "#94A3B8";
  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${color}15`, color }}>{score}</span>;
}

function OperatorCardView({ card, onSave, saving }: { card: OperatorCard; onSave: () => void; saving: boolean }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: BG, border: `1px solid ${BORDER}` }}>
      <div className="p-4" style={{ background: `${EMERALD}08`, borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-base font-bold" style={{ color: TEXT }}>{card.companyName}</h3>
              <ConfidenceBadge score={card.confidence} />
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs" style={{ color: MUTED }}>
              {card.industryType && <span className="flex items-center gap-1"><Flame className="w-3 h-3" />{card.industryType}</span>}
              {card.region && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{card.region}</span>}
            </div>
          </div>
          <button
            onClick={onSave}
            disabled={saving}
            className="p-2 rounded-lg transition-colors hover:opacity-80 flex-shrink-0"
            style={{ color: EMERALD }}
            data-testid={`save-card-${card.companyName.replace(/\s+/g, '-').toLowerCase()}`}
          >
            <Bookmark className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-lg p-3" style={{ background: `${EMERALD}08`, border: `1px solid ${EMERALD}20` }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1" style={{ color: EMERALD }}>
              <Target className="w-3 h-3" />Best Next Room
            </p>
            <p className="text-xs font-semibold" style={{ color: TEXT }}>{card.bestNextRoom || "Research needed"}</p>
          </div>
          <div className="rounded-lg p-3" style={{ background: "rgba(139,92,246,0.05)", border: "1px solid rgba(139,92,246,0.2)" }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1" style={{ color: "#8B5CF6" }}>
              <Users className="w-3 h-3" />Best Connector
            </p>
            <p className="text-xs font-semibold" style={{ color: TEXT }}>{card.bestConnector || "Research needed"}</p>
          </div>
          <div className="rounded-lg p-3" style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.2)" }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1" style={{ color: "#3B82F6" }}>
              <Zap className="w-3 h-3" />Best Action
            </p>
            <p className="text-xs font-semibold" style={{ color: TEXT }}>{card.bestAction || "Research needed"}</p>
          </div>
        </div>

        {card.backupAction && (
          <div className="rounded-lg p-2.5" style={{ background: SUBTLE }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1" style={{ color: MUTED }}>
              <ArrowRight className="w-3 h-3" />Backup Action
            </p>
            <p className="text-xs" style={{ color: TEXT }}>{card.backupAction}</p>
          </div>
        )}

        {card.talkingAngle && (
          <div className="rounded-lg p-2.5" style={{ background: "rgba(16,185,129,0.05)", border: `1px dashed ${EMERALD}40` }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1" style={{ color: EMERALD }}>
              <MessageSquare className="w-3 h-3" />Talking Angle
            </p>
            <p className="text-xs italic" style={{ color: TEXT }}>{card.talkingAngle}</p>
          </div>
        )}

        {card.priorityPeople.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1" style={{ color: TEXT }}>
              <Users className="w-3 h-3" />Priority People ({card.priorityPeople.length})
            </p>
            <div className="space-y-1.5">
              {card.priorityPeople.map((person, j) => (
                <div key={j} className="flex items-center gap-2 rounded-lg p-2" style={{ background: SUBTLE }}>
                  <ScoreDot score={person.score} />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold" style={{ color: TEXT }}>{person.name}</span>
                    <span className="text-xs mx-1.5" style={{ color: MUTED }}>{person.title}</span>
                    {person.roleCategory && (
                      <span className="px-1 py-0.5 rounded text-[9px] font-bold uppercase" style={{ background: `${ROLE_COLORS[person.roleCategory] || MUTED}15`, color: ROLE_COLORS[person.roleCategory] || MUTED }}>
                        {person.roleCategory.replace("_", " ")}
                      </span>
                    )}
                  </div>
                  {person.publicSourceUrl && (
                    <a href={person.publicSourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: EMERALD }}>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {card.whatTheyCareAbout.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1" style={{ color: TEXT }}>
              <Shield className="w-3 h-3" />What They Care About
            </p>
            <div className="flex flex-wrap gap-1.5">
              {card.whatTheyCareAbout.map((concern, j) => (
                <span key={j} className="px-2 py-1 rounded-full text-[10px] font-medium" style={{ background: SUBTLE, color: TEXT, border: `1px solid ${BORDER}` }}>
                  {concern}
                </span>
              ))}
            </div>
          </div>
        )}

        {card.professionalEnvironments.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1" style={{ color: TEXT }}>
              <Calendar className="w-3 h-3" />Professional Environments ({card.professionalEnvironments.length})
            </p>
            <div className="space-y-1.5">
              {card.professionalEnvironments.map((env, j) => (
                <div key={j} className="flex items-center gap-2 rounded-lg p-2" style={{ background: SUBTLE }}>
                  <ScoreDot score={env.score} />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold" style={{ color: TEXT }}>{env.name}</span>
                    {env.type && (
                      <span className="ml-1.5 px-1 py-0.5 rounded text-[9px] font-bold uppercase" style={{ background: `${ENV_COLORS[env.type] || MUTED}15`, color: ENV_COLORS[env.type] || MUTED }}>
                        {env.type.replace("_", " ")}
                      </span>
                    )}
                    {env.location && <span className="text-xs ml-1.5" style={{ color: MUTED }}>{env.location}</span>}
                    {env.date && <span className="text-xs ml-1" style={{ color: MUTED }}>({env.date})</span>}
                  </div>
                  {env.publicUrl && (
                    <a href={env.publicUrl} target="_blank" rel="noopener noreferrer" style={{ color: EMERALD }}>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {card.bestConnectors.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1" style={{ color: TEXT }}>
              <Star className="w-3 h-3" />Connectors ({card.bestConnectors.length})
            </p>
            <div className="space-y-1.5">
              {card.bestConnectors.map((conn, j) => (
                <div key={j} className="flex items-start gap-2 rounded-lg p-2" style={{ background: SUBTLE }}>
                  <ScoreDot score={conn.score} />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold" style={{ color: TEXT }}>{conn.name || conn.type}</span>
                    {conn.organization && <span className="text-xs ml-1.5" style={{ color: MUTED }}>{conn.organization}</span>}
                    {conn.reason && <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>{conn.reason}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {card.whyThisPathMakesSense && (
          <div className="rounded-lg p-2.5" style={{ background: SUBTLE }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: MUTED }}>Why This Path Makes Sense</p>
            <p className="text-xs" style={{ color: TEXT }}>{card.whyThisPathMakesSense}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LngProjectsPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabView>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<OperatorCard[] | null>(null);
  const [noteText, setNoteText] = useState<Record<number, string>>({});
  const [expandedSaved, setExpandedSaved] = useState<number | null>(null);

  const savedCardsQuery = useQuery<any[]>({
    queryKey: ["/api/lng/cards"],
    enabled: activeTab === "saved_cards",
  });

  const savedProjectsQuery = useQuery<any[]>({
    queryKey: ["/api/lng/projects"],
    enabled: activeTab === "saved_projects",
  });

  const searchMutation = useMutation({
    mutationFn: async (query: string) => {
      const resp = await apiRequest("POST", "/api/lng/search", { query });
      return resp.json();
    },
    onSuccess: (data) => {
      const normalized = (data.cards || []).map((c: any) => ({
        ...c,
        priorityPeople: c.priorityPeople || [],
        whatTheyCareAbout: c.whatTheyCareAbout || [],
        professionalEnvironments: c.professionalEnvironments || [],
        bestConnectors: c.bestConnectors || [],
        confidence: c.confidence || 0,
      }));
      setSearchResults(normalized);
      toast({ title: `Found ${normalized.length} operator cards` });
    },
    onError: (err: any) => {
      toast({ title: "Search failed", description: err.message, variant: "destructive" });
    },
  });

  const saveCardMutation = useMutation({
    mutationFn: async (card: OperatorCard) => {
      const resp = await apiRequest("POST", "/api/lng/cards/save", { card });
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lng/cards"] });
      toast({ title: "Operator card saved" });
    },
    onError: (err: any) => { toast({ title: "Save failed", description: err.message, variant: "destructive" }); },
  });

  const deleteCardMutation = useMutation({
    mutationFn: async (id: number) => {
      const resp = await apiRequest("DELETE", `/api/lng/cards/${id}`);
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lng/cards"] });
      toast({ title: "Card removed" });
    },
    onError: (err: any) => { toast({ title: "Delete failed", description: err.message, variant: "destructive" }); },
  });

  const saveProjectMutation = useMutation({
    mutationFn: async (project: any) => {
      const resp = await apiRequest("POST", "/api/lng/projects/save", { project });
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lng/projects"] });
      toast({ title: "Project saved" });
    },
    onError: (err: any) => { toast({ title: "Save failed", description: err.message, variant: "destructive" }); },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (id: number) => {
      const resp = await apiRequest("DELETE", `/api/lng/projects/${id}`);
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lng/projects"] });
      toast({ title: "Project removed" });
    },
    onError: (err: any) => { toast({ title: "Delete failed", description: err.message, variant: "destructive" }); },
  });

  const updateNotesMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: number; notes: string }) => {
      const resp = await apiRequest("PUT", `/api/lng/cards/${id}/notes`, { notes });
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lng/cards"] });
      toast({ title: "Notes updated" });
    },
    onError: (err: any) => { toast({ title: "Notes save failed", description: err.message, variant: "destructive" }); },
  });

  const handleSearch = () => {
    if (!searchQuery.trim()) return;
    searchMutation.mutate(searchQuery.trim());
  };

  return (
    <div className="min-h-screen p-4 md:p-6 max-w-4xl mx-auto" style={{ background: SUBTLE }}>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${EMERALD}15` }}>
          <Target className="w-5 h-5" style={{ color: EMERALD }} />
        </div>
        <div>
          <h1 className="text-lg font-bold" style={{ color: TEXT }} data-testid="heading-lng">Relationship Intelligence</h1>
          <p className="text-xs" style={{ color: MUTED }}>Find the best rooms, connectors, and paths to warm introductions</p>
        </div>
      </div>

      <div className="flex gap-1 mb-4 p-1 rounded-lg" style={{ background: BG, border: `1px solid ${BORDER}` }}>
        {[
          { key: "search" as const, label: "Search", icon: Search },
          { key: "saved_cards" as const, label: "Saved Cards", icon: Target },
          { key: "saved_projects" as const, label: "Saved Projects", icon: Building2 },
        ].map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex-1 justify-center"
              style={{ background: active ? TEXT : "transparent", color: active ? "#FFF" : MUTED }}
              data-testid={`tab-${t.key}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {activeTab === "search" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Search companies, industries, projects..."
              className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: BG, border: `1px solid ${BORDER}`, color: TEXT }}
              data-testid="input-lng-search"
            />
            <button
              onClick={handleSearch}
              disabled={searchMutation.isPending || !searchQuery.trim()}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
              style={{ background: EMERALD }}
              data-testid="button-lng-search"
            >
              {searchMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {QUICK_SEARCHES.map((q) => (
              <button
                key={q}
                onClick={() => { setSearchQuery(q); searchMutation.mutate(q); }}
                className="px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors hover:opacity-80"
                style={{ background: BG, color: MUTED, border: `1px solid ${BORDER}` }}
                data-testid={`quick-search-${q.slice(0, 20)}`}
              >
                {q.length > 45 ? q.slice(0, 42) + "..." : q}
              </button>
            ))}
          </div>

          {searchMutation.isPending && (
            <div className="rounded-xl p-12 text-center" style={{ background: BG, border: `1px solid ${BORDER}` }}>
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" style={{ color: EMERALD }} />
              <p className="text-sm font-semibold" style={{ color: TEXT }}>Building relationship intelligence...</p>
              <p className="text-xs mt-1" style={{ color: MUTED }}>Scanning public sources for companies, people, environments, and connectors</p>
            </div>
          )}

          {searchResults && !searchMutation.isPending && (
            <div className="space-y-4">
              {searchResults.length === 0 ? (
                <div className="rounded-xl p-12 text-center" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                  <Target className="w-8 h-8 mx-auto mb-2" style={{ color: MUTED }} />
                  <p className="text-sm font-semibold" style={{ color: TEXT }}>No operator cards found</p>
                  <p className="text-xs mt-1" style={{ color: MUTED }}>Try searching for specific companies or industries</p>
                </div>
              ) : (
                <>
                  <p className="text-xs font-semibold" style={{ color: MUTED }}>
                    {searchResults.length} operator card{searchResults.length !== 1 ? "s" : ""} found
                  </p>
                  {searchResults.map((card, i) => (
                    <OperatorCardView
                      key={i}
                      card={card}
                      onSave={() => saveCardMutation.mutate(card)}
                      saving={saveCardMutation.isPending}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === "saved_cards" && (
        <div className="space-y-4">
          {savedCardsQuery.isLoading && (
            <div className="rounded-xl p-8 text-center" style={{ background: BG, border: `1px solid ${BORDER}` }}>
              <Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: EMERALD }} />
            </div>
          )}
          {savedCardsQuery.data?.length === 0 && (
            <div className="rounded-xl p-12 text-center" style={{ background: BG, border: `1px solid ${BORDER}` }}>
              <Target className="w-8 h-8 mx-auto mb-2" style={{ color: MUTED }} />
              <p className="text-sm font-semibold" style={{ color: TEXT }}>No saved operator cards yet</p>
              <p className="text-xs mt-1" style={{ color: MUTED }}>Search for companies and save the best relationship paths</p>
            </div>
          )}
          {savedCardsQuery.data?.map((saved: any) => {
            let card: OperatorCard;
            try {
              card = JSON.parse(saved.cardData);
              if (!card || !card.companyName) return null;
              card.priorityPeople = card.priorityPeople || [];
              card.whatTheyCareAbout = card.whatTheyCareAbout || [];
              card.professionalEnvironments = card.professionalEnvironments || [];
              card.bestConnectors = card.bestConnectors || [];
            } catch { return null; }
            const isExpanded = expandedSaved === saved.id;
            return (
              <div key={saved.id} className="rounded-xl overflow-hidden" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                <div className="p-4 cursor-pointer" style={{ background: `${EMERALD}08`, borderBottom: `1px solid ${BORDER}` }}
                  onClick={() => setExpandedSaved(isExpanded ? null : saved.id)}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-base font-bold" style={{ color: TEXT }}>{card.companyName}</h3>
                        <ConfidenceBadge score={card.confidence} />
                        {isExpanded ? <ChevronUp className="w-4 h-4" style={{ color: MUTED }} /> : <ChevronDown className="w-4 h-4" style={{ color: MUTED }} />}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs" style={{ color: MUTED }}>
                        {card.industryType && <span className="flex items-center gap-1"><Flame className="w-3 h-3" />{card.industryType}</span>}
                        {card.region && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{card.region}</span>}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{ background: `${EMERALD}10`, color: EMERALD }}>{card.bestNextRoom || "No room"}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{ background: "rgba(139,92,246,0.1)", color: "#8B5CF6" }}>{card.bestConnector || "No connector"}</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteCardMutation.mutate(saved.id); }}
                      className="p-1.5 rounded-lg transition-colors hover:opacity-80 flex-shrink-0"
                      style={{ color: "#EF4444" }}
                      data-testid={`delete-card-${saved.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="p-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="rounded-lg p-3" style={{ background: `${EMERALD}08`, border: `1px solid ${EMERALD}20` }}>
                        <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1" style={{ color: EMERALD }}>
                          <Target className="w-3 h-3" />Best Next Room
                        </p>
                        <p className="text-xs font-semibold" style={{ color: TEXT }}>{card.bestNextRoom}</p>
                      </div>
                      <div className="rounded-lg p-3" style={{ background: "rgba(139,92,246,0.05)", border: "1px solid rgba(139,92,246,0.2)" }}>
                        <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1" style={{ color: "#8B5CF6" }}>
                          <Users className="w-3 h-3" />Best Connector
                        </p>
                        <p className="text-xs font-semibold" style={{ color: TEXT }}>{card.bestConnector}</p>
                      </div>
                      <div className="rounded-lg p-3" style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.2)" }}>
                        <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1" style={{ color: "#3B82F6" }}>
                          <Zap className="w-3 h-3" />Best Action
                        </p>
                        <p className="text-xs font-semibold" style={{ color: TEXT }}>{card.bestAction}</p>
                      </div>
                    </div>

                    {card.talkingAngle && (
                      <div className="rounded-lg p-2.5" style={{ background: "rgba(16,185,129,0.05)", border: `1px dashed ${EMERALD}40` }}>
                        <p className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1" style={{ color: EMERALD }}>
                          <MessageSquare className="w-3 h-3" />Talking Angle
                        </p>
                        <p className="text-xs italic" style={{ color: TEXT }}>{card.talkingAngle}</p>
                      </div>
                    )}

                    {card.priorityPeople.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: TEXT }}>Priority People</p>
                        <div className="space-y-1.5">
                          {card.priorityPeople.map((person, j) => (
                            <div key={j} className="flex items-center gap-2 rounded-lg p-2" style={{ background: SUBTLE }}>
                              <ScoreDot score={person.score} />
                              <span className="text-xs font-bold" style={{ color: TEXT }}>{person.name}</span>
                              <span className="text-xs" style={{ color: MUTED }}>{person.title}</span>
                              <span className="px-1 py-0.5 rounded text-[9px] font-bold uppercase" style={{ background: `${ROLE_COLORS[person.roleCategory] || MUTED}15`, color: ROLE_COLORS[person.roleCategory] || MUTED }}>
                                {person.roleCategory?.replace("_", " ")}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {card.professionalEnvironments.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: TEXT }}>Professional Environments</p>
                        <div className="space-y-1.5">
                          {card.professionalEnvironments.map((env, j) => (
                            <div key={j} className="flex items-center gap-2 rounded-lg p-2" style={{ background: SUBTLE }}>
                              <ScoreDot score={env.score} />
                              <span className="text-xs font-bold" style={{ color: TEXT }}>{env.name}</span>
                              <span className="px-1 py-0.5 rounded text-[9px] font-bold uppercase" style={{ background: `${ENV_COLORS[env.type] || MUTED}15`, color: ENV_COLORS[env.type] || MUTED }}>
                                {env.type?.replace("_", " ")}
                              </span>
                              {env.location && <span className="text-xs" style={{ color: MUTED }}>{env.location}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="rounded-lg p-3" style={{ background: SUBTLE }}>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1" style={{ color: TEXT }}>
                        <StickyNote className="w-3 h-3" />Notes
                      </p>
                      <textarea
                        value={noteText[saved.id] ?? saved.notes ?? ""}
                        onChange={(e) => setNoteText({ ...noteText, [saved.id]: e.target.value })}
                        onBlur={() => {
                          const val = noteText[saved.id];
                          if (val !== undefined && val !== saved.notes) {
                            updateNotesMutation.mutate({ id: saved.id, notes: val });
                          }
                        }}
                        placeholder="Add your notes..."
                        className="w-full text-xs p-2 rounded-lg outline-none resize-none"
                        style={{ background: BG, border: `1px solid ${BORDER}`, color: TEXT, minHeight: "60px" }}
                        data-testid={`notes-${saved.id}`}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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
              <Building2 className="w-8 h-8 mx-auto mb-2" style={{ color: MUTED }} />
              <p className="text-sm font-semibold" style={{ color: TEXT }}>No saved projects yet</p>
            </div>
          )}
          {savedProjectsQuery.data?.map((project: any) => (
            <div key={project.id} className="rounded-xl p-4" style={{ background: BG, border: `1px solid ${BORDER}` }}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-sm font-bold" style={{ color: TEXT }}>{project.projectName}</h3>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs mt-1" style={{ color: MUTED }}>
                    {project.operator && <span>{project.operator}</span>}
                    {project.location && <span>{project.location}</span>}
                    {project.status && <span>{project.status}</span>}
                  </div>
                  {project.description && <p className="text-xs mt-2" style={{ color: TEXT }}>{project.description}</p>}
                </div>
                <button
                  onClick={() => deleteProjectMutation.mutate(project.id)}
                  className="p-1.5 rounded-lg transition-colors hover:opacity-80"
                  style={{ color: "#EF4444" }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
