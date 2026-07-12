import { buildLocalFileUrl } from '../urlUtils';

describe('buildLocalFileUrl', () => {
  it('prefixes a POSIX absolute path with file:// (three slashes total)', () => {
    expect(buildLocalFileUrl('/Users/me/out/photo.png')).toBe('file:///Users/me/out/photo.png');
  });

  it('converts a Windows backslash drive path to file:/// with forward slashes', () => {
    // file://C:\... would treat "C:" as a hostname and fail to load.
    expect(buildLocalFileUrl('C:\\Users\\me\\photo.png')).toBe('file:///C:/Users/me/photo.png');
  });

  it('converts a Windows forward-slash drive path to file:///', () => {
    expect(buildLocalFileUrl('C:/Users/me/photo.png')).toBe('file:///C:/Users/me/photo.png');
  });

  it('handles a lowercase drive letter', () => {
    expect(buildLocalFileUrl('d:\\data\\img.jpg')).toBe('file:///d:/data/img.jpg');
  });

  it('passes through an already file:// scheme path unchanged', () => {
    expect(buildLocalFileUrl('file:///out/photo.png')).toBe('file:///out/photo.png');
  });

  it('passes through http(s) and data URLs unchanged', () => {
    expect(buildLocalFileUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(buildLocalFileUrl('http://example.com/a.png')).toBe('http://example.com/a.png');
    expect(buildLocalFileUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });
});
