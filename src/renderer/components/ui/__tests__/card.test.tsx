// @vitest-environment happy-dom
/**
 * Tests for Card components
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '../card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('applies default classes', () => {
    const { container } = render(<Card />);
    expect(container.firstChild).toHaveClass('rounded-lg', 'border-gray-200', 'bg-white');
  });

  it('applies custom className', () => {
    const { container } = render(<Card className="custom-card" />);
    expect(container.firstChild).toHaveClass('custom-card');
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Card ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});

describe('CardHeader', () => {
  it('renders children', () => {
    render(<CardHeader>Header</CardHeader>);
    expect(screen.getByText('Header')).toBeInTheDocument();
  });

  it('applies default classes', () => {
    const { container } = render(<CardHeader />);
    expect(container.firstChild).toHaveClass('flex', 'flex-col', 'p-6');
  });

  it('merges custom className', () => {
    const { container } = render(<CardHeader className="extra" />);
    expect(container.firstChild).toHaveClass('extra', 'p-6');
  });
});

describe('CardTitle', () => {
  it('renders as h3', () => {
    render(<CardTitle>My Title</CardTitle>);
    const heading = screen.getByText('My Title');
    expect(heading.tagName).toBe('H3');
    expect(heading).toHaveClass('text-2xl', 'font-semibold');
  });
});

describe('CardDescription', () => {
  it('renders as p', () => {
    render(<CardDescription>Description text</CardDescription>);
    const el = screen.getByText('Description text');
    expect(el.tagName).toBe('P');
    expect(el).toHaveClass('text-sm', 'text-gray-500');
  });
});

describe('CardContent', () => {
  it('renders with padding classes', () => {
    const { container } = render(<CardContent>Content</CardContent>);
    expect(container.firstChild).toHaveClass('p-6', 'pt-0');
  });
});

describe('CardFooter', () => {
  it('renders with flex classes', () => {
    const { container } = render(<CardFooter>Footer</CardFooter>);
    expect(container.firstChild).toHaveClass('flex', 'items-center', 'p-6', 'pt-0');
  });
});

describe('Card composition', () => {
  it('renders a full card', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>
    );

    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });
});
