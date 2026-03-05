import type { IndustryConfig } from "./types";

export const IndustryConfig: IndustryConfig = {
  name: "B2B SaaS Companies",
  market: "US Tech Hubs",
  markets: [
    "San Francisco CA", "Austin TX", "New York NY", "Boston MA",
    "Seattle WA", "Denver CO", "Chicago IL", "Atlanta GA",
    "Los Angeles CA", "Miami FL", "Dallas TX", "Nashville TN",
  ],

  company_categories: [
    "B2B SaaS", "Software", "Tech Services", "IT Consulting",
    "DevTools", "MarTech", "FinTech", "HealthTech", "Other",
  ],

  opportunity_keywords: [
    "hiring", "series a", "series b", "sales development", "outbound",
    "revops", "pipeline", "growth", "fundraise", "scaling",
    "go-to-market", "demand gen", "account executive", "sdr",
    "revenue operations", "sales enablement", "product-led",
  ],

  negative_keywords: [
    "consulting only", "freelance", "solopreneur", "blog",
    "open source only", "nonprofit",
  ],

  decision_maker_titles_tiers: {
    tier1: ["VP Sales", "VP Revenue", "CRO", "Head of Sales"],
    tier2: ["Head of Growth", "VP Marketing", "Director of RevOps", "Director of Sales"],
    tier3: ["SDR Manager", "Sales Manager", "Director of Business Development"],
    tier4: ["CEO", "Founder", "COO", "General Manager"],
  },

  search_templates: [
    "b2b saas {city} hiring sales",
    "saas company {city} series a",
    "software company {city} {category}",
    "revops consulting {market}",
    "{category} startup {city}",
  ],

  cold_start_queries: [
    { query: "b2b saas companies hiring sales reps", category: "B2B SaaS" },
    { query: "saas startups series a funding", category: "B2B SaaS" },
    { query: "revops consulting firms", category: "Tech Services" },
    { query: "sales enablement software companies", category: "Software" },
    { query: "martech companies hiring", category: "MarTech" },
    { query: "fintech startups growth stage", category: "FinTech" },
    { query: "devtools companies venture backed", category: "DevTools" },
    { query: "it consulting firms enterprise", category: "IT Consulting" },
    { query: "demand generation agencies saas", category: "MarTech" },
    { query: "product led growth companies", category: "Software" },
  ],

  scoring: {
    keyword_hit: 5,
    opp_base: 25,
    dm_email_bonus: 10,
    dm_phone_bonus: 3,
    engagement_weight: 35,
    priority_weight: 1,
    opportunity_weight: 25,
    recency_bonus: 15,
  },

  call_list: {
    pctHot: 0.35,
    pctWorking: 0.40,
    pctFresh: 0.25,
    topDefault: 20,
    staleDaysWorking: 5,
    staleDaysNoCall: 21,
  },

  geo: {
    cities: [
      "san francisco", "austin", "new york", "boston", "seattle",
      "denver", "chicago", "atlanta", "los angeles", "miami",
    ],
    states: ["CA", "TX", "NY", "MA", "WA", "CO", "IL", "GA"],
    industry_types: [
      "saas", "software", "technology", "fintech", "martech",
      "devtools", "healthtech", "edtech", "startup",
    ],
  },

  lead_feed: {
    high_value_categories: [
      "b2b saas", "software", "martech", "fintech", "devtools",
    ],
    industry_keywords: [
      "saas", "software", "technology", "startup", "venture",
      "series", "funding", "growth", "revenue", "pipeline",
      "outbound", "sales", "demand gen", "product-led",
    ],
    query_seeds: [
      "b2b saas company", "sales enablement platform",
      "revops software", "demand generation tool",
      "martech company", "fintech startup",
      "devtools company", "it consulting firm",
      "sales development platform", "crm software company",
    ],
    gpt_prompt_context: "You generate search queries to find B2B SaaS companies across US tech hubs. Focus on companies that are hiring sales teams, recently funded, or scaling their go-to-market.\n\nTarget company types: B2B SaaS, MarTech, FinTech, DevTools, Sales Enablement, RevOps.\n\nTarget geography: Major US tech hubs (SF, Austin, NYC, Boston, Seattle, Denver, Chicago, Atlanta).",
  },
};
