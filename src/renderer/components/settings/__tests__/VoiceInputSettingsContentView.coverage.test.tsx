/** @vitest-environment happy-dom */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock CSS files
vi.mock('../../styles/ContentView.css', () => ({}));
vi.mock('../../styles/ToolbarSettingsView.css', () => ({}));
vi.mock('../../styles/RuntimeSettings.css', () => ({}));

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Download: (props: any) => React.createElement('span', { 'data-testid': 'icon-Download' }),
  Trash2: (props: any) => React.createElement('span', { 'data-testid': 'icon-Trash2' }),
  AlertCircle: (props: any) => React.createElement('span', { 'data-testid': 'icon-AlertCircle' }),
}));

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
}));

import VoiceInputSettingsContentView from '../VoiceInputSettingsContentView';

const baseSettings = {
  whisperModel: 'small' as any,
  language: 'auto',
  useGPU: false,
  translate: false,
};

const modelInfos = [
  { size: 'small' as any, fileSizeDisplay: '~150MB', description: 'Small model' },
  { size: 'medium' as any, fileSizeDisplay: '~500MB', description: 'Medium model' },
];

const modelStatuses = [
  { size: 'small' as any, downloaded: true },
  { size: 'medium' as any, downloaded: false },
];

const makeProps = (overrides: any = {}) => ({
  settings: baseSettings,
  modelStatuses,
  modelInfos,
  downloadProgress: null,
  loading: false,
  error: null,
  onSettingsChange: vi.fn(),
  onDownloadModel: vi.fn(),
  onDeleteModel: vi.fn(),
  onCancelDownload: vi.fn(),
  voiceInputEnabled: true,
  isEnabling: false,
  setupStep: null as any,
  setupProgress: 0,
  enablingError: undefined,
  onToggleVoiceInput: vi.fn(),
  onCancelEnabling: vi.fn(),
  addonStatus: 'not-downloaded' as any,
  onDeleteAddon: vi.fn(),
  ...overrides,
});

describe('VoiceInputSettingsContentView', () => {
  it('renders voice input toggle', () => {
    render(<VoiceInputSettingsContentView {...makeProps()} />);
    expect(screen.getByText('Voice Input')).toBeInTheDocument();
  });

  it('renders model list when voice input enabled', () => {
    render(<VoiceInputSettingsContentView {...makeProps()} />);
    expect(screen.getByText('Small')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
  });

  it('hides model list when voice input disabled', () => {
    render(<VoiceInputSettingsContentView {...makeProps({ voiceInputEnabled: false })} />);
    expect(screen.queryByText('Small')).not.toBeInTheDocument();
  });

  it('shows error message when error is set', () => {
    render(<VoiceInputSettingsContentView {...makeProps({ error: 'Something went wrong' })} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('shows enablingError when provided', () => {
    render(<VoiceInputSettingsContentView {...makeProps({ enablingError: 'Setup failed' })} />);
    expect(screen.getByText('Setup failed')).toBeInTheDocument();
  });

  it('shows enabling progress when isEnabling=true', () => {
    render(<VoiceInputSettingsContentView {...makeProps({ isEnabling: true, setupProgress: 60, setupStep: 'addon' })} />);
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('1/2 downloading engine')).toBeInTheDocument();
  });

  it('shows model download progress', () => {
    const props = makeProps({
      downloadProgress: { model: 'medium', percent: 45 },
      modelStatuses: [
        { size: 'small', downloaded: true },
        { size: 'medium', downloaded: false },
      ],
    });
    render(<VoiceInputSettingsContentView {...props} />);
    expect(screen.getByText('45%')).toBeInTheDocument();
  });

  it('calls onDownloadModel when download button clicked', () => {
    const onDownloadModel = vi.fn();
    const props = makeProps({
      onDownloadModel,
      modelStatuses: [
        { size: 'small', downloaded: false },
        { size: 'medium', downloaded: false },
      ],
    });
    render(<VoiceInputSettingsContentView {...props} />);
    const downloadBtns = screen.getAllByText('Download');
    fireEvent.click(downloadBtns[0]);
    expect(onDownloadModel).toHaveBeenCalledWith('small');
  });

  it('calls onDeleteModel when delete button clicked', () => {
    const onDeleteModel = vi.fn();
    render(<VoiceInputSettingsContentView {...makeProps({ onDeleteModel })} />);
    const deleteIcon = screen.getAllByTestId('icon-Trash2')[0];
    fireEvent.click(deleteIcon.closest('button')!);
    expect(onDeleteModel).toHaveBeenCalled();
  });

  it('calls onSettingsChange when GPU toggle changed', () => {
    const onSettingsChange = vi.fn();
    render(<VoiceInputSettingsContentView {...makeProps({ onSettingsChange })} />);
    // GPU acceleration checkbox
    const checkboxes = screen.getAllByRole('checkbox');
    // First checkbox is the master toggle (voiceInputEnabled=true), then GPU, then translate
    const gpuCheckbox = checkboxes.find(c => c.closest('label')?.parentElement?.querySelector('.setting-label')?.textContent?.includes('GPU'));
    // Just fire change on the last checkbox (GPU)
    fireEvent.click(checkboxes[checkboxes.length - 2]);
    expect(onSettingsChange).toHaveBeenCalled();
  });

  it('shows translate card for small model', () => {
    render(<VoiceInputSettingsContentView {...makeProps({ settings: { ...baseSettings, whisperModel: 'small' } })} />);
    expect(screen.getByText('Translate to English')).toBeInTheDocument();
  });

  it('does not show translate card for tiny model', () => {
    render(<VoiceInputSettingsContentView {...makeProps({ settings: { ...baseSettings, whisperModel: 'tiny' } })} />);
    expect(screen.queryByText('Translate to English')).not.toBeInTheDocument();
  });

  it('shows warning when no models downloaded', () => {
    render(<VoiceInputSettingsContentView {...makeProps({
      modelStatuses: [
        { size: 'small', downloaded: false },
        { size: 'medium', downloaded: false },
      ],
    })} />);
    expect(screen.getByText(/Please download at least one model/i)).toBeInTheDocument();
  });

  it('calls onToggleVoiceInput when toggle changes', () => {
    const onToggleVoiceInput = vi.fn();
    // Render with voiceInputEnabled=false so only the master toggle checkbox exists
    render(<VoiceInputSettingsContentView {...makeProps({ voiceInputEnabled: false, onToggleVoiceInput })} />);
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(onToggleVoiceInput).toHaveBeenCalled();
  });

  it('shows model step 2 when setupStep=model', () => {
    render(<VoiceInputSettingsContentView {...makeProps({ isEnabling: true, setupStep: 'model', setupProgress: 80 })} />);
    expect(screen.getByText('2/2 downloading model')).toBeInTheDocument();
  });

  it('calls onCancelEnabling when Cancel clicked during enabling', () => {
    const onCancelEnabling = vi.fn();
    render(<VoiceInputSettingsContentView {...makeProps({ isEnabling: true, onCancelEnabling })} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancelEnabling).toHaveBeenCalled();
  });

  it('shows language select with auto-detect option', () => {
    render(<VoiceInputSettingsContentView {...makeProps()} />);
    expect(screen.getByDisplayValue('Auto-detect')).toBeInTheDocument();
  });

  it('calls onSettingsChange when language changed', () => {
    const onSettingsChange = vi.fn();
    render(<VoiceInputSettingsContentView {...makeProps({ onSettingsChange })} />);
    const select = screen.getByDisplayValue('Auto-detect');
    fireEvent.change(select, { target: { value: 'en' } });
    expect(onSettingsChange).toHaveBeenCalled();
  });
});
