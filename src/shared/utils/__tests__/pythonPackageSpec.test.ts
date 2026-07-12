import { describe, it, expect } from 'vitest';
import { isValidPackageSpec, parsePackageSpecs } from '../pythonPackageSpec';

describe('isValidPackageSpec', () => {
  it.each(['requests', 'mcp[cli]', 'requests[security,socks]', 'httpx>=0.27,<1', 'ruff==0.4.2'])(
    'accepts %s',
    (s) => expect(isValidPackageSpec(s)).toBe(true),
  );
  it.each(['', '-flag', '--upgrade', 'a;b', 'rm -rf', 'pkg`x`'])(
    'rejects %s',
    (s) => expect(isValidPackageSpec(s)).toBe(false),
  );
});

describe('parsePackageSpecs', () => {
  it('splits on whitespace', () => {
    expect(parsePackageSpecs(' mcp   httpx ruff ')).toEqual(['mcp', 'httpx', 'ruff']);
  });
  it('splits on commas between names', () => {
    expect(parsePackageSpecs('mcp,httpx')).toEqual(['mcp', 'httpx']);
    expect(parsePackageSpecs('mcp, httpx')).toEqual(['mcp', 'httpx']);
    expect(parsePackageSpecs('mcp,2to3')).toEqual(['mcp', '2to3']);
  });
  it('keeps PEP 508 version-range commas', () => {
    expect(parsePackageSpecs('mcp httpx>=0.27,<1')).toEqual(['mcp', 'httpx>=0.27,<1']);
  });
  it('keeps commas inside extras', () => {
    expect(parsePackageSpecs('requests[security,socks] mcp')).toEqual(['requests[security,socks]', 'mcp']);
  });
  it('handles nested-then-closed brackets and depth reset', () => {
    expect(parsePackageSpecs('a[x,y] b[p,q]')).toEqual(['a[x,y]', 'b[p,q]']);
    expect(parsePackageSpecs(']mcp,httpx')).toEqual([']mcp', 'httpx']);
  });
  it('returns empty for blank', () => {
    expect(parsePackageSpecs('   ')).toEqual([]);
  });
});
