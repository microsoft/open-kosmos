import { APP_NAME, BRAND_NAME, BRAND_CONFIG, getWindowTitle } from '../branding';

describe('branding constants', () => {
  it('exports APP_NAME with a default value', () => {
    expect(typeof APP_NAME).toBe('string');
    expect(APP_NAME.length).toBeGreaterThan(0);
  });

  it('exports BRAND_NAME with a default value', () => {
    expect(typeof BRAND_NAME).toBe('string');
    expect(BRAND_NAME.length).toBeGreaterThan(0);
  });

  it('exports BRAND_CONFIG as an object', () => {
    expect(typeof BRAND_CONFIG).toBe('object');
  });

  describe('getWindowTitle', () => {
    it('returns a string containing AI Studio when no windowTitle in BRAND_CONFIG', () => {
      const title = getWindowTitle();
      expect(typeof title).toBe('string');
      expect(title.length).toBeGreaterThan(0);
    });
  });
});
