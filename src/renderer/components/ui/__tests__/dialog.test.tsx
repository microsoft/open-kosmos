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

  it('handles open=false to open=true to open=false lifecycle', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Dialog open={false} onOpenChange={onOpenChange}>
        <div>Content</div>
      </Dialog>
    );
    // No ESC listener when closed
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();

    // Open it
    rerender(
      <Dialog open={true} onOpenChange={onOpenChange}>
        <div>Content</div>
      </Dialog>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    onOpenChange.mockClear();

    // Close it again
    rerender(
      <Dialog open={false} onOpenChange={onOpenChange}>
        <div>Content</div>
      </Dialog>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
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

  it('ignores keys other than Escape and Tab', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open={true} onOpenChange={onOpenChange}>
        <button>First</button>
      </Dialog>
    );
    fireEvent.keyDown(document, { key: 'a' });
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe('Dialog focus management', () => {
  it('moves focus to the first focusable element on open', () => {
    render(
      <Dialog open={true} onOpenChange={vi.fn()}>
        <button>First</button>
        <button>Second</button>
      </Dialog>
    );
    expect(document.activeElement).toBe(screen.getByText('First'));
  });

  it('focuses the content container when there are no focusable children', () => {
    const { container } = render(
      <Dialog open={true} onOpenChange={vi.fn()}>
        <span>Just text</span>
      </Dialog>
    );
    const content = container.querySelector('.dialog-content-animate');
    expect(document.activeElement).toBe(content);
  });

  it('restores focus to the previously focused element on close', () => {
    const onOpenChange = vi.fn();
    const tree = (open: boolean) => (
      <>
        <button>Opener</button>
        <Dialog open={open} onOpenChange={onOpenChange}>
          <button>Inside</button>
        </Dialog>
      </>
    );
    const { rerender } = render(tree(false));
    const opener = screen.getByText('Opener');
    opener.focus();
    expect(document.activeElement).toBe(opener);

    rerender(tree(true));
    expect(document.activeElement).toBe(screen.getByText('Inside'));

    rerender(tree(false));
    expect(document.activeElement).toBe(opener);
  });

  it('traps Tab from the last focusable back to the first', () => {
    render(
      <Dialog open={true} onOpenChange={vi.fn()}>
        <button>First</button>
        <button>Last</button>
      </Dialog>
    );
    screen.getByText('Last').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('First'));
  });

  it('traps Shift+Tab from the first focusable back to the last', () => {
    render(
      <Dialog open={true} onOpenChange={vi.fn()}>
        <button>First</button>
        <button>Last</button>
      </Dialog>
    );
    screen.getByText('First').focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('Last'));
  });

  it('pulls focus back to the first focusable on Tab from outside the dialog', () => {
    render(
      <>
        <button>Outside</button>
        <Dialog open={true} onOpenChange={vi.fn()}>
          <button>First</button>
          <button>Last</button>
        </Dialog>
      </>
    );
    screen.getByText('Outside').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('First'));
  });

  it('pulls focus back to the last focusable on Shift+Tab from outside the dialog', () => {
    render(
      <>
        <button>Outside</button>
        <Dialog open={true} onOpenChange={vi.fn()}>
          <button>First</button>
          <button>Last</button>
        </Dialog>
      </>
    );
    screen.getByText('Outside').focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('Last'));
  });

  it('keeps focus on the content container when Tab is pressed with no focusables', () => {
    const { container } = render(
      <Dialog open={true} onOpenChange={vi.fn()}>
        <span>Text only</span>
      </Dialog>
    );
    const content = container.querySelector('.dialog-content-animate') as HTMLElement;
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(content);
  });

  it('traps Tab within the topmost dialog when nested', () => {
    render(
      <Dialog open={true} onOpenChange={vi.fn()}>
        <button>Outer</button>
        <Dialog open={true} onOpenChange={vi.fn()}>
          <button>InnerFirst</button>
          <button>InnerLast</button>
        </Dialog>
      </Dialog>
    );
    screen.getByText('InnerLast').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('InnerFirst'));
  });

  it('does not trap Tab when focus is on a non-boundary focusable', () => {
    render(
      <Dialog open={true} onOpenChange={vi.fn()}>
        <button>First</button>
        <button>Middle</button>
        <button>Last</button>
      </Dialog>
    );
    const middle = screen.getByText('Middle');
    middle.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(middle);
  });

  it('does not trap Shift+Tab when focus is on a non-boundary focusable', () => {
    render(
      <Dialog open={true} onOpenChange={vi.fn()}>
        <button>First</button>
        <button>Middle</button>
        <button>Last</button>
      </Dialog>
    );
    const middle = screen.getByText('Middle');
    middle.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(middle);
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

describe('DialogContent accessibility', () => {
  it('exposes role=dialog and aria-modal, with no dangling label refs', () => {
    render(<DialogContent>Body</DialogContent>);
    const dlg = screen.getByRole('dialog');
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    // No title/description rendered → attributes are omitted (no dangling references).
    expect(dlg).not.toHaveAttribute('aria-labelledby');
    expect(dlg).not.toHaveAttribute('aria-describedby');
  });

  it('wires aria-labelledby to a rendered DialogTitle', () => {
    render(
      <DialogContent>
        <DialogTitle>My Title</DialogTitle>
      </DialogContent>
    );
    const heading = screen.getByText('My Title');
    expect(heading.id).toBeTruthy();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', heading.id);
  });

  it('wires aria-describedby to a rendered DialogDescription', () => {
    render(
      <DialogContent>
        <DialogDescription>My Desc</DialogDescription>
      </DialogContent>
    );
    const desc = screen.getByText('My Desc');
    expect(desc.id).toBeTruthy();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-describedby', desc.id);
  });

  it('drops aria-labelledby when the title is unmounted', () => {
    const { rerender } = render(
      <DialogContent>
        <DialogTitle>T</DialogTitle>
      </DialogContent>
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby');
    rerender(
      <DialogContent>
        <span>no title now</span>
      </DialogContent>
    );
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-labelledby');
  });

  it('lets callers override the role via props', () => {
    render(<DialogContent role="alertdialog">Body</DialogContent>);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
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

  it('hides close button when hideCloseButton is set', () => {
    render(
      <Dialog open={true} onOpenChange={vi.fn()}>
        <DialogHeader hideCloseButton>Header</DialogHeader>
      </Dialog>
    );
    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument();
  });

  it('does not add pr-8 padding when hideCloseButton is set', () => {
    const { container } = render(
      <Dialog open={true} onOpenChange={vi.fn()}>
        <DialogHeader hideCloseButton>Header</DialogHeader>
      </Dialog>
    );
    const headers = container.querySelectorAll('.flex.flex-col');
    const header = headers[headers.length - 1];
    expect(header).not.toHaveClass('pr-8');
  });
});

describe('DialogTitle', () => {
  it('renders as h2', () => {
    render(<DialogTitle>The Title</DialogTitle>);
    const heading = screen.getByText('The Title');
    expect(heading.tagName).toBe('H2');
    expect(heading).toHaveClass('text-lg', 'font-semibold');
  });

  it('uses an explicit id and reports it to the dialog', () => {
    render(
      <DialogContent>
        <DialogTitle id="custom-title">T</DialogTitle>
      </DialogContent>
    );
    expect(screen.getByText('T').id).toBe('custom-title');
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'custom-title');
  });
});

describe('DialogDescription', () => {
  it('renders as p with gray text', () => {
    render(<DialogDescription>Desc</DialogDescription>);
    const el = screen.getByText('Desc');
    expect(el.tagName).toBe('P');
    expect(el).toHaveClass('text-sm', 'text-neutral-500');
  });

  it('uses an explicit id and reports it to the dialog', () => {
    render(
      <DialogContent>
        <DialogDescription id="custom-desc">D</DialogDescription>
      </DialogContent>
    );
    expect(screen.getByText('D').id).toBe('custom-desc');
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-describedby', 'custom-desc');
  });
});

describe('DialogFooter', () => {
  it('renders with flex column-reverse classes', () => {
    const { container } = render(<DialogFooter>Footer</DialogFooter>);
    expect(container.firstChild).toHaveClass('flex', 'flex-col-reverse');
  });
});
