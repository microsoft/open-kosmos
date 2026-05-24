import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';

interface GifRecorderParams {
  action: 'start' | 'stop' | 'status' | 'auto_start' | 'capture' | 'clear' | 'export';
  tabId?: number;
  filename?: string;
  download?: boolean;
  coordinates?: { x: number; y: number };
  ref?: string;
  selector?: string;
}

interface GifResult {
  success: boolean;
  action: GifRecorderParams['action'];
  tabId?: number;
  frameCount?: number;
  durationMs?: number;
  byteLength?: number;
  downloadId?: number;
  filename?: string;
  fullPath?: string;
  mode?: 'fixed_fps' | 'auto_capture';
  uploadTarget?: {
    x: number;
    y: number;
    tagName?: string;
    id?: string;
  };
}

interface ExportableGif {
  gifData: Uint8Array;
  width: number;
  height: number;
  frameCount: number;
  durationMs: number;
  tabId: number;
  filename?: string;
  actionsCount?: number;
  mode: 'fixed_fps' | 'auto_capture';
  createdAt: number;
}

interface GifExportContext {
  resolveTargetTab: (tabId?: number) => Promise<chrome.tabs.Tab | null>;
  isRestrictedUrl: (url?: string) => boolean;
  injectContentScript: (tabId: number, files: string[]) => Promise<void>;
  sendMessageToTab: (tabId: number, message: unknown) => Promise<any>;
  buildResponse: (result: GifResult) => ToolResult;
  blobToDataUrl: (blob: Blob) => Promise<string>;
}

export async function saveGifToDownloads(
  gifData: Uint8Array,
  filename: string | undefined,
  fallbackPrefix: string,
  blobToDataUrl: (blob: Blob) => Promise<string>,
): Promise<{ downloadId: number; filename: string; fullPath?: string }> {
  const blob = new Blob([gifData], { type: 'image/gif' });
  const dataUrl = await blobToDataUrl(blob);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputFilename = filename?.replace(/[^a-z0-9_-]/gi, '_') || `${fallbackPrefix}_${timestamp}`;
  const fullFilename = outputFilename.endsWith('.gif') ? outputFilename : `${outputFilename}.gif`;

  const downloadId = await chrome.downloads.download({
    url: dataUrl,
    filename: fullFilename,
    saveAs: false,
  });

  await new Promise((resolve) => setTimeout(resolve, 100));

  let fullPath: string | undefined;
  try {
    const [downloadItem] = await chrome.downloads.search({ id: downloadId });
    fullPath = downloadItem?.filename;
  } catch {
    // Ignore path lookup errors.
  }

  return { downloadId, filename: fullFilename, fullPath };
}

export async function handleGifExportAction(
  context: GifExportContext,
  args: GifRecorderParams,
  lastRecordedGif: ExportableGif | null,
  exportCacheLifetimeMs: number,
): Promise<ToolResult> {
  if (!lastRecordedGif) {
    return createErrorResponse(
      'No recorded GIF available for export. Use action="stop" to finish a recording first.',
    );
  }

  if (Date.now() - lastRecordedGif.createdAt > exportCacheLifetimeMs) {
    return createErrorResponse('Cached GIF has expired. Please record a new GIF.');
  }

  const download = args.download !== false;
  if (download) {
    const saved = await saveGifToDownloads(
      lastRecordedGif.gifData,
      args.filename ?? lastRecordedGif.filename,
      'export',
      context.blobToDataUrl,
    );
    return context.buildResponse({
      success: true,
      action: 'export',
      mode: lastRecordedGif.mode,
      frameCount: lastRecordedGif.frameCount,
      durationMs: lastRecordedGif.durationMs,
      byteLength: lastRecordedGif.gifData.byteLength,
      downloadId: saved.downloadId,
      filename: saved.filename,
      fullPath: saved.fullPath,
    });
  }

  const { coordinates, ref, selector } = args;
  if (!coordinates && !ref && !selector) {
    return createErrorResponse(
      'For drag&drop upload, provide coordinates, ref, or selector to identify the drop target.',
    );
  }

  const tab = await context.resolveTargetTab(args.tabId);
  if (!tab?.id) {
    return createErrorResponse(
      typeof args.tabId === 'number' ? `Tab not found: ${args.tabId}` : 'No active tab found',
    );
  }

  if (context.isRestrictedUrl(tab.url)) {
    return createErrorResponse('Cannot upload to special browser pages or web store pages.');
  }

  const gifBase64 = btoa(
    Array.from(lastRecordedGif.gifData)
      .map((byte) => String.fromCharCode(byte))
      .join(''),
  );

  let targetX: number | undefined;
  let targetY: number | undefined;

  if (ref) {
    try {
      await context.injectContentScript(tab.id, ['inject-scripts/accessibility-tree-helper.js']);
      const resolved = await context.sendMessageToTab(tab.id, {
        action: TOOL_MESSAGE_TYPES.RESOLVE_REF,
        ref,
      });
      if (resolved?.success && resolved.center) {
        targetX = resolved.center.x;
        targetY = resolved.center.y;
      } else {
        return createErrorResponse(`Could not resolve ref: ${ref}`);
      }
    } catch (error) {
      return createErrorResponse(
        `Failed to resolve ref: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else if (selector) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (cssSelector: string) => {
          const el = document.querySelector(cssSelector);
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
        },
        args: [selector],
      });

      if (result?.result) {
        targetX = result.result.x;
        targetY = result.result.y;
      } else {
        return createErrorResponse(`Could not find element: ${selector}`);
      }
    } catch (error) {
      return createErrorResponse(
        `Failed to resolve selector: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else if (coordinates) {
    targetX = coordinates.x;
    targetY = coordinates.y;
  }

  if (typeof targetX !== 'number' || typeof targetY !== 'number') {
    return createErrorResponse('Invalid drop target coordinates.');
  }

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = args.filename ?? lastRecordedGif.filename ?? `recording_${timestamp}`;
    const fullFilename = filename.endsWith('.gif') ? filename : `${filename}.gif`;

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (base64Data: string, x: number, y: number, fname: string) => {
        const byteChars = atob(base64Data);
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
          byteArray[i] = byteChars.charCodeAt(i);
        }
        const blob = new Blob([byteArray], { type: 'image/gif' });
        const file = new File([blob], fname, { type: 'image/gif' });

        const target = document.elementFromPoint(x, y);
        if (!target) {
          return { success: false, error: 'No element at drop coordinates' };
        }

        const dt = new DataTransfer();
        dt.items.add(file);

        const events = ['dragenter', 'dragover', 'drop'] as const;
        for (const eventType of events) {
          const evt = new DragEvent(eventType, {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt,
            clientX: x,
            clientY: y,
          });
          target.dispatchEvent(evt);
        }

        return {
          success: true,
          targetTagName: target.tagName,
          targetId: target.id || undefined,
        };
      },
      args: [gifBase64, targetX, targetY, fullFilename],
    });

    if (!result?.result?.success) {
      return createErrorResponse(result?.result?.error || 'Drag&drop upload failed');
    }

    return context.buildResponse({
      success: true,
      action: 'export',
      mode: lastRecordedGif.mode,
      frameCount: lastRecordedGif.frameCount,
      durationMs: lastRecordedGif.durationMs,
      byteLength: lastRecordedGif.gifData.byteLength,
      uploadTarget: {
        x: targetX,
        y: targetY,
        tagName: result.result.targetTagName,
        id: result.result.targetId,
      },
    });
  } catch (error) {
    return createErrorResponse(
      `Drag&drop upload failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}