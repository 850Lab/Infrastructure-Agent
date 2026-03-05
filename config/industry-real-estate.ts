import type { IndustryConfig } from "./types";

export const IndustryConfig: IndustryConfig = {
  name: "Commercial Real Estate",
  market: "Major Metro",
  markets: [
    "Houston TX", "Dallas TX", "Austin TX", "San Antonio TX",
    "Atlanta GA", "Charlotte NC", "Nashville TN", "Tampa FL",
    "Phoenix AZ", "Denver CO", "Chicago IL", "Miami FL",
  ],

  company_categories: [
    "Brokerage", "Property Management", "Leasing", "Development",
    "Multifamily", "Commercial", "Industrial RE", "Tenant Rep", "Other",
  ],

  opportunity_keywords: [
    "brokerage", "leasing", "tenant rep", "property management",
    "multifamily", "commercial", "office space", "retail space",
    "warehouse", "distribution", "mixed use", "development",
    "investment sales", "cap rate", "nnn lease",
  ],

  negative_keywords: [
    "residential realtor", "home buying", "mortgage broker",
    "home staging", "home inspection",
  ],

  decision_maker_titles_tiers: {
    tier1: ["Managing Broker", "Broker Owner", "Principal Broker"],
    tier2: ["Director of Leasing", "Director of Property Management", "VP Real Estate"],
    tier3: ["Property Manager", "Leasing Manager", "Asset Manager"],
    tier4: ["Senior Associate", "Managing Director", "Partner"],
  },

  search_templates: [
    "commercial real estate {category} {city}",
    "{category} companies {city} {state}",
    "commercial {category} firms {market}",
    "{category} services {city}",
    "commercial property {category} {city}",
  ],

  cold_start_queries: [
    { query: "commercial real estate brokerage", category: "Brokerage" },
    { query: "property management companies commercial", category: "Property Management" },
    { query: "commercial leasing agents", category: "Leasing" },
    { query: "tenant representation firms", category: "Tenant Rep" },
    { query: "multifamily property management", category: "Multifamily" },
    { query: "industrial real estate brokers", category: "Industrial RE" },
    { query: "commercial real estate development", category: "Development" },
    { query: "office leasing companies", category: "Leasing" },
    { query: "retail property management", category: "Commercial" },
    { query: "investment sales real estate", category: "Brokerage" },
  ],

  scoring: {
    keyword_hit: 5,
    opp_base: 25,
    dm_email_bonus: 8,
    dm_phone_bonus: 5,
    engagement_weight: 35,
    priority_weight: 1,
    opportunity_weight: 25,
    recency_bonus: 10,
  },

  call_list: {
    pctHot: 0.35,
    pctWorking: 0.35,
    pctFresh: 0.30,
    topDefault: 25,
    staleDaysWorking: 5,
    staleDaysNoCall: 14,
  },

  geo: {
    cities: [
      "houston", "dallas", "austin", "san antonio", "atlanta",
      "charlotte", "nashville", "tampa", "phoenix", "denver",
    ],
    states: ["TX", "GA", "NC", "TN", "FL", "AZ", "CO", "IL"],
    industry_types: [
      "real estate", "commercial", "brokerage", "property management",
      "leasing", "development", "multifamily", "industrial",
    ],
  },

  lead_feed: {
    high_value_categories: [
      "brokerage", "property management", "leasing", "multifamily", "development",
    ],
    industry_keywords: [
      "real estate", "commercial", "brokerage", "leasing", "property",
      "multifamily", "office", "retail", "industrial", "warehouse",
      "development", "investment", "tenant", "asset management",
    ],
    query_seeds: [
      "commercial real estate brokerage", "property management company",
      "commercial leasing firm", "tenant representation broker",
      "multifamily property management", "office leasing company",
      "retail property management", "industrial real estate broker",
      "commercial real estate development", "investment sales broker",
    ],
    gpt_prompt_context: "You generate search queries to find commercial real estate firms across major US metros. Focus on brokerages, property management companies, leasing firms, and development companies.\n\nTarget company types: commercial brokerages, property management, leasing, tenant rep, multifamily, industrial RE, development.\n\nTarget geography: Major US metropolitan areas.",
  },
};
