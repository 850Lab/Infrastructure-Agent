import { useLocation } from "wouter";
import { useState } from "react";
import { Phone, Mail, BarChart3, Users, Zap, Shield, Target, Brain, Calendar, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const NAVY = "#0F172A";
const EMERALD = "#10B981";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";
const WHITE = "#FFFFFF";

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
      <div className="rounded-xl p-8 text-center" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
        <CheckCircle2 className="w-12 h-12 mx-auto mb-4" style={{ color: EMERALD }} />
        <h3 className="text-xl font-bold mb-2" style={{ color: WHITE }}>Thanks, {form.name}!</h3>
        <p className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>We received your request and will reach out soon.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl p-8 text-left" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>Name *</label>
          <input type="text" value={form.name} onChange={e => update("name", e.target.value)} className="w-full px-4 py-2.5 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: WHITE }} placeholder="Your name" data-testid="input-contact-name" />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>Company</label>
          <input type="text" value={form.company} onChange={e => update("company", e.target.value)} className="w-full px-4 py-2.5 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: WHITE }} placeholder="Company name" data-testid="input-contact-company" />
        </div>
      </div>
      <div className="mb-4">
        <label className="block text-xs font-semibold mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>Email *</label>
        <input type="email" value={form.email} onChange={e => update("email", e.target.value)} className="w-full px-4 py-2.5 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: WHITE }} placeholder="you@company.com" data-testid="input-contact-email" />
      </div>
      <div className="mb-6">
        <label className="block text-xs font-semibold mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>Phone</label>
        <input type="tel" value={form.phone} onChange={e => update("phone", e.target.value)} className="w-full px-4 py-2.5 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: WHITE }} placeholder="(555) 123-4567" data-testid="input-contact-phone" />
      </div>
      <button type="submit" disabled={sending} className="w-full py-3 rounded-xl text-sm font-bold transition-opacity hover:opacity-90 flex items-center justify-center gap-2" style={{ background: EMERALD, color: WHITE, opacity: sending ? 0.7 : 1 }} data-testid="button-contact-submit">
        {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</> : "Request Demo"}
      </button>
    </form>
  );
}

export default function LandingPage() {
  const [, navigate] = useLocation();

  return (
    <div style={{ background: WHITE, color: NAVY }} data-testid="landing-page">
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4" style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(12px)", borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `rgba(16,185,129,0.1)` }}>
            <Target className="w-5 h-5" style={{ color: EMERALD }} />
          </div>
          <span className="text-lg font-bold tracking-tight" style={{ color: NAVY }}>Texas Automation Systems</span>
        </div>
        <div className="flex items-center gap-6">
          <a href="#features" className="text-sm font-medium hidden sm:block" style={{ color: MUTED }} data-testid="link-features">Features</a>
          <a href="#how-it-works" className="text-sm font-medium hidden sm:block" style={{ color: MUTED }} data-testid="link-how">How It Works</a>
          <a href="#contact" className="text-sm font-medium hidden sm:block" style={{ color: MUTED }} data-testid="link-contact">Contact</a>
          <button onClick={() => navigate("/login")} className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90" style={{ background: NAVY, color: WHITE }} data-testid="button-login-nav">
            Sign In
          </button>
        </div>
      </nav>

      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold mb-6" style={{ background: "rgba(16,185,129,0.08)", color: EMERALD, border: `1px solid rgba(16,185,129,0.2)` }}>
            <Zap className="w-3.5 h-3.5" />
            Sales Workflow Automation
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-6" style={{ color: NAVY }}>
            The sales platform that<br />
            <span style={{ color: EMERALD }}>drives revenue</span>, not busywork
          </h1>
          <p className="text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed" style={{ color: MUTED }}>
            Texas Automation Systems unifies calling, email, pipeline management, and analytics
            into one platform — giving your team the tools to manage relationships and close deals faster.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href="#contact" className="px-8 py-3.5 rounded-xl text-base font-semibold transition-opacity hover:opacity-90 flex items-center gap-2" style={{ background: EMERALD, color: WHITE }} data-testid="button-hero-cta">
              Request a Demo
              <ArrowRight className="w-4 h-4" />
            </a>
            <a href="#features" className="px-8 py-3.5 rounded-xl text-base font-semibold transition-opacity hover:opacity-90" style={{ background: SUBTLE, color: NAVY, border: `1px solid ${BORDER}` }} data-testid="button-hero-features">
              See Features
            </a>
          </div>
        </div>
      </section>

      <section className="py-16 px-6" style={{ background: SUBTLE }}>
        <div className="max-w-5xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
          {[
            { value: "Unified", label: "Calls + Email Platform" },
            { value: "AI-Powered", label: "Conversation Insights" },
            { value: "Real-Time", label: "Pipeline Visibility" },
            { value: "Multi-Campaign", label: "Team Management" },
          ].map((stat) => (
            <div key={stat.label}>
              <div className="text-2xl sm:text-3xl font-bold mb-1" style={{ color: EMERALD }}>{stat.value}</div>
              <div className="text-sm font-medium" style={{ color: MUTED }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4" style={{ color: NAVY }}>
              Everything your sales team needs
            </h2>
            <p className="text-lg max-w-2xl mx-auto" style={{ color: MUTED }}>
              From first conversation to closed deal, Texas Automation Systems keeps your pipeline organized and your team productive.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Phone,
                title: "Integrated Calling",
                desc: "Make and receive calls directly from the platform with Twilio-powered voice. Calls are recorded and transcribed automatically for easy review.",
              },
              {
                icon: Mail,
                title: "Email Sequences",
                desc: "Build structured follow-up sequences that combine calls and emails. Templates are personalized for each contact to keep messaging relevant.",
              },
              {
                icon: Brain,
                title: "AI Conversation Analysis",
                desc: "Call transcriptions are analyzed by AI to surface key takeaways, identify next steps, and help your team improve over time.",
              },
              {
                icon: Target,
                title: "Focus Mode",
                desc: "A guided workflow that presents each account with full context, suggested talking points, and one-click logging. Keeps your team in the zone.",
              },
              {
                icon: BarChart3,
                title: "Pipeline Analytics",
                desc: "Track activity volume, conversion rates, and team performance across campaigns. Know what's working and where to focus.",
              },
              {
                icon: Users,
                title: "Contact Management",
                desc: "Organize contacts by company, role, and engagement history. The right person and context are always one click away.",
              },
              {
                icon: Calendar,
                title: "Smart Scheduling",
                desc: "Follow-up dates are captured from conversations automatically. When a contact says 'call me next week,' it shows up on the calendar.",
              },
              {
                icon: Shield,
                title: "Compliance & Audit Trails",
                desc: "Call recording consent tracking, opt-out management, and full activity logs. Operate at scale with confidence.",
              },
              {
                icon: Zap,
                title: "Company Research",
                desc: "Automatic web research surfaces relevant company information and talking points before each interaction. Walk in prepared.",
              },
            ].map((feature) => (
              <div key={feature.title} className="rounded-xl p-6 transition-shadow hover:shadow-md" style={{ background: WHITE, border: `1px solid ${BORDER}` }} data-testid={`feature-card-${feature.title.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ background: "rgba(16,185,129,0.08)" }}>
                  <feature.icon className="w-5 h-5" style={{ color: EMERALD }} />
                </div>
                <h3 className="text-base font-bold mb-2" style={{ color: NAVY }}>{feature.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: MUTED }}>{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="py-20 px-6" style={{ background: SUBTLE }}>
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4" style={{ color: NAVY }}>
              How it works
            </h2>
            <p className="text-lg max-w-2xl mx-auto" style={{ color: MUTED }}>
              Get your team productive in days, not months.
            </p>
          </div>

          <div className="space-y-8">
            {[
              {
                step: "01",
                title: "Set up your accounts",
                desc: "Import your target account list. The platform enriches each company with key contacts, industry context, and relevant intel.",
              },
              {
                step: "02",
                title: "Build your campaigns",
                desc: "Configure follow-up sequences, customize templates, and assign accounts to your team. AI helps generate personalized messaging.",
              },
              {
                step: "03",
                title: "Work through Focus Mode",
                desc: "Your team works through a guided daily session with full account context, call capabilities, and streamlined logging. Everything in one view.",
              },
              {
                step: "04",
                title: "Measure and improve",
                desc: "Analytics show what's driving results. AI insights from call transcriptions help refine your approach over time.",
              },
            ].map((item) => (
              <div key={item.step} className="flex gap-6 items-start rounded-xl p-6" style={{ background: WHITE, border: `1px solid ${BORDER}` }}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-lg font-bold" style={{ background: "rgba(16,185,129,0.08)", color: EMERALD }}>
                  {item.step}
                </div>
                <div>
                  <h3 className="text-lg font-bold mb-1" style={{ color: NAVY }}>{item.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: MUTED }}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4" style={{ color: NAVY }}>
              Built for B2B service teams
            </h2>
            <p className="text-lg max-w-2xl mx-auto" style={{ color: MUTED }}>
              Texas Automation Systems is designed for companies where relationships drive revenue.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
            {[
              "Industrial services & contractors",
              "Staffing & workforce solutions",
              "Equipment rental & leasing",
              "Professional services & consulting",
              "Safety & compliance services",
              "Facility management & operations",
            ].map((item) => (
              <div key={item} className="flex items-center gap-3 py-2">
                <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: EMERALD }} />
                <span className="text-sm font-medium" style={{ color: NAVY }}>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="contact" className="py-20 px-6" style={{ background: NAVY }}>
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4" style={{ color: WHITE }}>
            See it in action
          </h2>
          <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.6)" }}>
            Request a personalized demo and see how Texas Automation Systems can work for your team.
          </p>
          <ContactForm />
        </div>
      </section>

      <footer className="py-10 px-6" style={{ background: NAVY, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(16,185,129,0.15)" }}>
              <Target className="w-4 h-4" style={{ color: EMERALD }} />
            </div>
            <span className="text-sm font-bold" style={{ color: WHITE }}>Texas Automation Systems</span>
          </div>
          <div className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            A product by Pivotal Gamechangers LLC
          </div>
          <div className="flex items-center gap-4 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            <a href="#features" className="hover:underline">Features</a>
            <a href="#how-it-works" className="hover:underline">How It Works</a>
            <a href="#contact" className="hover:underline">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
