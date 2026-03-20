import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";

const SCENARIOS = [
  "decision_maker_transfer",
  "gatekeeper_referral",
  "wrong_person_no_referral",
  "hesitation_callback",
  "not_interested",
  "voicemail_expected",
  "other_edge_case",
] as const;

export default function AiCallBotSandboxPage() {
  const { isAuthenticated } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    fullName: "",
    phoneE164: "",
    companyName: "",
    titleOrRole: "",
    relationshipTag: "trusted_tester",
    testScenarioType: "decision_maker_transfer" as (typeof SCENARIOS)[number],
    outreachReason: "Sandbox supervised test call for AI Call Bot readiness.",
    notes: "",
    consentConfirmed: false,
    expectedBehavior: "",
  });

  const contactsQ = useQuery({
    queryKey: ["/api/ai-call-bot/sandbox/contacts"],
    enabled: isAuthenticated,
  });

  const runsQ = useQuery({
    queryKey: ["/api/ai-call-bot/sandbox/runs"],
    enabled: isAuthenticated,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai-call-bot/sandbox/contacts", {
        fullName: form.fullName,
        phoneE164: form.phoneE164,
        companyName: form.companyName,
        titleOrRole: form.titleOrRole || undefined,
        relationshipTag: form.relationshipTag,
        testScenarioType: form.testScenarioType,
        outreachReason: form.outreachReason,
        notes: form.notes || undefined,
        consentConfirmed: form.consentConfirmed,
        expectedBehavior: form.expectedBehavior || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai-call-bot/sandbox/contacts"] });
    },
  });

  const callMut = useMutation({
    mutationFn: async (sandboxContactId: number) => {
      const res = await apiRequest("POST", "/api/ai-call-bot/sandbox/calls", { sandboxContactId });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai-call-bot/sandbox/runs"] });
    },
  });

  const archiveMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/ai-call-bot/sandbox/contacts/${id}/archive`, {});
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/ai-call-bot/sandbox/contacts"] }),
  });

  const contacts = (contactsQ.data as any)?.contacts ?? [];

  return (
    <div className="min-h-screen p-6 max-w-5xl mx-auto" style={{ background: "#0f172a", color: "#e2e8f0" }}>
      <h1 className="text-xl font-semibold mb-1">AI Call Bot — Test sandbox</h1>
      <p className="text-sm mb-6 opacity-80">
        Isolated contacts & dials. Does not use production outreach pipeline. Requires explicit consent checkbox.
      </p>

      <section className="mb-8 p-4 rounded-lg border border-slate-600" style={{ background: "#1e293b" }}>
        <h2 className="font-medium mb-3">Add sandbox contact</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Full name
            <input
              className="block w-full mt-1 px-2 py-1 rounded bg-slate-900 border border-slate-600"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Phone (E.164)
            <input
              className="block w-full mt-1 px-2 py-1 rounded bg-slate-900 border border-slate-600"
              placeholder="+15551234567"
              value={form.phoneE164}
              onChange={(e) => setForm({ ...form, phoneE164: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Company name
            <input
              className="block w-full mt-1 px-2 py-1 rounded bg-slate-900 border border-slate-600"
              value={form.companyName}
              onChange={(e) => setForm({ ...form, companyName: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Title / role
            <input
              className="block w-full mt-1 px-2 py-1 rounded bg-slate-900 border border-slate-600"
              value={form.titleOrRole}
              onChange={(e) => setForm({ ...form, titleOrRole: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Relationship tag
            <input
              className="block w-full mt-1 px-2 py-1 rounded bg-slate-900 border border-slate-600"
              value={form.relationshipTag}
              onChange={(e) => setForm({ ...form, relationshipTag: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Scenario type
            <select
              className="block w-full mt-1 px-2 py-1 rounded bg-slate-900 border border-slate-600"
              value={form.testScenarioType}
              onChange={(e) => setForm({ ...form, testScenarioType: e.target.value as any })}
            >
              {SCENARIOS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm md:col-span-2">
            Outreach reason (≥3 chars)
            <input
              className="block w-full mt-1 px-2 py-1 rounded bg-slate-900 border border-slate-600"
              value={form.outreachReason}
              onChange={(e) => setForm({ ...form, outreachReason: e.target.value })}
            />
          </label>
          <label className="text-sm md:col-span-2">
            Notes
            <textarea
              className="block w-full mt-1 px-2 py-1 rounded bg-slate-900 border border-slate-600"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <label className="text-sm md:col-span-2">
            Expected behavior (optional)
            <input
              className="block w-full mt-1 px-2 py-1 rounded bg-slate-900 border border-slate-600"
              value={form.expectedBehavior}
              onChange={(e) => setForm({ ...form, expectedBehavior: e.target.value })}
            />
          </label>
        </div>
        <label className="flex items-center gap-2 mt-4 text-sm">
          <input
            type="checkbox"
            checked={form.consentConfirmed}
            onChange={(e) => setForm({ ...form, consentConfirmed: e.target.checked })}
          />
          I confirm this person has opted in to receive this test call (consent_confirmed).
        </label>
        <button
          type="button"
          className="mt-4 px-4 py-2 rounded bg-emerald-600 text-white text-sm disabled:opacity-40"
          disabled={!form.consentConfirmed || createMut.isPending}
          onClick={() => createMut.mutate()}
        >
          Create contact
        </button>
        {createMut.isError && (
          <p className="text-red-400 text-sm mt-2">{(createMut.error as Error).message}</p>
        )}
      </section>

      <section className="mb-8">
        <h2 className="font-medium mb-2">Sandbox contacts</h2>
        {contactsQ.isLoading ? (
          <p className="text-sm opacity-70">Loading…</p>
        ) : (
          <div className="overflow-x-auto border border-slate-600 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-600 bg-slate-800">
                  <th className="p-2">ID</th>
                  <th className="p-2">Name</th>
                  <th className="p-2">Phone</th>
                  <th className="p-2">Scenario</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c: any) => (
                  <tr key={c.id} className="border-b border-slate-700">
                    <td className="p-2">{c.id}</td>
                    <td className="p-2">{c.fullName}</td>
                    <td className="p-2 font-mono text-xs">{c.phoneE164}</td>
                    <td className="p-2">{c.testScenarioType}</td>
                    <td className="p-2 flex gap-2 flex-wrap">
                      <button
                        type="button"
                        className="px-2 py-1 rounded bg-sky-600 text-xs"
                        onClick={() => callMut.mutate(c.id)}
                        disabled={callMut.isPending}
                      >
                        Test call
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 rounded bg-slate-600 text-xs"
                        onClick={() => archiveMut.mutate(c.id)}
                        disabled={archiveMut.isPending}
                      >
                        Archive
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {callMut.isError && <p className="text-red-400 text-sm mt-2">{(callMut.error as Error).message}</p>}
        {callMut.isSuccess && (
          <p className="text-emerald-400 text-sm mt-2">
            Call started — SID {(callMut.data as any)?.sid}, session {(callMut.data as any)?.aiCallBotSessionId}
          </p>
        )}
      </section>

      <section>
        <h2 className="font-medium mb-2">Recent sandbox runs</h2>
        {runsQ.isLoading ? (
          <p className="text-sm opacity-70">Loading…</p>
        ) : (
          <pre className="text-xs p-3 rounded border border-slate-600 overflow-auto max-h-96 bg-slate-900">
            {JSON.stringify((runsQ.data as any)?.runs ?? [], null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}
