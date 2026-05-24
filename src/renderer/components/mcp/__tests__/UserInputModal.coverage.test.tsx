// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import UserInputModal from '../UserInputModal'
import { UserInputField } from '../../../lib/utilities/processUserInputPlaceholder'

// ---- mocks ----

vi.mock('lucide-react', () => ({
  X: () => <svg data-testid="icon-x" />,
  Folder: () => <svg data-testid="icon-folder" />,
  FileText: () => <svg data-testid="icon-file-text" />,
}))

vi.mock('../../../styles/Modal.css', () => ({}))
vi.mock('../UserInputModal.css', () => ({}))

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}))

vi.mock('../../../lib/utilities/processUserInputPlaceholder', async () => ({
  validateUserInputValue: vi.fn((value: string, field: any) => {
    if (field.isRequired && !value) return { isValid: false, error: `${field.label} is required` }
    return { isValid: true }
  }),
  convertUserInputValue: vi.fn((value: string, type: string) => {
    if (type === 'INT') return parseInt(value)
    if (type === 'DOUBLE') return parseFloat(value)
    if (type === 'BOOLEAN') return value === 'true'
    return value
  }),
}))

// ---- helpers ----

function makeTextField(overrides: Partial<UserInputField> = {}): UserInputField {
  return {
    key: 'MY_KEY',
    originalValue: '',
    type: 'STRING',
    control: 'text',
    varName: 'MY_KEY',
    isRequired: false,
    label: 'My Label',
    defaultValue: '',
    ...overrides,
  }
}

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  fields: [makeTextField()],
  serverName: 'test-server',
  onSubmit: vi.fn(),
  onSkip: vi.fn(),
}

function setupElectronApi() {
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      workspace: {
        selectFolder: vi.fn().mockResolvedValue({ success: true, folderPath: '/selected/folder' }),
      },
      fs: {
        selectFile: vi.fn().mockResolvedValue({ success: true, filePath: '/selected/file.txt' }),
      },
    },
  })
}

// ---- tests ----

describe('UserInputModal - visibility', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(<UserInputModal {...defaultProps} isOpen={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders modal when isOpen is true', () => {
    render(<UserInputModal {...defaultProps} />)
    expect(screen.getByText('Configure test-server')).toBeInTheDocument()
  })

  it('calls onClose when clicking the overlay', () => {
    const onClose = vi.fn()
    render(<UserInputModal {...defaultProps} onClose={onClose} />)
    fireEvent.click(document.querySelector('.modal-overlay')!)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call onClose when clicking inside modal container', () => {
    const onClose = vi.fn()
    render(<UserInputModal {...defaultProps} onClose={onClose} />)
    fireEvent.click(document.querySelector('.modal-container')!)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<UserInputModal {...defaultProps} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('UserInputModal - contact info', () => {
  it('shows contact link when contact prop is provided', () => {
    render(<UserInputModal {...defaultProps} contact="help@example.com" />)
    expect(screen.getByText('help@example.com')).toBeInTheDocument()
  })

  it('does not show contact link when no contact prop', () => {
    render(<UserInputModal {...defaultProps} />)
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('UserInputModal - text input', () => {
  it('renders a text field', () => {
    render(<UserInputModal {...defaultProps} fields={[makeTextField({ label: 'API Key' })]} />)
    expect(screen.getByText('API Key')).toBeInTheDocument()
  })

  it('renders required asterisk for required fields', () => {
    render(<UserInputModal {...defaultProps} fields={[makeTextField({ isRequired: true, label: 'Required Field' })]} />)
    expect(document.querySelector('.required-asterisk')).toBeInTheDocument()
  })

  it('renders INT input as number type', () => {
    render(<UserInputModal {...defaultProps} fields={[makeTextField({ type: 'INT', control: 'text', label: 'Port' })]} />)
    const input = screen.getByPlaceholderText('Enter integer value...')
    expect(input).toHaveAttribute('type', 'number')
  })

  it('renders DOUBLE input with step=any', () => {
    render(<UserInputModal {...defaultProps} fields={[makeTextField({ type: 'DOUBLE', control: 'text', label: 'Threshold' })]} />)
    const input = screen.getByPlaceholderText('Enter decimal value...')
    expect(input).toHaveAttribute('step', 'any')
  })

  it('renders BOOLEAN input as select', () => {
    render(<UserInputModal {...defaultProps} fields={[makeTextField({ type: 'BOOLEAN', control: 'text', label: 'Enable' })]} />)
    const select = screen.getByRole('combobox')
    expect(select).toBeInTheDocument()
    expect(screen.getByText('True')).toBeInTheDocument()
    expect(screen.getByText('False')).toBeInTheDocument()
  })

  it('initializes with defaultValue', async () => {
    render(<UserInputModal {...defaultProps} fields={[makeTextField({ defaultValue: 'default-val' })]} />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('default-val')).toBeInTheDocument()
    })
  })

  it('updates value when user types', () => {
    render(<UserInputModal {...defaultProps} fields={[makeTextField({ label: 'Value' })]} />)
    const input = screen.getByPlaceholderText('Enter value...')
    fireEvent.change(input, { target: { value: 'new-value' } })
    expect(screen.getByDisplayValue('new-value')).toBeInTheDocument()
  })
})

describe('UserInputModal - folder input', () => {
  beforeEach(() => setupElectronApi())

  it('renders folder input field', () => {
    render(<UserInputModal {...defaultProps} fields={[makeTextField({ control: 'folder', label: 'Root Dir' })]} />)
    expect(screen.getByPlaceholderText('Select a folder...')).toBeInTheDocument()
  })

  it('calls selectFolder when folder button clicked', async () => {
    render(<UserInputModal {...defaultProps} fields={[makeTextField({ control: 'folder', label: 'Root Dir' })]} />)
    const btn = screen.getByTitle('Select folder')
    fireEvent.click(btn)
    await waitFor(() => {
      expect(window.electronAPI.workspace.selectFolder).toHaveBeenCalled()
    })
  })

  it('populates folder path after selection', async () => {
    render(<UserInputModal {...defaultProps} fields={[makeTextField({ control: 'folder', label: 'Root Dir' })]} />)
    fireEvent.click(screen.getByTitle('Select folder'))
    await waitFor(() => {
      expect(screen.getByDisplayValue('/selected/folder')).toBeInTheDocument()
    })
  })

  it('handles selectFolder returning no path', async () => {
    ;(window.electronAPI as any).workspace.selectFolder = vi.fn().mockResolvedValue({ success: false })
    render(<UserInputModal {...defaultProps} fields={[makeTextField({ control: 'folder', label: 'Root Dir' })]} />)
    fireEvent.click(screen.getByTitle('Select folder'))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Select a folder...')).toHaveValue('')
    })
  })

  it('handles missing workspace API gracefully', async () => {
    ;(window.electronAPI as any).workspace = undefined
    render(<UserInputModal {...defaultProps} fields={[makeTextField({ control: 'folder', label: 'Root Dir' })]} />)
    // Should not throw
    fireEvent.click(screen.getByTitle('Select folder'))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Select a folder...')).toHaveValue('')
    })
  })
})

describe('UserInputModal - file input', () => {
  beforeEach(() => setupElectronApi())

  it('renders file input field', () => {
    render(<UserInputModal {...defaultProps} fields={[makeTextField({ control: 'file', label: 'Config File' })]} />)
    expect(screen.getByPlaceholderText('Select a file...')).toBeInTheDocument()
  })

  it('calls selectFile when file button clicked', async () => {
    render(<UserInputModal {...defaultProps} fields={[makeTextField({ control: 'file', label: 'Config File' })]} />)
    fireEvent.click(screen.getByTitle('Select file'))
    await waitFor(() => {
      expect(window.electronAPI.fs.selectFile).toHaveBeenCalled()
    })
  })

  it('populates file path after selection', async () => {
    render(<UserInputModal {...defaultProps} fields={[makeTextField({ control: 'file', label: 'Config File' })]} />)
    fireEvent.click(screen.getByTitle('Select file'))
    await waitFor(() => {
      expect(screen.getByDisplayValue('/selected/file.txt')).toBeInTheDocument()
    })
  })

  it('handles missing fs API gracefully', async () => {
    ;(window.electronAPI as any).fs = undefined
    render(<UserInputModal {...defaultProps} fields={[makeTextField({ control: 'file', label: 'Config File' })]} />)
    fireEvent.click(screen.getByTitle('Select file'))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Select a file...')).toHaveValue('')
    })
  })
})

describe('UserInputModal - submit behavior', () => {
  beforeEach(() => setupElectronApi())

  it('calls onSkip when Skip button is clicked', () => {
    const onSkip = vi.fn()
    render(<UserInputModal {...defaultProps} onSkip={onSkip} />)
    fireEvent.click(screen.getByRole('button', { name: /Skip/i }))
    expect(onSkip).toHaveBeenCalled()
  })

  it('calls onSubmit with form data when Confirm is clicked and form is valid', async () => {
    const onSubmit = vi.fn()
    render(
      <UserInputModal
        {...defaultProps}
        onSubmit={onSubmit}
        fields={[makeTextField({ key: 'MY_KEY', label: 'Value', defaultValue: 'hello' })]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Confirm and Continue/i }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ MY_KEY: 'hello' })
    })
  })

  it('does not call onSubmit when required field is empty', async () => {
    const onSubmit = vi.fn()
    render(
      <UserInputModal
        {...defaultProps}
        onSubmit={onSubmit}
        fields={[makeTextField({ isRequired: true, label: 'Required Value' })]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Confirm and Continue/i }))
    await waitFor(() => {
      expect(screen.getByText(/Required Value is required/)).toBeInTheDocument()
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('clears error after fixing invalid field', async () => {
    render(
      <UserInputModal
        {...defaultProps}
        fields={[makeTextField({ isRequired: true, label: 'Required Value' })]}
      />
    )
    // Submit with empty field to trigger error
    fireEvent.click(screen.getByRole('button', { name: /Confirm and Continue/i }))
    await waitFor(() => {
      expect(screen.getByText(/Required Value is required/)).toBeInTheDocument()
    })
    // Fill the field to clear error
    const input = screen.getByPlaceholderText('Enter value...')
    fireEvent.change(input, { target: { value: 'fixed' } })
    await waitFor(() => {
      expect(screen.queryByText(/Required Value is required/)).toBeNull()
    })
  })

  it('does not include empty field values in submitted data', async () => {
    const onSubmit = vi.fn()
    render(
      <UserInputModal
        {...defaultProps}
        onSubmit={onSubmit}
        fields={[
          makeTextField({ key: 'FILLED', label: 'Filled', defaultValue: 'yes' }),
          makeTextField({ key: 'EMPTY', label: 'Empty' }),
        ]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Confirm and Continue/i }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ FILLED: 'yes' })
    })
  })

  it('converts INT type values when submitting', async () => {
    const onSubmit = vi.fn()
    render(
      <UserInputModal
        {...defaultProps}
        onSubmit={onSubmit}
        fields={[makeTextField({ key: 'PORT', type: 'INT', control: 'text', label: 'Port' })]}
      />
    )
    const input = screen.getByPlaceholderText('Enter integer value...')
    fireEvent.change(input, { target: { value: '8080' } })
    fireEvent.click(screen.getByRole('button', { name: /Confirm and Continue/i }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ PORT: 8080 })
    })
  })

  it('converts BOOLEAN type values when submitting', async () => {
    const onSubmit = vi.fn()
    render(
      <UserInputModal
        {...defaultProps}
        onSubmit={onSubmit}
        fields={[makeTextField({ key: 'FLAG', type: 'BOOLEAN', control: 'text', label: 'Enable' })]}
      />
    )
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'true' } })
    fireEvent.click(screen.getByRole('button', { name: /Confirm and Continue/i }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ FLAG: true })
    })
  })
})

describe('UserInputModal - re-initialization', () => {
  it('reinitializes form when fields change', async () => {
    const fields1 = [makeTextField({ key: 'K1', label: 'K1', defaultValue: 'v1' })]
    const fields2 = [makeTextField({ key: 'K2', label: 'K2', defaultValue: 'v2' })]
    const { rerender } = render(<UserInputModal {...defaultProps} fields={fields1} />)
    await waitFor(() => screen.getByDisplayValue('v1'))
    rerender(<UserInputModal {...defaultProps} fields={fields2} isOpen={true} />)
    await waitFor(() => screen.getByDisplayValue('v2'))
  })

  it('does not reinitialize when isOpen becomes false', async () => {
    render(<UserInputModal {...defaultProps} isOpen={false} />)
    expect(screen.queryByText('Configure test-server')).toBeNull()
  })
})
