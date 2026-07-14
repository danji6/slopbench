import { Cubic, Morph, type RoundedPolygon } from '.'

const SPIN_DEGREES = 140
const SPIN_LEAD_TIME = 300
const SPIN_DURATION = 500
const SPIN_IDLE = 50
const ZOOM_STRENGTH = 0.08
const ZOOM_DURATION = 300
const ZOOM_DELAY = 130

export type MorpherMethod = 'autoplay' | 'press' | 'hover'

export type MorpherOptions = {
  delay?: number
  method?: MorpherMethod
  randomize?: boolean
  fill?: string
  stiffness?: number
  damping?: number
  mass?: number
  onMorphStart?: () => void
  onMorphEnd?: () => void
  spin?: boolean
}

export class Morpher {
  private ctx: CanvasRenderingContext2D
  private shapes: RoundedPolygon[]
  private fill: string
  private delay: number
  private method: 'autoplay' | 'press' | 'hover'
  private randomize: boolean
  private stiffness: number
  private damping: number
  private mass: number
  private onMorphStart?: () => void
  private onMorphEnd?: () => void
  private spin: boolean

  // --- Animation state ---
  private morphCache: Map<string, Morph>
  private currentMorph: Morph
  private currentMorphIndex: number
  private animationId: number
  private morphTimerId: number | null
  private target: number
  private position: number
  private velocity: number
  private lastTime: number
  private rotation: number
  private scale: number
  private morphStartTime: number
  private isSequenceRunning: boolean
  private baseRotation: number
  private idleRotationStartTime: number
  // ---

  constructor(
    ctx: CanvasRenderingContext2D,
    shapes: RoundedPolygon[],
    options?: MorpherOptions,
  ) {
    this.ctx = ctx
    this.shapes = shapes

    this.delay = options?.delay ?? 1000
    this.method = options?.method ?? 'autoplay'
    this.randomize = options?.randomize ?? false
    this.fill = options?.fill ?? '#000000'
    this.stiffness = options?.stiffness ?? 0.2
    this.damping = options?.damping ?? 0.4
    this.mass = options?.mass ?? 1
    this.onMorphStart = options?.onMorphStart
    this.onMorphEnd = options?.onMorphEnd
    this.spin = options?.spin ?? false

    this.morphCache = new Map()
    this.currentMorph = this.getMorph(0, 1 % shapes.length)
    this.currentMorphIndex = 0
    this.animationId = 0
    this.morphTimerId = null
    this.target = 0
    this.position = 0
    this.velocity = 0
    this.lastTime = 0
    this.rotation = 0
    this.scale = 1
    this.morphStartTime = 0
    this.isSequenceRunning = false
    this.baseRotation = 0
    this.idleRotationStartTime = 0
  }

  public setOptions(options: MorpherOptions) {
    const oldMethod = this.method

    this.delay = options?.delay ?? this.delay
    this.method = options?.method ?? this.method
    this.randomize = options?.randomize ?? this.randomize
    this.fill = options?.fill ?? this.fill
    this.stiffness = options?.stiffness ?? this.stiffness
    this.damping = options?.damping ?? this.damping
    this.mass = options?.mass ?? this.mass
    this.onMorphStart = options?.onMorphStart ?? this.onMorphStart
    this.onMorphEnd = options?.onMorphEnd ?? this.onMorphEnd
    this.spin = options?.spin ?? this.spin

    if (oldMethod !== this.method) {
      this.clearEventListeners()
      this.setupEventListeners()

      if (this.method === 'autoplay') {
        if (!this.morphTimerId && !this.isSequenceRunning) {
          this.nextMorph()
        }
      } else {
        if (this.morphTimerId != null) {
          clearTimeout(this.morphTimerId)
          this.morphTimerId = null
        }
      }
    } else {
      // We still want to redraw the current shape to reflect any changes
      this.draw()
    }
  }

  public start() {
    this.setupEventListeners()

    // For autoplay mode, start the first morph immediately
    if (this.method === 'autoplay' && this.shapes.length > 1) {
      this.nextMorph()
    } else {
      this.nextFrame()
    }
  }

  public stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
      this.animationId = 0
    }

    if (this.morphTimerId != null) {
      clearTimeout(this.morphTimerId)
      this.morphTimerId = null
    }

    this.clearEventListeners()
  }

  private getMorph(fromIndex: number, toIndex: number): Morph {
    const key = `${fromIndex}-${toIndex}`
    let morph = this.morphCache.get(key)
    if (!morph) {
      morph = new Morph(this.shapes[fromIndex], this.shapes[toIndex])
      this.morphCache.set(key, morph)
    }
    return morph
  }

  private setRandomTarget() {
    if (this.shapes.length <= 1) return

    // Pick a random index that isn't the current one
    let randomIndex: number
    do {
      randomIndex = Math.floor(Math.random() * this.shapes.length)
    } while (randomIndex === this.currentMorphIndex)

    this.currentMorph = this.getMorph(this.currentMorphIndex, randomIndex)
    this.position = 0
    this.velocity = 0
    this.setTarget(1)
  }

  private onMouseDown = () => {
    this.setRandomTarget()
  }

  private onMouseUp = () => {
    this.setTarget(0)
  }

  private onTouchStart = (e: TouchEvent) => {
    e.preventDefault()
    this.setRandomTarget()
  }

  private onTouchEnd = (e: TouchEvent) => {
    e.preventDefault()
    this.setTarget(0)
  }

  private onMouseEnter = () => {
    this.setRandomTarget()
  }

  private onMouseLeave = () => {
    this.setTarget(0)
  }

  private setupEventListeners() {
    if (this.method === 'autoplay') return

    const canvas = this.ctx.canvas

    if (this.method === 'press') {
      // Mouse events
      canvas.addEventListener('mousedown', this.onMouseDown)
      canvas.addEventListener('mouseup', this.onMouseUp)

      // Touch events
      canvas.addEventListener('touchstart', this.onTouchStart)
      canvas.addEventListener('touchend', this.onTouchEnd)
    } else if (this.method === 'hover') {
      canvas.addEventListener('mouseenter', this.onMouseEnter)
      canvas.addEventListener('mouseleave', this.onMouseLeave)
    }
  }

  private setTarget(value: number) {
    this.target = value
    if (!this.animationId) {
      this.lastTime = performance.now()
      this.nextFrame()
    }
  }

  private clearEventListeners() {
    const canvas = this.ctx.canvas

    canvas.removeEventListener('mousedown', this.onMouseDown)
    canvas.removeEventListener('mouseup', this.onMouseUp)
    canvas.removeEventListener('touchstart', this.onTouchStart)
    canvas.removeEventListener('touchend', this.onTouchEnd)
    canvas.removeEventListener('mouseenter', this.onMouseEnter)
    canvas.removeEventListener('mouseleave', this.onMouseLeave)
  }

  private animate(timestamp: number) {
    this.updateSequence(timestamp)
    this.updatePhysics(timestamp)
    this.draw()
    this.continueAnimation()
  }

  private updateSequence(timestamp: number) {
    let sequenceElapsed: number

    if (this.isSequenceRunning) {
      sequenceElapsed = timestamp - this.morphStartTime

      // Spin
      const spinProgress = Math.min(sequenceElapsed / SPIN_DURATION, 1)
      const easedSpin = this.easeInOutQuad(spinProgress)
      this.rotation = this.baseRotation + easedSpin * SPIN_DEGREES

      // Morph
      if (sequenceElapsed > SPIN_LEAD_TIME / 2 && this.target === 0) {
        this.setTarget(1)
        this.onMorphStart?.()
      }

      // Zoom
      let zoomProgress = 0
      if (sequenceElapsed > ZOOM_DELAY) {
        zoomProgress = Math.min(
          (sequenceElapsed - ZOOM_DELAY) / ZOOM_DURATION,
          1,
        )
      }
      this.scale = 1 + Math.sin(zoomProgress * Math.PI) * ZOOM_STRENGTH

      if (
        sequenceElapsed >= Math.max(SPIN_DURATION, ZOOM_DURATION + ZOOM_DELAY)
      ) {
        this.isSequenceRunning = false
        this.baseRotation = this.rotation % 360 // Normalize
        this.scale = 1
        this.idleRotationStartTime = timestamp // Start idle rotation from now

        this.onMorphEnd?.()
        if (
          this.method === 'autoplay' &&
          this.shapes.length > 1 &&
          this.morphTimerId == null
        ) {
          this.morphTimerId = window.setTimeout(() => {
            this.morphTimerId = null
            this.nextMorph()
          }, this.delay)
        }
      }
    } else if (this.spin && this.method === 'autoplay') {
      if (this.idleRotationStartTime === 0) {
        this.idleRotationStartTime = timestamp
      }
      const idleElapsed = (timestamp - this.idleRotationStartTime) / 1000
      this.rotation = this.baseRotation + idleElapsed * SPIN_IDLE
    }
  }

  private updatePhysics(timestamp: number) {
    // Cap the delta time to prevent large jumps when the canvas is reactivated
    const maxDelta = 1000 / 30 // Cap at 30fps for stability
    let deltaTime = timestamp - this.lastTime

    // If delta is too large, cap it
    if (deltaTime > maxDelta) {
      deltaTime = maxDelta
    }

    this.lastTime = timestamp
    const deltaTimeSeconds = deltaTime / 1000

    const force = -this.stiffness * (this.position - this.target)
    const dampingForce = -this.damping * this.velocity
    const acceleration = (force + dampingForce) / this.mass
    this.velocity += acceleration * deltaTimeSeconds * 60
    this.position += this.velocity * deltaTimeSeconds * 60
  }

  private draw() {
    const width = this.ctx.canvas.width
    const height = this.ctx.canvas.height
    const side = Math.min(width, height)
    const padding = side * 0.1
    const size = side - padding * 2
    const offsetX = (width - size) / 2
    const offsetY = (height - size) / 2
    const cubics = this.currentMorph.asCubics(this.position)
    const path = Cubic.toPath(cubics)

    this.ctx.clearRect(0, 0, width, height)

    // Center and scale the shape
    this.ctx.fillStyle = this.fill
    this.ctx.save()

    // Move to center for rotation/scale
    const centerX = width / 2
    const centerY = height / 2
    this.ctx.translate(centerX, centerY)
    this.ctx.rotate((this.rotation * Math.PI) / 180)
    this.ctx.scale(this.scale, this.scale)
    this.ctx.translate(-centerX, -centerY)

    this.ctx.translate(offsetX, offsetY)
    this.ctx.scale(size, size)

    // Draw the shape
    this.ctx.fill(path)
    this.ctx.restore()
  }

  private continueAnimation() {
    const isIdleSpinning =
      this.spin && this.method === 'autoplay' && !this.isSequenceRunning

    // Continue animation or start next morph
    if (
      this.isSequenceRunning ||
      isIdleSpinning ||
      Math.abs(this.position - this.target) > 0.001 ||
      Math.abs(this.velocity) > 0.001
    ) {
      this.nextFrame()
    } else {
      if (!this.spin) {
        this.onMorphEnd?.()
        if (
          this.method === 'autoplay' &&
          this.shapes.length > 1 &&
          this.morphTimerId == null
        ) {
          this.morphTimerId = window.setTimeout(() => {
            this.morphTimerId = null
            this.nextMorph()
          }, this.delay)
        }
      }
      this.animationId = 0
    }
  }

  private nextFrame() {
    this.animationId = requestAnimationFrame(this.animate.bind(this))
  }

  private nextMorph() {
    if (this.shapes.length <= 1) return

    let nextIndex: number
    if (this.randomize) {
      do {
        nextIndex = Math.floor(Math.random() * this.shapes.length)
      } while (nextIndex === this.currentMorphIndex)
    } else {
      nextIndex = (this.currentMorphIndex + 1) % this.shapes.length
    }

    this.currentMorph = this.getMorph(this.currentMorphIndex, nextIndex)
    this.currentMorphIndex = nextIndex
    this.position = 0
    this.velocity = 0

    if (this.spin) {
      this.target = 0
      this.baseRotation = this.rotation % 360 // Preserve current rotation
      this.isSequenceRunning = true
      this.morphStartTime = performance.now()

      if (!this.animationId) {
        this.lastTime = this.morphStartTime
        this.onMorphStart?.()
        this.nextFrame()
      }
    } else {
      this.setTarget(1)
    }
  }

  private easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
  }

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: debug code
  private drawDebugLines(width: number, height: number) {
    this.ctx.strokeStyle = 'red'
    this.ctx.lineWidth = 2
    this.ctx.beginPath()

    // Horizontal line
    this.ctx.moveTo(0, height / 2)
    this.ctx.lineTo(width, height / 2)

    // Vertical line
    this.ctx.moveTo(width / 2, 0)
    this.ctx.lineTo(width / 2, height)
    this.ctx.stroke()

    // Canvas perimeter rectangle
    this.ctx.strokeRect(0, 0, width, height)

    // Circle at center
    this.ctx.beginPath()
    const radius = Math.min(width, height) / 2
    this.ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2)
    this.ctx.stroke()
  }
}
