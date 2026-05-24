export class Point {
  constructor(
    public x = 0,
    public y = 0,
  ) {}

  public set(x: number, y: number) {
    this.x = x;
    this.y = y;
    return this;
  }

  public offset(dx: number, dy: number) {
    this.x += dx;
    this.y += dy;
    return this;
  }
  public equal(other: Point) {
    return this.x === other.x && this.y === other.y;
  }

  public spanTo(other: Point) {
    return [this.x - other.x, this.y - other.y] as const;
  }

  public distanceTo(other: Point) {
    const [h, v] = this.spanTo(other);
    return Math.sqrt(h**2 + v**2);
  }

  public stringify() {
    return this.x + ',' + this.y;
  }

  public clone() {
    return new Point(this.x, this.y);
  }
}
