export interface IndustryConfig {
  name: string;
  market: string;
  markets?: string[];

  company_categories: string[];
  opportunity_keywords: string[];
  negative_keywords?: string[];

  decision_maker_titles_tiers: {
    tier1: string[];
    tier2: string[];
    tier3: string[];
    tier4: string[];
    other?: string[];
  };

  search_templates: string[];

  cold_start_queries: Array<{
    query: string;
    category: string;
  }>;

  scoring: {
    keyword_hit: number;
    opp_base: number;
    dm_email_bonus: number;
    dm_phone_bonus: number;
    engagement_weight: number;
    priority_weight: number;
    opportunity_weight: number;
    recency_bonus: number;
  };

  call_list: {
    pctHot: number;
    pctWorking: number;
    pctFresh: number;
    topDefault: number;
    staleDaysWorking: number;
    staleDaysNoCall: number;
  };

  geo: {
    cities: string[];
    states: string[];
    industry_types: string[];
  };

  lead_feed: {
    high_value_categories: string[];
    industry_keywords: string[];
    query_seeds: string[];
    gpt_prompt_context: string;
  };
}
