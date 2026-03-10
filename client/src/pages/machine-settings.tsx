import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import AppLayout from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Save, AlertTriangle, Loader2, Check, Link2, Unlink, ExternalLink } from "lucide-react";

const EMERALD = "#10B981";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";
const WARN = "#F59E0B";

interface MachineConfig {
  machine_name: string;
  market: string;
  opportunity: string;
  decision_maker_focus: string;
  geo: string;
  industry_config_selected: string;
}

const MARKET_OPTIONS = [
  { value: "industrial", label: "Industrial / Contractors" },
  { value: "saas", label: "SaaS / Technology" },
  { value: "real-estate", label: "Real Estate" },
  { value: "agency", label: "Agency / Services" },
  { value: "custom", label: "Custom" },
];

const HUBSPOT_ORANGE = "#FF7A59";

function HubSpotCard() {
  const { toast } = useToast();

  const { data: hubStatus, isLoading } = useQuery<{ connected: boolean; hubId?: string; connectedAt?: string }>({
    queryKey: ["/api/hubspot/status"],
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/hubspot/disconnect"),
    onSuccess: () => {
      toast({ title: "HubSpot disconnected" });
      queryClient.invalidateQueries({ queryKey: ["/api/hubspot/status"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to disconnect", description: err.message, variant: "destructive" });
    },
  });

  const handleConnect = async () => {
    try {
      const res = await apiRequest("GET", "/api/hubspot/auth");
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err: any) {
      toast({ title: "Failed to start OAuth", description: err.message, variant: "destructive" });
    }
  };

  const params = new URLSearchParams(window.location.search);
  const hubspotResult = params.get("hubspot");

  if (hubspotResult === "connected") {
    queryClient.invalidateQueries({ queryKey: ["/api/hubspot/status"] });
    window.history.replaceState({}, "", window.location.pathname);
  }

  return (
    <div
      className="rounded-2xl p-6 mb-6"
      style={{ background: "#FFF", border: `1px solid ${BORDER}`, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
      data-testid="card-hubspot"
    >
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-2 rounded-full" style={{ background: HUBSPOT_ORANGE }} />
        <p className="text-sm font-bold" style={{ color: TEXT }}>HubSpot Integration</p>
      </div>
      <p className="text-xs mb-4" style={{ color: MUTED }}>
        Connect your HubSpot CRM. When connected, the machine automatically syncs call activity, contacts, and deals to your HubSpot.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: MUTED }} />
          <span className="text-xs" style={{ color: MUTED }}>Checking connection...</span>
        </div>
      ) : hubStatus?.connected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)" }}>
            <Check className="w-4 h-4" style={{ color: EMERALD }} />
            <span className="text-sm font-medium" style={{ color: EMERALD }}>Connected</span>
            {hubStatus.hubId && (
              <span className="text-xs ml-auto" style={{ color: MUTED }}>Hub ID: {hubStatus.hubId}</span>
            )}
          </div>
          <div className="rounded-lg p-3 space-y-1.5" style={{ background: "rgba(248,250,252,1)", border: `1px solid ${BORDER}` }}>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: EMERALD }}>Auto-sync active</p>
            <p className="text-xs" style={{ color: MUTED }}>Call outcomes sync as HubSpot notes + engagement</p>
            <p className="text-xs" style={{ color: MUTED }}>New DMs sync as HubSpot contacts</p>
            <p className="text-xs" style={{ color: MUTED }}>Qualified deals create HubSpot deals</p>
            <p className="text-xs" style={{ color: MUTED }}>Companies linked automatically</p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
              variant="outline"
              className="text-xs gap-1.5"
              style={{ borderColor: BORDER, color: MUTED }}
              data-testid="button-hubspot-disconnect"
            >
              {disconnectMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
              Disconnect
            </Button>
            <Button
              onClick={() => window.open("https://app.hubspot.com", "_blank")}
              variant="outline"
              className="text-xs gap-1.5"
              style={{ borderColor: BORDER, color: MUTED }}
              data-testid="button-hubspot-open"
            >
              <ExternalLink className="w-3 h-3" />
              Open HubSpot
            </Button>
          </div>
        </div>
      ) : (
        <Button
          onClick={handleConnect}
          className="text-sm font-bold gap-2"
          style={{ background: HUBSPOT_ORANGE, color: "#FFF" }}
          data-testid="button-hubspot-connect"
        >
          <Link2 className="w-4 h-4" />
          Connect HubSpot
        </Button>
      )}
    </div>
  );
}

export default function MachineSettingsPage() {
  const { getToken } = useAuth();
  const token = getToken();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [machineName, setMachineName] = useState("");
  const [geo, setGeo] = useState("");
  const [dmFocus, setDmFocus] = useState("");
  const [opportunity, setOpportunity] = useState("");
  const [market, setMarket] = useState("");
  const [showMarketConfirm, setShowMarketConfirm] = useState(false);
  const [pendingMarket, setPendingMarket] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  const { data: meData, isLoading } = useQuery<{ email: string; machine_config: MachineConfig | null }>({
    queryKey: ["/api/me"],
    enabled: !!token,
  });

  const mc = meData?.machine_config;

  useEffect(() => {
    if (mc) {
      setMachineName(mc.machine_name);
      setGeo(mc.geo);
      setDmFocus(mc.decision_maker_focus);
      setOpportunity(mc.opportunity);
      setMarket(mc.market);
    }
  }, [mc]);

  useEffect(() => {
    if (!mc) return;
    const changed =
      machineName !== mc.machine_name ||
      geo !== mc.geo ||
      dmFocus !== mc.decision_maker_focus ||
      opportunity !== mc.opportunity ||
      market !== mc.market;
    setHasChanges(changed);
  }, [machineName, geo, dmFocus, opportunity, market, mc]);

  const saveMutation = useMutation({
    mutationFn: (data: Partial<MachineConfig>) =>
      apiRequest("PATCH", "/api/machine-settings", data),
    onSuccess: async (res) => {
      const body = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/me"] });

      toast({
        title: "Machine settings saved",
        description: body.industry_changed
          ? "Industry config changed — next pipeline run will use new settings."
          : "Your machine identity has been updated.",
        duration: 3000,
      });

      setHasChanges(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to save settings",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!hasChanges || !mc) return;

    if (market !== mc.market) {
      setPendingMarket(market);
      setShowMarketConfirm(true);
      return;
    }

    saveMutation.mutate({
      machine_name: machineName,
      geo,
      decision_maker_focus: dmFocus,
      opportunity,
    });
  };

  const confirmMarketChange = () => {
    setShowMarketConfirm(false);
    saveMutation.mutate({
      machine_name: machineName,
      geo,
      decision_maker_focus: dmFocus,
      opportunity,
      market: pendingMarket,
    });
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: MUTED }} />
        </div>
      </AppLayout>
    );
  }

  if (!mc) {
    return (
      <AppLayout>
        <div className="max-w-xl mx-auto p-6 pt-12 text-center">
          <p className="text-sm" style={{ color: MUTED }}>No machine configuration found. Complete onboarding first.</p>
          <Button
            onClick={() => navigate("/machine/onboarding")}
            className="mt-4"
            style={{ background: EMERALD, color: "#FFF" }}
            data-testid="button-go-onboarding"
          >
            Go to Onboarding
          </Button>
        </div>
      </AppLayout>
    );
  }

  const Field = ({ label, value, onChange, placeholder, id, hint }: {
    label: string; value: string; onChange: (v: string) => void;
    placeholder?: string; id: string; hint?: string;
  }) => (
    <div className="space-y-1.5">
      <label className="text-xs font-mono uppercase tracking-widest" style={{ color: MUTED }}>{label}</label>
      {hint && <p className="text-xs" style={{ color: MUTED }}>{hint}</p>}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-2.5 rounded-xl text-sm font-medium"
        style={{
          background: "#FFF",
          border: `1px solid ${BORDER}`,
          color: TEXT,
        }}
        data-testid={`input-${id}`}
      />
    </div>
  );

  return (
    <AppLayout showBackToChip>
      <div className="max-w-2xl mx-auto p-4 md:p-6 pt-8">
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => navigate("/machine/dashboard")}
            className="p-1.5 rounded-lg"
            style={{ color: MUTED }}
            data-testid="button-back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-bold" style={{ color: TEXT }} data-testid="text-page-title">
              Machine Settings
            </h1>
            <p className="text-xs font-mono" style={{ color: MUTED }}>
              Configure your lead engine identity and targeting
            </p>
          </div>
        </div>

        <div
          className="rounded-2xl p-6 mb-6 space-y-5"
          style={{ background: "#FFF", border: `1px solid ${BORDER}`, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
          data-testid="card-identity"
        >
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full" style={{ background: EMERALD }} />
            <p className="text-sm font-bold" style={{ color: TEXT }}>Identity</p>
          </div>
          <Field
            label="Machine Name"
            value={machineName}
            onChange={setMachineName}
            placeholder="e.g., INDUSTRIAL-COOL-HTX"
            id="machine-name"
            hint="This appears on your dashboard and reports"
          />
        </div>

        <div
          className="rounded-2xl p-6 mb-6 space-y-5"
          style={{ background: "#FFF", border: `1px solid ${BORDER}`, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
          data-testid="card-targeting"
        >
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full" style={{ background: EMERALD }} />
            <p className="text-sm font-bold" style={{ color: TEXT }}>Targeting</p>
          </div>
          <Field
            label="Territory / Geography"
            value={geo}
            onChange={setGeo}
            placeholder="e.g., Houston, Gulf Coast, Texas"
            id="geo"
          />
          <Field
            label="Decision Maker Focus"
            value={dmFocus}
            onChange={setDmFocus}
            placeholder="e.g., Safety Manager, Operations Director"
            id="dm-focus"
          />
          <Field
            label="Opportunity / Product"
            value={opportunity}
            onChange={setOpportunity}
            placeholder="e.g., Cooling trailers, Heat mitigation"
            id="opportunity"
          />
        </div>

        <div
          className="rounded-2xl p-6 mb-6"
          style={{ background: "#FFF", border: `1px solid ${BORDER}`, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
          data-testid="card-industry"
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full" style={{ background: WARN }} />
            <p className="text-sm font-bold" style={{ color: TEXT }}>Industry Configuration</p>
          </div>
          <p className="text-xs mb-3" style={{ color: MUTED }}>
            Changing industry config affects scoring, keywords, and search templates. A confirmation is required.
          </p>
          <div className="flex items-center gap-2 text-xs mb-3" style={{ color: MUTED }}>
            <span>Current:</span>
            <span
              className="px-2 py-0.5 rounded font-mono font-bold"
              style={{ background: `${EMERALD}10`, color: EMERALD, border: `1px solid ${EMERALD}25` }}
              data-testid="text-current-industry"
            >
              {mc.industry_config_selected}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {MARKET_OPTIONS.map((opt) => {
              const isSelected = market === opt.value;
              const isCurrent = mc.market === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setMarket(opt.value)}
                  className="px-3 py-2.5 rounded-xl text-xs font-semibold text-left transition-all"
                  style={{
                    background: isSelected ? `${EMERALD}08` : SUBTLE,
                    border: `1px solid ${isSelected ? `${EMERALD}35` : BORDER}`,
                    color: isSelected ? EMERALD : TEXT,
                  }}
                  data-testid={`market-${opt.value}`}
                >
                  {opt.label}
                  {isCurrent && <span className="block text-xs font-normal mt-0.5" style={{ color: MUTED }}>(current)</span>}
                </button>
              );
            })}
          </div>
        </div>

        <HubSpotCard />

        <div className="flex items-center justify-between">
          <Button
            onClick={() => navigate("/machine/dashboard")}
            variant="outline"
            className="text-sm"
            style={{ borderColor: BORDER, color: MUTED }}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || saveMutation.isPending}
            className="text-sm font-bold gap-2 px-6"
            style={{
              background: hasChanges ? TEXT : `${TEXT}40`,
              color: "#FFF",
            }}
            data-testid="button-save"
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saveMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>

        {showMarketConfirm && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={() => setShowMarketConfirm(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="rounded-2xl p-6 w-96"
              style={{ background: "#FFF", border: `1px solid ${BORDER}` }}
              data-testid="modal-industry-confirm"
            >
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-5 h-5" style={{ color: WARN }} />
                <p className="text-sm font-bold" style={{ color: TEXT }}>Change Industry Configuration?</p>
              </div>
              <p className="text-xs mb-4 leading-relaxed" style={{ color: MUTED }}>
                Switching from <strong style={{ color: TEXT }}>{mc.market}</strong> to <strong style={{ color: TEXT }}>{pendingMarket}</strong> will
                change scoring rules, keyword sets, and search templates. The next pipeline run will use the new configuration.
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={() => { setShowMarketConfirm(false); setMarket(mc.market); }}
                  variant="outline"
                  className="flex-1 text-sm"
                  style={{ borderColor: BORDER, color: MUTED }}
                  data-testid="button-confirm-cancel"
                >
                  Keep Current
                </Button>
                <Button
                  onClick={confirmMarketChange}
                  className="flex-1 text-sm font-bold gap-1.5"
                  style={{ background: WARN, color: TEXT }}
                  data-testid="button-confirm-change"
                >
                  <Check className="w-4 h-4" />
                  Confirm Change
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
