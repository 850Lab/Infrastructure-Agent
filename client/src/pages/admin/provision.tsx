import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlusCircle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ProvisionResult {
  success: boolean;
  client: { id: string; clientName: string; machineName: string };
  user: { id: string; email: string; role: string };
}

export default function AdminProvision() {
  const { toast } = useToast();
  const [form, setForm] = useState({
    clientName: "",
    machineName: "",
    industryConfig: "industrial",
    territory: "",
    decisionMakerFocus: "",
    userEmail: "",
    userPassword: "",
  });
  const [result, setResult] = useState<ProvisionResult | null>(null);

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await apiRequest("POST", "/api/admin/provision", data);
      return res.json();
    },
    onSuccess: (data: ProvisionResult) => {
      setResult(data);
      toast({ title: "Client provisioned", description: `${data.client.clientName} is now live.` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
    },
    onError: (err: any) => {
      toast({ title: "Provision failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(form);
  };

  const update = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }));

  if (result) {
    return (
      <AdminLayout>
        <div className="max-w-lg mx-auto mt-12">
          <Card style={{ border: "1px solid #E2E8F0" }}>
            <CardContent className="p-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center" style={{ background: "rgba(16,185,129,0.08)" }}>
                <CheckCircle2 className="w-7 h-7" style={{ color: "#10B981" }} />
              </div>
              <h2 className="text-xl font-bold" style={{ color: "#0F172A" }} data-testid="text-provision-success">Client Provisioned</h2>
              <div className="text-sm space-y-1" style={{ color: "#64748B" }}>
                <p><strong>Client:</strong> {result.client.clientName}</p>
                <p><strong>Machine:</strong> {result.client.machineName}</p>
                <p><strong>User:</strong> {result.user.email} ({result.user.role})</p>
              </div>
              <Button
                onClick={() => { setResult(null); setForm({ clientName: "", machineName: "", industryConfig: "industrial", territory: "", decisionMakerFocus: "", userEmail: "", userPassword: "" }); }}
                style={{ background: "#10B981", color: "white" }}
                data-testid="button-provision-another"
              >
                Provision Another
              </Button>
            </CardContent>
          </Card>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-lg mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#0F172A" }} data-testid="text-provision-title">
            Provision New Client
          </h1>
          <p className="text-sm mt-1" style={{ color: "#94A3B8" }}>
            Create a new client machine and operator account
          </p>
        </div>

        <Card style={{ border: "1px solid #E2E8F0" }}>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ color: "#0F172A" }}>
              <PlusCircle className="w-4 h-4" style={{ color: "#10B981" }} />
              Client Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label style={{ color: "#0F172A" }}>Client Name</Label>
                <Input
                  value={form.clientName}
                  onChange={(e) => update("clientName", e.target.value)}
                  placeholder="Texas Cool Down Trailers"
                  required
                  data-testid="input-client-name"
                />
              </div>

              <div className="space-y-2">
                <Label style={{ color: "#0F172A" }}>Machine Name</Label>
                <Input
                  value={form.machineName}
                  onChange={(e) => update("machineName", e.target.value)}
                  placeholder="Gulf Coast Heat Mitigation Engine"
                  required
                  data-testid="input-machine-name"
                />
              </div>

              <div className="space-y-2">
                <Label style={{ color: "#0F172A" }}>Industry</Label>
                <select
                  value={form.industryConfig}
                  onChange={(e) => update("industryConfig", e.target.value)}
                  className="w-full px-3 py-2 rounded-md text-sm"
                  style={{ border: "1px solid #E2E8F0", color: "#0F172A" }}
                  data-testid="select-industry"
                >
                  <option value="industrial">Industrial</option>
                  <option value="saas">SaaS</option>
                  <option value="real-estate">Real Estate</option>
                  <option value="agency">Agency</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label style={{ color: "#0F172A" }}>Territory</Label>
                <Input
                  value={form.territory}
                  onChange={(e) => update("territory", e.target.value)}
                  placeholder="Gulf Coast"
                  required
                  data-testid="input-territory"
                />
              </div>

              <div className="space-y-2">
                <Label style={{ color: "#0F172A" }}>Decision Maker Focus</Label>
                <Input
                  value={form.decisionMakerFocus}
                  onChange={(e) => update("decisionMakerFocus", e.target.value)}
                  placeholder="Safety + Site Operations"
                  required
                  data-testid="input-dm-focus"
                />
              </div>

              <div className="pt-4" style={{ borderTop: "1px solid #E2E8F0" }}>
                <p className="text-xs font-semibold mb-3" style={{ color: "#64748B" }}>OPERATOR ACCOUNT</p>
              </div>

              <div className="space-y-2">
                <Label style={{ color: "#0F172A" }}>User Email</Label>
                <Input
                  type="email"
                  value={form.userEmail}
                  onChange={(e) => update("userEmail", e.target.value)}
                  placeholder="operator@client.com"
                  required
                  data-testid="input-user-email"
                />
              </div>

              <div className="space-y-2">
                <Label style={{ color: "#0F172A" }}>Password</Label>
                <Input
                  type="password"
                  value={form.userPassword}
                  onChange={(e) => update("userPassword", e.target.value)}
                  placeholder="Min 6 characters"
                  required
                  minLength={6}
                  data-testid="input-user-password"
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={mutation.isPending}
                style={{ background: "#10B981", color: "white" }}
                data-testid="button-provision-submit"
              >
                {mutation.isPending ? "Provisioning..." : "Provision Client"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
