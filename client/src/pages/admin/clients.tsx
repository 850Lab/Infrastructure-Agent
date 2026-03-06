import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Users,
  ChevronDown,
  ChevronUp,
  Pencil,
  Save,
  X,
  KeyRound,
  Mail,
  Shield,
  Building2,
  MapPin,
  Loader2,
  Eye,
  EyeOff,
  Power,
  PowerOff,
  UserPlus,
  AtSign,
  Send,
  Globe,
} from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const EMERALD = "#10B981";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";
const AMBER = "#F59E0B";
const RED = "#EF4444";
const BLUE = "#3B82F6";

interface ClientRow {
  id: string;
  clientName: string;
  machineName: string;
  industryConfig: string;
  territory: string;
  decisionMakerFocus: string;
  status: string;
  createdAt: string;
  lastRunAt: string | null;
}

interface UserRow {
  id: string;
  email: string;
  role: string;
  clientId: string;
}

interface EmailSettingsRow {
  fromName: string;
  fromEmail: string;
  smtpHost: string;
  smtpUser: string;
  providerType: string;
  dailyLimit: number;
  autoSendEnabled: boolean;
}

function AddUserForm({ clientId, onAdded }: { clientId: string; onAdded: () => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("operator");
  const [showPassword, setShowPassword] = useState(false);

  const addMutation = useMutation({
    mutationFn: (data: { email: string; password: string; role: string }) =>
      apiRequest("POST", `/api/admin/clients/${clientId}/users`, data),
    onSuccess: () => {
      toast({ title: "User added successfully" });
      setEmail("");
      setPassword("");
      setRole("operator");
      onAdded();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div
      className="rounded-lg p-4 space-y-3"
      style={{ background: "#FFFFFF", border: `1px solid ${EMERALD}33` }}
      data-testid={`add-user-form-${clientId}`}
    >
      <div className="text-xs font-bold uppercase tracking-wider" style={{ color: EMERALD }}>
        Add New User
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: MUTED }}>Email</label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="h-8 text-sm"
            data-testid={`input-new-user-email-${clientId}`}
          />
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: MUTED }}>Password</label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 6 characters"
              className="h-8 text-sm pr-8"
              data-testid={`input-new-user-password-${clientId}`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2"
              data-testid={`button-toggle-new-password-${clientId}`}
            >
              {showPassword ? (
                <EyeOff className="w-3.5 h-3.5" style={{ color: MUTED }} />
              ) : (
                <Eye className="w-3.5 h-3.5" style={{ color: MUTED }} />
              )}
            </button>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: MUTED }}>Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full h-8 text-sm rounded-md px-2"
            style={{ border: `1px solid ${BORDER}`, background: "#FFFFFF", color: TEXT }}
            data-testid={`select-new-user-role-${clientId}`}
          >
            <option value="operator">Operator</option>
            <option value="client_admin">Client Admin</option>
            <option value="manager">Manager</option>
          </select>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => addMutation.mutate({ email, password, role })}
          disabled={addMutation.isPending || !email || password.length < 6}
          className="gap-1 text-xs"
          style={{ background: EMERALD, color: "#FFFFFF" }}
          data-testid={`button-confirm-add-user-${clientId}`}
        >
          {addMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
          Add User
        </Button>
      </div>
    </div>
  );
}

function UserCard({
  user,
  onUpdate,
}: {
  user: UserRow;
  onUpdate: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState(user.role);
  const [resettingPw, setResettingPw] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (data: { email?: string; role?: string }) =>
      apiRequest("PATCH", `/api/admin/users/${user.id}`, data),
    onSuccess: () => {
      toast({ title: "User updated" });
      setEditing(false);
      onUpdate();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resetPwMutation = useMutation({
    mutationFn: (pw: string) =>
      apiRequest("POST", `/api/admin/users/${user.id}/reset-password`, { newPassword: pw }),
    onSuccess: () => {
      toast({ title: "Password reset successfully" });
      setResettingPw(false);
      setNewPassword("");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}
      data-testid={`user-card-${user.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: MUTED }}>Email</label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-8 text-sm"
                  data-testid={`input-edit-email-${user.id}`}
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: MUTED }}>Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full h-8 text-sm rounded-md px-2"
                  style={{ border: `1px solid ${BORDER}`, background: "#FFFFFF", color: TEXT }}
                  data-testid={`select-role-${user.id}`}
                >
                  <option value="operator">Operator</option>
                  <option value="client_admin">Client Admin</option>
                  <option value="manager">Manager</option>
                  <option value="platform_admin">Platform Admin</option>
                </select>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => updateMutation.mutate({ email, role })}
                  disabled={updateMutation.isPending}
                  className="gap-1 text-xs"
                  style={{ background: EMERALD, color: "#FFFFFF" }}
                  data-testid={`button-save-user-${user.id}`}
                >
                  {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setEditing(false); setEmail(user.email); setRole(user.role); }}
                  className="gap-1 text-xs"
                  style={{ borderColor: BORDER, color: MUTED }}
                  data-testid={`button-cancel-edit-${user.id}`}
                >
                  <X className="w-3 h-3" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5" style={{ color: MUTED }} />
                <span className="text-sm font-medium" style={{ color: TEXT }} data-testid={`text-user-email-${user.id}`}>
                  {user.email}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Shield className="w-3.5 h-3.5" style={{ color: MUTED }} />
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                  style={{
                    color: user.role === "platform_admin" ? EMERALD : user.role === "client_admin" ? AMBER : BLUE,
                    background: user.role === "platform_admin" ? "rgba(16,185,129,0.08)" : user.role === "client_admin" ? "rgba(245,158,11,0.08)" : "rgba(59,130,246,0.08)",
                    border: `1px solid ${user.role === "platform_admin" ? "rgba(16,185,129,0.3)" : user.role === "client_admin" ? "rgba(245,158,11,0.3)" : "rgba(59,130,246,0.3)"}`,
                  }}
                  data-testid={`badge-role-${user.id}`}
                >
                  {user.role}
                </span>
              </div>
            </>
          )}

          {resettingPw && (
            <div className="mt-3 space-y-2" style={{ borderTop: `1px solid ${BORDER}`, paddingTop: "0.75rem" }}>
              <label className="text-xs font-medium block" style={{ color: MUTED }}>New Password</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className="h-8 text-sm pr-8"
                    data-testid={`input-new-password-${user.id}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    data-testid={`button-toggle-password-${user.id}`}
                  >
                    {showPassword ? (
                      <EyeOff className="w-3.5 h-3.5" style={{ color: MUTED }} />
                    ) : (
                      <Eye className="w-3.5 h-3.5" style={{ color: MUTED }} />
                    )}
                  </button>
                </div>
                <Button
                  size="sm"
                  onClick={() => resetPwMutation.mutate(newPassword)}
                  disabled={resetPwMutation.isPending || newPassword.length < 6}
                  className="gap-1 text-xs"
                  style={{ background: AMBER, color: "#FFFFFF" }}
                  data-testid={`button-confirm-reset-${user.id}`}
                >
                  {resetPwMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />}
                  Reset
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setResettingPw(false); setNewPassword(""); }}
                  className="text-xs"
                  style={{ borderColor: BORDER, color: MUTED }}
                  data-testid={`button-cancel-reset-${user.id}`}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        {!editing && (
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
              className="gap-1 text-xs h-7 px-2"
              style={{ borderColor: BORDER, color: MUTED }}
              data-testid={`button-edit-user-${user.id}`}
            >
              <Pencil className="w-3 h-3" />
              Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setResettingPw(!resettingPw)}
              className="gap-1 text-xs h-7 px-2"
              style={{ borderColor: BORDER, color: AMBER }}
              data-testid={`button-reset-password-${user.id}`}
            >
              <KeyRound className="w-3 h-3" />
              Password
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function EmailInfoSection({ clientId }: { clientId: string }) {
  const { data, isLoading } = useQuery<{ settings: EmailSettingsRow | null }>({
    queryKey: ["/api/admin/clients", clientId, "email-settings"],
  });

  if (isLoading) {
    return <div className="h-16 rounded-lg animate-pulse" style={{ background: SUBTLE }} />;
  }

  const settings = data?.settings;

  return (
    <div data-testid={`email-info-${clientId}`}>
      <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: MUTED }}>
        <Mail className="w-3.5 h-3.5 inline mr-1" />
        Email Configuration
      </h3>
      {settings ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: MUTED }}>From</div>
            <div className="text-sm font-medium" style={{ color: TEXT }} data-testid={`text-from-name-${clientId}`}>{settings.fromName}</div>
            <div className="text-xs" style={{ color: MUTED }} data-testid={`text-from-email-${clientId}`}>{settings.fromEmail}</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: MUTED }}>SMTP</div>
            <div className="flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5" style={{ color: MUTED }} />
              <span className="text-sm" style={{ color: TEXT }} data-testid={`text-provider-${clientId}`}>
                {settings.providerType}
              </span>
            </div>
            <div className="text-xs mt-0.5" style={{ color: MUTED }}>{settings.smtpHost}</div>
            <div className="text-xs" style={{ color: MUTED }} data-testid={`text-smtp-user-${clientId}`}>{settings.smtpUser}</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: MUTED }}>Sending</div>
            <div className="text-sm" style={{ color: TEXT }}>
              {settings.dailyLimit}/day limit
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase"
                style={{
                  color: settings.autoSendEnabled ? EMERALD : MUTED,
                  background: settings.autoSendEnabled ? "rgba(16,185,129,0.08)" : "rgba(148,163,184,0.08)",
                }}
                data-testid={`badge-autosend-${clientId}`}
              >
                {settings.autoSendEnabled ? "Auto-Send ON" : "Auto-Send OFF"}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg p-4 text-center" style={{ background: SUBTLE, border: `1px dashed ${BORDER}` }}>
          <AtSign className="w-5 h-5 mx-auto mb-2" style={{ color: MUTED }} />
          <p className="text-xs" style={{ color: MUTED }} data-testid={`text-no-email-${clientId}`}>
            No email settings configured. The account operator can set up email from their Email Settings page.
          </p>
        </div>
      )}
    </div>
  );
}

function ClientDetail({ client }: { client: ClientRow }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [editingClient, setEditingClient] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [clientForm, setClientForm] = useState({
    clientName: client.clientName,
    machineName: client.machineName,
    territory: client.territory,
    status: client.status,
    industryConfig: client.industryConfig,
    decisionMakerFocus: client.decisionMakerFocus || "",
  });

  const { data: usersData, isLoading: usersLoading } = useQuery<{ users: UserRow[] }>({
    queryKey: ["/api/admin/clients", client.id, "users"],
    enabled: expanded,
  });

  const updateClientMutation = useMutation({
    mutationFn: (data: Record<string, string>) =>
      apiRequest("PATCH", `/api/admin/clients/${client.id}`, data),
    onSuccess: () => {
      toast({ title: "Client updated" });
      setEditingClient(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/clients"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: (newStatus: string) =>
      apiRequest("PATCH", `/api/admin/clients/${client.id}`, { status: newStatus }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/clients"] });
      toast({ title: `Account ${client.clientName} status updated` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const users = usersData?.users ?? [];

  const statusColor = client.status === "active" ? EMERALD : client.status === "paused" ? AMBER : MUTED;
  const statusBg = client.status === "active" ? "rgba(16,185,129,0.08)" : client.status === "paused" ? "rgba(245,158,11,0.08)" : "rgba(148,163,184,0.08)";
  const statusBorder = client.status === "active" ? "rgba(16,185,129,0.3)" : client.status === "paused" ? "rgba(245,158,11,0.3)" : BORDER;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: `1px solid ${BORDER}`, background: "#FFFFFF" }}
      data-testid={`client-card-${client.id}`}
    >
      <div
        className="flex items-center justify-between p-4"
        data-testid={`client-header-${client.id}`}
      >
        <div
          className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <Building2 className="w-4 h-4 flex-shrink-0" style={{ color: EMERALD }} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm truncate" style={{ color: TEXT }} data-testid={`text-client-name-${client.id}`}>
                {client.clientName}
              </span>
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
                style={{
                  color: statusColor,
                  background: statusBg,
                  border: `1px solid ${statusBorder}`,
                }}
                data-testid={`badge-status-${client.id}`}
              >
                {client.status}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs mt-0.5" style={{ color: MUTED }}>
              <span>{client.machineName}</span>
              <span>{client.territory}</span>
              <span>{client.industryConfig}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {client.status !== "active" && (
            <Button
              size="sm"
              onClick={(e) => { e.stopPropagation(); toggleStatusMutation.mutate("active"); }}
              disabled={toggleStatusMutation.isPending}
              className="gap-1 text-xs h-7 px-3"
              style={{ background: EMERALD, color: "#FFFFFF" }}
              data-testid={`button-activate-${client.id}`}
            >
              {toggleStatusMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
              Activate
            </Button>
          )}

          {client.status === "active" && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => { e.stopPropagation(); toggleStatusMutation.mutate("paused"); }}
              disabled={toggleStatusMutation.isPending}
              className="gap-1 text-xs h-7 px-3"
              style={{ borderColor: BORDER, color: AMBER }}
              data-testid={`button-pause-${client.id}`}
            >
              {toggleStatusMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <PowerOff className="w-3 h-3" />}
              Pause
            </Button>
          )}

          {client.status !== "inactive" && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => { e.stopPropagation(); toggleStatusMutation.mutate("inactive"); }}
              disabled={toggleStatusMutation.isPending}
              className="gap-1 text-xs h-7 px-3"
              style={{ borderColor: BORDER, color: RED }}
              data-testid={`button-deactivate-${client.id}`}
            >
              <PowerOff className="w-3 h-3" />
              Deactivate
            </Button>
          )}

          <div className="cursor-pointer p-1" onClick={() => setExpanded(!expanded)}>
            {expanded ? (
              <ChevronUp className="w-4 h-4" style={{ color: MUTED }} />
            ) : (
              <ChevronDown className="w-4 h-4" style={{ color: MUTED }} />
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="p-4 space-y-6">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: MUTED }}>
                  Client Details
                </h3>
                {!editingClient ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingClient(true)}
                    className="gap-1 text-xs h-7 px-2"
                    style={{ borderColor: BORDER, color: MUTED }}
                    data-testid={`button-edit-client-${client.id}`}
                  >
                    <Pencil className="w-3 h-3" />
                    Edit Client
                  </Button>
                ) : (
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      onClick={() => updateClientMutation.mutate(clientForm)}
                      disabled={updateClientMutation.isPending}
                      className="gap-1 text-xs h-7"
                      style={{ background: EMERALD, color: "#FFFFFF" }}
                      data-testid={`button-save-client-${client.id}`}
                    >
                      {updateClientMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingClient(false);
                        setClientForm({
                          clientName: client.clientName,
                          machineName: client.machineName,
                          territory: client.territory,
                          status: client.status,
                          industryConfig: client.industryConfig,
                          decisionMakerFocus: client.decisionMakerFocus || "",
                        });
                      }}
                      className="gap-1 text-xs h-7"
                      style={{ borderColor: BORDER, color: MUTED }}
                      data-testid={`button-cancel-client-${client.id}`}
                    >
                      <X className="w-3 h-3" />
                      Cancel
                    </Button>
                  </div>
                )}
              </div>

              {editingClient ? (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: MUTED }}>Client Name</label>
                    <Input
                      value={clientForm.clientName}
                      onChange={(e) => setClientForm({ ...clientForm, clientName: e.target.value })}
                      className="h-8 text-sm"
                      data-testid={`input-client-name-${client.id}`}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: MUTED }}>Machine Name</label>
                    <Input
                      value={clientForm.machineName}
                      onChange={(e) => setClientForm({ ...clientForm, machineName: e.target.value })}
                      className="h-8 text-sm"
                      data-testid={`input-machine-name-${client.id}`}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: MUTED }}>Territory</label>
                    <Input
                      value={clientForm.territory}
                      onChange={(e) => setClientForm({ ...clientForm, territory: e.target.value })}
                      className="h-8 text-sm"
                      data-testid={`input-territory-${client.id}`}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: MUTED }}>Status</label>
                    <select
                      value={clientForm.status}
                      onChange={(e) => setClientForm({ ...clientForm, status: e.target.value })}
                      className="w-full h-8 text-sm rounded-md px-2"
                      style={{ border: `1px solid ${BORDER}`, background: "#FFFFFF", color: TEXT }}
                      data-testid={`select-status-${client.id}`}
                    >
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: MUTED }}>Industry</label>
                    <Input
                      value={clientForm.industryConfig}
                      onChange={(e) => setClientForm({ ...clientForm, industryConfig: e.target.value })}
                      className="h-8 text-sm"
                      data-testid={`input-industry-${client.id}`}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: MUTED }}>DM Focus</label>
                    <Input
                      value={clientForm.decisionMakerFocus}
                      onChange={(e) => setClientForm({ ...clientForm, decisionMakerFocus: e.target.value })}
                      className="h-8 text-sm"
                      data-testid={`input-dm-focus-${client.id}`}
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: MUTED }}>Machine</div>
                    <div className="text-sm font-mono" style={{ color: TEXT }}>{client.machineName}</div>
                  </div>
                  <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: MUTED }}>Territory</div>
                    <div className="text-sm" style={{ color: TEXT }}>{client.territory}</div>
                  </div>
                  <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: MUTED }}>Industry</div>
                    <div className="text-sm" style={{ color: TEXT }}>{client.industryConfig}</div>
                  </div>
                  <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: MUTED }}>DM Focus</div>
                    <div className="text-sm" style={{ color: TEXT }}>{client.decisionMakerFocus || "---"}</div>
                  </div>
                  <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: MUTED }}>Created</div>
                    <div className="text-sm" style={{ color: TEXT }}>{new Date(client.createdAt).toLocaleDateString()}</div>
                  </div>
                  <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: MUTED }}>Last Run</div>
                    <div className="text-sm" style={{ color: TEXT }}>
                      {client.lastRunAt ? new Date(client.lastRunAt).toLocaleString() : "Never"}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <EmailInfoSection clientId={client.id} />

            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: MUTED }}>
                  <Users className="w-3.5 h-3.5 inline mr-1" />
                  User Accounts ({users.length})
                </h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowAddUser(!showAddUser)}
                  className="gap-1 text-xs h-7 px-2"
                  style={{ borderColor: showAddUser ? EMERALD : BORDER, color: showAddUser ? EMERALD : MUTED }}
                  data-testid={`button-add-user-${client.id}`}
                >
                  {showAddUser ? <X className="w-3 h-3" /> : <UserPlus className="w-3 h-3" />}
                  {showAddUser ? "Cancel" : "Add User"}
                </Button>
              </div>

              {showAddUser && (
                <div className="mb-3">
                  <AddUserForm
                    clientId={client.id}
                    onAdded={() => {
                      queryClient.invalidateQueries({ queryKey: ["/api/admin/clients", client.id, "users"] });
                      setShowAddUser(false);
                    }}
                  />
                </div>
              )}

              {usersLoading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-16 rounded-lg animate-pulse" style={{ background: SUBTLE }} />
                  ))}
                </div>
              ) : users.length === 0 ? (
                <p className="text-xs py-4 text-center" style={{ color: MUTED }}>
                  No users found for this client. Click "Add User" to create one.
                </p>
              ) : (
                <div className="space-y-2">
                  {users.map((user) => (
                    <UserCard
                      key={user.id}
                      user={user}
                      onUpdate={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/clients", client.id, "users"] })}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
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
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: TEXT }} data-testid="text-clients-title">
              Account Registry
            </h1>
            <p className="text-sm mt-1" style={{ color: MUTED }}>
              Manage accounts, email settings, users, and login credentials
            </p>
          </div>
          <Link href="/admin/provision">
            <button
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ background: EMERALD }}
              data-testid="button-new-client"
            >
              + New Account
            </button>
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }} />
            ))}
          </div>
        ) : clients.length === 0 ? (
          <Card style={{ border: `1px solid ${BORDER}` }}>
            <CardContent>
              <p className="text-sm py-8 text-center" style={{ color: MUTED }}>
                No accounts provisioned yet. Use the Provision page to add your first account.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3" data-testid="clients-list">
            {clients.map((client) => (
              <ClientDetail key={client.id} client={client} />
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
