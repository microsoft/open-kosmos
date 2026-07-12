/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import VoiceInputSettingsContentView from '../VoiceInputSettingsContentView'

const searchParamsState = vi.hoisted(() => ({ value: new URLSearchParams() }))

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [searchParamsState.value],
}))

type ModelSize = 'tiny' | 'base' | 'small' | 'medium' | 'turbo'

type Props = React.ComponentProps<typeof VoiceInputSettingsContentView>

const modelInfos: Props['modelInfos'] = [
  { size: 'tiny' as ModelSize, fileName: 'ggml-tiny.bin', fileSize: 75_000_000, downloadUrl: 'https://models.test/tiny', fileSizeDisplay: '75 MB', description: 'Fastest model' },
  { size: 'small' as ModelSize, fileName: 'ggml-small.bin', fileSize: 466_000_000, downloadUrl: 'https://models.test/small', fileSizeDisplay: '466 MB', description: 'Balanced model' },
  { size: 'turbo' as ModelSize, fileName: 'ggml-turbo.bin', fileSize: 809_000_000, downloadUrl: 'https://models.test/turbo', fileSizeDisplay: '809 MB', description: 'Turbo model' },
]

const defaultSettings: Props['settings'] = {
  whisperModel: 'small' as ModelSize,
  language: 'auto',
  useGPU: false,
  translate: false,
}

const createHandlers = () => ({
  onSettingsChange: vi.fn(),
  onDownloadModel: vi.fn(),
  onDeleteModel: vi.fn(),
  onCancelDownload: vi.fn(),
  onToggleVoiceInput: vi.fn(),
  onCancelEnabling: vi.fn(),
  onDeleteAddon: vi.fn(),
})

const buildProps = (overrides: Partial<Props> = {}): Props => ({
  settings: defaultSettings,
  modelStatuses: [
    { size: 'tiny' as ModelSize, downloaded: false },
    { size: 'small' as ModelSize, downloaded: true },
    { size: 'turbo' as ModelSize, downloaded: false },
  ],
  modelInfos,
  downloadProgress: null,
  loading: false,
  error: null,
  voiceInputEnabled: true,
  isEnabling: false,
  setupStep: null,
  setupProgress: 0,
  enablingError: undefined,
  addonStatus: 'downloaded',
  ...createHandlers(),
  ...overrides,
})

const renderView = (overrides: Partial<Props> = {}) => {
  const props = buildProps(overrides)
  const view = render(<VoiceInputSettingsContentView {...props} />)
  return { ...view, props }
}

describe('VoiceInputSettingsContentView', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    vi.clearAllMocks()
    searchParamsState.value = new URLSearchParams()
    process.env.NODE_ENV = 'development'
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
  })

  it('renders errors and migrated color tokens without raw hex values', () => {
    renderView({
      error: 'Model download failed',
      enablingError: 'Voice setup failed',
      addonStatus: 'error',
      modelStatuses: modelInfos.map(info => ({ size: info.size, downloaded: false })),
    })

    expect(screen.getByText('Model download failed')).toBeInTheDocument()
    expect(screen.getByText('Voice setup failed').getAttribute('style') ?? '').toContain('var(--color-danger-500)')
    expect(screen.getByText('error').getAttribute('style') ?? '').toContain('var(--color-danger-500)')

    const warning = screen.getByText('Please download at least one model to use voice input').closest('.runtime-loading-bar')
    expect(warning?.getAttribute('style') ?? '').toContain('var(--color-warning-700)')
    expect(warning?.getAttribute('style') ?? '').toContain('var(--color-warning-100)')
    expect(warning?.getAttribute('style') ?? '').toContain('var(--color-warning-200)')
    expect(document.body.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/)
  })

  it('drives voice toggle, model actions, language, gpu, translate, addon delete, and highlight cleanup', () => {
    vi.useFakeTimers()
    searchParamsState.value = new URLSearchParams('highlight=model')
    const { props, unmount, rerender } = renderView({
      downloadProgress: { model: 'turbo' as ModelSize, downloaded: 10_000_000, total: 20_000_000, percent: 42 },
    })

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    const modelCard = screen.getByText('Whisper Model').closest('.toolbar-settings-card')
    expect(modelCard).toHaveClass('highlight-section')
    expect(modelCard).toHaveClass('highlight-pulse')

    fireEvent.click(screen.getByTitle('Delete addon cache (dev)'))
    expect(props.onDeleteAddon).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    expect(props.onDownloadModel).toHaveBeenCalledWith('tiny')

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(props.onCancelDownload).toHaveBeenCalledWith('turbo')

    fireEvent.click(screen.getByTitle('Delete model'))
    expect(props.onDeleteModel).toHaveBeenCalledWith('small')

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ja' } })
    expect(props.onSettingsChange).toHaveBeenCalledWith({ ...defaultSettings, language: 'ja' })

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])
    expect(props.onToggleVoiceInput).toHaveBeenCalledWith(false)
    fireEvent.click(checkboxes[1])
    expect(props.onSettingsChange).toHaveBeenCalledWith({ ...defaultSettings, useGPU: true })
    fireEvent.click(checkboxes[2])
    expect(props.onSettingsChange).toHaveBeenCalledWith({ ...defaultSettings, translate: true })

    const radioProps = buildProps({ settings: { ...defaultSettings, whisperModel: 'tiny' as ModelSize } })
    rerender(<VoiceInputSettingsContentView {...radioProps} />)
    fireEvent.click(screen.getByRole('radio', { name: /use/i }))
    expect(radioProps.onSettingsChange).toHaveBeenCalledWith({ ...defaultSettings, whisperModel: 'small' })

    vi.advanceTimersByTime(2000)
    expect(modelCard).not.toHaveClass('highlight-pulse')
    unmount()
    vi.useRealTimers()
  })

  it('renders enabling steps, disabled downloads, hidden model settings, and production addon branch', () => {
    process.env.NODE_ENV = 'production'
    const { rerender, props } = renderView({
      voiceInputEnabled: false,
      isEnabling: true,
      setupStep: 'addon',
      setupProgress: 25,
      addonStatus: 'downloaded',
    })

    expect(screen.getByText('1/2 downloading engine')).toBeInTheDocument()
    expect(screen.queryByText('engine addon:')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(props.onCancelEnabling).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Whisper Model')).not.toBeInTheDocument()

    rerender(<VoiceInputSettingsContentView {...buildProps({ isEnabling: true, setupStep: 'model', setupProgress: 60 })} />)
    expect(screen.getByText('2/2 downloading model')).toBeInTheDocument()

    rerender(<VoiceInputSettingsContentView {...buildProps({ isEnabling: true, setupStep: null, setupProgress: 90 })} />)
    expect(screen.getByText('setting up...')).toBeInTheDocument()

    rerender(<VoiceInputSettingsContentView {...buildProps({ loading: true, modelStatuses: modelInfos.map(info => ({ size: info.size, downloaded: false })) })} />)
    expect(screen.getAllByRole('button', { name: /download/i })[0]).toBeDisabled()
  })

  it('covers non-translating models, default gpu/translate fallbacks, and non-downloaded addon badge', () => {
    renderView({
      settings: { whisperModel: 'base' as ModelSize, language: 'en' },
      modelInfos: [{ size: 'base' as ModelSize, fileName: 'ggml-base.bin', fileSize: 142_000_000, downloadUrl: 'https://models.test/base', fileSizeDisplay: '142 MB', description: 'Base model' }],
      modelStatuses: [{ size: 'base' as ModelSize, downloaded: true }],
      addonStatus: 'not-downloaded',
    })

    expect(screen.queryByText('Translate to English')).not.toBeInTheDocument()
    expect(screen.queryByText('Please download at least one model to use voice input')).not.toBeInTheDocument()
    expect(screen.getByText('not-downloaded')).toHaveClass('runtime-python-badge--available')
    expect(screen.getAllByRole('checkbox')[1]).not.toBeChecked()
  })
})
