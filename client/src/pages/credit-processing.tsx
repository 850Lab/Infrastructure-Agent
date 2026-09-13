import { useQuery } from "@tanstack/react-query";
import AppLayout from "@/components/app-layout";
import {
  CheckCircle2,
  FileLock2,
  FileText,
  FlaskConical,
  IdCard,
  Loader2,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";

const TEXT = "#0F172A";
const MUTED = "#64748B";
const BORDER = "#E2E8F0";
const GREEN = "#10B981";
const AMBER = "#F59E0B";

interface CreditStatus {
  foundationReady: boolean;
  enabled: boolean;
  mode: "synthetic_only";
  realUploadsEnabled: boolean;
  storageConnected: boolean;
  aiDocumentProcessingEnabled: boolean;
}

const documentSlots = [
  { label: "TransUnion report", icon: FileText },
  { label: "Experian report", icon: FileText },
  { label: "Equifax report", icon: FileText },
  { label: "Government ID", icon: IdCard },
  { label: "Proof of address", icon: FileText },
];

export default function CreditProcessingPage() {
  const { data: status, isLoading, isError } = useQuery<CreditStatus>({
    queryKey: ["/api/credit/status"],
    retry: false,
  });

  const locked = !status?.realUploadsEnabled;

  return (
    <AppLayout>
      <div className="px-4 py-6 sm:px-6" data-testid="page-credit-processing">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <FileLock2 className="w-5 h-5" style={{ color: GREEN }} />
                <h1 className="text-xl font-bold" style={{ color: TEXT }}>Credit Processing</h1>
              </div>
              <p className="text-sm" style={{ color: MUTED }}>
                Secure intake, report analysis, client questions, and dispute packages.
              </p>
            </div>
            <div
              className="inline-flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-xs font-semibold"
              style={{ color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A" }}
            >
              <FlaskConical className="w-3.5 h-3.5" />
              Synthetic testing only
            </div>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: GREEN }} />
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3 mb-6">
                <StatusCard
                  title="Foundation"
                  ready={Boolean(status?.foundationReady)}
                  detail={status?.foundationReady ? "Installed" : "Unavailable"}
                />
                <StatusCard
                  title="Secure storage"
                  ready={Boolean(status?.storageConnected)}
                  detail={status?.storageConnected ? "Connected" : "Not connected"}
                />
                <StatusCard
                  title="Document AI"
                  ready={Boolean(status?.aiDocumentProcessingEnabled)}
                  detail={status?.aiDocumentProcessingEnabled ? "Connected" : "Not connected"}
                />
              </div>

              <section className="rounded-xl bg-white p-5 sm:p-6 mb-5" style={{ border: `1px solid ${BORDER}` }}>
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div>
                    <h2 className="text-base font-bold" style={{ color: TEXT }}>New client case</h2>
                    <p className="text-sm mt-1" style={{ color: MUTED }}>
                      These are the five documents the completed system will collect.
                    </p>
                  </div>
                  <LockKeyhole className="w-5 h-5 shrink-0" style={{ color: AMBER }} />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {documentSlots.map(({ label, icon: Icon }) => (
                    <div
                      key={label}
                      className="flex items-center justify-between rounded-lg px-4 py-3"
                      style={{ background: "#F8FAFC", border: `1px solid ${BORDER}` }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-md flex items-center justify-center bg-white" style={{ border: `1px solid ${BORDER}` }}>
                          <Icon className="w-4 h-4" style={{ color: MUTED }} />
                        </div>
                        <span className="text-sm font-medium" style={{ color: TEXT }}>{label}</span>
                      </div>
                      <span className="text-[11px] font-semibold" style={{ color: AMBER }}>LOCKED</span>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  disabled={locked}
                  className="mt-5 w-full rounded-lg px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed"
                  style={{
                    color: locked ? "#94A3B8" : "white",
                    background: locked ? "#F1F5F9" : GREEN,
                    border: `1px solid ${locked ? BORDER : GREEN}`,
                  }}
                  data-testid="button-start-credit-case"
                >
                  Uploads remain locked until storage passes security review
                </button>
              </section>

              <section className="rounded-xl p-5 sm:p-6" style={{ background: "#ECFDF5", border: "1px solid #A7F3D0" }}>
                <div className="flex gap-3">
                  <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "#047857" }} />
                  <div>
                    <h2 className="text-sm font-bold" style={{ color: "#065F46" }}>Safety lock is working</h2>
                    <p className="text-sm mt-1" style={{ color: "#047857" }}>
                      This page cannot accept a real credit report, ID, or bill yet. That prevents accidental exposure while we connect encrypted storage and verify access controls.
                    </p>
                  </div>
                </div>
              </section>

              {isError && (
                <p className="mt-4 text-xs" style={{ color: "#B91C1C" }}>
                  The safety-status endpoint could not be reached. Uploads remain locked.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function StatusCard({ title, ready, detail }: { title: string; ready: boolean; detail: string }) {
  return (
    <div className="rounded-xl bg-white p-4" style={{ border: `1px solid ${BORDER}` }}>
      <div className="flex items-center gap-2">
        {ready ? (
          <CheckCircle2 className="w-4 h-4" style={{ color: GREEN }} />
        ) : (
          <LockKeyhole className="w-4 h-4" style={{ color: AMBER }} />
        )}
        <span className="text-xs font-semibold" style={{ color: MUTED }}>{title}</span>
      </div>
      <p className="mt-2 text-sm font-bold" style={{ color: TEXT }}>{detail}</p>
    </div>
  );
}
