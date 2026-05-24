// @ts-nocheck
/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { EmojiPainter, EmojiShape } from '../emoji';

vi.mock('../../../model', () => ({
  uuid: () => 'test-uuid',
  PresetEmoji: class {},
}));

vi.mock('../assets', () => ({
  Heart: ({ coord, onPointerDown }: any) => <svg data-testid="heart" />,
  Flag: ({ coord, onPointerDown }: any) => <svg data-testid="flag" />,
  Pushpin: ({ coord, onPointerDown }: any) => <svg data-testid="pushpin" />,
  RoundPushpin: ({ coord, onPointerDown }: any) => <svg data-testid="roundPushpin" />,
}));

const makeProps = (emoji: string) => ({
  area: [0, 0, 100, 100] as [number, number, number, number],
  rect: [10, 10, 20, 20] as [number, number, number, number],
  addPreset: vi.fn(),
  config: { emoji },
  bg: { url: '', css: {} },
});

describe('EmojiPainter', () => {
  it('renders heart emoji', () => {
    const props = makeProps('heart');
    const { getByTestId } = render(<EmojiPainter {...props} />);
    expect(getByTestId('heart')).toBeTruthy();
  });

  it('renders flag emoji', () => {
    const props = makeProps('flag');
    const { getByTestId } = render(<EmojiPainter {...props} />);
    expect(getByTestId('flag')).toBeTruthy();
  });

  it('renders pushpin emoji', () => {
    const props = makeProps('pushpin');
    const { getByTestId } = render(<EmojiPainter {...props} />);
    expect(getByTestId('pushpin')).toBeTruthy();
  });

  it('renders roundPushpin emoji', () => {
    const props = makeProps('roundPushpin');
    const { getByTestId } = render(<EmojiPainter {...props} />);
    expect(getByTestId('roundPushpin')).toBeTruthy();
  });

  it('renders null when no rect', () => {
    const props = { ...makeProps('heart'), rect: undefined };
    const { container } = render(<EmojiPainter {...props as any} />);
    expect(container.firstChild).toBeNull();
  });

  it('calls addPreset on createDefault', () => {
    const props = makeProps('heart');
    const ref = React.createRef<EmojiPainter>();
    render(<EmojiPainter ref={ref} {...props} />);
    (ref.current as any)?.createDefault([50, 50]);
    expect(props.addPreset).toHaveBeenCalled();
  });

  it('calls addPreset on finish when rect exists', () => {
    const props = makeProps('heart');
    const ref = React.createRef<EmojiPainter>();
    render(<EmojiPainter ref={ref} {...props} />);
    (ref.current as any)?.finish();
    expect(props.addPreset).toHaveBeenCalled();
  });

  it('finish does nothing when no rect', () => {
    const props = { ...makeProps('heart'), rect: undefined };
    const ref = React.createRef<EmojiPainter>();
    render(<EmojiPainter ref={ref} {...props as any} />);
    (ref.current as any)?.finish();
    expect(props.addPreset).not.toHaveBeenCalled();
  });
});

describe('EmojiShape', () => {
  it('renders heart shape', () => {
    const { getByTestId } = render(
      <EmojiShape
        rect={[5, 5, 20, 20]}
        content={{ emoji: 'heart' }}
        onPointerDown={vi.fn()}
      />
    );
    expect(getByTestId('heart')).toBeTruthy();
  });

  it('renders flag shape', () => {
    const { getByTestId } = render(
      <EmojiShape
        rect={[5, 5, 20, 20]}
        content={{ emoji: 'flag' }}
        onPointerDown={vi.fn()}
      />
    );
    expect(getByTestId('flag')).toBeTruthy();
  });
});
