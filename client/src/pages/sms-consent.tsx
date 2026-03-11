import { useLocation } from "wouter";
import { Target, ArrowLeft, MessageSquare, ShieldCheck, Phone, HelpCircle, Ban } from "lucide-react";

const NAVY = "#0F172A";
const EMERALD = "#10B981";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const WHITE = "#FFFFFF";
const SUBTLE = "#F8FAFC";

export default function SmsConsentPage() {
  const [, navigate] = useLocation();

  return (
    <div style={{ background: WHITE, color: NAVY, minHeight: "100vh" }} data-testid="sms-consent-page">
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 sm:px-6 py-3" style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(12px)", borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-2 sm:gap-3 cursor-pointer" onClick={() => navigate("/site")}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(16,185,129,0.1)" }}>
            <Target className="w-4 h-4" style={{ color: EMERALD }} />
          </div>
          <span className="text-base sm:text-lg font-bold tracking-tight" style={{ color: NAVY }}>Texas Automation Systems</span>
        </div>
        <button onClick={() => navigate("/site")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ color: MUTED }} data-testid="button-back-site">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Site
        </button>
      </nav>

      <div className="pt-24 pb-16 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(16,185,129,0.1)" }}>
              <MessageSquare className="w-6 h-6" style={{ color: EMERALD }} />
            </div>
            <div>
              <h1 className="text-3xl font-bold" style={{ color: NAVY }}>SMS & Messaging Consent</h1>
              <p className="text-sm" style={{ color: MUTED }}>How we obtain and manage your consent for text messages</p>
            </div>
          </div>
          <p className="text-sm mt-1 mb-8" style={{ color: MUTED }}>Last updated: March 11, 2026</p>

          <div className="rounded-xl p-5 sm:p-6 mb-8" style={{ background: "rgba(16,185,129,0.05)", border: `2px solid ${EMERALD}` }}>
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: EMERALD }} />
              <div>
                <h2 className="text-base font-bold mb-2" style={{ color: NAVY }}>Consent Summary</h2>
                <p className="text-sm leading-relaxed" style={{ color: NAVY }}>
                  Texas Automation Systems (operated by Pivotal Gamechangers LLC) only sends text messages to business contacts who have provided explicit verbal consent during a live, one-on-one phone conversation with a sales representative. We never send unsolicited text messages, cold SMS, promotional blasts, or marketing messages. All messaging is one-to-one and directly related to a prior business conversation initiated by or with the customer.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-8 text-sm leading-relaxed">
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Phone className="w-5 h-5" style={{ color: EMERALD }} />
                <h2 className="text-lg font-bold" style={{ color: NAVY }}>How Consent Is Collected</h2>
              </div>
              <div className="rounded-lg p-4" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
                <p className="mb-3" style={{ color: NAVY }}>
                  Consent to receive text messages is collected through <strong>verbal opt-in</strong> during a live phone conversation between a sales representative and a business contact. The process is as follows:
                </p>
                <ol className="list-decimal pl-6 space-y-3" style={{ color: NAVY }}>
                  <li>
                    <strong>Customer-Initiated Interaction:</strong> A business contact calls our client's business line, or our sales representative makes a one-on-one business call to a company contact for a legitimate business purpose.
                  </li>
                  <li>
                    <strong>Verbal Consent Request:</strong> During the live conversation, the sales representative asks the contact if they would like to receive follow-up information via text message. For example: <em>"Would it be okay if I send you a text with [the information discussed / a summary / the quote / the appointment confirmation]?"</em>
                  </li>
                  <li>
                    <strong>Affirmative Response:</strong> The contact verbally agrees to receive the text message. Only upon receiving a clear affirmative response does the representative send any SMS.
                  </li>
                  <li>
                    <strong>Consent Logging:</strong> The verbal consent, the date, and the context of the conversation are logged in our system's compliance audit trail for record-keeping purposes.
                  </li>
                </ol>
              </div>
              <p className="mt-3" style={{ color: MUTED }}>
                Consent is <strong>not</strong> required as a condition of purchasing any goods or services. Contacts may decline to receive text messages without any impact on the business relationship.
              </p>
            </section>

            <section>
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare className="w-5 h-5" style={{ color: EMERALD }} />
                <h2 className="text-lg font-bold" style={{ color: NAVY }}>What Messages Are Sent</h2>
              </div>
              <p className="mb-3" style={{ color: MUTED }}>
                Text messages are strictly limited to service-related, one-to-one follow-up communications arising from a prior phone conversation. Examples include:
              </p>
              <ul className="list-disc pl-6 space-y-2" style={{ color: NAVY }}>
                <li>Sending requested information, quotes, or documentation discussed on the call</li>
                <li>Confirming appointments or meeting times</li>
                <li>Providing a direct contact number or email as requested</li>
                <li>Following up on a missed call with a brief service message</li>
              </ul>
              <div className="rounded-lg p-4 mt-4" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
                <p className="font-semibold mb-2" style={{ color: NAVY }}>Sample Message:</p>
                <p className="italic" style={{ color: MUTED }}>
                  "Sorry we missed your call. How can we help you today?" Reply STOP to opt out.
                </p>
              </div>
            </section>

            <section>
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-5 h-5" style={{ color: EMERALD }} />
                <h2 className="text-lg font-bold" style={{ color: NAVY }}>Message Frequency</h2>
              </div>
              <p style={{ color: MUTED }}>
                Message frequency varies based on the nature of the business conversation. Contacts typically receive <strong>1 to 5 messages per month</strong>, and only in direct relation to an active business discussion. We do not send recurring marketing messages, promotional campaigns, or automated bulk SMS.
              </p>
            </section>

            <section>
              <div className="flex items-center gap-2 mb-3">
                <Ban className="w-5 h-5" style={{ color: "#EF4444" }} />
                <h2 className="text-lg font-bold" style={{ color: NAVY }}>How to Opt Out</h2>
              </div>
              <p className="mb-3" style={{ color: MUTED }}>
                You can opt out of receiving text messages at any time using any of the following methods:
              </p>
              <div className="rounded-lg p-5" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <span className="px-2 py-1 rounded text-xs font-bold" style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444" }}>1</span>
                    <div>
                      <p className="font-semibold" style={{ color: NAVY }}>Reply STOP</p>
                      <p style={{ color: MUTED }}>Text <strong>STOP</strong> to the number that messaged you. You will receive a one-time confirmation: <em>"You have been unsubscribed from Texas Automation Systems messages. No further texts will be sent. Reply START to re-subscribe."</em></p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="px-2 py-1 rounded text-xs font-bold" style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444" }}>2</span>
                    <div>
                      <p className="font-semibold" style={{ color: NAVY }}>Tell a Representative</p>
                      <p style={{ color: MUTED }}>During any phone call, simply inform the representative that you do not wish to receive text messages. Your preference will be recorded immediately.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="px-2 py-1 rounded text-xs font-bold" style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444" }}>3</span>
                    <div>
                      <p className="font-semibold" style={{ color: NAVY }}>Email Us</p>
                      <p style={{ color: MUTED }}>Send an email to <strong>Pivotalgcs@gmail.com</strong> requesting to be removed from text message communications.</p>
                    </div>
                  </div>
                </div>
              </div>
              <p className="mt-3" style={{ color: MUTED }}>
                Opt-out requests are honored <strong>immediately and permanently</strong> unless you explicitly re-subscribe by replying START or requesting to receive messages again.
              </p>
            </section>

            <section>
              <div className="flex items-center gap-2 mb-3">
                <HelpCircle className="w-5 h-5" style={{ color: EMERALD }} />
                <h2 className="text-lg font-bold" style={{ color: NAVY }}>Help & Support</h2>
              </div>
              <div className="rounded-lg p-4" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
                <p className="mb-2" style={{ color: NAVY }}>Text <strong style={{ color: EMERALD }}>HELP</strong> to the number that messaged you for assistance.</p>
                <p className="mb-3 italic" style={{ color: MUTED }}>You will receive: "Texas Automation Systems: For support, email Pivotalgcs@gmail.com or call during business hours. Reply STOP to opt out."</p>
                <p className="font-semibold" style={{ color: NAVY }}>Direct Contact:</p>
                <p style={{ color: MUTED }}>Pivotal Gamechangers LLC</p>
                <p style={{ color: MUTED }}>Email: Pivotalgcs@gmail.com</p>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3" style={{ color: NAVY }}>Message and Data Rates</h2>
              <p style={{ color: MUTED }}>
                Standard message and data rates may apply depending on your wireless carrier and messaging plan. Contact your wireless carrier for details about your specific plan.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3" style={{ color: NAVY }}>Supported Carriers</h2>
              <p style={{ color: MUTED }}>
                Our messaging services are supported on all major U.S. wireless carriers including AT&T, Verizon, T-Mobile, and most regional carriers. Carrier support is subject to change.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3" style={{ color: NAVY }}>No Sharing of Opt-In Data</h2>
              <p style={{ color: MUTED }}>
                We do not sell, rent, or share your phone number, opt-in status, or messaging consent data with any third parties for marketing or promotional purposes. Your consent information is used solely to manage your communication preferences within our platform.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3" style={{ color: NAVY }}>Related Policies</h2>
              <div className="flex flex-col sm:flex-row gap-3">
                <a href="/privacy" className="flex-1 rounded-lg p-4 text-center transition-colors hover:opacity-80" style={{ background: SUBTLE, border: `1px solid ${BORDER}`, color: EMERALD, textDecoration: "none" }} data-testid="link-privacy">
                  <p className="font-bold text-sm">Privacy Policy</p>
                  <p className="text-xs mt-1" style={{ color: MUTED }}>How we collect, use, and protect your data</p>
                </a>
                <a href="/terms" className="flex-1 rounded-lg p-4 text-center transition-colors hover:opacity-80" style={{ background: SUBTLE, border: `1px solid ${BORDER}`, color: EMERALD, textDecoration: "none" }} data-testid="link-terms">
                  <p className="font-bold text-sm">Terms & Conditions</p>
                  <p className="text-xs mt-1" style={{ color: MUTED }}>Full messaging program terms</p>
                </a>
              </div>
            </section>
          </div>
        </div>
      </div>

      <footer className="py-6 px-4 sm:px-6" style={{ borderTop: `1px solid ${BORDER}` }}>
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4" style={{ color: EMERALD }} />
            <span className="text-sm font-bold" style={{ color: NAVY }}>Texas Automation Systems</span>
          </div>
          <div className="flex items-center gap-4 text-xs" style={{ color: MUTED }}>
            <a href="/privacy" className="hover:underline">Privacy Policy</a>
            <a href="/terms" className="hover:underline">Terms & Conditions</a>
          </div>
          <div className="text-xs" style={{ color: MUTED }}>A product by Pivotal Gamechangers LLC</div>
        </div>
      </footer>
    </div>
  );
}
