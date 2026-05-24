import { type Tool } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from './tool-names';

export const browserSupportToolSchemas: Tool[] = [
  {
    name: TOOL_NAMES.BROWSER.GIF_RECORDER,
    description:
      'Record browser tab activity as an animated GIF.\n\nModes:\n- Fixed FPS mode (action="start"): Captures frames at regular intervals. Good for animations/videos.\n- Auto-capture mode (action="auto_start"): Captures frames automatically when chrome_computer or chrome_navigate actions succeed. Better for interaction recordings with natural pacing.\n\nUse "stop" to end recording and save the GIF.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'stop', 'status', 'auto_start', 'capture', 'clear', 'export'],
          description:
            'Action to perform:\n- "start": Begin fixed-FPS recording (captures frames at regular intervals)\n- "auto_start": Begin auto-capture mode (frames captured on tool actions)\n- "stop": End recording and save GIF\n- "status": Get current recording state\n- "capture": Manually trigger a frame capture in auto mode\n- "clear": Clear all recording state and cached GIF without saving\n- "export": Export the last recorded GIF (download or drag&drop upload)',
        },
        tabId: {
          type: 'number',
          description:
            'Target tab ID (default: active tab). Used with "start"/"auto_start" for recording, and with "export" (download=false) for drag&drop upload target.',
        },
        fps: {
          type: 'number',
          description:
            'Frames per second for fixed-FPS mode (1-30, default: 5). Higher values = smoother but larger file.',
        },
        durationMs: {
          type: 'number',
          description:
            'Maximum recording duration in milliseconds (default: 5000, max: 60000). Only for fixed-FPS mode.',
        },
        maxFrames: {
          type: 'number',
          description:
            'Maximum number of frames to capture (default: 50 for fixed-FPS, 100 for auto mode, max: 300).',
        },
        width: {
          type: 'number',
          description: 'Output GIF width in pixels (default: 800, max: 1920).',
        },
        height: {
          type: 'number',
          description: 'Output GIF height in pixels (default: 600, max: 1080).',
        },
        maxColors: {
          type: 'number',
          description:
            'Maximum colors in palette (default: 256). Lower values = smaller file size.',
        },
        filename: {
          type: 'string',
          description: 'Output filename (without extension). Defaults to timestamped name.',
        },
        captureDelayMs: {
          type: 'number',
          description:
            'Auto-capture mode only: Delay in ms after action before capturing frame (default: 150). Allows UI to stabilize.',
        },
        frameDelayCs: {
          type: 'number',
          description:
            'Auto-capture mode only: Display duration per frame in centiseconds (default: 20 = 200ms per frame).',
        },
        annotation: {
          type: 'string',
          description:
            'Auto-capture mode only (action="capture"): Optional text label to render on the captured frame.',
        },
        download: {
          type: 'boolean',
          description:
            'Export action only: Set to true (default) to download the GIF, or false to upload via drag&drop.',
        },
        coordinates: {
          type: 'object',
          description:
            'Export action only (when download=false): Target coordinates for drag&drop upload.',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
          },
          required: ['x', 'y'],
        },
        ref: {
          type: 'string',
          description:
            'Export action only (when download=false): Element ref from chrome_read_page for drag&drop target.',
        },
        selector: {
          type: 'string',
          description:
            'Export action only (when download=false): CSS selector for drag&drop target element.',
        },
        enhancedRendering: {
          type: 'object',
          description:
            'Auto-capture mode only: Configure visual overlays for recorded actions (click indicators, drag paths, labels). Pass `true` to enable all defaults.',
          properties: {
            clickIndicators: {
              oneOf: [
                { type: 'boolean' },
                {
                  type: 'object',
                  properties: {
                    enabled: {
                      type: 'boolean',
                      description: 'Enable click indicators (default: true)',
                    },
                    color: {
                      type: 'string',
                      description:
                        'CSS color for click indicator (default: "rgba(255, 87, 34, 0.8)")',
                    },
                    radius: { type: 'number', description: 'Initial radius in px (default: 20)' },
                    animationDurationMs: {
                      type: 'number',
                      description: 'Animation duration in ms (default: 400)',
                    },
                    animationFrames: {
                      type: 'number',
                      description: 'Number of animation frames (default: 3)',
                    },
                    animationIntervalMs: {
                      type: 'number',
                      description: 'Interval between animation frames in ms (default: 80)',
                    },
                  },
                },
              ],
              description:
                'Click indicator overlay config (true for defaults, or object for custom).',
            },
            dragPaths: {
              oneOf: [
                { type: 'boolean' },
                {
                  type: 'object',
                  properties: {
                    enabled: {
                      type: 'boolean',
                      description: 'Enable drag path rendering (default: true)',
                    },
                    color: {
                      type: 'string',
                      description: 'CSS color for drag path (default: "rgba(33, 150, 243, 0.7)")',
                    },
                    lineWidth: { type: 'number', description: 'Line width in px (default: 3)' },
                    lineDash: {
                      type: 'array',
                      items: { type: 'number' },
                      description: 'Dash pattern (default: [6, 4])',
                    },
                    arrowSize: {
                      type: 'number',
                      description: 'Arrow head size in px (default: 10)',
                    },
                  },
                },
              ],
              description: 'Drag path overlay config (true for defaults, or object for custom).',
            },
            labels: {
              oneOf: [
                { type: 'boolean' },
                {
                  type: 'object',
                  properties: {
                    enabled: {
                      type: 'boolean',
                      description: 'Enable action labels (default: true)',
                    },
                    font: {
                      type: 'string',
                      description: 'Font for labels (default: "bold 12px sans-serif")',
                    },
                    textColor: { type: 'string', description: 'Text color (default: "#fff")' },
                    bgColor: {
                      type: 'string',
                      description: 'Background color (default: "rgba(0,0,0,0.7)")',
                    },
                    padding: { type: 'number', description: 'Padding in px (default: 4)' },
                    borderRadius: {
                      type: 'number',
                      description: 'Border radius in px (default: 4)',
                    },
                    offset: {
                      type: 'object',
                      properties: { x: { type: 'number' }, y: { type: 'number' } },
                      description: 'Offset from action position (default: {x: 10, y: -20})',
                    },
                  },
                },
              ],
              description: 'Action label overlay config (true for defaults, or object for custom).',
            },
            durationMs: {
              type: 'number',
              description: 'How long overlays remain visible in ms (default: 1500).',
            },
          },
        },
      },
      required: ['action'],
    },
  },

];
