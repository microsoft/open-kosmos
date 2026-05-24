import { Point } from '../coord';

describe('Point', () => {
  it('creates a point with default 0,0', () => {
    const p = new Point();
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
  });

  it('creates a point with given coordinates', () => {
    const p = new Point(3, 4);
    expect(p.x).toBe(3);
    expect(p.y).toBe(4);
  });

  describe('set', () => {
    it('sets coordinates and returns this', () => {
      const p = new Point();
      const result = p.set(5, 10);
      expect(p.x).toBe(5);
      expect(p.y).toBe(10);
      expect(result).toBe(p);
    });
  });

  describe('offset', () => {
    it('adds delta and returns this', () => {
      const p = new Point(1, 2);
      const result = p.offset(3, 4);
      expect(p.x).toBe(4);
      expect(p.y).toBe(6);
      expect(result).toBe(p);
    });
  });

  describe('equal', () => {
    it('returns true for equal points', () => {
      expect(new Point(1, 2).equal(new Point(1, 2))).toBe(true);
    });

    it('returns false for different points', () => {
      expect(new Point(1, 2).equal(new Point(1, 3))).toBe(false);
    });
  });

  describe('spanTo', () => {
    it('returns difference as [dx, dy]', () => {
      const [dx, dy] = new Point(5, 7).spanTo(new Point(2, 3));
      expect(dx).toBe(3);
      expect(dy).toBe(4);
    });
  });

  describe('distanceTo', () => {
    it('returns euclidean distance', () => {
      expect(new Point(0, 0).distanceTo(new Point(3, 4))).toBe(5);
    });

    it('returns 0 for same point', () => {
      expect(new Point(1, 1).distanceTo(new Point(1, 1))).toBe(0);
    });
  });

  describe('stringify', () => {
    it('returns comma-separated string', () => {
      expect(new Point(10, 20).stringify()).toBe('10,20');
    });
  });

  describe('clone', () => {
    it('creates a new point with same coordinates', () => {
      const p = new Point(7, 8);
      const c = p.clone();
      expect(c.x).toBe(7);
      expect(c.y).toBe(8);
      expect(c).not.toBe(p);
    });
  });
});
