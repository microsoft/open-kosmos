import { describe, expect, it, vi } from 'vitest';

vi.mock('../../assets/openkosmos/app.svg', () => ({ default: 'openkosmos-icon.svg' }));

describe('brandIcon', () => {
  it('returns the OpenKosmos icon for the OpenKosmos brand', async () => {
    vi.resetModules();
    vi.doMock('@shared/constants/branding', () => ({ BRAND_NAME: 'openkosmos' }));

    const { appIcon } = await import('../brandIcon');

    expect(appIcon).toBe('openkosmos-icon.svg');
  });

  it('falls back to an empty icon for unknown brands', async () => {
    vi.resetModules();
    vi.doMock('@shared/constants/branding', () => ({ BRAND_NAME: 'unknown' }));

    const { appIcon } = await import('../brandIcon');

    expect(appIcon).toBe('');
  });
});
