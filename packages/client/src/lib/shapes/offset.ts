/**
 * @param {number} x
 * @param {number} y
 * @returns {Offset}
 */
export function createOffset(x: number, y: number): Offset {
  return new Offset(x, y)
}

export class Offset {
  x: number
  y: number

  constructor(x: number, y: number) {
    this.x = x
    this.y = y
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {Offset}
   */
  copy(x: number = this.x, y: number = this.y): Offset {
    return new Offset(x, y)
  }

  /**
   * @returns {number}
   */
  getDistance(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y)
  }

  /**
   * @returns {number}
   */
  getDistanceSquared(): number {
    return this.x * this.x + this.y * this.y
  }

  /**
   * @returns {boolean}
   */
  isValid(): boolean {
    return Number.isFinite(this.x) && Number.isFinite(this.y)
  }

  /**
   * @returns {boolean}
   */
  get isFinite(): boolean {
    return Number.isFinite(this.x) && Number.isFinite(this.y)
  }

  /**
   * @returns {boolean}
   */
  get isSpecified(): boolean {
    return !this.isUnspecified
  }

  /**
   * @returns {boolean}
   */
  get isUnspecified(): boolean {
    return Object.is(this.x, NaN) && Object.is(this.y, NaN)
  }

  /**
   * @returns {Offset}
   */
  negate(): Offset {
    return new Offset(-this.x, -this.y)
  }

  /**
   * @param {Offset} other
   * @returns {Offset}
   */
  minus(other: Offset): Offset {
    return new Offset(this.x - other.x, this.y - other.y)
  }

  /**
   * @param {Offset} other
   * @returns {Offset}
   */
  plus(other: Offset): Offset {
    return new Offset(this.x + other.x, this.y + other.y)
  }

  /**
   * @param {number} operand
   * @returns {Offset}
   */
  times(operand: number): Offset {
    return new Offset(this.x * operand, this.y * operand)
  }

  /**
   * @param {number} operand
   * @returns {Offset}
   */
  div(operand: number): Offset {
    return new Offset(this.x / operand, this.y / operand)
  }

  /**
   * @param {number} operand
   * @returns {Offset}
   */
  rem(operand: number): Offset {
    return new Offset(this.x % operand, this.y % operand)
  }

  /**
   * @returns {string}
   */
  toString(): string {
    if (this.isSpecified) {
      return `Offset(${this.x.toFixed(1)}, ${this.y.toFixed(1)})`
    } else {
      return 'Offset.Unspecified'
    }
  }

  /**
   * @param {Offset} start
   * @param {Offset} stop
   * @param {number} fraction
   * @returns {Offset}
   */
  static lerp(start: Offset, stop: Offset, fraction: number): Offset {
    return new Offset(
      start.x + (stop.x - start.x) * fraction,
      start.y + (stop.y - start.y) * fraction,
    )
  }

  /**
   * @param {function(): Offset} block
   * @returns {Offset}
   */
  takeOrElse(block: () => Offset): Offset {
    return this.isSpecified ? this : block()
  }

  /**
   * @returns {number}
   */
  angleDegrees(): number {
    return (Math.atan2(this.y, this.x) * 180) / Math.PI
  }

  /**
   * @param {number} angle
   * @param {Offset} center
   * @returns {Offset}
   */
  rotateDegrees(angle: number, center: Offset = Offset.Zero): Offset {
    const a = (angle * Math.PI) / 180
    const off = this.minus(center)
    const cosA = Math.cos(a)
    const sinA = Math.sin(a)
    const newX = off.x * cosA - off.y * sinA
    const newY = off.x * sinA + off.y * cosA
    return new Offset(newX, newY).plus(center)
  }

  static Zero = new Offset(0, 0)
  static Infinite = new Offset(Infinity, Infinity)
  static Unspecified = new Offset(NaN, NaN)
}
