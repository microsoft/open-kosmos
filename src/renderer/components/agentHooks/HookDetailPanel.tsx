import React from 'react';
import type { HookAction, HookDefinition } from '@shared/ipc/agentHooks';
import { Badge } from '../ui/badge';
import { type TranslationKey, type TranslationParams } from '../../lib/i18n';
import { useI18n } from '../../lib/i18n/useI18n';
import '../../styles/AgentHooks.css';

interface HookDetailPanelProps {
  hook: HookDefinition | null;
}

interface PropertyItemProps {
  label: string;
  children: React.ReactNode;
  code?: boolean;
}

const DEFAULT_HTTP_METHOD = 'POST';
type TFunction = (key: TranslationKey, params?: TranslationParams) => string;

function actionSummary(action: HookAction, t: TFunction): string {
  if (action.type === 'command') return t('agent.hooks.detail.runsCommand');
  return t('agent.hooks.detail.sendsRequest', { method: action.method ?? DEFAULT_HTTP_METHOD });
}

function actionTimeout(action: HookAction, t: TFunction): string {
  if (typeof action.timeout === 'number') return `${action.timeout}s`;
  if (typeof action.timeoutMs === 'number') return `${action.timeoutMs}ms`;
  return t('agent.hooks.detail.defaultTimeout');
}

function commandLine(action: Extract<HookAction, { type: 'command' }>): string {
  return [action.command, ...(action.args ?? [])].join(' ');
}

function formatHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

const PropertyItem: React.FC<PropertyItemProps> = ({ label, children, code = false }) => (
  <div className="hook-detail-property-item">
    <span className="hook-detail-property-label">{label}</span>
    <span className={code ? 'hook-detail-property-value hook-detail-property-value--code' : 'hook-detail-property-value'}>
      {children}
    </span>
  </div>
);

const CodeBlock: React.FC<{ children: string; testId?: string }> = ({ children, testId }) => (
  <pre className="hook-detail-code-block" data-testid={testId}>
    <code>{children}</code>
  </pre>
);

const ActionDetail: React.FC<{ action: HookAction; t: TFunction }> = ({ action, t }) => {
  if (action.type === 'command') {
    return (
      <>
        <div className="hook-detail-action-card hook-detail-action-card--command">
          <div className="hook-detail-action-card-header">
            <span className="hook-detail-action-type">{t('agent.hooks.detail.command')}</span>
            <span className="hook-detail-action-summary">{actionSummary(action, t)}</span>
          </div>
          <CodeBlock testId="detail-command">{commandLine(action)}</CodeBlock>
        </div>
        <div className="hook-detail-property-grid">
          <PropertyItem label={t('agent.hooks.detail.asyncExecution')}>{action.async ? t('agent.hooks.detail.yes') : t('agent.hooks.detail.no')}</PropertyItem>
          <PropertyItem label={t('agent.hooks.detail.timeout')}>{actionTimeout(action, t)}</PropertyItem>
        </div>
      </>
    );
  }

  const headers = action.headers ? formatHeaders(action.headers) : '';

  return (
    <>
      <div className="hook-detail-action-card hook-detail-action-card--http">
        <div className="hook-detail-action-card-header">
          <span className="hook-detail-action-type">HTTP</span>
          <span className="hook-detail-action-summary">{actionSummary(action, t)}</span>
        </div>
        <div className="hook-detail-endpoint">
          <span className="hook-detail-method">{action.method ?? DEFAULT_HTTP_METHOD}</span>
          <code>{action.url}</code>
        </div>
      </div>
      <div className="hook-detail-property-grid">
        <PropertyItem label={t('agent.hooks.detail.asyncExecution')}>{action.async ? t('agent.hooks.detail.yes') : t('agent.hooks.detail.no')}</PropertyItem>
        <PropertyItem label={t('agent.hooks.detail.timeout')}>{actionTimeout(action, t)}</PropertyItem>
      </div>
      {headers ? (
        <div className="hook-detail-subsection">
          <h4 className="hook-detail-subsection-title">{t('agent.hooks.detail.headers')}</h4>
          <CodeBlock testId="detail-headers">{headers}</CodeBlock>
        </div>
      ) : null}
      {action.body ? (
        <div className="hook-detail-subsection">
          <h4 className="hook-detail-subsection-title">{t('agent.hooks.detail.body')}</h4>
          <CodeBlock testId="detail-body">{action.body}</CodeBlock>
        </div>
      ) : null}
    </>
  );
};

const HookDetailPanel: React.FC<HookDetailPanelProps> = ({ hook }) => {
  const { t } = useI18n();
  if (!hook) {
    return (
      <div className="hook-detail-panel">
        <div className="hook-detail-empty">{t('agent.hooks.detail.empty')}</div>
      </div>
    );
  }

  return (
    <div className="hook-detail-panel">
      <div className="hook-detail">
        <div className="hook-detail-header">
          <div className="hook-detail-header-info">
            <div className="hook-detail-header-text">
              <h3 className="hook-detail-name">{hook.name}</h3>
              <p className="hook-detail-header-subtitle">{actionSummary(hook.action, t)}</p>
            </div>
          </div>
          <div className="hook-detail-badges">
            <span className={`hook-status ${hook.enabled ? 'enabled' : 'disabled'}`}>
              {hook.enabled ? t('agent.hooks.enabledStatus') : t('agent.hooks.disabledStatus')}
            </span>
            <Badge variant="normal" className="text-xs">
              {hook.source}
            </Badge>
            {hook.version ? (
              <Badge variant="normal" className="text-xs">
                v{hook.version}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="hook-detail-content">
          <section className="hook-detail-section">
            <h4 className="hook-detail-section-title">{t('agent.hooks.detail.description')}</h4>
            <div className="hook-detail-section-content">
              <p className="hook-detail-description">
                {hook.description || t('agent.hooks.detail.noDescription')}
              </p>
            </div>
          </section>

          <section className="hook-detail-section">
            <h4 className="hook-detail-section-title">{t('agent.hooks.detail.trigger')}</h4>
            <div className="hook-detail-section-content">
              <div className="hook-detail-property-grid">
                <PropertyItem label={t('agent.hooks.detail.event')}>{hook.event}</PropertyItem>
                <PropertyItem label={t('agent.hooks.detail.matcher')} code>
                  {hook.matcher || t('agent.hooks.detail.allTools')}
                </PropertyItem>
                {hook.action.if ? (
                  <PropertyItem label={t('agent.hooks.detail.condition')} code>
                    {hook.action.if}
                  </PropertyItem>
                ) : null}
              </div>
            </div>
          </section>

          <section className="hook-detail-section">
            <h4 className="hook-detail-section-title">{t('agent.hooks.detail.action')}</h4>
            <div className="hook-detail-section-content">
              <ActionDetail action={hook.action} t={t} />
            </div>
          </section>

          <section className="hook-detail-section">
            <h4 className="hook-detail-section-title">{t('agent.hooks.detail.metadata')}</h4>
            <div className="hook-detail-section-content">
              <div className="hook-detail-property-grid">
                <PropertyItem label={t('agent.hooks.detail.hookId')} code>
                  {hook.id}
                </PropertyItem>
                {hook.remoteVersion ? <PropertyItem label={t('agent.hooks.detail.remoteVersion')}>v{hook.remoteVersion}</PropertyItem> : null}
                <PropertyItem label={t('agent.hooks.detail.created')}>{hook.createdAt}</PropertyItem>
                <PropertyItem label={t('agent.hooks.detail.updated')}>{hook.updatedAt}</PropertyItem>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default HookDetailPanel;
