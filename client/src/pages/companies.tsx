import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import AppLayout from "@/components/app-layout";
import { Building2, Search, User, Phone, Mail, MapPin, ChevronRight, Loader2, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";

const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const EMERALD = "#10B981";
const AMBER = "#F59E0B";
const BLUE = "#3B82F6";

interface TodayCompany {
  id: string;
  company_name: string;
  phone: string;
  bucket: string;
  final_priority: number;
  lead_status: string;
  times_called: number;
  last_outcome: string;
  offer_dm_name: string;
  offer_dm_title: string;
  offer_dm_phone: string;
  city: string;
  state: string;
  category: string;
  dm_status: string;
  website: string;
}

interface CompanyFlow {
  id: number;
  companyId: string;
  flowType: string;
  status: string;
  attemptCount: number;
  nextAction: string | null;
  lastOutcome: string | null;
}

const BUCKET_COLORS: Record<string, string> = {
  "Hot Follow-up": "#EF4444",
  "Working": AMBER,
  "Fresh": EMERALD,
};

export default function CompaniesPage() {
  const [, navigate] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterBucket, setFilterBucket] = useState<string>("all");

  const { data: companies = [], isLoading } = useQuery<TodayCompany[]>({
    queryKey: ["/api/today-list"],
  });

  const { data: flows = [] } = useQuery<CompanyFlow[]>({
    queryKey: ["/api/flows/all"],
  });

  const flowsByCompany = useMemo(() => {
    const map: Record<string, CompanyFlow[]> = {};
    flows.forEach(f => {
      if (!map[f.companyId]) map[f.companyId] = [];
      map[f.companyId].push(f);
    });
    return map;
  }, [flows]);

  const filtered = useMemo(() => {
    let result = companies;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(c =>
        c.company_name.toLowerCase().includes(term) ||
        c.city?.toLowerCase().includes(term) ||
        c.category?.toLowerCase().includes(term) ||
        c.offer_dm_name?.toLowerCase().includes(term)
      );
    }
    if (filterBucket !== "all") {
      result = result.filter(c => c.bucket === filterBucket);
    }
    return result;
  }, [companies, searchTerm, filterBucket]);

  const buckets = useMemo(() => {
    const counts: Record<string, number> = {};
    companies.forEach(c => {
      counts[c.bucket] = (counts[c.bucket] || 0) + 1;
    });
    return counts;
  }, [companies]);

  return (
    <AppLayout>
      <div className="px-4 py-6" data-testid="page-companies">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold" style={{ color: TEXT }}>Companies</h1>
            <p className="text-sm mt-0.5" style={{ color: MUTED }}>{companies.length} companies in your territory</p>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: MUTED }} />
            <Input
              placeholder="Search companies, contacts, cities..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 h-9 text-sm"
              style={{ borderColor: BORDER }}
              data-testid="input-search"
            />
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFilterBucket("all")}
              className="px-3 py-1.5 rounded-md text-xs font-medium"
              style={{
                background: filterBucket === "all" ? `${EMERALD}12` : "transparent",
                color: filterBucket === "all" ? TEXT : MUTED,
              }}
              data-testid="filter-all"
            >
              All ({companies.length})
            </button>
            {Object.entries(buckets).map(([bucket, count]) => (
              <button
                key={bucket}
                onClick={() => setFilterBucket(bucket)}
                className="px-3 py-1.5 rounded-md text-xs font-medium"
                style={{
                  background: filterBucket === bucket ? `${BUCKET_COLORS[bucket] || MUTED}15` : "transparent",
                  color: filterBucket === bucket ? (BUCKET_COLORS[bucket] || TEXT) : MUTED,
                }}
                data-testid={`filter-${bucket}`}
              >
                {bucket} ({count})
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: EMERALD }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 rounded-lg" style={{ background: "white", border: `1px solid ${BORDER}` }}>
            <Building2 className="w-10 h-10 mx-auto mb-3" style={{ color: MUTED }} />
            <p className="text-sm font-medium" style={{ color: TEXT }}>No companies found</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(company => {
              const companyFlows = flowsByCompany[company.id] || [];
              const activeFlowCount = companyFlows.filter(f => f.status === "active").length;
              const bucketColor = BUCKET_COLORS[company.bucket] || MUTED;

              return (
                <div
                  key={company.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-all hover:shadow-sm group"
                  style={{ background: "white", border: `1px solid ${BORDER}` }}
                  onClick={() => navigate(`/machine/company/${company.id}`)}
                  data-testid={`company-row-${company.id}`}
                >
                  <div className="w-2 h-full rounded-full flex-shrink-0" style={{ background: bucketColor, minHeight: "36px" }} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-semibold text-sm truncate" style={{ color: TEXT }}>
                        {company.company_name}
                      </span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: `${bucketColor}15`, color: bucketColor }}>
                        {company.bucket}
                      </span>
                      {activeFlowCount > 0 && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: `${EMERALD}12`, color: EMERALD }}>
                          {activeFlowCount} flow{activeFlowCount !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs" style={{ color: MUTED }}>
                      {company.category && <span>{company.category}</span>}
                      {company.city && (
                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{company.city}, {company.state}</span>
                      )}
                      {company.offer_dm_name && (
                        <span className="flex items-center gap-1"><User className="w-3 h-3" />{company.offer_dm_name}</span>
                      )}
                      {company.times_called > 0 && <span>{company.times_called} calls</span>}
                    </div>
                  </div>

                  <div className="text-xs text-right flex-shrink-0" style={{ color: MUTED }}>
                    {company.last_outcome && <div>Last: {company.last_outcome}</div>}
                    <div>P{company.final_priority || 0}</div>
                  </div>

                  <ChevronRight className="w-4 h-4 flex-shrink-0 opacity-0 group-hover:opacity-100" style={{ color: MUTED }} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
