function padzero(n: number, len: number) {
  let str = String(n);
  const count = len - str.length;
  if (count > 0) {
    const list = Array(count).fill(0);
    list.push(str);
    str = list.join('');
  }
  return str;
}


export function yyyymmdd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = padzero(d.getMonth() + 1, 2);
  const dd = padzero(d.getDate(), 2);
  return yyyy + mm + dd;
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function nextTick() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

type Resolve<T> = (value: T) => void;
export class Future<T = void> {
  private task: Promise<T>;
  public reach: Resolve<T> = () => {};

  constructor() {
    this.task = new Promise((rs) => { this.reach = rs });
  }

  public then(rs: Resolve<T>) {
    return this.task.then(rs);
  }

  public async delay(n: number) {
    const v = await this.task;
    await sleep(n);
    return v;
  }
}
