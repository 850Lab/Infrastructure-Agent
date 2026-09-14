import {
  Building2,
  FileText,
  IdCard,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";

const documents = [
  { label: "TransUnion credit report", detail: "PDF · up to 75 MB", icon: FileText },
  { label: "Experian credit report", detail: "PDF · up to 75 MB", icon: FileText },
  { label: "Equifax credit report", detail: "PDF · up to 75 MB", icon: FileText },
  { label: "Government-issued ID", detail: "PDF, JPG or PNG · up to 20 MB", icon: IdCard },
  { label: "Proof of current address", detail: "PDF, JPG or PNG · up to 20 MB", icon: Building2 },
];

export default function CreditIntakeDemoPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4 sm:px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-bold">Secure Credit Intake</p>
            <p className="text-xs text-slate-500">Protected document portal</p>
          </div>
          <span className="ml-auto rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">
            Preview
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
        <section className="mb-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-700">Sample case CR-0001</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Upload your documents</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
            Submit all three credit reports, your ID, and proof of address so your file can be reviewed.
          </p>
        </section>

        <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-bold">Document progress</p>
              <p className="mt-0.5 text-xs text-slate-500">Complete all five items</p>
            </div>
            <p className="text-sm font-bold text-slate-500">0 of 5</p>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-label="Zero of five documents uploaded">
            <div className="h-full w-0 bg-emerald-600" />
          </div>
        </section>

        <section className="space-y-3" aria-label="Required documents">
          {documents.map(({ label, detail, icon: Icon }, index) => (
            <article key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold"><span className="mr-1 text-slate-400">{index + 1}.</span> {label}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{detail}</p>
                </div>
                <LockKeyhole className="h-4 w-4 shrink-0 text-amber-600" aria-label="Upload locked" />
              </div>
              <button
                type="button"
                disabled
                className="mt-3 w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-400"
              >
                Upload temporarily locked
              </button>
            </article>
          ))}
        </section>

        <section className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-bold text-emerald-900">Your privacy comes first</h2>
              <p className="mt-1 text-xs leading-5 text-emerald-800">
                This preview cannot accept files. Live uploads will remain unavailable until encrypted storage, malware scanning, and access testing are complete.
              </p>
            </div>
          </div>
        </section>

        <p className="mt-6 text-center text-xs text-slate-400">Synthetic preview only · Do not enter real personal information</p>
      </div>
    </main>
  );
}
