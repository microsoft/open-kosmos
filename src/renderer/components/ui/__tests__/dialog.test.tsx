// @vitest-environment happy-dom
/**
 * Tests for Dialog components
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../dialog';

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <Dialog open={false} onOpenChange={vi.fn()}>
        <div>Hidden</div>
      </Dialog>
    );
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it('renders children when open', () => {
    render(
      <Dialog open={true} onOpenChange={vi.fn()}>
        <div>Visible</div>
      </Dialog>
    );
    expect(screen.getByText('Visible')).toBeInTheDocument();
  });

  it('calls onOpenChange(false) when backdrop is clicked', () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <Dialog open={true} onOpenChange={onOpenChange}>
        <div>Content</div>
      </Dialog>
    );
    // The backdrop is the fixed inset div
    const backdrop = container.querySelector('.fixed.inset-0.bg-black\\/50');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onOpenChange(false) when Escape is pressed', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open={true} onOpenChange={onOpenChange}>
        <div>Content</div>
      </Dialog>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('only closes topmost dialog when Escape is pressed with nested dialogs', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(
      <Dialog open={true} onOpenChange={outerClose}>
        <div>Outer</div>
        <Dialog open={true} onOpenChange={innerClose}>
          <div>Inner</div>
        </Dialog>
      </Dialog>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledWith(false);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it('cleans up ESC listener when dialog closes', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Dialog open={true} onOpenChange={onOpenChange}>
        <div>Content</div>
      </Dialog>
    );
    rerender(
      <Dialog open={false} onOpenChange={onOpenChange}>
        <div>Content</div>
      </Dialog>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('cleans up ESC listener when dialog unmounts', () => {
    const onOpenChange = vi.fn();
    const { unmount } = render(
      <Dialog open={true} onOpenChange={onOpenChange}>
        <div>Content</div>
      </Dialog>
    );
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('does not propagate content clicks to backdrop', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open={true} onOpenChange={onOpenChange}>
        <div>Content</div>
      </Dialog>
    );
    fireEvent.click(screen.getByText('Content'));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('applies custom className to outer wrapper', () => {
    const { container } = render(
      <Dialog open={true} onOpenChange={vi.fn()} className="custom-dialog">
        <div>Content</div>
      </Dialog>
    );
    expect(container.firstChild).toHaveClass('custom-dialog');
  });
});

describe('DialogContent', () => {
  it('renders children with default classes', () => {
    render(<DialogContent>Dialog body</DialogContent>);
    const el = screen.getByText('Dialog body');
    expect(el).toHaveClass('bg-white', 'rounded-lg', 'shadow-xl');
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<DialogContent ref={ref}>Body</DialogContent>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});

describe('DialogHeader', () => {
  it('renders with default classes', () => {
    const { container } = render(<DialogHeader>Header</DialogHeader>);
    expect(container.firstChild).toHaveClass('flex', 'flex-col');
  });

  it('renders close button when inside Dialog', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open={true} onOpenChange={onOpenChange}>
        <DialogHeader>Header</DialogHeader>
      </Dialog>
    );
    const closeBtn = screen.getByLabelText('Close');
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not render close button without Dialog parent', () => {
    render(<DialogHeader>Header</DialogHeader>);
    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument();
  });
});

describe('DialogTitle', () => {
  it('renders as h2', () => {
    render(<DialogTitle>The Title</DialogTitle>);
    const heading = screen.getByText('The Title');
    expect(heading.tagName).toBe('H2');
    expect(heading).toHaveClass('text-lg', 'font-semibold');
  });
});

describe('DialogDescription', () => {
  it('renders as p with gray text', () => {
    render(<DialogDescription>Desc</DialogDescription>);
    const el = screen.getByText('Desc');
    expect(el.tagName).toBe('P');
    expect(el).toHaveClass('text-sm', 'text-gray-500');
  });
});

describe('DialogFooter', () => {
  it('renders with flex column-reverse classes', () => {
    const { container } = render(<DialogFooter>Footer</DialogFooter>);
    expect(container.firstChild).toHaveClass('flex', 'flex-col-reverse');
  });
});
