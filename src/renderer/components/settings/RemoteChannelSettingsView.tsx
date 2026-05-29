'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import RemoteChannelSettingsHeaderView from './RemoteChannelSettingsHeaderView'
import RemoteChannelSettingsContentView from './RemoteChannelSettingsContentView'
import { remoteChannelApi, remoteChannelEvents } from '../../ipc/remoteChannel'
import { useFeatureFlag } from '../../lib/featureFlags'
import { useChats } from '../userData/userDataProvider'
import { profileDataManager } from '../../lib/userData'
import type { RemoteChannelsConfig, ChannelConfig, ChannelStatusInfo } from '@shared/ipc/remoteChannel'
import '../../styles/ContentView.css'
import '../../styles/SettingsShared.css'
import '../../styles/RemoteChannelSettings.css'

const RemoteChannelSettingsView: React.FC = () => {
  const remoteChannelEnabled = useFeatureFlag('kosmosFeatureRemoteChannel')
  const { chats } = useChats()

  // State
  const [config, setConfig] = useState<RemoteChannelsConfig>({})
  const [statusInfo, setStatusInfo] = useState<ChannelStatusInfo | null>(null)
  const [bindingStatus, setBindingStatus] = useState<{ bound: boolean; userId?: string }>({ bound: false })
  const [bindCode, setBindCode] = useState('')
  const [binding, setBinding] = useState(false)
  const [bindError, setBindError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Feature flag guard
  if (!remoteChannelEnabled) {
    return <Navigate to="/settings" replace />
  }

  // Chat options for agent dropdown
  const chatOptions = useMemo(() => {
    if (!chats) return []
    return chats
      .map((chat) => ({
        chatId: chat.chat_id,
        name: chat.agent?.name || chat.chat_id,
        emoji: chat.agent?.emoji || '',
      }))
  }, [chats])

  // Initial load
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      try {
        const [configRes, statusRes, bindRes] = await Promise.all([
          remoteChannelApi.getConfig(),
          remoteChannelApi.getStatus('teams'),
          remoteChannelApi.getBindingStatus({ channelId: 'teams' }),
        ])
        if (configRes.success && configRes.data) setConfig(configRes.data)
        if (statusRes.success && statusRes.data) setStatusInfo(statusRes.data)
        if (bindRes.success && bindRes.data) setBindingStatus(bindRes.data)
      } catch (err) {
        setError('Failed to load settings: ' + (err instanceof Error ? err.message : String(err)))
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  useEffect(() => {
    // Status subscription
    const offStatus = remoteChannelEvents.statusChanged((_event, info) => {
      if (info.channelId === 'teams') {
        setStatusInfo(info)
      }
    })
    // Binding change subscription (server-side unbind etc.)
    const offBind = remoteChannelEvents.bindingChanged((_event, info) => {
      if (info.channelId === 'teams') {
        setBindingStatus({ bound: info.bound })
      }
    })
    return () => { offStatus(); offBind() };
  }, [])

  // Subscribe to profile changes — sync config when .agent command modifies boundChatId remotely
  useEffect(() => {
    const unsubscribe = profileDataManager.subscribe((data) => {
      const remote = data.profile?.remoteChannels as RemoteChannelsConfig | undefined
      if (remote) {
        setConfig((prev) => {
          if (prev['teams']?.boundChatId !== remote['teams']?.boundChatId) {
            return remote
          }
          return prev
        })
      }
    })
    return () => unsubscribe()
  }, [])

  // Start binding flow — start channel so user can enter binding code
  const handleStartBinding = useCallback(async () => {
    setError(null)
    try {
      const res = await remoteChannelApi.start('teams')
      if (!res.success) {
        setError(res.error || 'Failed to start')
      }
    } catch (err) {
      setError('Operation failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [])

  // Save config
  const handleSaveConfig = useCallback(async (teamsConfig: ChannelConfig): Promise<boolean> => {
    setError(null)
    try {
      const configRes = await remoteChannelApi.updateConfig({ teams: teamsConfig })
      if (!configRes.success) {
        setError(configRes.error || 'Failed to save config')
        return false
      }
      setConfig((prev) => ({ ...prev, teams: teamsConfig }))
      return true
    } catch (err) {
      setError('Failed to save: ' + (err instanceof Error ? err.message : String(err)))
      return false
    }
  }, [])

  // Bind
  const handleBind = useCallback(async () => {
    if (!bindCode.trim()) return
    setBinding(true)
    setBindError(null)
    try {
      const res = await remoteChannelApi.bind({ channelId: 'teams', code: bindCode.trim().toUpperCase() })
      if (res.success && res.data) {
        setBindingStatus({ bound: true, userId: res.data.userId })
        setBindCode('')
      } else {
        setBindError(res.error || 'Binding failed')
      }
    } catch (err) {
      setBindError(err instanceof Error ? err.message : String(err))
    } finally {
      setBinding(false)
    }
  }, [bindCode])

  // Disconnect — unbind + stop channel
  const handleDisconnect = useCallback(async () => {
    setBinding(true)
    setBindError(null)
    try {
      const unbindRes = await remoteChannelApi.unbind({ channelId: 'teams' })
      if (!unbindRes.success) {
        setBindError(unbindRes.error || 'Disconnect failed')
        return
      }

      const shouldStop = !!statusInfo && statusInfo.status !== 'stopped'
      if (shouldStop) {
        const stopRes = await remoteChannelApi.stop('teams')
        if (!stopRes.success) {
          setBindError(stopRes.error || 'Unbound, but failed to stop Teams bridge')
          return
        }
      }

      setBindingStatus({ bound: false })
      setBindCode('')
    } catch (err) {
      setBindError(err instanceof Error ? err.message : String(err))
    } finally {
      setBinding(false)
    }
  }, [statusInfo])

  const displayError = useMemo(() => {
    if (!error) return null

    const statusError = statusInfo?.error?.trim()
    if (!statusError) return error

    const normalizedError = error.trim()
    if (normalizedError === statusError) return null
    if (normalizedError === `Teams channel error: ${statusError}`) return null

    return error
  }, [error, statusInfo?.error])

  return (
    <div className="remote-channel-settings-view">
      <RemoteChannelSettingsHeaderView />
      <RemoteChannelSettingsContentView
        config={config['teams']}
        statusInfo={statusInfo}
        bindingStatus={bindingStatus}
        bindCode={bindCode}
        binding={binding}
        error={displayError}
        bindError={bindError}
        loading={loading}
        chatOptions={chatOptions}
        onStartBinding={handleStartBinding}
        onSave={handleSaveConfig}
        onBindCodeChange={setBindCode}
        onBind={handleBind}
        onDisconnect={handleDisconnect}
      />
    </div>
  )
}

export default RemoteChannelSettingsView
