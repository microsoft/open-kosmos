/**
 * Workspace Search Service - Renderer side
 * Calls main process file search functionality via IPC
 */

export type SearchTarget = 'files' | 'folders' | 'both';

export interface FileSearchQuery {
  folder?: string;
  pattern?: string;
  maxResults?: number;
  fuzzy?: boolean;
  searchTarget?: SearchTarget;  // Search target: files (files only) | folders (folders only) | both (files + folders, default)
}

export interface FileSearchResult {
  path: string;
  score?: number;
  isDirectory?: boolean;  // Whether this is a directory
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
    // Return empty results instead of throwing an error to avoid disrupting the UI
    return { results: [], limitHit: false };
  }
}

/**
 * Search files matching a specified pattern
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
    searchTarget: options?.searchTarget || 'both' // Search files + folders by default
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
    // 🔍 Get the current chat's workspace path from ProfileDataManager
    let workspacePath: string | undefined;
    try {
      const { profileDataManager } = await import('../userData');
      const currentChatConfig: any = profileDataManager.getCurrentChat?.();
      workspacePath = currentChatConfig?.agent?.workspace;
      
    } catch (error) {
    }
    
    // If no workspace is available, return empty results
    if (!workspacePath || typeof workspacePath !== 'string' || workspacePath.trim().length === 0) {
      return [];
    }
    
    return await searchFilesByPattern(pattern, {
      folder: workspacePath, // 🔥 Key fix: pass in workspace path
      maxResults,
      fuzzy: true,
      searchTarget // Pass search target parameter
    });
  } catch (error) {
    return [];
  }
}