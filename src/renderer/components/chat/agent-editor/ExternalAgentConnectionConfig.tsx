import React, { useState, useEffect, useCallback } from 'react'
import { externalAgentApi, externalAgentEvents } from '../../../ipc/externalAgent'
import type { ExternalAgentConnectionInfo } from '@shared/ipc/externalAgent'
import { useToast } from '../../ui/ToastProvider'
import { useI18n } from '../../../lib/i18n/useI18n'

interface Props {
  token?: string;
}

/**
 * External Agent connection configuration panel.
 * Displays WS URL(s), connection status, and the bot's auth token (read-only).
 * Rendered inside the agent Basic tab when the agent has source='EXTERNAL'.
 */
const ExternalAgentConnectionConfig: React.FC<Props> = ({ token }) => {
  const [info, setInfo] = useState<ExternalAgentConnectionInfo | null>(null)
  const [showToken, setShowToken] = useState(false)
  const { showToast } = useToast()
  const { t } = useI18n()

  useEffect(() => {
    const load = async () => {
      const res = await externalAgentApi.getConnectionInfo()
      if (res.success && res.data) {
        setInfo(res.data)
      }
    }
    load()

    // Subscribe to real-time status changes
    const off = externalAgentEvents.statusChanged((_event, status) => {
      setInfo(prev => prev ? { ...prev, connected: status.connected } : prev)
    })
    return () => { off() }
  }, [])

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
    showToast(t('common.copiedToClipboard'), 'success')
  }, [showToast, t])

  if (!info) return null

  return (
    <div className="form-section">
      <label className="form-label">{t('agent.create.externalConnection')}</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* Status */}
        <div className="agent-meta-row">
          <div className="agent-meta-item">
            <span className="agent-meta-label">{t('common.status')}:</span>
            <span
              className="agent-meta-badge"
              style={{
                color: info.connected ? 'var(--color-success, var(--color-success-600))' : 'var(--text-secondary)',
              }}
            >
              {info.connected ? t('agent.create.connected') : t('agent.create.disconnected')}
            </span>
          </div>
        </div>

        {/* WS URLs */}
        {info.port && info.addresses.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span className="agent-meta-label">{t('agent.create.websocketUrl')}</span>
            {info.addresses.map(addr => {
              const url = `ws://${addr}:${info.port}`
              return (
                <div key={addr} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <code style={{
                    flex: 1,
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '13px',
                    backgroundColor: 'var(--bg-secondary, var(--color-neutral-100))',
                    fontFamily: 'monospace',
                  }}>
                    {url}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy(url)}
                    style={{
                      padding: '4px 8px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      border: '1px solid var(--border-color, var(--color-neutral-200))',
                      borderRadius: '4px',
                      backgroundColor: 'transparent',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {t('common.copy')}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Token (read-only, per bot) */}
        {token && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span className="agent-meta-label">{t('agent.create.authToken')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <code style={{
                flex: 1,
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '13px',
                backgroundColor: 'var(--bg-secondary, var(--color-neutral-100))',
                fontFamily: 'monospace',
              }}>
                {showToken ? token : '••••••••••••••••'}
              </code>
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  border: '1px solid var(--border-color, var(--color-neutral-200))',
                  borderRadius: '4px',
                  backgroundColor: 'transparent',
                  color: 'var(--text-secondary)',
                  minWidth: '50px',
                }}
              >
                {showToken ? t('common.hide') : t('common.show')}
              </button>
              <button
                type="button"
                onClick={() => handleCopy(token)}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  border: '1px solid var(--border-color, var(--color-neutral-200))',
                  borderRadius: '4px',
                  backgroundColor: 'transparent',
                  color: 'var(--text-secondary)',
                }}
              >
                {t('common.copy')}
              </button>
            </div>
          </div>
        )}

        {/* Setup hint */}
        <div style={{
          padding: '10px 12px',
          borderRadius: '6px',
          backgroundColor: 'var(--bg-secondary, var(--color-neutral-100))',
          fontSize: '12px',
          color: 'var(--text-secondary)',
          lineHeight: '1.6',
        }}>
          <div style={{ fontWeight: 500, marginBottom: '4px' }}>{t('agent.create.openClawSetup')}</div>
          <div>{t('agent.create.openClawConfigHint')} <code>config.yaml</code>:</div>
          <pre style={{
            margin: '6px 0 0',
            padding: '8px',
            borderRadius: '4px',
            backgroundColor: 'var(--bg-primary, var(--color-white))',
            fontSize: '11px',
            overflow: 'auto',
            whiteSpace: 'pre',
          }}>{`plugins:\n  entries:\n    openkosmos:\n      enabled: true\n      config:\n        url: "${info.addresses[0] ? `ws://${info.addresses[0]}:${info.port}` : 'ws://<your-ip>:' + info.port}"\n        accounts:\n          <openclaw-agent-id>:\n            token: "${token ? '<click Show above to reveal>' : '<no token>'}"`}</pre>
        </div>
      </div>
    </div>
  )
}

export default ExternalAgentConnectionConfig
