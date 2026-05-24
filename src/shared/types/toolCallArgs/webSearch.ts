export interface WebSearchResultItem {
  index: number;
  title: string;
  url: string;
  caption: string;
  site: string;
  query?: string;
}

export interface WebSearchToolArgs {
  description: string;
  queries: string[];
  lang?: string;           // Required by Bing, not needed by Google — unified as optional in shared
  locale?: string;         // Same as above
  maxResults?: number;
  timeout?: number;
}

export interface WebSearchToolResult {
  success: boolean;
  totalQueries: number;
  totalResults: number;
  results: WebSearchResultItem[];
  errors?: string[];
  timestamp: string;
}
