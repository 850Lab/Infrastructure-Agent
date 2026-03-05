import type { IndustryConfig } from "./types";

export const IndustryConfig: IndustryConfig = {
  name: "Marketing Agencies",
  market: "US Metro",
  markets: [
    "New York NY", "Los Angeles CA", "Chicago IL", "Houston TX",
    "Austin TX", "Miami FL", "Atlanta GA", "Denver CO",
    "San Francisco CA", "Seattle WA", "Dallas TX", "Nashville TN",
  ],

  company_categories: [
    "Full Service Agency", "Performance Marketing", "SEO Agency",
    "PPC Agency", "Web Design", "Lead Gen", "Content Marketing",
    "Social Media Agency", "Branding", "Other",
  ],

  opportunity_keywords: [
    "marketing agency", "lead gen", "performance marketing", "ppc",
    "seo", "web design", "digital marketing", "social media marketing",
    "content marketing", "branding", "growth agency", "demand gen",
    "email marketing", "conversion optimization", "paid media",
  ],

  negative_keywords: [
    "freelance only", "blog", "influencer", "personal brand",
    "lifestyle", "wedding photographer",
  ],

  decision_maker_titles_tiers: {
    tier1: ["Founder", "Owner", "CEO", "Managing Partner"],
    tier2: ["Director of Growth", "VP Marketing", "Director of Client Services"],
    tier3: ["Account Director", "Director of Strategy", "Head of Digital"],
    tier4: ["Senior Account Manager", "Operations Director", "General Manager"],
  },

  search_templates: [
    "{category} {city}",
    "digital marketing agency {city} {state}",
    "{category} companies {market}",
    "{category} services {city}",
    "marketing agency {city} {category}",
  ],

  cold_start_queries: [
    { query: "digital marketing agency", category: "Full Service Agency" },
    { query: "ppc management agency", category: "PPC Agency" },
    { query: "seo company local business", category: "SEO Agency" },
    { query: "lead generation agency b2b", category: "Lead Gen" },
    { query: "performance marketing firm", category: "Performance Marketing" },
    { query: "web design agency small business", category: "Web Design" },
    { query: "content marketing agency", category: "Content Marketing" },
    { query: "social media marketing agency", category: "Social Media Agency" },
    { query: "branding agency", category: "Branding" },
    { query: "email marketing services agency", category: "Full Service Agency" },
  ],

  scoring: {
    keyword_hit: 5,
    opp_base: 20,
    dm_email_bonus: 8,
    dm_phone_bonus: 5,
    engagement_weight: 30,
    priority_weight: 1,
    opportunity_weight: 20,
    recency_bonus: 10,
  },

  call_list: {
    pctHot: 0.30,
    pctWorking: 0.40,
    pctFresh: 0.30,
    topDefault: 20,
    staleDaysWorking: 5,
    staleDaysNoCall: 21,
  },

  geo: {
    cities: [
      "new york", "los angeles", "chicago", "houston", "austin",
      "miami", "atlanta", "denver", "san francisco", "seattle",
    ],
    states: ["NY", "CA", "IL", "TX", "FL", "GA", "CO", "WA"],
    industry_types: [
      "marketing", "advertising", "digital", "agency", "creative",
      "media", "design", "consulting",
    ],
  },

  lead_feed: {
    high_value_categories: [
      "performance marketing", "ppc agency", "seo agency", "lead gen", "web design",
    ],
    industry_keywords: [
      "marketing", "agency", "digital", "advertising", "ppc",
      "seo", "lead gen", "performance", "growth", "design",
      "content", "social media", "branding", "email marketing",
    ],
    query_seeds: [
      "digital marketing agency", "ppc management company",
      "seo services agency", "lead generation company",
      "performance marketing firm", "web design agency",
      "content marketing services", "social media agency",
      "branding firm", "email marketing agency",
    ],
    gpt_prompt_context: "You generate search queries to find marketing agencies across US metro areas. Focus on agencies that provide PPC, SEO, lead gen, web design, content marketing, and performance marketing.\n\nTarget company types: full service agencies, PPC shops, SEO firms, lead gen companies, web design studios, content marketing agencies.\n\nTarget geography: Major US metropolitan areas.",
  },
};
