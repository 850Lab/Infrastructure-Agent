import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  RefreshCw,
  Search,
  Zap,
  Target,
  Building2,
  Phone,
  Globe,
  MapPin,
  BarChart3,
  Play,
  Star,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";

function ScoreBadge({ score }: { score: number }) {
  if (score >= 80) return <Badge variant="default" className="bg-green-600" data-testid={`badge-score-${score}`}>{score}</Badge>;
  if (score >= 60) return <Badge variant="default" className="bg-yellow-600" data-testid={`badge-score-${score}`}>{score}</Badge>;
  if (score >= 40) return <Badge variant="secondary" data-testid={`badge-score-${score}`}>{score}</Badge>;
  return <Badge variant="outline" data-testid={`badge-score-${score}`}>{score}</Badge>;
}

export default function ActiveWork() {
  const [testUrl, setTestUrl] = useState("");
  const [testName, setTestName] = useState("");
  const { toast } = useToast();

  const configQuery = useQuery<{
    geos: Array<{ city: string; state: string }>;
    keywords: string[];
    totalPossibleQueries: number;
  }>({
    queryKey: ["/api/active-work/config"],
  });

  const highScoreQuery = useQuery<{
    count: number;
    companies: Array<{
      id: string;
      name: string;
      phone: string;
      website: string;
      score: number;
      reasoning: string;
      city: string;
      state: string;
    }>;
  }>({
    queryKey: ["/api/active-work/high-score"],
  });

  const generateMutation = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const res = await apiRequest("POST", `/api/active-work/generate-queries?dryRun=${dryRun}`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.dryRun ? "Query preview ready" : "Queries generated",
        description: `${data.totalQueries} queries ${data.dryRun ? "previewed" : "written to Airtable"}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    },
  });

  const scoreMutation = useMutation({
    mutationFn: async ({ url, companyName }: { url: string; companyName: string }) => {
      const res = await apiRequest("POST", "/api/active-work/score-company", { url, companyName });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: `Score: ${data.score}/100`,
        description: data.reasoning,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Scoring failed", description: error.message, variant: "destructive" });
    },
  });

  const batchScoreMutation = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const res = await apiRequest("POST", "/api/active-work/score-batch", { limit: 20, dryRun });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/active-work/high-score"] });
      toast({
        title: data.dryRun ? "Preview ready" : "Batch scoring complete",
        description: `${data.dryRun ? data.companiesFound : data.scored} companies ${data.dryRun ? "found" : "scored"}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Batch scoring failed", description: error.message, variant: "destructive" });
    },
  });

  const rotateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/active-work/rotate-queries");
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Query rotation complete",
        description: `${data.disabled} disabled, ${data.generated} new queries generated`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Rotation failed", description: error.message, variant: "destructive" });
    },
  });

  const config = configQuery.data;
  const highScore = highScoreQuery.data;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back-home">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="p-2 bg-primary/10 rounded-md">
              <Target className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight" data-testid="text-page-title">Active Work Finder</h1>
              <p className="text-xs text-muted-foreground">Find contractors working in refineries & chemical plants</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/active-work/high-score"] });
              queryClient.invalidateQueries({ queryKey: ["/api/active-work/config"] });
            }}
            data-testid="button-refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {config && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card data-testid="card-stat-geos">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Target Cities</p>
                    <p className="text-2xl font-semibold tabular-nums mt-1">{config.geos.length}</p>
                  </div>
                  <div className="p-2.5 bg-muted rounded-md">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-stat-keywords">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Keywords</p>
                    <p className="text-2xl font-semibold tabular-nums mt-1">{config.keywords.length}</p>
                  </div>
                  <div className="p-2.5 bg-primary/10 rounded-md">
                    <Search className="h-4 w-4 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-stat-queries">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Total Queries</p>
                    <p className="text-2xl font-semibold tabular-nums mt-1">{config.totalPossibleQueries}</p>
                  </div>
                  <div className="p-2.5 bg-muted rounded-md">
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card data-testid="card-query-generator">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                Query Generator
              </CardTitle>
              <CardDescription>
                Generate geo + keyword search queries for contractor discovery
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <Button
                  onClick={() => generateMutation.mutate(true)}
                  disabled={generateMutation.isPending}
                  variant="outline"
                  data-testid="button-preview-queries"
                >
                  {generateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                  Preview Queries
                </Button>
                <Button
                  onClick={() => generateMutation.mutate(false)}
                  disabled={generateMutation.isPending}
                  data-testid="button-generate-queries"
                >
                  {generateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  Write to Airtable
                </Button>
              </div>
              <Separator />
              <Button
                variant="outline"
                onClick={() => rotateMutation.mutate()}
                disabled={rotateMutation.isPending}
                className="w-full"
                data-testid="button-rotate-queries"
              >
                {rotateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Rotate Queries (Daily Job)
              </Button>
            </CardContent>
          </Card>

          <Card data-testid="card-company-scorer">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Star className="h-4 w-4 text-primary" />
                Company Scorer
              </CardTitle>
              <CardDescription>
                Score a company's website for active plant work indicators
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Company name (optional)"
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                data-testid="input-company-name"
              />
              <Input
                placeholder="Website URL (e.g., example.com)"
                value={testUrl}
                onChange={(e) => setTestUrl(e.target.value)}
                data-testid="input-company-url"
              />
              <Button
                className="w-full"
                onClick={() => scoreMutation.mutate({ url: testUrl, companyName: testName })}
                disabled={!testUrl.trim() || scoreMutation.isPending}
                data-testid="button-score-company"
              >
                {scoreMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TrendingUp className="mr-2 h-4 w-4" />}
                Score Website
              </Button>

              {scoreMutation.data && (
                <div className="mt-3 p-3 border border-border rounded-md space-y-2" data-testid="card-score-result">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Score</span>
                    <ScoreBadge score={scoreMutation.data.score} />
                  </div>
                  <p className="text-xs text-muted-foreground">{scoreMutation.data.reasoning}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {scoreMutation.data.turnaround_mentions && <Badge variant="outline" className="text-[10px]">Turnaround</Badge>}
                    {scoreMutation.data.refinery_mentions && <Badge variant="outline" className="text-[10px]">Refinery</Badge>}
                    {scoreMutation.data.twentyfour_seven && <Badge variant="outline" className="text-[10px]">24/7</Badge>}
                    {scoreMutation.data.crew_size_language && <Badge variant="outline" className="text-[10px]">Crew Size</Badge>}
                    {scoreMutation.data.safety_hse_page && <Badge variant="outline" className="text-[10px]">Safety/HSE</Badge>}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card data-testid="card-batch-scoring">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Batch Scoring
            </CardTitle>
            <CardDescription>Score unscored companies from your Airtable Companies table</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <Button
                onClick={() => batchScoreMutation.mutate(true)}
                disabled={batchScoreMutation.isPending}
                variant="outline"
                data-testid="button-preview-batch"
              >
                {batchScoreMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Preview (Find Unscored)
              </Button>
              <Button
                onClick={() => batchScoreMutation.mutate(false)}
                disabled={batchScoreMutation.isPending}
                data-testid="button-run-batch"
              >
                {batchScoreMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Score Batch (Up to 20)
              </Button>
            </div>

            {batchScoreMutation.data && !batchScoreMutation.data.dryRun && batchScoreMutation.data.results && (
              <div className="space-y-2 mt-3">
                {batchScoreMutation.data.results.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between p-2 border border-border rounded-md" data-testid={`row-batch-result-${r.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{r.name || r.website}</p>
                      <p className="text-xs text-muted-foreground truncate">{r.reasoning}</p>
                    </div>
                    <ScoreBadge score={r.score} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-high-score-list">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  Hot Leads — Active Work Score &gt; 70
                </CardTitle>
                <CardDescription>Contractors most likely working inside plants right now (with phone)</CardDescription>
              </div>
              {highScoreQuery.isRefetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          </CardHeader>
          <CardContent>
            {highScoreQuery.isLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-14 bg-muted/50 rounded-md animate-pulse" />
                ))}
              </div>
            ) : highScore && highScore.companies.length > 0 ? (
              <div className="space-y-2">
                {highScore.companies.map((c, i) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between p-3 border border-border rounded-md"
                    data-testid={`row-hot-lead-${c.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="text-xs text-muted-foreground font-mono w-6 text-right">#{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {c.city && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {c.city}, {c.state}
                            </span>
                          )}
                          {c.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {c.phone}
                            </span>
                          )}
                          {c.website && (
                            <span className="flex items-center gap-1">
                              <Globe className="h-3 w-3" />
                              {c.website}
                            </span>
                          )}
                        </div>
                        {c.reasoning && (
                          <p className="text-xs text-muted-foreground mt-1 truncate">{c.reasoning}</p>
                        )}
                      </div>
                    </div>
                    <ScoreBadge score={c.score} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="p-3 bg-muted/50 rounded-full mb-3">
                  <Target className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-muted-foreground" data-testid="text-empty-leads">No high-score leads yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Run batch scoring to discover active contractors
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {generateMutation.data?.dryRun && generateMutation.data.queries && (
          <Card data-testid="card-query-preview">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" />
                Query Preview ({generateMutation.data.totalQueries} total)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-96 overflow-y-auto space-y-1">
                {generateMutation.data.queries.map((q: any, i: number) => (
                  <div key={i} className="text-sm font-mono p-2 bg-muted/50 rounded text-xs" data-testid={`row-query-${i}`}>
                    {q.query}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
