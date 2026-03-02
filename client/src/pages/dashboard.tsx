import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import type { WebhookLog } from "@shared/schema";
import {
  Activity,
  Send,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  FileAudio,
  Radio,
  ChevronDown,
  ChevronUp,
  Mic,
  Zap,
  BarChart3,
  RefreshCw,
} from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    pending: { variant: "outline", label: "Pending" },
    processing: { variant: "secondary", label: "Processing" },
    downloading: { variant: "secondary", label: "Downloading" },
    transcribing: { variant: "secondary", label: "Transcribing" },
    analyzing: { variant: "secondary", label: "Analyzing" },
    completed: { variant: "default", label: "Completed" },
    error: { variant: "destructive", label: "Error" },
  };

  const { variant, label } = config[status] || { variant: "outline" as const, label: status };

  return (
    <Badge variant={variant} data-testid={`badge-status-${status}`}>
      {(status === "processing" || status === "downloading" || status === "transcribing" || status === "analyzing") && (
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
      )}
      {status === "completed" && <CheckCircle2 className="mr-1 h-3 w-3" />}
      {status === "error" && <XCircle className="mr-1 h-3 w-3" />}
      {label}
    </Badge>
  );
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function formatDuration(ms: number | null) {
  if (!ms) return "--";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function LogDetailRow({ log }: { log: WebhookLog }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="border border-border rounded-md overflow-hidden transition-all"
      data-testid={`log-entry-${log.id}`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 text-left hover-elevate"
        data-testid={`button-expand-log-${log.id}`}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex-shrink-0">
            <StatusBadge status={log.status} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate" data-testid={`text-record-id-${log.id}`}>
                {log.airtableRecordId}
              </span>
              {log.audioFileName && (
                <span className="text-xs text-muted-foreground flex items-center gap-1 flex-shrink-0">
                  <FileAudio className="h-3 w-3" />
                  {log.audioFileName}
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground" data-testid={`text-time-${log.id}`}>
              {formatTime(log.createdAt as unknown as string)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDuration(log.processingTimeMs)}
          </span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border bg-card/50 p-4 space-y-4">
          {log.errorMessage && (
            <div data-testid={`text-error-${log.id}`}>
              <h4 className="text-xs font-medium text-destructive mb-1 uppercase tracking-wider">Error</h4>
              <p className="text-sm bg-destructive/10 text-destructive p-3 rounded-md font-mono">
                {log.errorMessage}
              </p>
            </div>
          )}

          {log.transcription && (
            <div data-testid={`text-transcription-${log.id}`}>
              <h4 className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Transcription</h4>
              <div className="text-sm bg-muted/50 p-3 rounded-md max-h-48 overflow-y-auto leading-relaxed">
                {log.transcription}
              </div>
            </div>
          )}

          {log.analysis && (
            <div data-testid={`text-analysis-${log.id}`}>
              <h4 className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Analysis</h4>
              <div className="text-sm bg-muted/50 p-3 rounded-md max-h-64 overflow-y-auto prose prose-sm max-w-none leading-relaxed">
                {log.analysis.split("\n").map((line, i) => {
                  if (line.startsWith("## ")) {
                    return <h3 key={i} className="text-base font-semibold mt-3 mb-1">{line.replace("## ", "")}</h3>;
                  }
                  if (line.startsWith("### ")) {
                    return <h4 key={i} className="text-sm font-semibold mt-2 mb-1">{line.replace("### ", "")}</h4>;
                  }
                  if (line.startsWith("- ")) {
                    return <li key={i} className="ml-4 text-sm">{line.replace("- ", "")}</li>;
                  }
                  if (line.trim() === "") return <br key={i} />;
                  return <p key={i} className="text-sm">{line}</p>;
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [recordId, setRecordId] = useState("");
  const { toast } = useToast();

  const healthQuery = useQuery<{
    status: string;
    timestamp: string;
    airtable: boolean;
    openai: boolean;
  }>({
    queryKey: ["/api/health"],
    refetchInterval: 30000,
  });

  const logsQuery = useQuery<WebhookLog[]>({
    queryKey: ["/api/webhook-logs"],
    refetchInterval: 5000,
  });

  const triggerMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", "/api/test-webhook", { recordId: id });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Webhook triggered",
        description: `Processing started for ${data.recordId}. Log ID: ${data.logId}`,
      });
      setRecordId("");
      queryClient.invalidateQueries({ queryKey: ["/api/webhook-logs"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Trigger failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const logs = logsQuery.data || [];
  const health = healthQuery.data;

  const stats = {
    total: logs.length,
    completed: logs.filter((l) => l.status === "completed").length,
    errors: logs.filter((l) => l.status === "error").length,
    processing: logs.filter((l) =>
      ["processing", "downloading", "transcribing", "analyzing"].includes(l.status)
    ).length,
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-md">
              <Mic className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight" data-testid="text-app-title">Voice Memo Analyzer</h1>
              <p className="text-xs text-muted-foreground">Airtable webhook processor with AI transcription & analysis</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {health && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className={`h-2 w-2 rounded-full ${health.airtable && health.openai ? "bg-green-500" : "bg-red-500"}`} />
                <span data-testid="text-service-status">
                  {health.airtable && health.openai ? "All services connected" : "Services disconnected"}
                </span>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["/api/webhook-logs"] });
                queryClient.invalidateQueries({ queryKey: ["/api/health"] });
              }}
              data-testid="button-refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card data-testid="card-stat-total">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Total</p>
                  <p className="text-2xl font-semibold tabular-nums mt-1" data-testid="text-stat-total">{stats.total}</p>
                </div>
                <div className="p-2.5 bg-muted rounded-md">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-stat-completed">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Completed</p>
                  <p className="text-2xl font-semibold tabular-nums mt-1" data-testid="text-stat-completed">{stats.completed}</p>
                </div>
                <div className="p-2.5 bg-green-500/10 rounded-md">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-stat-errors">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Errors</p>
                  <p className="text-2xl font-semibold tabular-nums mt-1" data-testid="text-stat-errors">{stats.errors}</p>
                </div>
                <div className="p-2.5 bg-destructive/10 rounded-md">
                  <XCircle className="h-4 w-4 text-destructive" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-stat-processing">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Processing</p>
                  <p className="text-2xl font-semibold tabular-nums mt-1" data-testid="text-stat-processing">{stats.processing}</p>
                </div>
                <div className="p-2.5 bg-primary/10 rounded-md">
                  <Activity className="h-4 w-4 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1" data-testid="card-test-webhook">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                Test Webhook
              </CardTitle>
              <CardDescription>
                Manually trigger processing for an Airtable record
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Enter Airtable Record ID (e.g., recXXXXXXXXXXXXXX)"
                value={recordId}
                onChange={(e) => setRecordId(e.target.value)}
                data-testid="input-record-id"
              />
              <Button
                className="w-full"
                onClick={() => triggerMutation.mutate(recordId)}
                disabled={!recordId.trim() || triggerMutation.isPending}
                data-testid="button-trigger-webhook"
              >
                {triggerMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Trigger Processing
              </Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2" data-testid="card-service-status">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Radio className="h-4 w-4 text-primary" />
                Service Status
              </CardTitle>
              <CardDescription>
                Integration health and connection status
              </CardDescription>
            </CardHeader>
            <CardContent>
              {healthQuery.isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : health ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full ${health.airtable ? "bg-green-500" : "bg-red-500"}`} />
                      <span className="text-sm font-medium" data-testid="text-airtable-status">Airtable</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {health.airtable ? "Connected" : "Not configured"}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full ${health.openai ? "bg-green-500" : "bg-red-500"}`} />
                      <span className="text-sm font-medium" data-testid="text-openai-status">OpenAI (Whisper + GPT)</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {health.openai ? "Connected" : "Not configured"}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        Last checked: {health.timestamp ? new Date(health.timestamp).toLocaleTimeString() : "--"}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">Unable to fetch health status</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card data-testid="card-processing-log">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Processing Log
                </CardTitle>
                <CardDescription>
                  Recent webhook processing activity
                </CardDescription>
              </div>
              {logsQuery.isRefetching && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {logsQuery.isLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-16 bg-muted/50 rounded-md animate-pulse" />
                ))}
              </div>
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="p-3 bg-muted/50 rounded-full mb-3">
                  <FileAudio className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-muted-foreground" data-testid="text-empty-state">
                  No processing logs yet
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Trigger a webhook or send a POST to /api/airtable-webhook
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {logs.map((log) => (
                  <LogDetailRow key={log.id} log={log} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
