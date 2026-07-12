/** @vitest-environment happy-dom */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

import MarkdownEditor from '../MarkdownEditor'

vi.mock('../../../../styles/Agent.css', () => ({}))

describe('MarkdownEditor', () => {
  it('renders edit tips for an empty editable prompt', () => {
    render(
      <MarkdownEditor
        value=""
        onChange={vi.fn()}
        showPreview={false}
        onTogglePreview={vi.fn()}
      />
    )

    expect(screen.getByText('Enter your system prompt here...')).toBeInTheDocument()
    expect(screen.getByText('# Headers')).toBeInTheDocument()
  })

  it('updates editable textareas and hides tips when content exists', () => {
    const onChange = vi.fn()
    render(
      <MarkdownEditor
        value="Initial"
        onChange={onChange}
        showPreview={false}
        onTogglePreview={vi.fn()}
      />
    )

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Changed' } })

    expect(onChange).toHaveBeenCalledWith('Changed')
    expect(screen.queryByText('Enter your system prompt here...')).not.toBeInTheDocument()
  })

  it('uses managed readonly background color and suppresses edits', () => {
    const onChange = vi.fn()
    render(
      <MarkdownEditor
        value="Locked"
        onChange={onChange}
        showPreview={false}
        onTogglePreview={vi.fn()}
        readOnly
      />
    )

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea).toHaveClass('readonly')
    expect(textarea.readOnly).toBe(true)
    expect(textarea.getAttribute('style') || '').toContain('var(--color-neutral-100)')
    expect(textarea.getAttribute('style') || '').not.toMatch(/#[0-9a-fA-F]{3,6}/)

    fireEvent.change(textarea, { target: { value: 'Ignored' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders headings, paragraphs, lists, inline emphasis, and blank lines in preview', () => {
    render(
      <MarkdownEditor
        value={[
          '### Small',
          '## Medium',
          '# Large',
          '- **Bold** item',
          '- *Italic* item',
          '',
          'Plain **strong** and *em* text',
        ].join('\n')}
        onChange={vi.fn()}
        showPreview
        onTogglePreview={vi.fn()}
      />
    )

    expect(screen.getByRole('heading', { level: 3, name: 'Small' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Medium' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Large' })).toBeInTheDocument()
    expect(screen.getByText('Bold')).toBeInTheDocument()
    expect(screen.getByText('Italic')).toBeInTheDocument()
    expect(screen.getByText(/Plain/)).toBeInTheDocument()
  })

  it('closes an open list before a following heading and at end of input', () => {
    const { container } = render(
      <MarkdownEditor
        value={['- First', '## After list', '- Last'].join('\n')}
        onChange={vi.fn()}
        showPreview
        onTogglePreview={vi.fn()}
      />
    )

    expect(container.querySelectorAll('ul')).toHaveLength(2)
    expect(screen.getByRole('heading', { level: 2, name: 'After list' })).toBeInTheDocument()
    expect(screen.getByText('Last')).toBeInTheDocument()
  })

  it('closes lists before h3, h1, and paragraph blocks', () => {
    const { container } = render(
      <MarkdownEditor
        value={['- Before h3', '### H3 after list', '- Before h1', '# H1 after list', '- Before paragraph', 'Paragraph after list'].join('\n')}
        onChange={vi.fn()}
        showPreview
        onTogglePreview={vi.fn()}
      />
    )

    expect(container.querySelectorAll('ul')).toHaveLength(3)
    expect(screen.getByRole('heading', { level: 3, name: 'H3 after list' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'H1 after list' })).toBeInTheDocument()
    expect(screen.getByText('Paragraph after list')).toBeInTheDocument()
  })
})
