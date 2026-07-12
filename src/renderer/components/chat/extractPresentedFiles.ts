/**
 * Helper to extract presented file deliverables from tool calls.
 * Filters out missing files reported in the corresponding tool result message.
 */
import type { Message, ToolCall } from '@shared/types/chatTypes';
import type { PresentedFile } from './message/GeneratedFileCards';

/**
 * Extract present_deliverables tool calls as PresentedFiles.
 * Cross-references tool result messages to exclude files reported as missing.
 */
export function extractPresentedFiles(toolCalls: ToolCall[], allMessages?: Message[]): PresentedFile[] {
  const files: PresentedFile[] = [];
  toolCalls.forEach(tc => {
    if (tc.function.name === 'present_deliverables') {
      try {
        const args = JSON.parse(tc.function.arguments || '{}');
        if (args.filePaths && Array.isArray(args.filePaths)) {
          // Find the corresponding tool result to check for missingFiles
          let missingFiles: string[] = [];
          if (allMessages) {
            const toolResultMsg = allMessages.find(
              m => m.role === 'tool' && m.tool_call_id === tc.id
            );
            if (toolResultMsg) {
              try {
                const resultText = toolResultMsg.content
                  .filter((p: any) => p.type === 'text')
                  .map((p: any) => p.text)
                  .join('');
                const result = JSON.parse(resultText);
                if (result.missingFiles && Array.isArray(result.missingFiles)) {
                  missingFiles = result.missingFiles;
                }
              } catch {
                // If we can't parse the result, don't filter
              }
            }
          }
          // Exclude missing files from presented paths
          const validPaths = args.filePaths.filter(
            (fp: string) => !missingFiles.includes(fp)
          );
          if (validPaths.length > 0) {
            files.push({
              filePath: JSON.stringify(validPaths),
              description: args.description || 'Final deliverables'
            });
          }
        }
      } catch {
        // Skip on parse failure
      }
    }
  });
  return files;
}
