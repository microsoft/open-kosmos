import { profileDataManager } from "../userData";
/**
 * Workspace Search Service - Renderer side
 * Calls the main process file search functionality via IPC
 */

export type SearchTarget = 'files' | 'folders' | 'both';

export interface FileSearchQuery {
  folder?: string;
  pattern?: string;
  maxResults?: number;
  fuzzy?: boolean;
  searchTarget?: SearchTarget;  // Search target: files (files only) | folders (folders only) | both (files+folders, default)
}

export interface FileSearchResult {
  path: string;
  score?: number;
  isDirectory?: boolean;  // Whether it is a directory
}

export interface SearchComplete {
  results: FileSearchResult[];
  limitHit: boolean;
  stats?: {
    duration: number;
    filesScanned: number;
    cacheHit: boolean;
  };
}

/**
 * Search workspace files
 * @param query Search query
 * @returns Search results
 */
export async function searchWorkspaceFiles(
  query: FileSearchQuery
): Promise<SearchComplete> {
  try {
    if (!window.electronAPI?.workspace?.searchFiles) {
      return { results: [], limitHit: false };
    }

    const result = await window.electronAPI.workspace.searchFiles(query);

    if (!result || !result.success) {
      throw new Error(result?.error || 'File search failed');
    }

    return result.data;
  } catch (error) {
    // Return empty results instead of throwing, to avoid interrupting the UI
    return { results: [], limitHit: false };
  }
}

/**
 * Search files by pattern
 * @param pattern Search pattern (filename or path fragment)
 * @param options Search options
 * @returns Search results
 */
export async function searchFilesByPattern(
  pattern: string,
  options?: {
    folder?: string;
    maxResults?: number;
    fuzzy?: boolean;
    searchTarget?: SearchTarget;
  }
): Promise<FileSearchResult[]> {
  const result = await searchWorkspaceFiles({
    pattern,
    folder: options?.folder,
    maxResults: options?.maxResults || 50,
    fuzzy: options?.fuzzy !== false, // Enable fuzzy search by default
    searchTarget: options?.searchTarget || 'both' // Search files+folders by default
  });

  return result.results;
}

/**
 * Quick file search (for UI autocomplete)
 * @param pattern Search pattern
 * @param maxResults Maximum number of results (default 10)
 * @returns Search results
 */
export async function quickSearchFiles(
  pattern: string,
  maxResults: number = 10,
  searchTarget: SearchTarget = 'both'
): Promise<FileSearchResult[]> {
  if (!pattern || pattern.trim().length === 0) {
    return [];
  }

  try {
    // 🔍 Get the workspace path for the current Chat from ProfileDataManager
    let workspacePath: string | undefined;
    try {
      const currentChatConfig: any = profileDataManager.getCurrentChat?.();
      workspacePath = currentChatConfig?.agent?.workspace;

    } catch (error) {
    }

    // If no workspace is set, return empty results
    if (!workspacePath || typeof workspacePath !== 'string' || workspacePath.trim().length === 0) {
      return [];
    }

    return await searchFilesByPattern(pattern, {
      folder: workspacePath, // 🔥 Key fix: pass the workspace path
      maxResults,
      fuzzy: true,
      searchTarget // pass the search target parameter
    });
  } catch (error) {
    return [];
  }
}