import { useLocation } from "wouter";
import { Target, ArrowLeft } from "lucide-react";

const NAVY = "#0F172A";
const EMERALD = "#10B981";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const WHITE = "#FFFFFF";

export default function TermsPage() {
  const [, navigate] = useLocation();

  return (
    <div style={{ background: WHITE, color: NAVY, minHeight: "100vh" }} data-testid="terms-page">
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
          <h1 className="text-3xl font-bold mb-2" style={{ color: NAVY }}>Terms and Conditions</h1>
          <p className="text-sm mb-8" style={{ color: MUTED }}>Last updated: March 9, 2026</p>

          <div className="space-y-8 text-sm leading-relaxed" style={{ color: NAVY }}>
            <section>
              <h2 className="text-lg font-bold mb-3">1. Program Overview</h2>
              <p style={{ color: MUTED }}>
                Texas Automation Systems is a B2B sales workflow automation platform operated by Pivotal Gamechangers LLC. The platform provides voice calling, text messaging, email, and analytics capabilities to help businesses manage their sales outreach and client communications.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">2. Messaging Program</h2>
              <p className="mb-3" style={{ color: MUTED }}>
                By opting in to receive text messages from Texas Automation Systems or its clients, you agree to the following:
              </p>
              <ul className="list-disc pl-6 space-y-2" style={{ color: MUTED }}>
                <li><strong style={{ color: NAVY }}>Program Name:</strong> Texas Automation Systems Business Messaging</li>
                <li><strong style={{ color: NAVY }}>Description:</strong> Follow-up text messages related to business conversations, including requested information, meeting confirmations, documentation, and appointment reminders.</li>
                <li><strong style={{ color: NAVY }}>Message Frequency:</strong> Message frequency varies. You may receive up to 5 messages per month related to ongoing business conversations.</li>
                <li><strong style={{ color: NAVY }}>Message and Data Rates:</strong> Standard message and data rates may apply. Contact your wireless carrier for details about your messaging plan.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">3. Consent</h2>
              <p style={{ color: MUTED }}>
                Consent to receive text messages is obtained through verbal agreement during a live phone conversation with a sales representative. You are not required to consent to text messaging as a condition of purchasing any goods or services. Consent applies only to the specific business relationship discussed during the call.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">4. Opt-Out Instructions</h2>
              <p style={{ color: MUTED }}>
                You can opt out of receiving text messages at any time using any of the following methods:
              </p>
              <div className="mt-3 rounded-lg p-4" style={{ background: "#F8FAFC", border: `1px solid ${BORDER}` }}>
                <p className="mb-2"><strong>Text <span style={{ color: EMERALD }}>STOP</span></strong> to the number that messaged you to immediately stop all text messages.</p>
                <p className="mb-2">After sending STOP, you will receive a one-time confirmation message: <em>"You have been unsubscribed from Texas Automation Systems messages. No further texts will be sent. Reply START to re-subscribe."</em></p>
                <p>You may also inform any representative during a phone call that you do not wish to receive text messages.</p>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">5. Help and Support</h2>
              <div className="rounded-lg p-4" style={{ background: "#F8FAFC", border: `1px solid ${BORDER}` }}>
                <p className="mb-2">Text <strong><span style={{ color: EMERALD }}>HELP</span></strong> to the number that messaged you for assistance.</p>
                <p className="mb-2">You will receive: <em>"Texas Automation Systems: For support, email Pivotalgcs@gmail.com or call during business hours. Reply STOP to opt out."</em></p>
                <p>You may also contact us directly:</p>
                <p className="mt-2 font-semibold" style={{ color: NAVY }}>Pivotal Gamechangers LLC</p>
                <p style={{ color: MUTED }}>Email: Pivotalgcs@gmail.com</p>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">6. Supported Carriers</h2>
              <p style={{ color: MUTED }}>
                Our messaging services are supported on all major U.S. wireless carriers including AT&T, Verizon, T-Mobile, Sprint, and most regional carriers. Carrier support is subject to change.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">7. Voice Calling</h2>
              <p style={{ color: MUTED }}>
                Our platform facilitates human-initiated, one-on-one business phone calls. All calls are made by individual sales representatives using click-to-call functionality. Calls are not auto-dialed. Call recording, when applicable, is disclosed at the beginning of the call and requires verbal consent.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">8. Do Not Contact Policy</h2>
              <p style={{ color: MUTED }}>
                We maintain an internal Do Not Contact list. Any contact who requests to not be contacted — whether by phone, text, or email — is immediately added to this list. We check this list and applicable Do Not Call registries before initiating any communication. Opt-out requests are honored permanently unless the contact explicitly re-subscribes.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">9. Privacy</h2>
              <p style={{ color: MUTED }}>
                Your privacy is important to us. Please review our <a href="/privacy" className="underline" style={{ color: EMERALD }}>Privacy Policy</a> for details on how we collect, use, and protect your information. We do not sell or share your personal information with third parties for marketing purposes.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">10. Modifications</h2>
              <p style={{ color: MUTED }}>
                We reserve the right to modify these Terms and Conditions at any time. Changes will be posted on this page with an updated revision date. Continued participation in the messaging program after modifications constitutes acceptance of the updated terms.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold mb-3">11. Contact Information</h2>
              <div className="rounded-lg p-4" style={{ background: "#F8FAFC", border: `1px solid ${BORDER}` }}>
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
