export interface WebContentResult {
  url: string;
  title: string;
  content: string;
  error?: string;
  size: number;
  timestamp: string;
}

export interface WebFetchToolArgs {
  description: string;
  urls: string[];
  maxContentSize?: number;
}

export interface WebFetchToolResult {
  success: boolean;
  totalUrls: number;
  successfulUrls: number;
  results: WebContentResult[];
  mergedContent: string;
  errors?: string[];
  timestamp: string;
}
