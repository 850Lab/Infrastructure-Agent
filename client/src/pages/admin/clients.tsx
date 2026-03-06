import { useQuery } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";
import { Link } from "wouter";

interface ClientRow {
  id: string;
  clientName: string;
  machineName: string;
  industryConfig: string;
  territory: string;
  status: string;
  createdAt: string;
  lastRunAt: string | null;
}

export default function AdminClients() {
  const { data, isLoading } = useQuery<{ clients: ClientRow[] }>({
    queryKey: ["/api/admin/clients"],
  });

  const clients = data?.clients ?? [];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#0F172A" }} data-testid="text-clients-title">
              Client Registry
            </h1>
            <p className="text-sm mt-1" style={{ color: "#94A3B8" }}>
              All machines in the network
            </p>
          </div>
          <Link href="/admin/provision">
            <button
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ background: "#10B981" }}
              data-testid="button-new-client"
            >
              + New Client
            </button>
          </Link>
        </div>

        <Card style={{ border: "1px solid #E2E8F0" }}>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ color: "#0F172A" }}>
              <Users className="w-4 h-4" style={{ color: "#10B981" }} />
              Registered Clients ({clients.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 rounded animate-pulse" style={{ background: "#F8FAFC" }} />
                ))}
              </div>
            ) : clients.length === 0 ? (
              <p className="text-sm py-8 text-center" style={{ color: "#94A3B8" }}>
                No clients provisioned yet. Use the Provision page to add your first client.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid #E2E8F0" }}>
                      <th className="text-left py-2 px-3 font-semibold" style={{ color: "#64748B" }}>Client</th>
                      <th className="text-left py-2 px-3 font-semibold" style={{ color: "#64748B" }}>Machine</th>
                      <th className="text-left py-2 px-3 font-semibold" style={{ color: "#64748B" }}>Industry</th>
                      <th className="text-left py-2 px-3 font-semibold" style={{ color: "#64748B" }}>Territory</th>
                      <th className="text-left py-2 px-3 font-semibold" style={{ color: "#64748B" }}>Status</th>
                      <th className="text-left py-2 px-3 font-semibold" style={{ color: "#64748B" }}>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((client) => (
                      <tr key={client.id} style={{ borderBottom: "1px solid #F1F5F9" }} data-testid={`row-client-${client.id}`}>
                        <td className="py-3 px-3 font-medium" style={{ color: "#0F172A" }}>{client.clientName}</td>
                        <td className="py-3 px-3 font-mono text-xs" style={{ color: "#64748B" }}>{client.machineName}</td>
                        <td className="py-3 px-3" style={{ color: "#64748B" }}>{client.industryConfig}</td>
                        <td className="py-3 px-3" style={{ color: "#64748B" }}>{client.territory}</td>
                        <td className="py-3 px-3">
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-semibold"
                            style={{
                              color: client.status === "active" ? "#10B981" : "#94A3B8",
                              background: client.status === "active" ? "rgba(16,185,129,0.08)" : "rgba(148,163,184,0.08)",
                            }}
                          >
                            {client.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-xs" style={{ color: "#94A3B8" }}>
                          {new Date(client.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
