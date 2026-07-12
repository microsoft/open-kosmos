import { redactEmbeddedBrowserDiagnosticUrl, type getEmbeddedBrowserManager } from '../../embeddedBrowser/EmbeddedBrowserManager';
import type { EmbeddedBrowserToolArgs } from './embeddedBrowserToolTypes';
import { assertClickableExpression, assertTextExpression, assertVisibleExpression, dialogOpenExpression, enabledStateExpression, formValidityExpression, imagesLoadedExpression, inspectFramesExpression, layoutAuditExpression, listItemsExpression, mediaRenderedExpression, multiSelectExpression, networkErrorsExpression, notBlankExpression, semanticContainerExpression, setDateExpression, setSliderExpression, tableRowsExpression, toastExpression } from './embeddedBrowserToolExpressions';

type ToolError = { ok: false; error: string };
type Manager = NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>;
type ResolvedTarget = { found?: boolean };
type EnsurePageReady = (manager: Manager, sessionId: string, signal?: AbortSignal) => Promise<ToolError | undefined>;
type Fail = (error: string) => ToolError;
type HasLocator = (args: EmbeddedBrowserToolArgs) => boolean;
type HasFieldLocator = (args: EmbeddedBrowserToolArgs) => boolean;
const MAX_AX_NODES = 200;
const MAX_AX_STRING_CHARS = 500;

let ensurePageReady: EnsurePageReady;
let fail: Fail;
let hasLocator: HasLocator;
let hasFieldLocator: HasFieldLocator;

export function configureBrowserAssertionHandlers(deps: { ensurePageReady: EnsurePageReady; fail: Fail; hasLocator: HasLocator; hasFieldLocator: HasFieldLocator }): void {
  ensurePageReady = deps.ensurePageReady;
  fail = deps.fail;
  hasLocator = deps.hasLocator;
  hasFieldLocator = deps.hasFieldLocator;
}

export async function assertVisible(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  args: EmbeddedBrowserToolArgs,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!hasLocator(args)) return fail('assert_visible requires a locator.');
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const result = await manager.executeJs(sessionId, assertVisibleExpression(args)) as { visible?: boolean; found?: boolean };
  const expected = args.expected !== false;
  const passed = result.visible === expected;
  return { ok: passed, passed, expected, ...result };
}

export async function assertText(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  args: EmbeddedBrowserToolArgs,
  signal?: AbortSignal,
): Promise<unknown> {
  const expectedText = args.text?.trim();
  if (!expectedText) return fail('assert_text requires "text".');
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const result = await manager.executeJs(sessionId, assertTextExpression(args)) as { found?: boolean; text?: string };
  const passed = result.found === true;
  return { ok: passed, passed, expectedText, ...result };
}

export async function assertClickable(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  args: EmbeddedBrowserToolArgs,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!hasLocator(args)) return fail('assert_clickable requires a locator.');
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const result = await manager.executeJs(sessionId, assertClickableExpression(args)) as { clickable?: boolean };
  const passed = result.clickable === true;
  return { ok: passed, passed, ...result };
}

export async function assertEnabledState(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  args: EmbeddedBrowserToolArgs,
  signal: AbortSignal | undefined,
  expectedEnabled: boolean,
): Promise<unknown> {
  if (!hasLocator(args)) return fail(`${expectedEnabled ? 'assert_enabled' : 'assert_disabled'} requires a locator.`);
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const result = await manager.executeJs(sessionId, enabledStateExpression(args)) as { enabled?: boolean };
  const passed = result.enabled === expectedEnabled;
  return { ok: passed, passed, expectedEnabled, ...result };
}

export async function assertUrl(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  args: EmbeddedBrowserToolArgs,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!args.url?.trim()) return fail('assert_url requires url.');
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const state = manager.getNavState(sessionId);
  if (!state) return fail('The embedded browser has no page open yet. Call the navigate action first.');
  const expectedUrl = args.url.trim();
  const exact = args.exact ?? false;
  const actualUrl = getRawNavUrl(manager, sessionId, state.url);
  const passed = exact ? actualUrl === expectedUrl : actualUrl.includes(expectedUrl);
  return {
    ok: passed,
    passed,
    actualUrl: redactEmbeddedBrowserDiagnosticUrl(actualUrl),
    expectedUrl: redactEmbeddedBrowserDiagnosticUrl(expectedUrl),
    exact,
  };
}

function getRawNavUrl(manager: Manager, sessionId: string, fallbackUrl: string): string {
  const rawState = (manager as { getRawNavState?: (id: string) => { url?: string } | null }).getRawNavState?.(sessionId);
  return rawState?.url ?? fallbackUrl;
}

export async function assertNotBlank(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const result = await manager.executeJs(sessionId, notBlankExpression()) as { blank?: boolean };
  const passed = result.blank === false;
  return { ok: passed, passed, ...result };
}

export async function assertImagesLoaded(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const result = await manager.executeJs(sessionId, imagesLoadedExpression()) as { failures?: unknown[] };
  const failures = Array.isArray(result.failures) ? result.failures : [];
  return { ok: failures.length === 0, passed: failures.length === 0, ...result };
}

export async function assertMediaRendered(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  args: EmbeddedBrowserToolArgs,
  signal?: AbortSignal,
): Promise<unknown> {
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const result = await manager.executeJs(sessionId, mediaRenderedExpression(args)) as { passed?: boolean };
  const passed = result.passed === true;
  return { ok: passed, ...result };
}

export async function assertDialogOpen(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  args: EmbeddedBrowserToolArgs,
  signal?: AbortSignal,
): Promise<unknown> {
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const result = await manager.executeJs(sessionId, dialogOpenExpression(args)) as { found?: boolean };
  const passed = result.found === true;
  return { ok: passed, passed, ...result };
}

export async function assertToast(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  args: EmbeddedBrowserToolArgs,
  signal?: AbortSignal,
): Promise<unknown> {
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const result = await manager.executeJs(sessionId, toastExpression(args)) as { found?: boolean };
  const passed = result.found === true;
  return { ok: passed, passed, ...result };
}

export async function assertTableRows(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  args: EmbeddedBrowserToolArgs,
  signal?: AbortSignal,
): Promise<unknown> {
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const result = await manager.executeJs(sessionId, tableRowsExpression(args)) as { rowCount?: number; found?: boolean };
  const hasExpected = Number.isFinite(args.expectedCount);
  const passed = result.found === true && (!hasExpected || result.rowCount === Number(args.expectedCount));
  return { ok: passed, passed, expectedCount: hasExpected ? Number(args.expectedCount) : undefined, ...result };
}

export async function assertFormValidity(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  args: EmbeddedBrowserToolArgs,
  signal?: AbortSignal,
): Promise<unknown> {
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const result = await manager.executeJs(sessionId, formValidityExpression(args)) as { valid?: boolean; found?: boolean };
  const expected = args.expected !== false;
  const passed = result.found === true && result.valid === expected;
  return { ok: passed, passed, expected, ...result };
}

export async function assertSemanticContainer(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  args: EmbeddedBrowserToolArgs,
  signal: AbortSignal | undefined,
  kind: 'menu' | 'tooltip' | 'drawer' | 'card',
): Promise<unknown> {
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const result = await manager.executeJs(sessionId, semanticContainerExpression(args, kind)) as { found?: boolean };
  const passed = result.found === true;
  return { ok: passed, passed, kind, ...result };
}

export async function assertListItems(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  args: EmbeddedBrowserToolArgs,
  signal?: AbortSignal,
): Promise<unknown> {
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const result = await manager.executeJs(sessionId, listItemsExpression(args)) as { found?: boolean; itemCount?: number };
  const hasExpected = Number.isFinite(args.expectedCount);
  const passed = result.found === true && (!hasExpected || result.itemCount === Number(args.expectedCount));
  return { ok: passed, passed, expectedCount: hasExpected ? Number(args.expectedCount) : undefined, ...result };
}

export async function assertNoConsoleErrors(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const diagnostics = manager.getDiagnostics(sessionId);
  const errors = diagnostics.recentEvents.filter((event) =>
    event.type === 'page-error' ||
    event.type === 'load-failure' ||
    (event.type === 'console' && !['warning', 'warn', '2'].includes(String(event.level || '').toLowerCase()))
  );
  return { ok: errors.length === 0, passed: errors.length === 0, errors, checkedEvents: diagnostics.recentEvents.length };
}

export async function assertNoNetworkErrors(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const result = await manager.executeJs(sessionId, networkErrorsExpression()) as { failures?: unknown[] };
  const runtimeFailures = Array.isArray(result.failures) ? result.failures : [];
  const diagnostics = manager.getDiagnostics(sessionId);
  const cdpFailures = diagnostics.networkEvents.filter((event) =>
    event.type === 'failure' ||
    (event.type === 'response' && typeof event.status === 'number' && event.status >= 400)
  );
  const failures = [...runtimeFailures, ...cdpFailures];
  return { ok: failures.length === 0, passed: failures.length === 0, failures };
}

export async function accessibilitySnapshot(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const tree = await manager.sendCdpCommand(sessionId, 'Accessibility.getFullAXTree', {});
  return { ok: true, tree: capAccessibilityTree(tree) };
}

function capAccessibilityTree(tree: unknown): unknown {
  if (!tree || typeof tree !== 'object') return tree;
  const source = tree as { nodes?: unknown[] };
  if (!Array.isArray(source.nodes)) return sanitizeAxValue(tree);
  const nodes = source.nodes.slice(0, MAX_AX_NODES).map((node) => sanitizeAxValue(node));
  const rest = sanitizeAxValue({ ...source, nodes: undefined }) as Record<string, unknown>;
  return {
    ...rest,
    nodes,
    truncated: source.nodes.length > MAX_AX_NODES,
    nodeCount: source.nodes.length,
    returnedNodeCount: nodes.length,
  };
}

function sanitizeAxValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_AX_STRING_CHARS ? `${value.slice(0, MAX_AX_STRING_CHARS)}...` : value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeAxValue(item));
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) result[key] = sanitizeAxValue(child);
  }
  return result;
}

export async function setDate(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  args: EmbeddedBrowserToolArgs,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!hasFieldLocator(args)) return fail('set_date requires a locator.');
  const value = args.value?.trim() || args.text?.trim();
  if (!value) return fail('set_date requires "value" or "text".');
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const result = await manager.executeJs(sessionId, setDateExpression(args, value));
  if ((result as ResolvedTarget)?.found === false) return { ok: false, error: 'No date input matched the given locator.' };
  return { ok: true, ...(result as Record<string, unknown>) };
}

export async function multiSelect(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  args: EmbeddedBrowserToolArgs,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!hasFieldLocator(args)) return fail('multi_select requires a locator.');
  const values = (args.values?.length ? args.values : [args.value ?? args.text])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (values.length === 0) return fail('multi_select requires "values", "value", or "text".');
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const result = await manager.executeJs(sessionId, multiSelectExpression(args, values));
  if ((result as ResolvedTarget)?.found === false) return { ok: false, error: 'No multi-select matched the given locator/options.' };
  return { ok: true, ...(result as Record<string, unknown>) };
}

export async function networkDiagnostics(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  await manager.enableNetworkDiagnostics(sessionId);
  const runtime = await manager.executeJs(sessionId, networkErrorsExpression());
  return { ok: true, ...(runtime as Record<string, unknown>), networkEvents: manager.getDiagnostics(sessionId).networkEvents };
}

export async function downloadDiagnostics(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  return { ok: true, downloads: manager.getDiagnostics(sessionId).downloads };
}

export async function assertDownloaded(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  args: EmbeddedBrowserToolArgs,
  signal?: AbortSignal,
): Promise<unknown> {
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const expectedText = args.text?.trim().toLowerCase();
  const downloads = manager.getDiagnostics(sessionId).downloads;
  const completed = downloads.filter((event) => event.type === 'done' && (!event.state || event.state === 'completed'));
  const matches = expectedText
    ? completed.filter((event) => `${event.filename} ${event.url} ${event.savePath ?? ''}`.toLowerCase().includes(expectedText))
    : completed;
  return { ok: matches.length > 0, passed: matches.length > 0, matches, downloads };
}

export async function inspectFrames(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const frames = await manager.executeJs(sessionId, inspectFramesExpression());
  return { ok: true, ...(frames as Record<string, unknown>) };
}

export async function layoutAudit(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const restored = await ensurePageReady(manager, sessionId, signal);
  if (restored) return restored;
  const audit = await manager.executeJs(sessionId, layoutAuditExpression());
  return { ok: true, ...(audit as Record<string, unknown>) };
}
