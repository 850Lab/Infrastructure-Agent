import { useLocation } from "wouter";
import { Target, ArrowLeft } from "lucide-react";

const NAVY = "#0F172A";
const EMERALD = "#10B981";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const WHITE = "#FFFFFF";

export default function PrivacyPage() {
  const [, navigate] = useLocation();

  return (
    <div style={{ background: WHITE, color: NAVY, minHeight: "100vh" }} data-testid="privacy-page">
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
          <h1 className="text-3xl font-bold mb-2" style={{ color: NAVY }}>Privacy Policy</h1>
          <p className="text-sm mb-8" style={{ color: MUTED }}>Last updated: March 9, 2026</p>

          <div className="space-y-8 text-sm leading-relaxed" style={{ color: NAVY }}>
            <section>
              <h2 className="text-lg font-bold mb-3">1. Introduction</h2>
              <p style={{ color: MUTED }}>
                Pivotal Gamechangers LLC ("we," "us," or "our") operates Texas Automation Systems, a business-to-business (B2B) sales workflow automation platform. This Privacy Policy describes how we collect, use, and protect information in connection with our services, including voice calling and text messaging features.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">2. Information We Collect</h2>
              <p className="mb-3" style={{ color: MUTED }}>We collect the following categories of information:</p>
              <ul className="list-disc pl-6 space-y-2" style={{ color: MUTED }}>
                <li><strong style={{ color: NAVY }}>Business Contact Information:</strong> Names, job titles, business phone numbers, and business email addresses of contacts at companies our clients engage with.</li>
                <li><strong style={{ color: NAVY }}>Company Information:</strong> Business names, addresses, industry classifications, and publicly available company data.</li>
                <li><strong style={{ color: NAVY }}>Communication Records:</strong> Call recordings (with consent), call transcriptions, email correspondence, and text messages exchanged through the platform.</li>
                <li><strong style={{ color: NAVY }}>Usage Data:</strong> Platform login activity, feature usage, and interaction logs for our clients and their authorized users.</li>
                <li><strong style={{ color: NAVY }}>Demo Request Information:</strong> Name, company, email, and phone number submitted through our website contact form.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">3. How We Use Information</h2>
              <ul className="list-disc pl-6 space-y-2" style={{ color: MUTED }}>
                <li>To provide and operate our B2B sales automation platform</li>
                <li>To facilitate voice calls and text messages on behalf of our clients</li>
                <li>To generate call transcriptions and AI-powered conversation analysis</li>
                <li>To maintain compliance records, including consent logs and opt-out requests</li>
                <li>To improve our platform and develop new features</li>
                <li>To respond to demo requests and support inquiries</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">4. Information Sharing</h2>
              <p style={{ color: MUTED }}>
                We do not sell, rent, or trade personal information to third parties for marketing purposes. We may share information with:
              </p>
              <ul className="list-disc pl-6 space-y-2 mt-3" style={{ color: MUTED }}>
                <li><strong style={{ color: NAVY }}>Service Providers:</strong> Third-party services that help us operate our platform, including Twilio (voice and messaging), OpenAI (transcription and analysis), and cloud hosting providers. These providers are contractually obligated to protect your information.</li>
                <li><strong style={{ color: NAVY }}>Our Clients:</strong> Business contact information and communication records are accessible to the client organization whose sales team initiated the contact.</li>
                <li><strong style={{ color: NAVY }}>Legal Requirements:</strong> When required by law, regulation, or legal process.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">5. Voice Calls and Recordings</h2>
              <p style={{ color: MUTED }}>
                Our platform enables human-initiated, one-on-one business calls through Twilio's voice API. Calls may be recorded for quality assurance and training purposes. Recording consent is obtained verbally at the beginning of each call and logged in our compliance audit trail. Call recordings and transcriptions are stored securely and accessible only to authorized users within the client organization.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">6. Text Messaging</h2>
              <p style={{ color: MUTED }}>
                Text messages are sent only to business contacts who have provided verbal consent during a live phone conversation with a sales representative. Message frequency varies based on business needs but is typically limited to follow-up communications such as sending requested information, confirming appointments, or sharing documentation. Standard message and data rates may apply. You can opt out of text messages at any time by replying STOP.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">7. Opt-Out and Do Not Contact</h2>
              <p style={{ color: MUTED }}>
                We maintain an internal Do Not Contact list. If a business contact requests to not be contacted, they are immediately added to this list and no further calls, emails, or text messages will be sent. To request removal from our contact lists, you may:
              </p>
              <ul className="list-disc pl-6 space-y-2 mt-3" style={{ color: MUTED }}>
                <li>Tell the representative during a phone call</li>
                <li>Reply STOP to any text message</li>
                <li>Email us at the address provided below</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">8. Data Security</h2>
              <p style={{ color: MUTED }}>
                We implement reasonable technical and organizational measures to protect information against unauthorized access, alteration, disclosure, or destruction. This includes encrypted data transmission, secure cloud hosting, access controls, and regular security reviews.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">9. Data Retention</h2>
              <p style={{ color: MUTED }}>
                We retain business contact information and communication records for as long as necessary to provide our services and comply with legal obligations. Call recordings are retained in accordance with our client agreements. Data associated with contacts on our Do Not Contact list is retained solely to ensure continued compliance with their opt-out request.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">10. Changes to This Policy</h2>
              <p style={{ color: MUTED }}>
                We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated revision date. Continued use of our services after changes constitutes acceptance of the updated policy.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">11. Contact Us</h2>
              <p style={{ color: MUTED }}>
                If you have questions about this Privacy Policy or wish to exercise your rights regarding your information, please contact us:
              </p>
              <div className="mt-3 rounded-lg p-4" style={{ background: "#F8FAFC", border: `1px solid ${BORDER}` }}>
                <p className="font-semibold" style={{ color: NAVY }}>Pivotal Gamechangers LLC</p>
                <p style={{ color: MUTED }}>Texas Automation Systems</p>
                <p style={{ color: MUTED }}>Email: Pivotalgcs@gmail.com</p>
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
          <div className="text-xs" style={{ color: MUTED }}>A product by Pivotal Gamechangers LLC</div>
        </div>
      </footer>
    </div>
  );
}
