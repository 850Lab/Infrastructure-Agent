export interface IndustryConfigType {
  name: string;
  market: string;

  company_categories: string[];

  opportunity_keywords: string[];

  decision_maker_titles: {
    tier1: string[];
    tier2: string[];
    tier3: string[];
    tier4: string[];
  };

  search_templates: string[];

  cold_start_queries: Array<{
    query: string;
    category: string;
  }>;

  scoring: {
    opportunity_keyword: number;
    dm_email_bonus: number;
    dm_phone_bonus: number;
    engagement_bonus: number;
  };

  geo: {
    cities: string[];
    states: string[];
    industrial_types: string[];
  };

  lead_feed: {
    high_value_categories: string[];
    industrial_keywords: string[];
    query_seeds: string[];
    gpt_prompt_context: string;
  };
}

export const IndustryConfig: IndustryConfigType = {
  name: "Industrial Contractors",
  market: "Gulf Coast",

  company_categories: [
    "Scaffolding",
    "Insulation",
    "Industrial Maintenance",
    "Turnaround",
    "Tank Cleaning",
    "Coatings",
    "Mechanical",
    "Construction",
    "Other",
  ],

  opportunity_keywords: [
    "refinery",
    "chemical plant",
    "turnaround",
    "shutdown",
    "maintenance",
    "outage",
    "petrochemical",
    "plant services",
    "scaffolding",
    "insulation",
    "hydroblasting",
    "industrial cleaning",
    "mechanical contractor",
    "tank cleaning",
    "coatings",
    "fireproofing",
    "blasting",
    "pipe",
  ],

  decision_maker_titles: {
    tier1: [
      "Safety Director",
      "Safety Manager",
      "HSE Manager",
      "EHS Manager",
    ],
    tier2: [
      "Project Manager",
      "Turnaround Manager",
      "Shutdown Manager",
    ],
    tier3: [
      "Operations Manager",
      "Plant Manager",
      "Maintenance Manager",
    ],
    tier4: [
      "Superintendent",
      "General Manager",
      "VP Operations",
    ],
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
    opportunity_keyword: 30,
    dm_email_bonus: 5,
    dm_phone_bonus: 5,
    engagement_bonus: 10,
  },

  geo: {
    cities: [
      "houston", "beaumont", "lake charles", "port arthur", "baton rouge",
      "texas city", "pasadena tx", "baytown", "deer park", "la porte",
    ],
    states: ["TX", "LA"],
    industrial_types: [
      "refinery", "chemical", "petrochemical", "industrial", "energy",
      "oil", "gas", "manufacturing", "construction",
    ],
  },

  lead_feed: {
    high_value_categories: [
      "scaffolding", "insulation", "turnaround", "tank cleaning", "coatings",
    ],
    industrial_keywords: [
      "refinery", "plant", "industrial", "turnaround", "shutdown",
      "chemical", "petrochemical", "energy", "offshore",
      "scaffolding", "insulation", "hydroblasting", "abatement",
    ],
    query_seeds: [
      "industrial scaffolding contractor",
      "industrial insulation contractor",
      "turnaround contractor",
      "refinery maintenance contractor",
      "tank cleaning services",
      "industrial coatings contractor",
      "hydroblasting services",
      "mechanical insulation contractor",
      "fireproofing contractor",
      "industrial painting services",
      "refractory contractor",
      "shutdown contractor",
      "abrasive blasting services",
      "pipe insulation contractor",
      "catalytic converter cleaning",
      "industrial vacuum services",
      "heat exchanger cleaning",
      "plant turnaround services",
    ],
    gpt_prompt_context: "You generate Google Maps search queries to find industrial contractors along the Gulf Coast (TX/LA). These queries will be used with Outscraper's Google Maps API.\n\nTarget contractor types: scaffolding, insulation, turnaround/shutdown, tank cleaning, industrial painting/coatings, hydroblasting, fireproofing, refractory, mechanical insulation, industrial cleaning, plant maintenance.\n\nTarget geography: Gulf Coast Texas and Louisiana refinery corridor.",
  },
};
