import { useEffect, useState, memo, useRef } from 'react';
import { profileDataManager } from '@/lib/userData/profileDataManager';
import { useAgentConfig } from '../../userData/userDataProvider';
import { getModelCapabilities } from '@/lib/models/ghcModels';
import { useClickOut } from '@/components/ui/use-click-out';

interface Props {
  currentChatId: string | null;
  shouldLockComposeUi: boolean;
}

/**
 * Per-chat reasoning effort selector.
 *
 * - Renders nothing unless the current model exposes `capabilities.supports.reasoning_effort`
 *   with more than one tier (single-option models give the user no real choice).
 * - Lists every effort tier reported by the API; one is annotated "(default)"
 *   based on a vendor-aware heuristic that mirrors the VS Code Copilot UI:
 *     - Claude models : `high` → `medium` → first reported
 *     - GPT / others  : `medium` → `high` → first reported
 *   The Copilot `/models` API does not actually report which tier is the
 *   server-side default.
 * - Persisted state lives on the ChatAgent (`agent.reasoningEffort`). When the
 *   user hasn't picked one yet, the request layer sends the vendor-aware
 *   default (same value shown as "(default)" in the UI) so the behavior
 *   always matches what the user sees.
 */
function Selector({ currentChatId, shouldLockComposeUi }: Props) {
  const { updateConfig, isLoading } = useAgentConfig();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Track current model + saved effort, refresh on cache changes.
  const [modelId, setModelId] = useState<string | null>(() =>
    currentChatId ? profileDataManager.getSelectedModel(currentChatId) : null,
  );
  const [effort, setEffort] = useState<string | undefined>(() =>
    currentChatId ? getStoredEffort(currentChatId) : undefined,
  );

  useEffect(() => {
    setModelId(currentChatId ? profileDataManager.getSelectedModel(currentChatId) : null);
    setEffort(currentChatId ? getStoredEffort(currentChatId) : undefined);
  }, [currentChatId]);

  useEffect(() => {
    return profileDataManager.subscribe(() => {
      if (!currentChatId) return;
      setModelId(profileDataManager.getSelectedModel(currentChatId));
      setEffort(getStoredEffort(currentChatId));
    });
  }, [currentChatId]);

  useClickOut(ref, () => setOpen(false));

  const caps = modelId ? getModelCapabilities(modelId) : null;
  const supported = caps?.reasoningEfforts;
  // Hide selector if model doesn't support reasoning OR only has one option (no choice to make)
  if (!supported || supported.length <= 1) return null;

  // Heuristic default tier by vendor — Copilot API does not expose this:
  // - Claude models: high → medium → first (VS Code uses High as default for Claude)
  // - GPT models: medium → high → first (VS Code uses Medium as default for GPT)
  // - Others: medium → high → first (fallback to GPT-style)
  const getDefaultEffort = (mid: string | null, efforts: string[]): string => {
    const isClaudeModel = mid?.toLowerCase().includes('claude') ?? false;
    if (isClaudeModel) {
      return efforts.find(e => e === 'high')
        ?? efforts.find(e => e === 'medium')
        ?? efforts[0];
    }
    // GPT and others default to medium
    return efforts.find(e => e === 'medium')
      ?? efforts.find(e => e === 'high')
      ?? efforts[0];
  };
  const defaultEffort = getDefaultEffort(modelId, supported);

  // Persisted value drives both UI highlight and request injection. When the
  // user hasn't picked one yet, highlight the heuristic default but leave the
  // request layer alone (it sends nothing → server-side default applies).
  const effectiveEffort = effort && supported.includes(effort) ? effort : defaultEffort;
  const isUsingDefault = !effort || !supported.includes(effort);
  const buttonLabel = isUsingDefault
    ? `${formatLabel(defaultEffort)} (default)`
    : formatLabel(effectiveEffort);

  const handleSelect = async (value: string) => {
    setOpen(false);
    const canonical = value.toLowerCase();
    if (canonical === effort) return;
    const previous = effort;
    setEffort(canonical);
    try {
      const result = await updateConfig({ reasoningEffort: canonical });
      if (result && result.success === false) {
        setEffort(previous);
      }
    } catch {
      setEffort(previous);
    }
  };

  return (
    <div className="reasoning-effort-selector" ref={ref}>
      <button
        className="reasoning-effort-button"
        onClick={() => setOpen(o => !o)}
        disabled={isLoading || shouldLockComposeUi}
        title="Reasoning effort"
      >
        <span className="reasoning-effort-label">{buttonLabel}</span>
      </button>
      {open && (
        <div className="reasoning-effort-dropdown">
          {supported.map(level => (
            <button
              key={level}
              className={`reasoning-effort-option ${effectiveEffort === level ? 'selected' : ''}`}
              onClick={() => handleSelect(level)}
            >
              {formatLabel(level)}{level === defaultEffort ? ' (default)' : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function getStoredEffort(chatId: string): string | undefined {
  const fn = (profileDataManager as { getReasoningEffort?: (id: string) => string | undefined })
    .getReasoningEffort;
  return typeof fn === 'function' ? fn.call(profileDataManager, chatId) : undefined;
}

/** Display formatter — capitalize each word, replace `_`/`-` with spaces. */
function formatLabel(s: string): string {
  if (!s) return s;
  return s
    .split(/[_-]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export const ReasoningEffortSelector = memo(Selector);
