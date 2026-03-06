import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Save,
  Loader2,
  CheckCircle2,
  Send,
  Mail,
  AlertTriangle,
  Eye,
  EyeOff,
  MessageSquareReply,
  RefreshCw,
} from "lucide-react";

const EMERALD = "#10B981";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";
const ERROR = "#EF4444";

interface EmailSettings {
  id: number;
  clientId: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpSecure: boolean;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean | null;
  replyCheckEnabled: boolean;
  lastReplyCheck: string | null;
  fromName: string;
  fromEmail: string;
  signature: string | null;
  dailyLimit: number;
  sentToday: number;
  enabled: boolean;
}

const SMTP_PRESETS = [
  { label: "Gmail", host: "smtp.gmail.com", port: 587, secure: false },
  { label: "Outlook / Office 365", host: "smtp.office365.com", port: 587, secure: false },
  { label: "Yahoo", host: "smtp.mail.yahoo.com", port: 465, secure: true },
  { label: "HubSpot SMTP", host: "smtp.hubspot.com", port: 587, secure: false },
  { label: "SendGrid", host: "smtp.sendgrid.net", port: 587, secure: false },
  { label: "Custom SMTP", host: "", port: 587, secure: false },
];

export default function EmailSettingsPage() {
  const { getToken } = useAuth();
  const token = getToken();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState(993);
  const [imapSecure, setImapSecure] = useState(true);
  const [replyCheckEnabled, setReplyCheckEnabled] = useState(false);
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [signature, setSignature] = useState("");
  const [dailyLimit, setDailyLimit] = useState(50);
  const [enabled, setEnabled] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  const { data: settings, isLoading } = useQuery<EmailSettings | null>({
    queryKey: ["/api/email/settings"],
    enabled: !!token,
  });

  useEffect(() => {
    if (settings) {
      setSmtpHost(settings.smtpHost || "");
      setSmtpPort(settings.smtpPort || 587);
      setSmtpUser(settings.smtpUser || "");
      setSmtpPass(settings.smtpPass || "");
      setSmtpSecure(settings.smtpSecure || false);
      setImapHost(settings.imapHost || "");
      setImapPort(settings.imapPort || 993);
      setImapSecure(settings.imapSecure !== false);
      setReplyCheckEnabled(settings.replyCheckEnabled || false);
      setFromName(settings.fromName || "");
      setFromEmail(settings.fromEmail || "");
      setSignature(settings.signature || "");
      setDailyLimit(settings.dailyLimit || 50);
      setEnabled(settings.enabled !== false);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/email/settings", {
        smtpHost, smtpPort, smtpUser, smtpPass, smtpSecure,
        imapHost: imapHost || null, imapPort, imapSecure, replyCheckEnabled,
        fromName, fromEmail, signature, dailyLimit, enabled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/settings"] });
      setHasChanges(false);
      toast({ title: "Email settings saved", description: "Your SMTP configuration has been updated." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/email/test", { recipientEmail: testEmail }),
    onSuccess: () => {
      toast({ title: "Test email sent", description: `Check ${testEmail} for the test message.` });
    },
    onError: (err: any) => {
      toast({ title: "Test failed", description: err.message, variant: "destructive" });
    },
  });

  const replyCheckMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/email/check-replies"),
    onSuccess: async (res: any) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/email/settings"] });
      toast({
        title: "Reply check complete",
        description: `Found ${data.repliesFound} new replies across ${data.clientsChecked} clients.`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Reply check failed", description: err.message, variant: "destructive" });
    },
  });

  function applyPreset(preset: typeof SMTP_PRESETS[number]) {
    if (preset.host) {
      setSmtpHost(preset.host);
      setSmtpPort(preset.port);
      setSmtpSecure(preset.secure);
      setHasChanges(true);
    }
  }

  const inputStyle = {
    background: "#FFFFFF",
    border: `1px solid ${BORDER}`,
    color: TEXT,
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    width: "100%",
    outline: "none",
  };

  const labelStyle = {
    fontSize: 12,
    fontWeight: 600 as const,
    color: TEXT,
    marginBottom: 4,
    display: "block" as const,
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#FFFFFF" }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: EMERALD }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#FFFFFF" }}>
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/machine/outreach")}
            className="gap-1"
            style={{ color: MUTED }}
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Outreach
          </Button>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: TEXT }} data-testid="text-page-title">
              Email Settings
            </h1>
            <p className="text-sm mt-1" style={{ color: MUTED }}>
              Configure your SMTP connection to send outreach emails directly from the platform
            </p>
          </div>
          <div className="flex items-center gap-2">
            {settings && (
              <div className="flex items-center gap-1.5 text-xs mr-3" style={{ color: MUTED }}>
                <Mail className="w-3.5 h-3.5" />
                {settings.sentToday} / {settings.dailyLimit} sent today
              </div>
            )}
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="gap-2 text-sm font-semibold"
              style={{ background: EMERALD, color: "#FFFFFF" }}
              data-testid="button-save-settings"
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Settings
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          <div
            className="rounded-xl p-5"
            style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}
          >
            <h2 className="text-sm font-bold mb-4" style={{ color: TEXT }}>
              SMTP Provider
            </h2>
            <div className="flex flex-wrap gap-2 mb-4" data-testid="smtp-presets">
              {SMTP_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => applyPreset(preset)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: smtpHost === preset.host && preset.host ? "rgba(16,185,129,0.08)" : "#FFFFFF",
                    border: `1px solid ${smtpHost === preset.host && preset.host ? EMERALD : BORDER}`,
                    color: smtpHost === preset.host && preset.host ? EMERALD : TEXT,
                  }}
                  data-testid={`preset-${preset.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label style={labelStyle}>SMTP Host</label>
                <input
                  type="text"
                  value={smtpHost}
                  onChange={(e) => { setSmtpHost(e.target.value); setHasChanges(true); }}
                  placeholder="smtp.gmail.com"
                  style={inputStyle}
                  data-testid="input-smtp-host"
                />
              </div>
              <div>
                <label style={labelStyle}>SMTP Port</label>
                <input
                  type="number"
                  value={smtpPort}
                  onChange={(e) => { setSmtpPort(parseInt(e.target.value) || 587); setHasChanges(true); }}
                  style={inputStyle}
                  data-testid="input-smtp-port"
                />
              </div>
              <div>
                <label style={labelStyle}>Username / Email</label>
                <input
                  type="text"
                  value={smtpUser}
                  onChange={(e) => { setSmtpUser(e.target.value); setHasChanges(true); }}
                  placeholder="you@example.com"
                  style={inputStyle}
                  data-testid="input-smtp-user"
                />
              </div>
              <div>
                <label style={labelStyle}>Password / App Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={smtpPass}
                    onChange={(e) => { setSmtpPass(e.target.value); setHasChanges(true); }}
                    placeholder="App-specific password"
                    style={{ ...inputStyle, paddingRight: 36 }}
                    data-testid="input-smtp-pass"
                  />
                  <button
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    style={{ color: MUTED }}
                    data-testid="button-toggle-password"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-3">
              <input
                type="checkbox"
                checked={smtpSecure}
                onChange={(e) => { setSmtpSecure(e.target.checked); setHasChanges(true); }}
                id="smtp-secure"
                data-testid="input-smtp-secure"
              />
              <label htmlFor="smtp-secure" className="text-xs" style={{ color: TEXT }}>
                Use SSL/TLS (port 465)
              </label>
            </div>
          </div>

          <div
            className="rounded-xl p-5"
            style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}
          >
            <h2 className="text-sm font-bold mb-4" style={{ color: TEXT }}>
              Sender Identity
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label style={labelStyle}>From Name</label>
                <input
                  type="text"
                  value={fromName}
                  onChange={(e) => { setFromName(e.target.value); setHasChanges(true); }}
                  placeholder="John Smith"
                  style={inputStyle}
                  data-testid="input-from-name"
                />
              </div>
              <div>
                <label style={labelStyle}>From Email</label>
                <input
                  type="email"
                  value={fromEmail}
                  onChange={(e) => { setFromEmail(e.target.value); setHasChanges(true); }}
                  placeholder="john@company.com"
                  style={inputStyle}
                  data-testid="input-from-email"
                />
              </div>
            </div>

            <div className="mt-4">
              <label style={labelStyle}>Email Signature</label>
              <textarea
                value={signature}
                onChange={(e) => { setSignature(e.target.value); setHasChanges(true); }}
                placeholder="Best regards,&#10;John Smith&#10;Account Executive&#10;(555) 123-4567"
                rows={4}
                style={{ ...inputStyle, resize: "vertical" as const }}
                data-testid="input-signature"
              />
            </div>
          </div>

          <div
            className="rounded-xl p-5"
            style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}
          >
            <h2 className="text-sm font-bold mb-4" style={{ color: TEXT }}>
              Sending Controls
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label style={labelStyle}>Daily Send Limit</label>
                <input
                  type="number"
                  value={dailyLimit}
                  onChange={(e) => { setDailyLimit(parseInt(e.target.value) || 50); setHasChanges(true); }}
                  min={1}
                  max={500}
                  style={inputStyle}
                  data-testid="input-daily-limit"
                />
                <p className="text-[10px] mt-1" style={{ color: MUTED }}>
                  Gmail: 500/day, Outlook: 300/day, SendGrid: varies by plan
                </p>
              </div>
              <div className="flex items-center gap-3 pt-5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => { setEnabled(e.target.checked); setHasChanges(true); }}
                    data-testid="input-enabled"
                  />
                  <span className="text-xs font-medium" style={{ color: TEXT }}>
                    Email sending enabled
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div
            className="rounded-xl p-5"
            style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}
          >
            <h2 className="text-sm font-bold mb-4 flex items-center gap-2" style={{ color: TEXT }}>
              <MessageSquareReply className="w-4 h-4" style={{ color: EMERALD }} />
              Reply Detection (IMAP)
            </h2>
            <p className="text-xs mb-3" style={{ color: MUTED }}>
              Monitor your inbox for replies to outreach emails. When a reply is detected, the outreach sequence for that company is automatically paused.
              IMAP credentials use your same SMTP username and password.
            </p>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <label style={labelStyle}>IMAP Host</label>
                <input
                  type="text"
                  value={imapHost}
                  onChange={(e) => { setImapHost(e.target.value); setHasChanges(true); }}
                  placeholder="imap.gmail.com"
                  style={inputStyle}
                  data-testid="input-imap-host"
                />
              </div>
              <div>
                <label style={labelStyle}>IMAP Port</label>
                <input
                  type="number"
                  value={imapPort}
                  onChange={(e) => { setImapPort(parseInt(e.target.value) || 993); setHasChanges(true); }}
                  style={inputStyle}
                  data-testid="input-imap-port"
                />
              </div>
              <div className="flex items-end gap-3 pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={imapSecure}
                    onChange={(e) => { setImapSecure(e.target.checked); setHasChanges(true); }}
                    data-testid="input-imap-secure"
                  />
                  <span className="text-xs font-medium" style={{ color: TEXT }}>
                    SSL/TLS
                  </span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={replyCheckEnabled}
                  onChange={(e) => { setReplyCheckEnabled(e.target.checked); setHasChanges(true); }}
                  data-testid="input-reply-check-enabled"
                />
                <span className="text-xs font-medium" style={{ color: TEXT }}>
                  Enable automatic reply checking (every 15 min)
                </span>
              </label>
              <div className="flex items-center gap-2">
                {settings?.lastReplyCheck && (
                  <span className="text-[10px]" style={{ color: MUTED }} data-testid="text-last-reply-check">
                    Last check: {new Date(settings.lastReplyCheck).toLocaleString()}
                  </span>
                )}
                <Button
                  onClick={() => replyCheckMutation.mutate()}
                  disabled={replyCheckMutation.isPending || !settings}
                  variant="outline"
                  size="sm"
                  className="gap-1 text-xs"
                  style={{ borderColor: EMERALD, color: EMERALD }}
                  data-testid="button-check-replies"
                >
                  {replyCheckMutation.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  Check Now
                </Button>
              </div>
            </div>

            {!imapHost && smtpHost && (
              <p className="text-[10px] mt-2" style={{ color: MUTED }}>
                If left empty, the IMAP host will be auto-derived from your SMTP host (works for Gmail, Outlook, Yahoo, Zoho).
              </p>
            )}
          </div>

          <div
            className="rounded-xl p-5"
            style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}
          >
            <h2 className="text-sm font-bold mb-4" style={{ color: TEXT }}>
              Test Connection
            </h2>
            <p className="text-xs mb-3" style={{ color: MUTED }}>
              Send a test email to verify your SMTP settings are working. Save your settings first.
            </p>
            <div className="flex gap-2">
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="test@example.com"
                style={{ ...inputStyle, flex: 1 }}
                data-testid="input-test-email"
              />
              <Button
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending || !testEmail || !settings}
                className="gap-2 text-sm"
                variant="outline"
                style={{ borderColor: EMERALD, color: EMERALD }}
                data-testid="button-send-test"
              >
                {testMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Send Test
              </Button>
            </div>
            {!settings && (
              <div className="flex items-center gap-1.5 mt-2 text-xs" style={{ color: "#F59E0B" }}>
                <AlertTriangle className="w-3.5 h-3.5" />
                Save your settings before testing
              </div>
            )}
          </div>

          {smtpHost.includes("gmail") && (
            <div
              className="rounded-xl p-4 flex items-start gap-3"
              style={{ background: "rgba(245,158,11,0.05)", border: `1px solid rgba(245,158,11,0.2)` }}
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "#F59E0B" }} />
              <div>
                <p className="text-xs font-semibold" style={{ color: TEXT }}>Gmail requires an App Password</p>
                <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>
                  Go to Google Account &gt; Security &gt; 2-Step Verification &gt; App Passwords.
                  Generate a new app password and use it above instead of your regular password.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
