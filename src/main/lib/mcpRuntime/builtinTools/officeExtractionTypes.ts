export interface TextExtractionResult {
  content: string;
  fileType: string;
  extractionMethod: string;
  totalPages?: number;
  totalLines: number;
}
