import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import AppLayout from "@/components/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Target,
  MapPin,
  FileText,
  Truck,
  Trophy,
  XCircle,
  Receipt,
  Mail,
  Plus,
  Trash2,
  X,
} from "lucide-react";

const EMERALD = "#10B981";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";

const STAGE_META: Record<string, { label: string; color: string; icon: any }> = {
  Qualified: { label: "Qualified", color: "#3B82F6", icon: Target },
  SiteWalk: { label: "Site Walk", color: "#8B5CF6", icon: MapPin },
  QuoteSent: { label: "Quote Sent", color: "#F59E0B", icon: FileText },
  DeploymentScheduled: { label: "Deployment", color: "#F97316", icon: Truck },
  Won: { label: "Won", color: "#10B981", icon: Trophy },
  Lost: { label: "Lost", color: "#EF4444", icon: XCircle },
};

const ACTIVE_STAGES = ["Qualified", "SiteWalk", "QuoteSent", "DeploymentScheduled"];

interface Opportunity {
  id: string;
  company: string;
  stage: string;
  next_action: string;
  next_action_due: string;
  owner: string;
  value_estimate: number | null;
  source: string;
  last_updated: string;
  notes: string;
}

interface Summary {
  stages: Record<string, { count: number; value: number }>;
  total_active: number;
  total_won: number;
  total_lost: number;
  total_value: number;
}

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

const DEFAULT_FEATURES = [
  "Air-conditioned cooling station",
  "Designed for industrial job sites",
  "Workforce recovery / break area",
  "Heat stress prevention support",
  "Durable trailer construction",
  "Electrical connection compatible with generator or site power",
];

const DEFAULT_TERMS = [
  "Trailers inspected prior to delivery",
  "Warranty and maintenance options available",
  "50% deposit",
  "Balance upon receipt",
];

function InvoiceModal({ opp, onClose }: { opp: Opportunity; onClose: () => void }) {
  const { toast } = useToast();
  const [contactName, setContactName] = useState("");
  const [contactTitle, setContactTitle] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [officeAddress, setOfficeAddress] = useState("");
  const [proposalTitle, setProposalTitle] = useState("Sale of Cool Down Trailers");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: "Texas Cool Down Trailer", quantity: 1, unitPrice: 28000 },
  ]);
  const [taxRate, setTaxRate] = useState(8.25);
  const [features, setFeatures] = useState<string[]>(DEFAULT_FEATURES);
  const [terms, setTerms] = useState<string[]>(DEFAULT_TERMS);
  const [newFeature, setNewFeature] = useState("");
  const [newTerm, setNewTerm] = useState("");

  const subtotal = lineItems.reduce((s, item) => s + item.quantity * item.unitPrice, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  const invoiceMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/opportunities/${opp.id}/invoice`, {
        contactName,
        contactTitle,
        contactEmail,
        officeAddress,
        proposalTitle,
        lineItems,
        taxRate,
        features,
        terms,
      }),
    onSuccess: () => {
      toast({ title: "Proposal sent", description: `Emailed to ${contactEmail} — $${total.toLocaleString()}` });
      queryClient.invalidateQueries({ predicate: (q) => {
        const key = q.queryKey[0];
        return typeof key === "string" && key.startsWith("/api/opportunities");
      }});
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Failed to create invoice", description: err.message, variant: "destructive" });
    },
  });

  const updateLineItem = (idx: number, field: keyof LineItem, value: string | number) => {
    const updated = [...lineItems];
    if (field === "quantity" || field === "unitPrice") {
      updated[idx][field] = Number(value) || 0;
    } else {
      updated[idx][field] = String(value);
    }
    setLineItems(updated);
  };

  const addLineItem = () => {
    setLineItems([...lineItems, { description: "", quantity: 1, unitPrice: 0 }]);
  };

  const removeLineItem = (idx: number) => {
    if (lineItems.length <= 1) return;
    setLineItems(lineItems.filter((_, i) => i !== idx));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 pb-8 overflow-y-auto" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-2xl w-full max-w-2xl mx-4 shadow-xl" style={{ border: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: BORDER }}>
          <div>
            <p className="text-xs font-mono tracking-wider uppercase" style={{ color: MUTED }}>Send Proposal</p>
            <h2 className="text-lg font-bold" style={{ color: TEXT }} data-testid="text-invoice-title">{opp.company}</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100" data-testid="button-close-invoice">
            <X className="w-5 h-5" style={{ color: MUTED }} />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: TEXT }}>Contact Details</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs mb-1 block" style={{ color: MUTED }}>Contact Name</label>
                <Input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Brent Jones"
                  data-testid="input-contact-name"
                />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: MUTED }}>Title</label>
                <Input
                  value={contactTitle}
                  onChange={(e) => setContactTitle(e.target.value)}
                  placeholder="Equipment Foreman"
                  data-testid="input-contact-title"
                />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: MUTED }}>Email</label>
                <Input
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="brent@company.com"
                  type="email"
                  data-testid="input-contact-email"
                />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: MUTED }}>Office Address</label>
                <Input
                  value={officeAddress}
                  onChange={(e) => setOfficeAddress(e.target.value)}
                  placeholder="14951 N Dallas Pkwy..."
                  data-testid="input-office-address"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: MUTED }}>Proposal Title</label>
            <Input
              value={proposalTitle}
              onChange={(e) => setProposalTitle(e.target.value)}
              data-testid="input-proposal-title"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: TEXT }}>Line Items</p>
              <Button size="sm" variant="ghost" onClick={addLineItem} className="h-7 text-xs" style={{ color: EMERALD }} data-testid="button-add-line-item">
                <Plus className="w-3 h-3 mr-1" /> Add Item
              </Button>
            </div>
            <div className="space-y-2">
              {lineItems.map((item, idx) => (
                <div key={idx} className="rounded-lg p-3 flex gap-2 items-start" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
                  <div className="flex-1 grid grid-cols-3 gap-2">
                    <div className="col-span-3 sm:col-span-1">
                      <label className="text-xs mb-1 block" style={{ color: MUTED }}>Description</label>
                      <Input
                        value={item.description}
                        onChange={(e) => updateLineItem(idx, "description", e.target.value)}
                        placeholder="Texas Cool Down Trailer"
                        data-testid={`input-line-desc-${idx}`}
                      />
                    </div>
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: MUTED }}>Qty</label>
                      <Input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateLineItem(idx, "quantity", e.target.value)}
                        data-testid={`input-line-qty-${idx}`}
                      />
                    </div>
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: MUTED }}>Unit Price</label>
                      <Input
                        type="number"
                        min="0"
                        value={item.unitPrice}
                        onChange={(e) => updateLineItem(idx, "unitPrice", e.target.value)}
                        data-testid={`input-line-price-${idx}`}
                      />
                    </div>
                  </div>
                  <div className="pt-5">
                    <p className="text-xs font-mono font-bold whitespace-nowrap" style={{ color: EMERALD }}>
                      ${(item.quantity * item.unitPrice).toLocaleString()}
                    </p>
                    {lineItems.length > 1 && (
                      <button onClick={() => removeLineItem(idx)} className="mt-1 p-1 rounded hover:bg-red-50" data-testid={`button-remove-line-${idx}`}>
                        <Trash2 className="w-3 h-3" style={{ color: "#EF4444" }} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl p-4" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs" style={{ color: MUTED }}>Subtotal</span>
              <span className="text-sm font-mono font-bold" style={{ color: TEXT }}>${subtotal.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs" style={{ color: MUTED }}>Tax Rate</span>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={taxRate}
                onChange={(e) => setTaxRate(Number(e.target.value) || 0)}
                className="w-20 h-7 text-xs"
                data-testid="input-tax-rate"
              />
              <span className="text-xs" style={{ color: MUTED }}>%</span>
              <span className="text-xs font-mono ml-auto" style={{ color: TEXT }}>${taxAmount.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: BORDER }}>
              <span className="text-sm font-bold" style={{ color: TEXT }}>Total</span>
              <span className="text-lg font-mono font-bold" style={{ color: EMERALD }} data-testid="text-invoice-total">${total.toLocaleString()}</span>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: TEXT }}>Features</p>
            <div className="space-y-1">
              {features.map((f, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs" style={{ color: TEXT }}>
                  <span className="flex-1">- {f}</span>
                  <button onClick={() => setFeatures(features.filter((_, i) => i !== idx))} className="p-0.5 rounded hover:bg-red-50" data-testid={`button-remove-feature-${idx}`}>
                    <X className="w-3 h-3" style={{ color: "#EF4444" }} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <Input
                value={newFeature}
                onChange={(e) => setNewFeature(e.target.value)}
                placeholder="Add feature..."
                className="text-xs h-7"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newFeature.trim()) {
                    setFeatures([...features, newFeature.trim()]);
                    setNewFeature("");
                  }
                }}
                data-testid="input-new-feature"
              />
              <Button size="sm" variant="ghost" className="h-7 text-xs" style={{ color: EMERALD }}
                onClick={() => { if (newFeature.trim()) { setFeatures([...features, newFeature.trim()]); setNewFeature(""); } }}
                data-testid="button-add-feature"
              >
                Add
              </Button>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: TEXT }}>Terms</p>
            <div className="space-y-1">
              {terms.map((t, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs" style={{ color: TEXT }}>
                  <span className="flex-1">- {t}</span>
                  <button onClick={() => setTerms(terms.filter((_, i) => i !== idx))} className="p-0.5 rounded hover:bg-red-50" data-testid={`button-remove-term-${idx}`}>
                    <X className="w-3 h-3" style={{ color: "#EF4444" }} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <Input
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                placeholder="Add term..."
                className="text-xs h-7"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTerm.trim()) {
                    setTerms([...terms, newTerm.trim()]);
                    setNewTerm("");
                  }
                }}
                data-testid="input-new-term"
              />
              <Button size="sm" variant="ghost" className="h-7 text-xs" style={{ color: EMERALD }}
                onClick={() => { if (newTerm.trim()) { setTerms([...terms, newTerm.trim()]); setNewTerm(""); } }}
                data-testid="button-add-term"
              >
                Add
              </Button>
            </div>
          </div>
        </div>

        <div className="p-5 border-t flex items-center justify-between" style={{ borderColor: BORDER }}>
          <Button variant="ghost" onClick={onClose} className="text-sm" style={{ color: MUTED }} data-testid="button-cancel-invoice">
            Cancel
          </Button>
          <Button
            onClick={() => invoiceMutation.mutate()}
            disabled={invoiceMutation.isPending || lineItems.every(i => !i.description)}
            className="rounded-lg text-sm font-semibold px-6"
            style={{ background: EMERALD, color: "#FFF" }}
            data-testid="button-submit-invoice"
          >
            {invoiceMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending...</>
            ) : (
              <><Mail className="w-4 h-4 mr-2" /> Send Proposal</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function PipelinePage() {
  const { getToken } = useAuth();
  const token = getToken();
  const [expandedOpp, setExpandedOpp] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [invoiceOpp, setInvoiceOpp] = useState<Opportunity | null>(null);

  const { data: summary, isLoading: summaryLoading } = useQuery<Summary>({
    queryKey: ["/api/opportunities/summary"],
    enabled: !!token,
  });

  const queryUrl = stageFilter ? `/api/opportunities?stage=${stageFilter}` : "/api/opportunities";
  const { data: oppsData, isLoading: oppsLoading } = useQuery<{ opportunities: Opportunity[]; count: number }>({
    queryKey: [queryUrl],
    enabled: !!token,
  });

  const advanceMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) =>
      apiRequest("POST", `/api/opportunities/${id}/update`, { stage }),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => {
        const key = q.queryKey[0];
        return typeof key === "string" && key.startsWith("/api/opportunities");
      }});
    },
  });

  const opportunities = oppsData?.opportunities || [];

  const nextStage = (current: string): string | null => {
    const idx = ACTIVE_STAGES.indexOf(current);
    if (idx === -1 || idx >= ACTIVE_STAGES.length - 1) return null;
    return ACTIVE_STAGES[idx + 1];
  };

  return (
    <AppLayout showBackToChip>
      <div className="p-4 md:p-6 space-y-6">
        <div>
          <p className="text-xs font-mono tracking-wider uppercase mb-1" style={{ color: MUTED }}>Opportunity Pipeline</p>
          <h1 className="text-xl font-bold" style={{ color: TEXT }} data-testid="text-page-title">Pipeline</h1>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="pipeline-funnel">
          {ACTIVE_STAGES.map((stage) => {
            const meta = STAGE_META[stage];
            const count = summary?.stages?.[stage]?.count ?? 0;
            const isActive = stageFilter === stage;
            return (
              <button
                key={stage}
                onClick={() => setStageFilter(isActive ? null : stage)}
                className="rounded-xl p-4 text-left transition-all"
                style={{
                  background: isActive ? `${meta.color}10` : SUBTLE,
                  border: `1px solid ${isActive ? `${meta.color}40` : BORDER}`,
                }}
                data-testid={`funnel-${stage.toLowerCase()}`}
              >
                <meta.icon className="w-4 h-4 mb-2" style={{ color: meta.color }} />
                <p className="text-2xl font-bold font-mono" style={{ color: TEXT }}>{count}</p>
                <p className="text-xs font-medium" style={{ color: MUTED }}>{meta.label}</p>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Card style={{ border: `1px solid ${BORDER}` }}>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-bold font-mono" style={{ color: EMERALD }} data-testid="total-active">
                {summary?.total_active ?? 0}
              </p>
              <p className="text-xs" style={{ color: MUTED }}>Active</p>
            </CardContent>
          </Card>
          <Card style={{ border: `1px solid ${BORDER}` }}>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-bold font-mono" style={{ color: "#10B981" }} data-testid="total-won">
                {summary?.total_won ?? 0}
              </p>
              <p className="text-xs" style={{ color: MUTED }}>Won</p>
            </CardContent>
          </Card>
          <Card style={{ border: `1px solid ${BORDER}` }}>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-bold font-mono" style={{ color: "#EF4444" }} data-testid="total-lost">
                {summary?.total_lost ?? 0}
              </p>
              <p className="text-xs" style={{ color: MUTED }}>Lost</p>
            </CardContent>
          </Card>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold" style={{ color: TEXT }}>
              {stageFilter ? STAGE_META[stageFilter]?.label || stageFilter : "All"} Opportunities
            </h2>
            {stageFilter && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStageFilter(null)}
                className="text-xs"
                style={{ color: MUTED }}
                data-testid="clear-filter"
              >
                Show all
              </Button>
            )}
          </div>

          {(summaryLoading || oppsLoading) && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: MUTED }} />
            </div>
          )}

          {!oppsLoading && opportunities.length === 0 && (
            <Card style={{ border: `1px solid ${BORDER}` }}>
              <CardContent className="py-10 text-center">
                <Target className="w-8 h-8 mx-auto mb-3" style={{ color: MUTED }} />
                <p className="text-sm font-medium" style={{ color: TEXT }}>No opportunities yet</p>
                <p className="text-xs" style={{ color: MUTED }}>Log a Qualified or Won call to create one automatically.</p>
              </CardContent>
            </Card>
          )}

          <div className="space-y-2" data-testid="opportunity-list">
            {opportunities.map((opp, idx) => {
              const meta = STAGE_META[opp.stage] || { label: opp.stage, color: MUTED, icon: Target };
              const isExpanded = expandedOpp === opp.id;
              const next = nextStage(opp.stage);
              const isOverdue = opp.next_action_due && new Date(opp.next_action_due) < new Date();

              return (
                <Card
                  key={opp.id}
                  className="overflow-hidden"
                  style={{ border: `1px solid ${BORDER}` }}
                  data-testid={`opportunity-row-${idx}`}
                >
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <div
                        className="w-2 h-2 rounded-full mt-2 flex-shrink-0"
                        style={{ background: meta.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="text-sm font-semibold" style={{ color: TEXT }} data-testid={`opp-company-${idx}`}>
                            {opp.company}
                          </p>
                          <Badge
                            className="text-xs"
                            style={{ background: `${meta.color}15`, color: meta.color, border: `1px solid ${meta.color}30` }}
                            data-testid={`opp-stage-${idx}`}
                          >
                            {meta.label}
                          </Badge>
                          {opp.value_estimate && (
                            <span className="text-xs font-mono" style={{ color: EMERALD }}>
                              ${opp.value_estimate.toLocaleString()}
                            </span>
                          )}
                        </div>

                        {opp.next_action && (
                          <p className="text-xs mb-1" style={{ color: isOverdue ? "#EF4444" : MUTED }} data-testid={`opp-action-${idx}`}>
                            {isOverdue ? "OVERDUE: " : ""}{opp.next_action}
                            {opp.next_action_due && (
                              <span className="ml-1 font-mono">
                                (due {new Date(opp.next_action_due).toLocaleDateString()})
                              </span>
                            )}
                          </p>
                        )}

                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {next && (
                            <Button
                              size="sm"
                              onClick={() => advanceMutation.mutate({ id: opp.id, stage: next })}
                              disabled={advanceMutation.isPending}
                              className="rounded-lg text-xs font-semibold h-7 px-3"
                              style={{ background: STAGE_META[next].color, color: "#FFF" }}
                              data-testid={`advance-${idx}`}
                            >
                              <ArrowRight className="w-3 h-3 mr-1" />
                              {STAGE_META[next].label}
                            </Button>
                          )}
                          {opp.stage !== "Won" && opp.stage !== "Lost" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => advanceMutation.mutate({ id: opp.id, stage: "Won" })}
                              disabled={advanceMutation.isPending}
                              className="rounded-lg text-xs font-semibold h-7 px-3"
                              style={{ color: EMERALD }}
                              data-testid={`mark-won-${idx}`}
                            >
                              <Trophy className="w-3 h-3 mr-1" /> Won
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setInvoiceOpp(opp)}
                            className="rounded-lg text-xs font-semibold h-7 px-3"
                            style={{ color: "#F59E0B" }}
                            data-testid={`create-invoice-${idx}`}
                          >
                            <Receipt className="w-3 h-3 mr-1" /> Invoice
                          </Button>
                          <button
                            onClick={() => setExpandedOpp(isExpanded ? null : opp.id)}
                            className="ml-auto p-1 rounded"
                            style={{ color: MUTED }}
                            data-testid={`expand-opp-${idx}`}
                          >
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0 border-t" style={{ borderColor: BORDER }}>
                      <div className="grid grid-cols-2 gap-3 mt-3">
                        <div className="rounded-lg p-3" style={{ background: SUBTLE }}>
                          <p className="text-xs font-mono tracking-widest uppercase mb-1" style={{ color: MUTED }}>Owner</p>
                          <p className="text-xs" style={{ color: TEXT }}>{opp.owner || "Unassigned"}</p>
                        </div>
                        <div className="rounded-lg p-3" style={{ background: SUBTLE }}>
                          <p className="text-xs font-mono tracking-widest uppercase mb-1" style={{ color: MUTED }}>Source</p>
                          <p className="text-xs" style={{ color: TEXT }}>{opp.source || "—"}</p>
                        </div>
                      </div>
                      {opp.notes && (
                        <div className="rounded-lg p-3 mt-3" style={{ background: SUBTLE }}>
                          <p className="text-xs font-mono tracking-widest uppercase mb-1" style={{ color: MUTED }}>Notes</p>
                          <p className="text-xs leading-relaxed whitespace-pre-line" style={{ color: TEXT }}>{opp.notes}</p>
                        </div>
                      )}
                      {opp.last_updated && (
                        <p className="text-xs font-mono mt-3" style={{ color: MUTED }}>
                          Last updated: {new Date(opp.last_updated).toLocaleString()}
                        </p>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      </div>

      {invoiceOpp && <InvoiceModal opp={invoiceOpp} onClose={() => setInvoiceOpp(null)} />}
    </AppLayout>
  );
}
