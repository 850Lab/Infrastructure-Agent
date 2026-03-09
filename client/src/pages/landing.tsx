import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import {
  Phone, PhoneCall, PhoneOff, Mail, BarChart3, Users, Target, Brain,
  ArrowRight, ArrowLeft, CheckCircle2, Loader2, Mic, MicOff,
  Building2, User, MapPin, Clock, FileText, TrendingUp,
  Calendar, Shield, ChevronRight, Play, CircleDot
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const NAVY = "#0F172A";
const EMERALD = "#10B981";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";
const WHITE = "#FFFFFF";
const AMBER = "#F59E0B";
const BLUE = "#3B82F6";
const RED = "#EF4444";

function ContactForm() {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ name: "", company: "", email: "", phone: "" });
  const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email) {
      toast({ title: "Please fill in your name and email", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Request failed");
      setSent(true);
      toast({ title: "Demo request received", description: "We'll be in touch shortly." });
    } catch {
      toast({ title: "Something went wrong", description: "Please try again or email us directly.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="w-16 h-16 mx-auto mb-4" style={{ color: EMERALD }} />
        <h3 className="text-2xl font-bold mb-2" style={{ color: NAVY }}>Thanks, {form.name}!</h3>
        <p className="text-base" style={{ color: MUTED }}>We received your request and will reach out soon.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: MUTED }}>Name *</label>
          <input type="text" value={form.name} onChange={e => update("name", e.target.value)} className="w-full px-4 py-2.5 rounded-lg text-sm" style={{ background: SUBTLE, border: `1px solid ${BORDER}`, color: NAVY }} placeholder="Your name" data-testid="input-contact-name" />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: MUTED }}>Company</label>
          <input type="text" value={form.company} onChange={e => update("company", e.target.value)} className="w-full px-4 py-2.5 rounded-lg text-sm" style={{ background: SUBTLE, border: `1px solid ${BORDER}`, color: NAVY }} placeholder="Company name" data-testid="input-contact-company" />
        </div>
      </div>
      <div className="mb-4">
        <label className="block text-xs font-semibold mb-1.5" style={{ color: MUTED }}>Email *</label>
        <input type="email" value={form.email} onChange={e => update("email", e.target.value)} className="w-full px-4 py-2.5 rounded-lg text-sm" style={{ background: SUBTLE, border: `1px solid ${BORDER}`, color: NAVY }} placeholder="you@company.com" data-testid="input-contact-email" />
      </div>
      <div className="mb-6">
        <label className="block text-xs font-semibold mb-1.5" style={{ color: MUTED }}>Phone</label>
        <input type="tel" value={form.phone} onChange={e => update("phone", e.target.value)} className="w-full px-4 py-2.5 rounded-lg text-sm" style={{ background: SUBTLE, border: `1px solid ${BORDER}`, color: NAVY }} placeholder="(555) 123-4567" data-testid="input-contact-phone" />
      </div>
      <button type="submit" disabled={sending} className="w-full py-3 rounded-xl text-sm font-bold transition-opacity hover:opacity-90 flex items-center justify-center gap-2" style={{ background: EMERALD, color: WHITE, opacity: sending ? 0.7 : 1 }} data-testid="button-contact-submit">
        {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</> : "Request Demo"}
      </button>
    </form>
  );
}

function StepIndicator({ current, total, onStep }: { current: number; total: number; onStep: (n: number) => void }) {
  const labels = ["Account", "Call", "Analysis", "Pipeline", "Get Access"];
  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2" data-testid="step-indicator">
      {Array.from({ length: total }, (_, i) => (
        <button
          key={i}
          onClick={() => onStep(i)}
          className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
          style={{
            background: i === current ? EMERALD : i < current ? "rgba(16,185,129,0.1)" : SUBTLE,
            color: i === current ? WHITE : i < current ? EMERALD : MUTED,
            border: `1px solid ${i === current ? EMERALD : i < current ? "rgba(16,185,129,0.3)" : BORDER}`,
          }}
          data-testid={`step-button-${i}`}
        >
          <span className="hidden sm:inline">{labels[i]}</span>
          <span className="sm:hidden">{i + 1}</span>
        </button>
      ))}
    </div>
  );
}

function MockScreen({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}`, background: WHITE, boxShadow: "0 8px 32px rgba(0,0,0,0.08)" }}>
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: SUBTLE, borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#EF4444" }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#F59E0B" }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#22C55E" }} />
        </div>
        <span className="text-xs font-mono ml-2" style={{ color: MUTED }}>{title}</span>
      </div>
      <div className="p-4 sm:p-6">{children}</div>
    </div>
  );
}

function AccountScreen() {
  return (
    <MockScreen title="Texas Automation Systems - Focus Mode">
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-5 h-5" style={{ color: EMERALD }} />
                <h3 className="text-lg font-bold" style={{ color: NAVY }}>Gulf Coast Industrial Services</h3>
              </div>
              <div className="flex items-center gap-3 text-xs" style={{ color: MUTED }}>
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> Baytown, TX</span>
                <span className="flex items-center gap-1"><Users className="w-3 h-3" /> 250-500 employees</span>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: "rgba(16,185,129,0.1)", color: EMERALD }}>Touch 1</span>
          </div>

          <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
            <div className="flex items-center gap-2 mb-2">
              <User className="w-4 h-4" style={{ color: BLUE }} />
              <span className="text-sm font-bold" style={{ color: NAVY }}>Mike Richardson</span>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(59,130,246,0.1)", color: BLUE }}>Safety Director</span>
            </div>
            <div className="flex items-center gap-4 text-xs" style={{ color: MUTED }}>
              <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> (281) 555-0142</span>
              <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> m.richardson@gcis.com</span>
            </div>
          </div>

          <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
            <div className="flex items-center gap-2 mb-2">
              <Brain className="w-4 h-4" style={{ color: AMBER }} />
              <span className="text-xs font-bold" style={{ color: NAVY }}>Talking Points</span>
            </div>
            <ul className="space-y-1.5">
              <li className="text-xs flex items-start gap-2" style={{ color: MUTED }}>
                <ChevronRight className="w-3 h-3 mt-0.5 shrink-0" style={{ color: EMERALD }} />
                Recently awarded maintenance contract for Exxon Baytown complex
              </li>
              <li className="text-xs flex items-start gap-2" style={{ color: MUTED }}>
                <ChevronRight className="w-3 h-3 mt-0.5 shrink-0" style={{ color: EMERALD }} />
                Q2 turnaround season starting — likely need temporary cooling
              </li>
              <li className="text-xs flex items-start gap-2" style={{ color: MUTED }}>
                <ChevronRight className="w-3 h-3 mt-0.5 shrink-0" style={{ color: EMERALD }} />
                Posted 3 HSE roles last month — growing safety team
              </li>
            </ul>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
            <div className="text-xs font-bold mb-2" style={{ color: NAVY }}>Call Script</div>
            <div className="text-xs leading-relaxed" style={{ color: MUTED }}>
              "Hi Mike, this is [Name] with Texas Automation Systems. I noticed Gulf Coast just picked up the Exxon Baytown maintenance contract — congratulations on that. With turnaround season coming up, I wanted to see if you have a few minutes to discuss how we help teams like yours..."
            </div>
          </div>
          <button className="w-full py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-opacity hover:opacity-90" style={{ background: EMERALD, color: WHITE }} data-testid="demo-call-button">
            <Phone className="w-4 h-4" />
            Call Mike Richardson
          </button>
          <div className="flex gap-2">
            <button className="flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1" style={{ background: SUBTLE, color: MUTED, border: `1px solid ${BORDER}` }}>
              <Mail className="w-3 h-3" /> Email
            </button>
            <button className="flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1" style={{ background: SUBTLE, color: MUTED, border: `1px solid ${BORDER}` }}>
              <Calendar className="w-3 h-3" /> Schedule
            </button>
          </div>
        </div>
      </div>
    </MockScreen>
  );
}

function CallScreen() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed(prev => prev + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return (
    <MockScreen title="Texas Automation Systems - Active Call">
      <div className="max-w-lg mx-auto space-y-4">
        <div className="text-center py-4">
          <div className="w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: "rgba(16,185,129,0.1)" }}>
            <PhoneCall className="w-7 h-7" style={{ color: EMERALD }} />
          </div>
          <h3 className="text-lg font-bold" style={{ color: NAVY }}>Mike Richardson</h3>
          <p className="text-sm" style={{ color: MUTED }}>Gulf Coast Industrial Services</p>
          <p className="text-2xl font-mono font-bold mt-2" style={{ color: EMERALD }}>
            {mins}:{secs.toString().padStart(2, "0")}
          </p>
        </div>

        <div className="flex items-center justify-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgba(239,68,68,0.08)", color: RED }}>
            <CircleDot className="w-3 h-3" />
            Recording
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgba(16,185,129,0.08)", color: EMERALD }}>
            <Shield className="w-3 h-3" />
            Consent Given
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgba(59,130,246,0.08)", color: BLUE }}>
            <Mic className="w-3 h-3" />
            Twilio Voice
          </div>
        </div>

        <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4" style={{ color: BLUE }} />
            <span className="text-xs font-bold" style={{ color: NAVY }}>Live Transcription</span>
          </div>
          <div className="space-y-2 text-xs" style={{ color: MUTED }}>
            <p><span className="font-semibold" style={{ color: NAVY }}>You:</span> Hi Mike, this is James with Texas Automation Systems. I noticed Gulf Coast just picked up the Exxon Baytown maintenance contract...</p>
            <p><span className="font-semibold" style={{ color: BLUE }}>Mike:</span> Yeah, we're ramping up for that now. What exactly do you guys do?</p>
            <p><span className="font-semibold" style={{ color: NAVY }}>You:</span> We provide mobile cooling solutions for turnaround and shutdown work. With the summer heat coming up at Baytown...</p>
            <p className="flex items-center gap-1" style={{ color: EMERALD }}>
              <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: EMERALD }} />
              Transcribing...
            </p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-4 pt-2">
          <button className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
            <MicOff className="w-4 h-4" style={{ color: MUTED }} />
          </button>
          <button className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: RED }}>
            <PhoneOff className="w-6 h-6" style={{ color: WHITE }} />
          </button>
          <button className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
            <FileText className="w-4 h-4" style={{ color: MUTED }} />
          </button>
        </div>
      </div>
    </MockScreen>
  );
}

function AnalysisScreen() {
  return (
    <MockScreen title="Texas Automation Systems - Call Analysis">
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4" style={{ color: EMERALD }} />
                <span className="text-sm font-bold" style={{ color: NAVY }}>AI Call Summary</span>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(16,185,129,0.1)", color: EMERALD }}>High Interest</span>
            </div>
            <p className="text-xs leading-relaxed mb-3" style={{ color: MUTED }}>
              Mike Richardson confirmed Gulf Coast is ramping up for the Exxon Baytown turnaround starting late April.
              He expressed interest in mobile cooling for the project and asked about lead times and pricing.
              He is the decision maker for equipment rentals on this contract.
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(59,130,246,0.08)", color: BLUE }}>Decision Maker Confirmed</span>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(245,158,11,0.08)", color: AMBER }}>Pricing Requested</span>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(16,185,129,0.08)", color: EMERALD }}>Follow-up Scheduled</span>
            </div>
          </div>

          <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4" style={{ color: AMBER }} />
              <span className="text-xs font-bold" style={{ color: NAVY }}>Next Steps (Auto-detected)</span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs" style={{ color: MUTED }}>
                <CheckCircle2 className="w-3.5 h-3.5" style={{ color: EMERALD }} />
                Send pricing sheet for 20-ton units
              </div>
              <div className="flex items-center gap-2 text-xs" style={{ color: MUTED }}>
                <CheckCircle2 className="w-3.5 h-3.5" style={{ color: EMERALD }} />
                Follow-up call scheduled: Thursday, March 12 at 2:00 PM
              </div>
              <div className="flex items-center gap-2 text-xs" style={{ color: MUTED }}>
                <CheckCircle2 className="w-3.5 h-3.5" style={{ color: EMERALD }} />
                Mike will loop in Procurement for contract terms
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
            <div className="flex items-center gap-2 mb-2">
              <Phone className="w-4 h-4" style={{ color: BLUE }} />
              <span className="text-xs font-bold" style={{ color: NAVY }}>Call Details</span>
            </div>
            <div className="space-y-2">
              {[
                ["Duration", "4:32"],
                ["Outcome", "Interested — Send Info"],
                ["Recording", "Available"],
                ["Transcription", "Complete"],
                ["Compliance", "Consent Recorded"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between text-xs">
                  <span style={{ color: MUTED }}>{label}</span>
                  <span className="font-semibold" style={{ color: NAVY }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4" style={{ color: EMERALD }} />
              <span className="text-xs font-bold" style={{ color: NAVY }}>Pipeline Update</span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs px-2 py-0.5 rounded" style={{ background: SUBTLE, color: MUTED, border: `1px solid ${BORDER}` }}>New Lead</span>
              <ArrowRight className="w-3 h-3" style={{ color: EMERALD }} />
              <span className="text-xs px-2 py-0.5 rounded font-semibold" style={{ background: "rgba(16,185,129,0.1)", color: EMERALD, border: `1px solid rgba(16,185,129,0.3)` }}>Qualified</span>
            </div>
            <p className="text-xs" style={{ color: MUTED }}>Automatically moved based on call analysis</p>
          </div>
        </div>
      </div>
    </MockScreen>
  );
}

function PipelineScreen() {
  const stages = [
    { name: "New", count: 24, color: MUTED, deals: ["Apex Marine", "Coastal Fab", "Delta Valve"] },
    { name: "Contacted", count: 18, color: BLUE, deals: ["Bayport Energy", "Southern Pipe"] },
    { name: "Qualified", count: 12, color: AMBER, deals: ["Gulf Coast Industrial", "Petro-Chem Solutions"] },
    { name: "Proposal", count: 6, color: EMERALD, deals: ["Marathon Refining", "Valero Port Arthur"] },
    { name: "Closed", count: 3, color: "#22C55E", deals: ["Phillips 66 Sweeny"] },
  ];

  return (
    <MockScreen title="Texas Automation Systems - Pipeline & Analytics">
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Calls Today", value: "14", change: "+3 vs avg" },
            { label: "Connect Rate", value: "38%", change: "+5% this week" },
            { label: "Meetings Set", value: "4", change: "this week" },
            { label: "Pipeline Value", value: "$186K", change: "+$42K this month" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg p-3 text-center" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
              <div className="text-xl font-bold" style={{ color: NAVY }}>{stat.value}</div>
              <div className="text-xs font-medium" style={{ color: MUTED }}>{stat.label}</div>
              <div className="text-xs mt-1" style={{ color: EMERALD }}>{stat.change}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-5 gap-2">
          {stages.map((stage) => (
            <div key={stage.name} className="rounded-lg p-2" style={{ border: `1px solid ${BORDER}` }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold" style={{ color: NAVY }}>{stage.name}</span>
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${stage.color}15`, color: stage.color }}>{stage.count}</span>
              </div>
              <div className="space-y-1.5">
                {stage.deals.map((deal) => (
                  <div key={deal} className="rounded p-1.5 text-xs truncate" style={{ background: SUBTLE, color: MUTED, border: `1px solid ${BORDER}` }}>
                    {deal}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4" style={{ color: EMERALD }} />
            <span className="text-xs font-bold" style={{ color: NAVY }}>Call Activity — Last 7 Days</span>
          </div>
          <div className="flex items-end gap-1 h-16">
            {[8, 12, 6, 15, 14, 10, 14].map((val, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full rounded-t transition-all" style={{ height: `${(val / 15) * 100}%`, background: i === 6 ? EMERALD : "rgba(16,185,129,0.3)" }} />
                <span className="text-xs" style={{ color: MUTED, fontSize: "9px" }}>{["M", "T", "W", "T", "F", "S", "S"][i]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </MockScreen>
  );
}

function DemoStep({ step }: { step: number }) {
  const descriptions = [
    { title: "Review the account", subtitle: "Every lead is presented with full context — company details, decision maker info, AI-generated talking points, and a personalized call script. Your rep knows exactly who they're calling and why." },
    { title: "Make the call", subtitle: "One-click calling powered by Twilio. Calls are recorded with consent, transcribed in real-time, and tagged with compliance metadata. Your team calls directly from the platform." },
    { title: "AI analyzes the conversation", subtitle: "After each call, AI processes the transcription to extract key insights — interest level, decision maker status, next steps, and follow-up dates. Everything is logged automatically." },
    { title: "Track your pipeline", subtitle: "See real-time performance across your team. Call volume, connect rates, pipeline progression, and revenue impact — all in one view. Know what's working and where to focus." },
  ];

  if (step >= 4) return null;
  const d = descriptions[step];

  return (
    <div className="mb-6 text-center">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold mb-3" style={{ background: "rgba(16,185,129,0.08)", color: EMERALD }}>
        Step {step + 1} of 4
      </div>
      <h2 className="text-2xl sm:text-3xl font-bold mb-2" style={{ color: NAVY }}>{d.title}</h2>
      <p className="text-sm sm:text-base max-w-xl mx-auto" style={{ color: MUTED }}>{d.subtitle}</p>
    </div>
  );
}

export default function LandingPage() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const totalSteps = 5;

  const goNext = () => setStep(prev => Math.min(prev + 1, totalSteps - 1));
  const goPrev = () => setStep(prev => Math.max(prev - 1, 0));

  return (
    <div style={{ background: WHITE, color: NAVY, minHeight: "100vh" }} data-testid="landing-page">
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 sm:px-6 py-3" style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(12px)", borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `rgba(16,185,129,0.1)` }}>
            <Target className="w-4 h-4" style={{ color: EMERALD }} />
          </div>
          <span className="text-base sm:text-lg font-bold tracking-tight" style={{ color: NAVY }}>Texas Automation Systems</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs hidden sm:inline" style={{ color: MUTED }}>by Pivotal Gamechangers LLC</span>
          <button onClick={() => navigate("/login")} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90" style={{ background: NAVY, color: WHITE }} data-testid="button-login-nav">
            Sign In
          </button>
        </div>
      </nav>

      <div className="pt-20 pb-8 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          {step === 0 && (
            <div className="text-center mb-8 pt-4">
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight mb-4" style={{ color: NAVY }}>
                See how your team sells with<br />
                <span style={{ color: EMERALD }}>Texas Automation Systems</span>
              </h1>
              <p className="text-base sm:text-lg max-w-xl mx-auto mb-6" style={{ color: MUTED }}>
                Walk through a live demo of the platform — from account research to closed deal.
              </p>
              <button onClick={goNext} className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-opacity hover:opacity-90" style={{ background: EMERALD, color: WHITE }} data-testid="button-start-demo">
                <Play className="w-4 h-4" />
                Start Product Tour
              </button>
            </div>
          )}

          {step > 0 && step < 5 && (
            <>
              <StepIndicator current={step - 1} total={totalSteps} onStep={(n) => setStep(n + 1)} />
              <div className="mt-6">
                <DemoStep step={step - 1} />
                <div className="transition-all">
                  {step === 1 && <AccountScreen />}
                  {step === 2 && <CallScreen />}
                  {step === 3 && <AnalysisScreen />}
                  {step === 4 && <PipelineScreen />}
                </div>
              </div>
            </>
          )}

          {step === 5 && (
            <div className="max-w-lg mx-auto mt-4">
              <div className="text-center mb-6">
                <h2 className="text-2xl sm:text-3xl font-bold mb-2" style={{ color: NAVY }}>Ready to get started?</h2>
                <p className="text-sm" style={{ color: MUTED }}>Request a personalized demo for your team.</p>
              </div>
              <div className="rounded-xl p-6 sm:p-8" style={{ border: `1px solid ${BORDER}`, background: WHITE, boxShadow: "0 8px 32px rgba(0,0,0,0.06)" }}>
                <ContactForm />
              </div>
            </div>
          )}

          {step > 0 && (
            <div className="flex items-center justify-between mt-6">
              <button onClick={goPrev} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80" style={{ color: MUTED }} data-testid="button-prev">
                <ArrowLeft className="w-4 h-4" />
                {step === 1 ? "Home" : "Back"}
              </button>
              {step < 5 && (
                <button onClick={goNext} className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-bold transition-opacity hover:opacity-90" style={{ background: EMERALD, color: WHITE }} data-testid="button-next">
                  {step === 4 ? "Request Access" : "Next"}
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <footer className="py-6 px-4 sm:px-6 mt-8" style={{ borderTop: `1px solid ${BORDER}` }}>
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4" style={{ color: EMERALD }} />
            <span className="text-sm font-bold" style={{ color: NAVY }}>Texas Automation Systems</span>
          </div>
          <div className="text-xs" style={{ color: MUTED }}>
            A product by Pivotal Gamechangers LLC
          </div>
        </div>
      </footer>
    </div>
  );
}
