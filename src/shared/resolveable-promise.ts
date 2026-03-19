const NOOP = () => {};
export default class Resolveable<T> extends Promise<T> {
  private _resolve: (value: T) => void = NOOP;
  private _reject: (reason?: any) => void = NOOP;

  public status: 'pending' | 'resolved' | 'rejected' = 'pending';

  // Ensure then/catch/finally return native Promise instead of trying to construct Resolveable
  static get [Symbol.species]() {
    return Promise;
  }

  constructor() {
    let capture: [(value: T) => void, (reason?: any) => void] = [NOOP, NOOP];
    super((resolve, reject) => {
      capture = [resolve, reject];
    });

    this._resolve = capture[0];
    this._reject = capture[1];
    this.status = 'pending';
  }

  public resolve(value: T) {
    if (this.status === 'pending') {
      this.status = 'resolved';
      this._resolve(value);
      this._resolve = NOOP;
      this._reject = NOOP;
    }
  }

  public reject(reason?: any) {
    if (this.status === 'pending') {
      this.status = 'rejected';
      this._reject(reason);
      this._resolve = NOOP;
      this._reject = NOOP;
    }
  }

  public get isPending() {
    return this.status === 'pending';
  }

  public get isResolved() {
    return this.status === 'resolved';
  }

  public get isRejected() {
    return this.status === 'rejected';
  }
}

