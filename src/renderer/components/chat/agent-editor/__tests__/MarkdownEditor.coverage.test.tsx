/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MarkdownEditor from '../MarkdownEditor';

const noop = () => {};

const defaultProps = {
  value: '',
  onChange: noop,
  showPreview: false,
  onTogglePreview: noop,
  readOnly: false,
};

describe('MarkdownEditor – edit mode', () => {
  it('renders the textarea in edit mode', () => {
    render(<MarkdownEditor {...defaultProps} />);
    expect(document.querySelector('textarea')).toBeInTheDocument();
  });

  it('shows placeholder tips when value is empty and not readOnly', () => {
    render(<MarkdownEditor {...defaultProps} />);
    expect(screen.getByText(/Enter your system prompt here/i)).toBeInTheDocument();
  });

  it('hides tips when value is non-empty', () => {
    render(<MarkdownEditor {...defaultProps} value="Hello" />);
    expect(screen.queryByText(/Enter your system prompt here/i)).not.toBeInTheDocument();
  });

  it('hides tips in readOnly mode even when value is empty', () => {
    render(<MarkdownEditor {...defaultProps} readOnly={true} />);
    expect(screen.queryByText(/Enter your system prompt here/i)).not.toBeInTheDocument();
  });

  it('calls onChange when textarea value changes', () => {
    const onChange = vi.fn();
    render(<MarkdownEditor {...defaultProps} onChange={onChange} />);
    fireEvent.change(document.querySelector('textarea')!, { target: { value: 'new text' } });
    expect(onChange).toHaveBeenCalledWith('new text');
  });

  it('does not call onChange in readOnly mode', () => {
    const onChange = vi.fn();
    render(<MarkdownEditor {...defaultProps} onChange={onChange} readOnly={true} />);
    fireEvent.change(document.querySelector('textarea')!, { target: { value: 'new text' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('applies readonly class when readOnly is true', () => {
    render(<MarkdownEditor {...defaultProps} readOnly={true} />);
    const ta = document.querySelector('textarea')!;
    expect(ta.classList).toContain('readonly');
  });
});

describe('MarkdownEditor – preview mode', () => {
  it('renders preview-content in showPreview mode', () => {
    render(<MarkdownEditor {...defaultProps} showPreview={true} value="# Title" />);
    expect(document.querySelector('.preview-content')).toBeInTheDocument();
  });

  it('renders h1 for # header', () => {
    render(<MarkdownEditor {...defaultProps} showPreview={true} value="# Heading" />);
    expect(document.querySelector('.preview-content')!.innerHTML).toContain('<h1>Heading</h1>');
  });

  it('renders h2 for ## header', () => {
    render(<MarkdownEditor {...defaultProps} showPreview={true} value="## Sub" />);
    expect(document.querySelector('.preview-content')!.innerHTML).toContain('<h2>Sub</h2>');
  });

  it('renders h3 for ### header', () => {
    render(<MarkdownEditor {...defaultProps} showPreview={true} value="### Third" />);
    expect(document.querySelector('.preview-content')!.innerHTML).toContain('<h3>Third</h3>');
  });

  it('renders list items for - prefix', () => {
    render(<MarkdownEditor {...defaultProps} showPreview={true} value="- item one" />);
    const html = document.querySelector('.preview-content')!.innerHTML;
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>item one</li>');
  });

  it('renders bold text with **', () => {
    render(<MarkdownEditor {...defaultProps} showPreview={true} value="**bold**" />);
    expect(document.querySelector('.preview-content')!.innerHTML).toContain('<strong>bold</strong>');
  });

  it('renders italic text with *', () => {
    render(<MarkdownEditor {...defaultProps} showPreview={true} value="*italic*" />);
    expect(document.querySelector('.preview-content')!.innerHTML).toContain('<em>italic</em>');
  });

  it('renders br for empty lines', () => {
    render(<MarkdownEditor {...defaultProps} showPreview={true} value={"line1\n\nline2"} />);
    expect(document.querySelector('.preview-content')!.innerHTML).toContain('<br>');
  });

  it('does not render textarea in preview mode', () => {
    render(<MarkdownEditor {...defaultProps} showPreview={true} value="test" />);
    expect(document.querySelector('textarea')).not.toBeInTheDocument();
  });
});
