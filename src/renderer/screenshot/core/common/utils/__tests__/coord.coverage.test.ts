import { describe, it, expect } from 'vitest';
import {
  calcCursorRect,
  offsetRect,
  limitPointInRect,
  isRectEqual,
  limitRectOverflow,
  LimitBothOverflow,
  isRectWithinOrEqualTo,
  isNotIntersected,
  isIntersected,
  isContain,
} from '../coord';

describe('calcCursorRect', () => {
  it('startX < endX, startY < endY', () => {
    expect(calcCursorRect(1, 2, 5, 6)).toEqual([1, 2, 4, 4]);
  });

  it('startX > endX, startY > endY', () => {
    expect(calcCursorRect(5, 6, 1, 2)).toEqual([1, 2, 4, 4]);
  });

  it('equal points', () => {
    expect(calcCursorRect(3, 3, 3, 3)).toEqual([3, 3, 0, 0]);
  });
});

describe('offsetRect', () => {
  it('applies positive offsets', () => {
    expect(offsetRect([1, 2, 10, 20], 3, 4)).toEqual([4, 6, 10, 20]);
  });

  it('applies negative offsets', () => {
    expect(offsetRect([5, 5, 10, 10], -2, -3)).toEqual([3, 2, 10, 10]);
  });
});

describe('limitPointInRect', () => {
  it('point inside rect returns as-is', () => {
    expect(limitPointInRect([0, 0, 100, 100], 50, 50)).toEqual([50, 50]);
  });

  it('point below-left clamps to start', () => {
    expect(limitPointInRect([10, 10, 100, 100], 5, 5)).toEqual([10, 10]);
  });

  it('point above-right clamps to end', () => {
    expect(limitPointInRect([10, 10, 100, 100], 200, 200)).toEqual([110, 110]);
  });
});

describe('isRectEqual', () => {
  it('equal rects return true', () => {
    expect(isRectEqual([1, 2, 3, 4], [1, 2, 3, 4])).toBe(true);
  });

  it('different rects return false', () => {
    expect(isRectEqual([1, 2, 3, 4], [1, 2, 3, 5])).toBe(false);
  });
});

describe('limitRectOverflow', () => {
  it('rect within bounds unchanged', () => {
    expect(limitRectOverflow(100, 100, [10, 10, 50, 50])).toEqual([10, 10, 50, 50]);
  });

  it('rect starting before 0 is shifted to 0', () => {
    expect(limitRectOverflow(100, 100, [-5, 0, 20, 20])).toEqual([0, 0, 20, 20]);
  });

  it('rect extending past max is shifted back', () => {
    expect(limitRectOverflow(100, 100, [90, 90, 20, 20])).toEqual([80, 80, 20, 20]);
  });
});

describe('LimitBothOverflow', () => {
  it('values within range unchanged (a < b)', () => {
    expect(LimitBothOverflow(100, 10, 30)).toEqual([10, 30]);
  });

  it('values within range unchanged (a > b)', () => {
    expect(LimitBothOverflow(100, 30, 10)).toEqual([30, 10]);
  });

  it('start below 0 shifts both', () => {
    expect(LimitBothOverflow(100, -10, 20)).toEqual([0, 30]);
  });

  it('end above max shifts both', () => {
    expect(LimitBothOverflow(100, 80, 110)).toEqual([70, 100]);
  });

  it('a > b with overflow below 0', () => {
    expect(LimitBothOverflow(100, 20, -10)).toEqual([30, 0]);
  });
});

describe('isRectWithinOrEqualTo', () => {
  it('inner fully inside outer returns true', () => {
    expect(isRectWithinOrEqualTo([0, 0, 100, 100], [10, 10, 50, 50])).toBe(true);
  });

  it('equal rects return true', () => {
    expect(isRectWithinOrEqualTo([0, 0, 100, 100], [0, 0, 100, 100])).toBe(true);
  });

  it('inner outside returns false', () => {
    expect(isRectWithinOrEqualTo([0, 0, 50, 50], [10, 10, 60, 60])).toBe(false);
  });
});

describe('isNotIntersected', () => {
  it('completely separate rects return true', () => {
    expect(isNotIntersected([0, 0, 10, 10], [20, 20, 10, 10])).toBe(true);
  });

  it('overlapping rects return false', () => {
    expect(isNotIntersected([0, 0, 20, 20], [10, 10, 20, 20])).toBe(false);
  });

  it('touching edge is not intersected', () => {
    expect(isNotIntersected([0, 0, 10, 10], [10, 0, 10, 10])).toBe(true);
  });
});

describe('isIntersected', () => {
  it('overlapping rects return true', () => {
    expect(isIntersected([0, 0, 20, 20], [10, 10, 20, 20])).toBe(true);
  });

  it('non-overlapping rects return false', () => {
    expect(isIntersected([0, 0, 10, 10], [20, 20, 10, 10])).toBe(false);
  });
});

describe('isContain', () => {
  it('rect1 contains rect2', () => {
    expect(isContain([0, 0, 100, 100], [10, 10, 50, 50])).toBe(true);
  });

  it('rect2 larger than rect1 returns false', () => {
    expect(isContain([10, 10, 50, 50], [0, 0, 100, 100])).toBe(false);
  });

  it('equal rects return true', () => {
    expect(isContain([0, 0, 100, 100], [0, 0, 100, 100])).toBe(true);
  });
});
