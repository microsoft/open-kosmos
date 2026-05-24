import { appendCacheBustingTimestamp } from '../urlUtils';

describe('appendCacheBustingTimestamp', () => {
  it('appends ?timestamp= to URL without query params', () => {
    const result = appendCacheBustingTimestamp('https://example.com/file.json');
    expect(result).toMatch(/^https:\/\/example\.com\/file\.json\?timestamp=\d+$/);
  });

  it('appends &timestamp= to URL with existing query params', () => {
    const result = appendCacheBustingTimestamp('https://example.com/file.json?v=1');
    expect(result).toMatch(/^https:\/\/example\.com\/file\.json\?v=1&timestamp=\d+$/);
  });

  it('generates a recent timestamp', () => {
    const before = Date.now();
    const result = appendCacheBustingTimestamp('https://example.com');
    const match = result.match(/timestamp=(\d+)/);
    expect(match).toBeTruthy();
    const ts = Number(match![1]);
    expect(ts).toBeGreaterThanOrEqual(before);
  });
});
