import Resolveable from '../resolveable-promise';

describe('Resolveable', () => {
  it('starts in pending state', () => {
    const p = new Resolveable<string>();
    expect(p.status).toBe('pending');
    expect(p.isPending).toBe(true);
    expect(p.isResolved).toBe(false);
    expect(p.isRejected).toBe(false);
  });

  it('resolves with a value', async () => {
    const p = new Resolveable<number>();
    p.resolve(42);
    expect(p.status).toBe('resolved');
    expect(p.isResolved).toBe(true);
    expect(p.isPending).toBe(false);
    await expect(p).resolves.toBe(42);
  });

  it('rejects with a reason', async () => {
    const p = new Resolveable<string>();
    p.reject(new Error('fail'));
    expect(p.status).toBe('rejected');
    expect(p.isRejected).toBe(true);
    expect(p.isPending).toBe(false);
    await expect(p).rejects.toThrow('fail');
  });

  it('ignores subsequent resolve calls after first resolve', async () => {
    const p = new Resolveable<string>();
    p.resolve('first');
    p.resolve('second');
    expect(p.status).toBe('resolved');
    await expect(p).resolves.toBe('first');
  });

  it('ignores subsequent reject calls after first resolve', async () => {
    const p = new Resolveable<string>();
    p.resolve('ok');
    p.reject(new Error('nope'));
    expect(p.status).toBe('resolved');
    await expect(p).resolves.toBe('ok');
  });

  it('ignores subsequent resolve calls after first reject', async () => {
    const p = new Resolveable<string>();
    p.reject(new Error('fail'));
    p.resolve('too late');
    expect(p.status).toBe('rejected');
    await expect(p).rejects.toThrow('fail');
  });

  it('ignores subsequent reject calls after first reject', async () => {
    const p = new Resolveable<string>();
    p.reject(new Error('first'));
    p.reject(new Error('second'));
    expect(p.status).toBe('rejected');
    await expect(p).rejects.toThrow('first');
  });

  it('then/catch/finally return native Promise via Symbol.species', async () => {
    const p = new Resolveable<number>();
    const chained = p.then(v => v * 2);
    expect(chained).toBeInstanceOf(Promise);
    // chained should NOT be a Resolveable
    expect(chained).not.toHaveProperty('resolve');
    p.resolve(5);
    await expect(chained).resolves.toBe(10);
  });

  it('Symbol.species returns Promise', () => {
    expect((Resolveable as any)[Symbol.species]).toBe(Promise);
  });
});
