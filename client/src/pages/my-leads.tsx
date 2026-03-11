import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import AppLayout from "@/components/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Phone, Copy, ChevronDown, ChevronUp, User, Loader2, CheckCircle2,
  Plus, X, Target, Clock, Mail, MapPin, Trash2, Receipt, ExternalLink,
  Zap, FileText, AlertCircle, Globe, PhoneCall, Send, Radio,
  Volume2, Shield, MessageSquare,
} from "lucide-react";

const EMERALD = "#10B981";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";
const ERROR_RED = "#EF4444";
const AMBER = "#F59E0B";
const BLUE = "#3B82F6";

const OUTCOMES = [
  { value: "Decision Maker", label: "DM", color: EMERALD },
  { value: "Gatekeeper", label: "GK", color: BLUE },
  { value: "No Answer", label: "N/A", color: MUTED },
  { value: "Qualified", label: "Qual", color: "#059669" },
  { value: "Callback", label: "CB", color: AMBER },
  { value: "Not Interested", label: "NI", color: ERROR_RED },
  { value: "NoAuthority", label: "Wrong Person", color: AMBER },
] as const;

const OUTCOME_FEEDBACK: Record<string, { title: string; description: string }> = {
  "Decision Maker": { title: "Signal captured", description: "DM reached." },
  "Gatekeeper": { title: "Intel gathered", description: "Gatekeeper mapped." },
  "No Answer": { title: "Noted", description: "Follow-up queued." },
  "Qualified": { title: "Opportunity created", description: "Moved to pipeline." },
  "Callback": { title: "Callback locked", description: "Follow-up scheduled." },
  "Not Interested": { title: "Signal absorbed", description: "Targeting recalibrated." },
  "NoAuthority": { title: "Wrong person flagged", description: "Machine will find the right DM." },
};

interface ManualLead {
  id: string;
  company_name: string;
  phone: string;
  website: string;
  city: string;
  state: string;
  lead_status: string;
  bucket: string;
  final_priority: number;
  times_called: number;
  last_outcome: string;
  followup_due: string;
  offer_dm_name: string;
  offer_dm_title: string;
  offer_dm_email: string;
  offer_dm_phone: string;
  rank_reason: string;
  rank_evidence: string;
  playbook_opener: string;
  playbook_gatekeeper: string;
  playbook_voicemail: string;
  playbook_followup: string;
  gatekeeper_name: string;
  dm_coverage_status: string;
  industry: string;
  touch_count: number;
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

function PlaybookSection({ lead, idx }: { lead: ManualLead; idx: number }) {
  const scripts = [
    { key: "opener", label: "Call Opener", content: lead.playbook_opener, icon: Phone },
    { key: "gatekeeper", label: "Gatekeeper Script", content: lead.playbook_gatekeeper, icon: User },
    { key: "voicemail", label: "Voicemail", content: lead.playbook_voicemail, icon: Mail },
    { key: "followup", label: "Follow-up", content: lead.playbook_followup, icon: Clock },
  ].filter(s => s.content);

  if (scripts.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5" data-testid={`playbooks-${idx}`}>
      {scripts.map(s => (
        <div key={s.key} className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
          <div className="flex items-center gap-1.5 mb-2">
            <s.icon className="w-3 h-3" style={{ color: EMERALD }} />
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: EMERALD }}>{s.label}</span>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: TEXT }} data-testid={`playbook-${s.key}-${idx}`}>
            {s.content}
          </p>
        </div>
      ))}
    </div>
  );
}

function ProposalModal({ lead, onClose }: { lead: ManualLead; onClose: () => void }) {
  const { toast } = useToast();
  const [contactName, setContactName] = useState(lead.offer_dm_name || "");
  const [contactTitle, setContactTitle] = useState(lead.offer_dm_title || "");
  const [contactEmail, setContactEmail] = useState(lead.offer_dm_email || "");
  const [officeAddress, setOfficeAddress] = useState(lead.city ? `${lead.city}${lead.state ? `, ${lead.state}` : ""}` : "");
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

  const proposalMutation = useMutation({
    mutationFn: async () => {
      const oppResp = await apiRequest("GET", "/api/opportunities");
      const oppData = await oppResp.json();
      const opps = oppData?.opportunities || [];
      const opp = opps.find((o: any) => o.company === lead.company_name);

      if (opp) {
        return apiRequest("POST", `/api/opportunities/${opp.id}/invoice`, {
          contactName, contactTitle, contactEmail, officeAddress,
          proposalTitle, lineItems, taxRate, features, terms,
        });
      } else {
        return apiRequest("POST", "/api/proposals/create", {
          companyName: lead.company_name,
          contactName, contactTitle, contactEmail, officeAddress,
          proposalTitle, lineItems, taxRate, features, terms,
        });
      }
    },
    onSuccess: () => {
      toast({ title: "Proposal sent", description: `Emailed to ${contactEmail || "recipient"} — $${total.toLocaleString()}` });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Failed to create proposal", description: err.message, variant: "destructive" });
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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 pb-8 overflow-y-auto" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-2xl w-full max-w-2xl mx-4 shadow-xl" style={{ border: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: BORDER }}>
          <div>
            <p className="text-xs font-mono tracking-wider uppercase" style={{ color: MUTED }}>Sales Proposal</p>
            <h2 className="text-lg font-bold" style={{ color: TEXT }} data-testid="text-proposal-title">{lead.company_name}</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100" data-testid="button-close-proposal">
            <X className="w-5 h-5" style={{ color: MUTED }} />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: TEXT }}>Recipient</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs mb-1 block" style={{ color: MUTED }}>Contact Name</label>
                <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Brent Jones" data-testid="input-proposal-contact-name" />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: MUTED }}>Title</label>
                <Input value={contactTitle} onChange={(e) => setContactTitle(e.target.value)} placeholder="Equipment Foreman" data-testid="input-proposal-contact-title" />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: MUTED }}>Email</label>
                <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="brent@company.com" type="email" data-testid="input-proposal-contact-email" />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: MUTED }}>Office Address</label>
                <Input value={officeAddress} onChange={(e) => setOfficeAddress(e.target.value)} placeholder="14951 N Dallas Pkwy..." data-testid="input-proposal-address" />
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: MUTED }}>Proposal Title</label>
            <Input value={proposalTitle} onChange={(e) => setProposalTitle(e.target.value)} data-testid="input-proposal-title" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: TEXT }}>Line Items</p>
              <Button size="sm" variant="ghost" onClick={() => setLineItems([...lineItems, { description: "", quantity: 1, unitPrice: 0 }])} className="h-7 text-xs" style={{ color: EMERALD }} data-testid="button-add-proposal-line">
                <Plus className="w-3 h-3 mr-1" /> Add Item
              </Button>
            </div>
            <div className="space-y-2">
              {lineItems.map((item, idx) => (
                <div key={idx} className="rounded-lg p-3 flex gap-2 items-start" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
                  <div className="flex-1 grid grid-cols-3 gap-2">
                    <div className="col-span-3 sm:col-span-1">
                      <label className="text-xs mb-1 block" style={{ color: MUTED }}>Description</label>
                      <Input value={item.description} onChange={(e) => updateLineItem(idx, "description", e.target.value)} placeholder="Texas Cool Down Trailer" data-testid={`input-proposal-desc-${idx}`} />
                    </div>
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: MUTED }}>Qty</label>
                      <Input type="number" min="1" value={item.quantity} onChange={(e) => updateLineItem(idx, "quantity", e.target.value)} data-testid={`input-proposal-qty-${idx}`} />
                    </div>
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: MUTED }}>Unit Price</label>
                      <Input type="number" min="0" value={item.unitPrice} onChange={(e) => updateLineItem(idx, "unitPrice", e.target.value)} data-testid={`input-proposal-price-${idx}`} />
                    </div>
                  </div>
                  <div className="pt-5">
                    <p className="text-xs font-mono font-bold whitespace-nowrap" style={{ color: EMERALD }}>
                      ${(item.quantity * item.unitPrice).toLocaleString()}
                    </p>
                    {lineItems.length > 1 && (
                      <button onClick={() => setLineItems(lineItems.filter((_, i) => i !== idx))} className="mt-1 p-1 rounded hover:bg-red-50" data-testid={`button-remove-proposal-line-${idx}`}>
                        <Trash2 className="w-3 h-3" style={{ color: ERROR_RED }} />
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
              <Input type="number" min="0" max="100" step="0.01" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value) || 0)} className="w-20 h-7 text-xs" data-testid="input-proposal-tax" />
              <span className="text-xs" style={{ color: MUTED }}>%</span>
              <span className="text-xs font-mono ml-auto" style={{ color: TEXT }}>${taxAmount.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: BORDER }}>
              <span className="text-sm font-bold" style={{ color: TEXT }}>Total</span>
              <span className="text-lg font-mono font-bold" style={{ color: EMERALD }} data-testid="text-proposal-total">${total.toLocaleString()}</span>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: TEXT }}>Features</p>
            <div className="space-y-1">
              {features.map((f, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs" style={{ color: TEXT }}>
                  <span className="flex-1">- {f}</span>
                  <button onClick={() => setFeatures(features.filter((_, i) => i !== idx))} className="p-0.5 rounded hover:bg-red-50">
                    <X className="w-3 h-3" style={{ color: ERROR_RED }} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <Input value={newFeature} onChange={(e) => setNewFeature(e.target.value)} placeholder="Add feature..." className="text-xs h-7"
                onKeyDown={(e) => { if (e.key === "Enter" && newFeature.trim()) { setFeatures([...features, newFeature.trim()]); setNewFeature(""); } }}
                data-testid="input-proposal-new-feature" />
              <Button size="sm" variant="ghost" className="h-7 text-xs" style={{ color: EMERALD }}
                onClick={() => { if (newFeature.trim()) { setFeatures([...features, newFeature.trim()]); setNewFeature(""); } }}>Add</Button>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: TEXT }}>Terms</p>
            <div className="space-y-1">
              {terms.map((t, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs" style={{ color: TEXT }}>
                  <span className="flex-1">- {t}</span>
                  <button onClick={() => setTerms(terms.filter((_, i) => i !== idx))} className="p-0.5 rounded hover:bg-red-50">
                    <X className="w-3 h-3" style={{ color: ERROR_RED }} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <Input value={newTerm} onChange={(e) => setNewTerm(e.target.value)} placeholder="Add term..." className="text-xs h-7"
                onKeyDown={(e) => { if (e.key === "Enter" && newTerm.trim()) { setTerms([...terms, newTerm.trim()]); setNewTerm(""); } }}
                data-testid="input-proposal-new-term" />
              <Button size="sm" variant="ghost" className="h-7 text-xs" style={{ color: EMERALD }}
                onClick={() => { if (newTerm.trim()) { setTerms([...terms, newTerm.trim()]); setNewTerm(""); } }}>Add</Button>
            </div>
          </div>
        </div>

        <div className="p-5 border-t flex items-center justify-between" style={{ borderColor: BORDER }}>
          <Button variant="ghost" onClick={onClose} className="text-sm" style={{ color: MUTED }} data-testid="button-cancel-proposal">Cancel</Button>
          <Button
            onClick={() => proposalMutation.mutate()}
            disabled={proposalMutation.isPending || lineItems.every(i => !i.description)}
            className="rounded-lg text-sm font-semibold px-6"
            style={{ background: EMERALD, color: "#FFF" }}
            data-testid="button-submit-proposal"
          >
            {proposalMutation.isPending ? (
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

function LeadCard({
  lead, idx, isExpanded, hasLogged, loggedOutcome, copiedId,
  isPending, onToggleExpand, onCopyPhone, onOutcome, onEnrich, onProposal,
  enrichingId, onTwilioCall, twilioCallPending, twilioCallActive,
}: {
  lead: ManualLead;
  idx: number;
  isExpanded: boolean;
  hasLogged: boolean;
  loggedOutcome: string | undefined;
  copiedId: string | null;
  isPending: boolean;
  onToggleExpand: (id: string) => void;
  onCopyPhone: (phone: string, id: string) => void;
  onOutcome: (name: string, outcome: string) => void;
  onEnrich: (id: string) => void;
  onProposal: (lead: ManualLead) => void;
  enrichingId: string | null;
  onTwilioCall?: (phone: string, companyName: string, contactName: string) => void;
  twilioCallPending?: boolean;
  twilioCallActive?: boolean;
}) {
  const callPhone = lead.offer_dm_phone || lead.phone;
  const isMobile = /^\+?\d[\d\s()-]{7,}$/.test(callPhone);
  const hasPlaybooks = lead.playbook_opener || lead.playbook_gatekeeper || lead.playbook_voicemail || lead.playbook_followup;

  return (
    <div
      className="rounded-xl overflow-hidden transition-all"
      style={{
        background: "#FFF",
        border: `1px solid ${hasLogged ? "rgba(16,185,129,0.25)" : BORDER}`,
        boxShadow: hasLogged ? "0 0 0 1px rgba(16,185,129,0.08)" : "0 1px 3px rgba(0,0,0,0.04)",
      }}
      data-testid={`lead-row-${idx}`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
            <div className="w-2 h-2 rounded-full" style={{ background: lead.last_outcome ? EMERALD : BLUE }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-sm font-bold truncate" style={{ color: TEXT }} data-testid={`lead-name-${idx}`}>
                {lead.company_name}
              </span>
              <Badge className="text-[10px]" style={{ background: "rgba(59,130,246,0.08)", color: BLUE, border: `1px solid rgba(59,130,246,0.2)` }}>
                Manual
              </Badge>
              {lead.lead_status && lead.lead_status !== "New" && (
                <Badge className="text-[10px]" style={{ background: `${EMERALD}10`, color: EMERALD, border: `1px solid ${EMERALD}25` }}>
                  {lead.lead_status}
                </Badge>
              )}
              {hasLogged && (
                <span className="flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: EMERALD }}>
                  <CheckCircle2 className="w-3 h-3" /> {loggedOutcome}
                </span>
              )}
            </div>

            {lead.offer_dm_name && (
              <div className="flex items-center gap-1.5 mb-1">
                <User className="w-3 h-3" style={{ color: MUTED }} />
                <span className="text-xs font-medium" style={{ color: TEXT }} data-testid={`lead-dm-${idx}`}>
                  Ask for: {lead.offer_dm_name}
                </span>
                {lead.offer_dm_title && (
                  <span className="text-[11px]" style={{ color: MUTED }}>({lead.offer_dm_title})</span>
                )}
              </div>
            )}

            {(lead.city || lead.website) && (
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                {lead.city && (
                  <span className="flex items-center gap-1 text-[11px]" style={{ color: MUTED }}>
                    <MapPin className="w-3 h-3" /> {lead.city}{lead.state ? `, ${lead.state}` : ""}
                  </span>
                )}
                {lead.website && (
                  <a href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[11px] hover:underline" style={{ color: BLUE }}>
                    <Globe className="w-3 h-3" /> Website
                  </a>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              {callPhone ? (
                <>
                  <button onClick={() => onCopyPhone(callPhone, lead.id)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                    style={{ background: "rgba(16,185,129,0.08)", color: EMERALD, border: "1px solid rgba(16,185,129,0.15)" }}
                    data-testid={`lead-call-${idx}`}>
                    {copiedId === lead.id ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedId === lead.id ? "Copied" : callPhone}
                  </button>
                  {onTwilioCall && (
                    <button
                      onClick={() => onTwilioCall(callPhone, lead.company_name, lead.offer_dm_name || "")}
                      disabled={twilioCallPending || twilioCallActive}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                      style={{ background: twilioCallActive ? `${ERROR_RED}15` : EMERALD, color: twilioCallActive ? ERROR_RED : "#FFF", border: twilioCallActive ? `1px solid ${ERROR_RED}30` : "none" }}
                      data-testid={`lead-twilio-call-${idx}`}
                    >
                      {twilioCallPending ? <Loader2 className="w-3 h-3 animate-spin" /> : twilioCallActive ? <Radio className="w-3 h-3 animate-pulse" /> : <PhoneCall className="w-3 h-3" />}
                      {twilioCallActive ? "Live Coach" : "Twilio Call"}
                    </button>
                  )}
                </>
              ) : (
                <span className="text-xs" style={{ color: MUTED }}>No phone</span>
              )}

              {!hasLogged && (
                <div className="flex items-center gap-1 flex-wrap" data-testid={`lead-outcomes-${idx}`}>
                  {OUTCOMES.map((o) => (
                    <button key={o.value} onClick={() => onOutcome(lead.company_name, o.value)} disabled={isPending}
                      className="px-2 py-1 rounded-md text-[11px] font-semibold transition-all hover:opacity-80"
                      style={{ background: `${o.color}12`, color: o.color, border: `1px solid ${o.color}20` }}
                      data-testid={`lead-outcome-${o.value.toLowerCase().replace(/\s+/g, "-")}-${idx}`}>
                      {o.label}
                    </button>
                  ))}
                </div>
              )}

              <button onClick={() => onToggleExpand(lead.id)} className="ml-auto p-1.5 rounded-lg transition-colors hover:bg-gray-50" style={{ color: MUTED }} data-testid={`lead-expand-${idx}`}>
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="px-4 pb-4 pt-0" style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="mt-3">
            <PlaybookSection lead={lead} idx={idx} />
          </div>

          {!hasPlaybooks && (
            <div className="rounded-lg p-3 mt-3 text-center" style={{ background: "rgba(245,158,11,0.04)", border: `1px solid rgba(245,158,11,0.15)` }}>
              <AlertCircle className="w-4 h-4 mx-auto mb-1" style={{ color: AMBER }} />
              <p className="text-xs" style={{ color: AMBER }}>No playbooks yet. Enrich this lead to generate call scripts.</p>
            </div>
          )}

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Button size="sm" variant="ghost" onClick={() => onEnrich(lead.id)} disabled={enrichingId === lead.id}
              className="rounded-lg text-xs font-semibold h-7 px-3" style={{ color: BLUE }}
              data-testid={`lead-enrich-${idx}`}>
              {enrichingId === lead.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Zap className="w-3 h-3 mr-1" />}
              Enrich
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onProposal(lead)}
              className="rounded-lg text-xs font-semibold h-7 px-3" style={{ color: AMBER }}
              data-testid={`lead-proposal-${idx}`}>
              <FileText className="w-3 h-3 mr-1" /> Create Proposal
            </Button>
          </div>

          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {lead.times_called > 0 && <span className="text-[11px]" style={{ color: MUTED }}>Called {lead.times_called}x</span>}
            {lead.last_outcome && <span className="text-[11px]" style={{ color: MUTED }}>Last: {lead.last_outcome}</span>}
            {lead.followup_due && (
              <span className="text-[11px] font-medium" style={{ color: AMBER }}>
                Follow-up: {new Date(lead.followup_due).toLocaleDateString()}
              </span>
            )}
            {lead.dm_coverage_status && <span className="text-[11px]" style={{ color: MUTED }}>DM: {lead.dm_coverage_status}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MyLeadsPage() {
  const { getToken } = useAuth();
  const token = getToken();
  const { toast } = useToast();
  const [expandedLead, setExpandedLead] = useState<string | null>(null);
  const [loggedCalls, setLoggedCalls] = useState<Map<string, string>>(new Map());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [proposalLead, setProposalLead] = useState<ManualLead | null>(null);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCompany, setNewCompany] = useState("");
  const [newWebsite, setNewWebsite] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newState, setNewState] = useState("");

  const [twilioCallActive, setTwilioCallActive] = useState(false);
  const [activeCallSid, setActiveCallSid] = useState<string | null>(null);
  const [coachingTranscript, setCoachingTranscript] = useState<{ text: string; speaker?: string; timestamp: number }[]>([]);
  const [coachingAlerts, setCoachingAlerts] = useState<{ type: string; severity: string; message: string; suggestion: string; timestamp: number }[]>([]);
  const [coachingConnected, setCoachingConnected] = useState(false);
  const [showCoachingPanel, setShowCoachingPanel] = useState(false);
  const [activeCallCompany, setActiveCallCompany] = useState("");
  const coachingRef = useRef<EventSource | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const [showQuickDial, setShowQuickDial] = useState(false);
  const [quickDialNumber, setQuickDialNumber] = useState("");
  const [quickDialName, setQuickDialName] = useState("");

  const { data: twilioStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/twilio/status"],
    enabled: !!token,
    staleTime: 60000,
  });

  const startCoachingSSE = useCallback((callSid: string) => {
    if (coachingRef.current) coachingRef.current.close();
    setCoachingTranscript([]);
    setCoachingAlerts([]);
    setCoachingConnected(false);
    setShowCoachingPanel(true);
    const es = new EventSource(`/api/twilio/coaching/${callSid}?token=${token}`);
    es.addEventListener("session_info", () => setCoachingConnected(true));
    es.addEventListener("transcript", (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        setCoachingTranscript(prev => [...prev, { text: d.text, speaker: d.speaker, timestamp: d.timestamp }]);
      } catch {}
    });
    es.addEventListener("coaching_alert", (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        setCoachingAlerts(prev => [...prev, { type: d.type, severity: d.severity, message: d.message, suggestion: d.suggestion, timestamp: d.timestamp }]);
      } catch {}
    });
    es.addEventListener("call_ended", () => {
      setTwilioCallActive(false);
      setActiveCallSid(null);
      setCoachingConnected(false);
      es.close();
      coachingRef.current = null;
    });
    let retryCount = 0;
    es.onerror = () => {
      setCoachingConnected(false);
      retryCount++;
      if (retryCount > 5) {
        setTwilioCallActive(false);
        setActiveCallSid(null);
        es.close();
        coachingRef.current = null;
        toast({ title: "Coaching connection lost", description: "Call may still be active but real-time coaching has disconnected.", variant: "destructive" });
      }
    };
    coachingRef.current = es;
  }, [token, toast]);

  useEffect(() => {
    return () => { if (coachingRef.current) { coachingRef.current.close(); coachingRef.current = null; } };
  }, []);

  useEffect(() => {
    if (transcriptEndRef.current) transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [coachingTranscript]);

  const twilioCallMutation = useMutation({
    mutationFn: async ({ to, companyName, contactName }: { to: string; companyName?: string; contactName?: string }) => {
      const res = await apiRequest("POST", "/api/twilio/call", { to, companyName, contactName });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.sid) {
        setTwilioCallActive(true);
        setActiveCallSid(data.sid);
        setTimeout(() => startCoachingSSE(data.sid), 1000);
        toast({ title: "Call initiated with Live Coach", description: "Real-time coaching active." });
      } else {
        toast({ title: "Call started", description: "Call initiated but coaching session unavailable." });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Call failed", description: err.message, variant: "destructive" });
    },
  });

  const handleTwilioCall = useCallback((phone: string, companyName: string, contactName: string) => {
    setActiveCallCompany(companyName);
    twilioCallMutation.mutate({ to: phone, companyName, contactName });
  }, [twilioCallMutation]);

  const handleQuickDial = useCallback(() => {
    if (!quickDialNumber.trim()) return;
    setActiveCallCompany(quickDialName || "Quick Dial");
    twilioCallMutation.mutate({ to: quickDialNumber, companyName: quickDialName || "Quick Dial", contactName: "" });
    setShowQuickDial(false);
    setQuickDialNumber("");
    setQuickDialName("");
  }, [quickDialNumber, quickDialName, twilioCallMutation]);

  const { data, isLoading, isError, refetch } = useQuery<{ ok: boolean; companies: ManualLead[]; count: number }>({
    queryKey: ["/api/companies/manual"],
    enabled: !!token,
  });

  const leads = data?.companies || [];

  const logMutation = useMutation({
    mutationFn: ({ company_name, outcome }: { company_name: string; outcome: string }) =>
      apiRequest("POST", "/api/calls/log", { company_name, outcome }),
    onSuccess: (_, vars) => {
      setLoggedCalls(prev => new Map(prev).set(vars.company_name, vars.outcome));
      const fb = OUTCOME_FEEDBACK[vars.outcome];
      if (fb) toast({ title: fb.title, description: fb.description });
      queryClient.invalidateQueries({ queryKey: ["/api/companies/manual"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to log call", description: err.message, variant: "destructive" });
    },
  });

  const addMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/companies/add", {
      companyName: newCompany, website: newWebsite, phone: newPhone, city: newCity, state: newState,
    }),
    onSuccess: () => {
      toast({ title: "Lead added", description: `${newCompany} added to your leads` });
      setNewCompany(""); setNewWebsite(""); setNewPhone(""); setNewCity(""); setNewState("");
      setShowAddForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/companies/manual"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to add lead", description: err.message, variant: "destructive" });
    },
  });

  const handleCopyPhone = useCallback((phone: string, id: string) => {
    navigator.clipboard.writeText(phone).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleEnrich = useCallback(async (id: string) => {
    setEnrichingId(id);
    try {
      await apiRequest("POST", `/api/companies/${id}/enrich`);
      toast({ title: "Enrichment complete", description: "DM and intel data updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/companies/manual"] });
    } catch (err: any) {
      toast({ title: "Enrichment failed", description: err.message, variant: "destructive" });
    } finally {
      setEnrichingId(null);
    }
  }, [toast]);

  return (
    <AppLayout showBackToChip>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-mono tracking-wider uppercase mb-1" style={{ color: MUTED }}>Your Direct Leads</p>
            <h1 className="text-xl font-bold" style={{ color: TEXT }} data-testid="text-page-title">My Leads</h1>
          </div>
          <div className="flex items-center gap-2">
            {twilioStatus?.connected && (
              <Button onClick={() => setShowQuickDial(!showQuickDial)}
                className="rounded-lg text-sm font-semibold px-4"
                style={{ background: twilioCallActive ? `${ERROR_RED}15` : "rgba(59,130,246,0.1)", color: twilioCallActive ? ERROR_RED : BLUE, border: `1px solid ${twilioCallActive ? ERROR_RED : BLUE}25` }}
                data-testid="button-quick-dial">
                {twilioCallActive ? <Radio className="w-4 h-4 mr-1 animate-pulse" /> : <PhoneCall className="w-4 h-4 mr-1" />}
                {twilioCallActive ? "Live Call Active" : "Quick Dial"}
              </Button>
            )}
            <Button onClick={() => setShowAddForm(!showAddForm)}
              className="rounded-lg text-sm font-semibold px-4"
              style={{ background: EMERALD, color: "#FFF" }}
              data-testid="button-add-lead">
              <Plus className="w-4 h-4 mr-1" /> Add Lead
            </Button>
          </div>
        </div>

        <AnimatePresence>
          {showQuickDial && !twilioCallActive && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <Card style={{ border: `1px solid ${BLUE}25`, background: `${BLUE}04` }}>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: BLUE }}>
                    <PhoneCall className="w-3 h-3 inline mr-1" /> Quick Dial — Call any number
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: MUTED }}>Phone Number *</label>
                      <Input
                        value={quickDialNumber}
                        onChange={(e) => setQuickDialNumber(e.target.value)}
                        placeholder="(409) 555-0123"
                        onKeyDown={(e) => e.key === "Enter" && handleQuickDial()}
                        data-testid="input-quick-dial-number"
                      />
                    </div>
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: MUTED }}>Company/Name (optional)</label>
                      <Input
                        value={quickDialName}
                        onChange={(e) => setQuickDialName(e.target.value)}
                        placeholder="e.g., Blue Hat Rentals"
                        onKeyDown={(e) => e.key === "Enter" && handleQuickDial()}
                        data-testid="input-quick-dial-name"
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <Button
                        onClick={handleQuickDial}
                        disabled={!quickDialNumber.trim() || twilioCallMutation.isPending}
                        className="rounded-lg text-sm font-semibold px-6 h-9"
                        style={{ background: EMERALD, color: "#FFF" }}
                        data-testid="button-quick-dial-call"
                      >
                        {twilioCallMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <PhoneCall className="w-4 h-4 mr-1" />}
                        Call with Live Coach
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setShowQuickDial(false)} className="text-xs h-9" style={{ color: MUTED }}>Cancel</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {showAddForm && (
          <Card style={{ border: `1px solid ${BORDER}` }}>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: TEXT }}>New Lead</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="col-span-2 md:col-span-1">
                  <label className="text-xs mb-1 block" style={{ color: MUTED }}>Company Name *</label>
                  <Input value={newCompany} onChange={(e) => setNewCompany(e.target.value)} placeholder="Blue Hat Rentals" data-testid="input-new-company" />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: MUTED }}>Website</label>
                  <Input value={newWebsite} onChange={(e) => setNewWebsite(e.target.value)} placeholder="bluehat.com" data-testid="input-new-website" />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: MUTED }}>Phone</label>
                  <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="(409) 555-0123" data-testid="input-new-phone" />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: MUTED }}>City</label>
                  <Input value={newCity} onChange={(e) => setNewCity(e.target.value)} placeholder="Dallas" data-testid="input-new-city" />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: MUTED }}>State</label>
                  <Input value={newState} onChange={(e) => setNewState(e.target.value)} placeholder="TX" data-testid="input-new-state" />
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !newCompany.trim()}
                  className="rounded-lg text-xs font-semibold px-4" style={{ background: EMERALD, color: "#FFF" }}
                  data-testid="button-submit-lead">
                  {addMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Plus className="w-3 h-3 mr-1" />}
                  Add
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowAddForm(false)} className="text-xs" style={{ color: MUTED }}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Card style={{ border: `1px solid ${BORDER}` }}>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-bold font-mono" style={{ color: EMERALD }} data-testid="stat-total">{leads.length}</p>
              <p className="text-xs" style={{ color: MUTED }}>Total Leads</p>
            </CardContent>
          </Card>
          <Card style={{ border: `1px solid ${BORDER}` }}>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-bold font-mono" style={{ color: BLUE }} data-testid="stat-with-dm">
                {leads.filter(l => l.offer_dm_name).length}
              </p>
              <p className="text-xs" style={{ color: MUTED }}>With DM</p>
            </CardContent>
          </Card>
          <Card style={{ border: `1px solid ${BORDER}` }}>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-bold font-mono" style={{ color: AMBER }} data-testid="stat-called">
                {leads.filter(l => l.times_called > 0).length}
              </p>
              <p className="text-xs" style={{ color: MUTED }}>Called</p>
            </CardContent>
          </Card>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: MUTED }} />
          </div>
        )}

        {isError && (
          <Card style={{ border: `1px solid ${ERROR_RED}20` }}>
            <CardContent className="py-8 text-center">
              <AlertCircle className="w-8 h-8 mx-auto mb-3" style={{ color: ERROR_RED }} />
              <p className="text-sm font-medium" style={{ color: TEXT }}>Failed to load leads</p>
              <p className="text-xs mb-3" style={{ color: MUTED }}>Something went wrong fetching your manual leads.</p>
              <Button size="sm" variant="ghost" onClick={() => refetch()} className="text-xs" style={{ color: EMERALD }} data-testid="button-retry-leads">Retry</Button>
            </CardContent>
          </Card>
        )}

        {!isLoading && !isError && leads.length === 0 && (
          <Card style={{ border: `1px solid ${BORDER}` }}>
            <CardContent className="py-10 text-center">
              <Target className="w-8 h-8 mx-auto mb-3" style={{ color: MUTED }} />
              <p className="text-sm font-medium" style={{ color: TEXT }}>No manual leads yet</p>
              <p className="text-xs" style={{ color: MUTED }}>Click "Add Lead" to add your first lead.</p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-2" data-testid="leads-list">
          {leads.map((lead, idx) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              idx={idx}
              isExpanded={expandedLead === lead.id}
              hasLogged={loggedCalls.has(lead.company_name)}
              loggedOutcome={loggedCalls.get(lead.company_name)}
              copiedId={copiedId}
              isPending={logMutation.isPending}
              onToggleExpand={(id) => setExpandedLead(expandedLead === id ? null : id)}
              onCopyPhone={handleCopyPhone}
              onOutcome={(name, outcome) => logMutation.mutate({ company_name: name, outcome })}
              onEnrich={handleEnrich}
              onProposal={setProposalLead}
              enrichingId={enrichingId}
              onTwilioCall={twilioStatus?.connected ? handleTwilioCall : undefined}
              twilioCallPending={twilioCallMutation.isPending}
              twilioCallActive={twilioCallActive}
            />
          ))}
        </div>
      </div>

      {proposalLead && <ProposalModal lead={proposalLead} onClose={() => setProposalLead(null)} />}

      <AnimatePresence>
        {showCoachingPanel && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 h-full w-[380px] z-50 flex flex-col"
            style={{ background: "#0F172A", borderLeft: "1px solid rgba(16,185,129,0.2)" }}
            data-testid="coaching-panel"
          >
            <div className="flex items-center justify-between p-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: coachingConnected ? EMERALD : AMBER }} />
                <span className="text-sm font-bold text-white">Live Coach</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)", color: MUTED }}>
                  {activeCallCompany}
                </span>
              </div>
              <button
                onClick={() => setShowCoachingPanel(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                data-testid="button-close-coaching"
              >
                <X className="w-4 h-4 text-white/60" />
              </button>
            </div>

            {coachingAlerts.length > 0 && (
              <div className="px-4 py-3 space-y-2 max-h-[200px] overflow-y-auto" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {coachingAlerts.slice(-5).map((alert, i) => (
                  <div key={i} className="rounded-lg p-2.5" style={{
                    background: alert.severity === "high" ? "rgba(239,68,68,0.12)" : alert.severity === "medium" ? "rgba(245,158,11,0.12)" : "rgba(59,130,246,0.12)",
                    border: `1px solid ${alert.severity === "high" ? "rgba(239,68,68,0.25)" : alert.severity === "medium" ? "rgba(245,158,11,0.25)" : "rgba(59,130,246,0.25)"}`,
                  }}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Shield className="w-3 h-3" style={{ color: alert.severity === "high" ? ERROR_RED : alert.severity === "medium" ? AMBER : BLUE }} />
                      <span className="text-[10px] font-bold uppercase" style={{ color: alert.severity === "high" ? ERROR_RED : alert.severity === "medium" ? AMBER : BLUE }}>
                        {alert.type.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="text-xs text-white/80">{alert.message}</p>
                    {alert.suggestion && <p className="text-[11px] mt-1 font-medium" style={{ color: EMERALD }}>{alert.suggestion}</p>}
                  </div>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {coachingTranscript.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <Volume2 className="w-8 h-8 mb-3 text-white/20" />
                  <p className="text-sm text-white/40">Listening for speech...</p>
                  <p className="text-xs text-white/20 mt-1">Transcript will appear as the call progresses</p>
                </div>
              )}
              {coachingTranscript.map((t, i) => (
                <div key={i} className="rounded-lg p-2.5" style={{ background: t.speaker === "agent" ? "rgba(16,185,129,0.08)" : t.speaker === "lead" ? "rgba(59,130,246,0.08)" : "rgba(255,255,255,0.04)" }}>
                  <p className="text-xs leading-relaxed" style={{ color: t.speaker === "agent" ? "rgba(16,185,129,0.9)" : t.speaker === "lead" ? "rgba(96,165,250,0.9)" : "rgba(255,255,255,0.8)" }}>{t.text}</p>
                  <p className="text-[9px] text-white/20 mt-1 font-mono">
                    {new Date(t.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>

            <div className="p-4" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: coachingConnected ? EMERALD : ERROR_RED }} />
                  <span className="text-[10px] text-white/40 font-mono">
                    {coachingConnected ? "Connected" : twilioCallActive ? "Connecting..." : "Call ended"}
                  </span>
                </div>
                <span className="text-[10px] text-white/30 font-mono">{coachingTranscript.length} segments</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </AppLayout>
  );
}
