/**
 * Coverage test for src/main/bootstrap.ts
 *
 * bootstrap.ts is the main-process entry point. Its entire job is two
 * load-bearing, ordered side-effect imports:
 *   1. `./bootstrapUserData` (brand userData path setup — must run first)
 *   2. `./main` (the real entry point)
 *
 * We mock both modules with side-effect spies, import bootstrap.ts, and assert
 * that BOTH ran and that bootstrapUserData ran BEFORE main (the ordering this
 * file exists to guarantee).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const order: string[] = [];

vi.mock('../bootstrapUserData', () => {
  order.push('bootstrapUserData');
  return {};
});

vi.mock('../main', () => {
  order.push('main');
  return {};
});

describe('bootstrap.ts entry point', () => {
  beforeEach(() => {
    order.length = 0;
  });

  it('imports bootstrapUserData before main (load-bearing order)', async () => {
    await import('../bootstrap');
    expect(order).toEqual(['bootstrapUserData', 'main']);
  });
});
