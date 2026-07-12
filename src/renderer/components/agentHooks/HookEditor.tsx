import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  validateFormState,
  HOOK_EVENTS,
  HOOK_ACTION_TYPES,
  HOOK_HTTP_METHODS,
  type HookActionType,
  type HookOperationForm,
  type HookFormState,
} from './hookFormModel';
import { useI18n } from '../../lib/i18n/useI18n';
import '../../styles/DropdownMenu.css';
import '../../styles/AgentHooks.css';

interface HookEditorProps {
  initial: HookFormState;
  saveError: string | null;
  busy: boolean;
  isNew: boolean;
  onSave: (state: HookFormState) => void;
  onCancel: () => void;
}

const EditorSection: React.FC<{ title: string; description: React.ReactNode; children: React.ReactNode }> = ({
  title,
  description,
  children,
}) => (
  <section className="hook-editor-section">
    <div className="hook-editor-section-header">
      <h4 className="hook-editor-section-title">{title}</h4>
      <p className="hook-editor-section-desc">{description}</p>
    </div>
    <div className="hook-editor-section-body">{children}</div>
  </section>
);

const RequirementBadge: React.FC<{ required?: boolean; label: string }> = ({ required = false, label }) => (
  <span className={`field-requirement ${required ? 'field-requirement--required' : 'field-requirement--optional'}`}>
    {label}
  </span>
);

const FieldHint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="hook-field-hint">{children}</p>
);

const HookSelect = <T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setOpen(true);
  };

  const selectOption = (event: React.MouseEvent<HTMLButtonElement>, option: T) => {
    event.preventDefault();
    event.stopPropagation();
    onChange(option);
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (triggerRef.current?.contains(target) || menuRef.current?.contains(target))) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`hook-select-trigger${open ? ' is-open' : ''}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="hook-select-trigger-text">{value}</span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open && position ? (
        <div
          ref={menuRef}
          className="dropdown-menu hook-select-menu"
          style={{ top: `${position.top}px`, left: `${position.left}px`, width: `${position.width}px` }}
          role="listbox"
          onMouseDown={event => event.stopPropagation()}
        >
          {options.map(option => (
            <button
              key={option}
              type="button"
              className={`dropdown-menu-item hook-select-menu-item${option === value ? ' is-selected' : ''}`}
              role="option"
              aria-label={option}
              aria-selected={option === value}
              onMouseDown={event => selectOption(event, option)}
              onClick={event => selectOption(event, option)}
            >
              <span className="dropdown-menu-item-icon">
                {option === value ? <Check size={16} strokeWidth={1.5} /> : null}
              </span>
              <span className="dropdown-menu-item-text">{option}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
};

const HookEditor: React.FC<HookEditorProps> = ({
  initial,
  saveError,
  busy,
  isNew,
  onSave,
  onCancel,
}) => {
  const { t } = useI18n();
  const [state, setState] = useState<HookFormState>(initial);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    setState(initial);
    setShowErrors(false);
  }, [initial]);

  const update = (patch: Partial<HookFormState>) => setState(prev => ({ ...prev, ...patch }));

  const updateOperation = (patch: Partial<HookOperationForm>) => {
    setState(prev => ({
      ...prev,
      operation: { ...prev.operation, ...patch },
    }));
  };

  const errors = validateFormState(state, t);
  const operation = state.operation;
  const requiredLabel = t('agent.hooks.editor.required');
  const optionalLabel = t('agent.hooks.editor.optional');

  const handleSave = () => {
    if (errors.length > 0) {
      setShowErrors(true);
      return;
    }
    onSave(state);
  };

  return (
    <div className="hook-editor">
      <EditorSection title={t('agent.hooks.editor.detailsTitle')} description={t('agent.hooks.editor.detailsDescription')}>
        <div className="hook-editor-grid">
          <label className="hook-field">
            <span className="hook-field-label">
              {t('agent.hooks.editor.name')}
              <RequirementBadge required label={requiredLabel} />
            </span>
            <input
              type="text"
              className="hook-input"
              value={state.name}
              onChange={e => update({ name: e.target.value })}
              aria-label={t('agent.hooks.editor.nameAria')}
            />
            <FieldHint>{t('agent.hooks.editor.nameHint')}</FieldHint>
          </label>

          <label className="hook-field hook-field--full">
            <span className="hook-field-label">
              {t('agent.hooks.editor.description')}
              <RequirementBadge label={optionalLabel} />
            </span>
            <textarea
              className="hook-textarea"
              value={state.description}
              onChange={e => update({ description: e.target.value })}
              aria-label={t('agent.hooks.editor.descriptionAria')}
            />
            <FieldHint>{t('agent.hooks.editor.descriptionHint')}</FieldHint>
          </label>
        </div>
      </EditorSection>

      <EditorSection
        title={t('agent.hooks.editor.operationTitle')}
        description={(
          <>
            {t('agent.hooks.editor.operationDescriptionPrefix')}{' '}
            <a
              href="https://code.claude.com/docs/en/hooks"
              target="_blank"
              rel="noreferrer"
              className="hook-editor-section-link"
            >
              {t('agent.hooks.editor.officialReference')}
            </a>
            .
          </>
        )}
      >
        <div data-testid="hook-operation" className="hook-operation-card">
          <div className="hook-editor-grid">
            <label className="hook-field">
              <span className="hook-field-label">
                {t('agent.hooks.editor.event')}
                <RequirementBadge required label={requiredLabel} />
              </span>
              <HookSelect
                value={operation.event}
                options={HOOK_EVENTS}
                onChange={event => updateOperation({ event })}
                ariaLabel={t('agent.hooks.editor.event')}
              />
              <FieldHint>{t('agent.hooks.editor.eventHint')}</FieldHint>
            </label>

            <label className="hook-field">
              <span className="hook-field-label">
                {t('agent.hooks.editor.matcher')}
                <RequirementBadge label={optionalLabel} />
              </span>
              <input
                type="text"
                className="hook-input"
                value={operation.matcher}
                onChange={e => updateOperation({ matcher: e.target.value })}
                placeholder={t('agent.hooks.editor.matcherPlaceholder')}
                aria-label={t('agent.hooks.editor.matcher')}
              />
              <FieldHint>{t('agent.hooks.editor.matcherHint')}</FieldHint>
            </label>

            <label className="hook-field">
              <span className="hook-field-label">
                {t('agent.hooks.editor.actionType')}
                <RequirementBadge required label={requiredLabel} />
              </span>
              <HookSelect
                value={operation.actionType}
                options={HOOK_ACTION_TYPES}
                onChange={(actionType: HookActionType) => updateOperation({ actionType })}
                ariaLabel={t('agent.hooks.editor.actionType')}
              />
              <FieldHint>{t('agent.hooks.editor.actionTypeHint')}</FieldHint>
            </label>

            <label className="hook-field hook-field--full">
              <span className="hook-field-label">
                {t('agent.hooks.editor.ifCondition')}
                <RequirementBadge label={optionalLabel} />
              </span>
              <input
                type="text"
                className="hook-input"
                value={operation.ifCondition}
                onChange={e => updateOperation({ ifCondition: e.target.value })}
                placeholder={t('agent.hooks.editor.ifConditionPlaceholder')}
                aria-label={t('agent.hooks.editor.ifCondition')}
              />
              <FieldHint>{t('agent.hooks.editor.ifConditionHint')}</FieldHint>
            </label>
          </div>

          {operation.actionType === 'http' ? (
            <div className="hook-editor-grid">
              <label className="hook-field hook-field--full">
                <span className="hook-field-label">
                  {t('agent.hooks.editor.url')}
                  <RequirementBadge required label={requiredLabel} />
                </span>
                <input
                  type="text"
                  className="hook-input"
                  value={operation.url}
                  onChange={e => updateOperation({ url: e.target.value })}
                  placeholder="https://example.com/webhook"
                  aria-label={t('agent.hooks.editor.url')}
                />
                <FieldHint>{t('agent.hooks.editor.urlHint')}</FieldHint>
              </label>

              <label className="hook-field">
                <span className="hook-field-label">
                  {t('agent.hooks.editor.method')}
                  <RequirementBadge required label={requiredLabel} />
                </span>
                <HookSelect
                  value={operation.method}
                  options={HOOK_HTTP_METHODS}
                  onChange={method => updateOperation({ method })}
                  ariaLabel={t('agent.hooks.editor.method')}
                />
                <FieldHint>{t('agent.hooks.editor.methodHint')}</FieldHint>
              </label>

              <label className="hook-field hook-field--full">
                <span className="hook-field-label">
                  {t('agent.hooks.editor.headers')}
                  <RequirementBadge label={optionalLabel} />
                </span>
                <textarea
                  className="hook-textarea hook-textarea--mono"
                  value={operation.headersText}
                  onChange={e => updateOperation({ headersText: e.target.value })}
                  placeholder={t('agent.hooks.editor.headersPlaceholder')}
                  aria-label={t('agent.hooks.editor.headers')}
                />
                <FieldHint>{t('agent.hooks.editor.headersHint')}</FieldHint>
              </label>

              <label className="hook-field hook-field--full">
                <span className="hook-field-label">
                  {t('agent.hooks.editor.body')}
                  <RequirementBadge label={optionalLabel} />
                </span>
                <textarea
                  className="hook-textarea hook-textarea--mono"
                  value={operation.body}
                  onChange={e => updateOperation({ body: e.target.value })}
                  placeholder={t('agent.hooks.editor.bodyPlaceholder')}
                  aria-label={t('agent.hooks.editor.body')}
                />
                <FieldHint>{t('agent.hooks.editor.bodyHint')}</FieldHint>
              </label>
            </div>
          ) : (
            <div className="hook-editor-grid">
              <label className="hook-field hook-field--full">
                <span className="hook-field-label">
                  {t('agent.hooks.editor.command')}
                  <RequirementBadge required label={requiredLabel} />
                </span>
                <textarea
                  className="hook-textarea hook-textarea--mono"
                  value={operation.command}
                  onChange={e => updateOperation({ command: e.target.value })}
                  placeholder={t('agent.hooks.editor.command')}
                  aria-label={t('agent.hooks.editor.command')}
                />
                <FieldHint>{t('agent.hooks.editor.commandHint')}</FieldHint>
              </label>

              <div className="hook-field hook-field--full">
                <label className="hook-checkbox-label">
                  <input
                    type="checkbox"
                    checked={operation.execForm}
                    onChange={e => updateOperation({ execForm: e.target.checked })}
                    aria-label={t('agent.hooks.editor.execForm')}
                  />
                  {t('agent.hooks.editor.execForm')}
                </label>
                {operation.execForm ? (
                  <textarea
                    className="hook-textarea hook-textarea--mono"
                    value={operation.argsText}
                    onChange={e => updateOperation({ argsText: e.target.value })}
                    placeholder={t('agent.hooks.editor.argumentsPlaceholder')}
                    aria-label={t('agent.hooks.editor.arguments')}
                  />
                ) : null}
                <FieldHint>{t('agent.hooks.editor.execFormHint')}</FieldHint>
              </div>
            </div>
          )}

          <div className="hook-operation-options">
            <label className="hook-field">
              <span className="hook-field-label">
                {t('agent.hooks.editor.timeout')}
                <span className="hook-field-unit">{t('agent.hooks.editor.secondsUnit')}</span>
                <RequirementBadge label={optionalLabel} />
              </span>
              <input
                type="text"
                className="hook-input hook-input--inline"
                value={operation.timeout}
                onChange={e => updateOperation({ timeout: e.target.value })}
                placeholder={t('agent.hooks.editor.secondsPlaceholder')}
                aria-label={t('agent.hooks.editor.timeout')}
              />
              <FieldHint>{t('agent.hooks.editor.timeoutHint')}</FieldHint>
            </label>

            <div className="hook-field">
              <span className="hook-field-label">
                {t('agent.hooks.editor.execution')}
                <RequirementBadge label={optionalLabel} />
              </span>
              <label className="hook-checkbox-label">
                <input
                  type="checkbox"
                  checked={operation.async}
                  onChange={e => updateOperation({ async: e.target.checked })}
                  aria-label={t('agent.hooks.editor.async')}
                />
                {t('agent.hooks.editor.async')}
              </label>
              <FieldHint>{t('agent.hooks.editor.asyncHint')}</FieldHint>
            </div>
          </div>
        </div>
      </EditorSection>

      {showErrors && errors.length > 0 ? (
        <ul className="hook-errors">
          {errors.map(error => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}

      {saveError ? <p className="agent-hooks-error">{saveError}</p> : null}

      <div className="hook-actions-row">
        <button
          type="button"
          className="hook-btn hook-btn--primary"
          onClick={handleSave}
          disabled={busy}
          aria-label={t('agent.hooks.editor.saveHook')}
        >
          {busy ? (isNew ? t('agent.hooks.editor.creating') : t('agent.hooks.editor.updating')) : isNew ? t('agent.hooks.editor.create') : t('agent.hooks.editor.update')}
        </button>
        <button
          type="button"
          className="hook-btn hook-btn--ghost"
          onClick={onCancel}
          disabled={busy}
          aria-label={t('common.cancel')}
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
};

export default HookEditor;
