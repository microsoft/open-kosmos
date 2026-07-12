import type { UserMessage } from '@shared/types/chatTypes';

export function buildUserPromptSubmitText(message: UserMessage): string {
  return message.content
    .map((part) => {
      switch (part.type) {
        case 'text':
          return part.text;
        case 'image':
          return `[image: ${part.metadata.fileName}, ${part.metadata.mimeType}, ${part.metadata.fileSize} bytes]`;
        case 'file':
          return `[file: ${part.file.fileName}, ${part.file.mimeType}, ${part.metadata.fileSize} bytes, path: ${part.file.filePath}]`;
        case 'office':
          return `[office: ${part.file.fileName}, ${part.file.mimeType}, ${part.metadata.fileSize} bytes, path: ${part.file.filePath}]`;
        case 'others':
          return `[attachment: ${part.file.fileName}, ${part.file.mimeType}, ${part.metadata.fileSize} bytes]`;
      }
    })
    .filter(Boolean)
    .join('\n');
}
