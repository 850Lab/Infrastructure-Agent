import type { IndustryConfig } from "./types";

export const IndustryConfig: IndustryConfig = {
  name: "Industrial Contractors",
  market: "Gulf Coast",
  markets: [
    "Houston TX", "Baytown TX", "Deer Park TX", "Pasadena TX", "La Porte TX",
    "Texas City TX", "Galveston TX", "Freeport TX", "Channelview TX",
    "Port Arthur TX", "Beaumont TX", "Orange TX", "Nederland TX",
    "Lake Charles LA", "Sulphur LA", "Westlake LA",
    "Baton Rouge LA", "Plaquemine LA", "Geismar LA",
    "Corpus Christi TX", "Victoria TX",
  ],

  company_categories: [
    "Scaffolding", "Insulation", "Industrial Maintenance", "Turnaround",
    "Tank Cleaning", "Coatings", "Mechanical", "Construction", "Other",
  ],

  opportunity_keywords: [
    "refinery", "chemical plant", "turnaround", "shutdown", "maintenance",
    "outage", "petrochemical", "plant services", "scaffolding", "insulation",
    "hydroblasting", "industrial cleaning", "mechanical contractor",
    "tank cleaning", "coatings", "fireproofing", "blasting", "pipe",
  ],

  negative_keywords: [
    "residential only", "home remodeling", "kitchen remodel",
    "bathroom remodel", "home improvement", "landscaping",
    "lawn care", "pool cleaning", "handyman",
  ],

  decision_maker_titles_tiers: {
    tier1: ["Safety Director", "Safety Manager", "HSE Manager", "EHS Manager"],
    tier2: ["Project Manager", "Turnaround Manager", "Shutdown Manager"],
    tier3: ["Operations Manager", "Plant Manager", "Maintenance Manager"],
    tier4: ["Superintendent", "General Manager", "VP Operations"],
  },

  search_templates: [
    "{category} contractors {city} refinery",
    "{category} contractors {city} chemical plant",
    "{category} companies {market}",
    "{category} services {city} turnaround",
    "{category} contractors {state} industrial",
  ],

  cold_start_queries: [
    { query: "industrial scaffolding contractors", category: "Scaffolding" },
    { query: "refinery insulation contractors", category: "Insulation" },
    { query: "turnaround maintenance services", category: "Turnaround" },
    { query: "tank cleaning services industrial", category: "Tank Cleaning" },
    { query: "industrial coatings contractors", category: "Coatings" },
    { query: "plant maintenance contractors", category: "Industrial Maintenance" },
    { query: "shutdown maintenance contractors", category: "Turnaround" },
    { query: "mechanical contractors industrial", category: "Mechanical" },
    { query: "fireproofing contractors refinery", category: "Coatings" },
    { query: "industrial cleaning services chemical plant", category: "Tank Cleaning" },
    { query: "scaffolding erectors petrochemical", category: "Scaffolding" },
    { query: "heat tracing contractors", category: "Mechanical" },
    { query: "abrasive blasting contractors", category: "Coatings" },
    { query: "refractory contractors industrial", category: "Industrial Maintenance" },
    { query: "industrial insulation removal asbestos", category: "Insulation" },
    { query: "rope access industrial services", category: "Industrial Maintenance" },
    { query: "hydro blasting services refinery", category: "Tank Cleaning" },
    { query: "catalyst handling services", category: "Turnaround" },
    { query: "pipe fitting contractors industrial", category: "Mechanical" },
    { query: "industrial construction general contractors", category: "Construction" },
  ],

  scoring: {
    keyword_hit: 5,
    opp_base: 30,
    dm_email_bonus: 5,
    dm_phone_bonus: 5,
    engagement_weight: 40,
    priority_weight: 1,
    opportunity_weight: 30,
    recency_bonus: 10,
  },

  call_list: {
    pctHot: 0.4,
    pctWorking: 0.35,
    pctFresh: 0.25,
    topDefault: 25,
    staleDaysWorking: 3,
    staleDaysNoCall: 14,
  },

  geo: {
    cities: [
      "houston", "beaumont", "lake charles", "port arthur", "baton rouge",
      "texas city", "pasadena tx", "baytown", "deer park", "la porte",
    ],
    states: ["TX", "LA"],
    industry_types: [
      "refinery", "chemical", "petrochemical", "industrial", "energy",
      "oil", "gas", "manufacturing", "construction",
    ],
  },

  lead_feed: {
    high_value_categories: [
      "scaffolding", "insulation", "turnaround", "tank cleaning", "coatings",
    ],
    industry_keywords: [
      "refinery", "plant", "industrial", "turnaround", "shutdown",
      "chemical", "petrochemical", "energy", "offshore",
      "scaffolding", "insulation", "hydroblasting", "abatement",
    ],
    query_seeds: [
      "industrial scaffolding contractor", "industrial insulation contractor",
      "turnaround contractor", "refinery maintenance contractor",
      "tank cleaning services", "industrial coatings contractor",
      "hydroblasting services", "mechanical insulation contractor",
      "fireproofing contractor", "industrial painting services",
      "refractory contractor", "shutdown contractor",
      "abrasive blasting services", "pipe insulation contractor",
      "catalytic converter cleaning", "industrial vacuum services",
      "heat exchanger cleaning", "plant turnaround services",
    ],
    gpt_prompt_context: "You generate Google Maps search queries to find industrial contractors along the Gulf Coast (TX/LA). These queries will be used with Outscraper's Google Maps API.\n\nTarget contractor types: scaffolding, insulation, turnaround/shutdown, tank cleaning, industrial painting/coatings, hydroblasting, fireproofing, refractory, mechanical insulation, industrial cleaning, plant maintenance.\n\nTarget geography: Gulf Coast Texas and Louisiana refinery corridor.",
  },

  decay_constant: 60,
};
