const MAX_GENERATION = 0xffffffff
const MIN_CAPACITY = 2

type ValidateHopId = (hopId: number) => void

export class SparseCandidateBestCostTable {
  private readonly keys: Float64Array
  private readonly occupied: Uint8Array
  private readonly generations: Uint32Array
  private readonly costs: Float64Array
  private readonly mask: number
  private generation = 1
  private entryCount = 0

  constructor(
    private readonly maxEntryCount: number,
    private readonly validateHopId: ValidateHopId,
  ) {
    if (!Number.isSafeInteger(maxEntryCount) || maxEntryCount < 0) {
      throw new Error(
        "Sparse candidate best-cost table requires a non-negative safe entry count, received " +
          maxEntryCount,
      )
    }

    let capacity = MIN_CAPACITY
    const minimumCapacity = Math.max(MIN_CAPACITY, maxEntryCount * 2)
    while (capacity < minimumCapacity) capacity *= 2

    this.keys = new Float64Array(capacity)
    this.occupied = new Uint8Array(capacity)
    this.generations = new Uint32Array(capacity)
    this.costs = new Float64Array(capacity)
    this.mask = capacity - 1
  }

  get size(): number {
    return this.entryCount
  }

  reset(): void {
    if (this.generation === MAX_GENERATION) {
      this.generations.fill(0)
      this.generation = 1
      return
    }

    this.generation += 1
  }

  get(hopId: number): number {
    const slot = this.findSlot(hopId)
    if (slot === undefined || this.generations[slot] !== this.generation) {
      return Number.POSITIVE_INFINITY
    }

    return this.costs[slot]!
  }

  set(hopId: number, cost: number): void {
    if (!Number.isSafeInteger(hopId) || hopId < 0) {
      throw new Error(
        "Sparse candidate best-cost table received invalid hop id " + hopId,
      )
    }

    const existingSlot = this.findSlot(hopId)
    if (existingSlot !== undefined) {
      this.generations[existingSlot] = this.generation
      this.costs[existingSlot] = cost
      return
    }

    if (this.entryCount >= this.maxEntryCount) {
      throw new Error(
        "Sparse candidate best-cost table exhausted its " +
          this.maxEntryCount +
          " legal hop entries while inserting hop " +
          hopId,
      )
    }

    this.validateHopId(hopId)
    let slot = this.hash(hopId)
    while (this.occupied[slot] !== 0) {
      slot = (slot + 1) & this.mask
    }

    this.keys[slot] = hopId
    this.occupied[slot] = 1
    this.generations[slot] = this.generation
    this.costs[slot] = cost
    this.entryCount += 1
  }

  private findSlot(hopId: number): number | undefined {
    let slot = this.hash(hopId)
    while (this.occupied[slot] !== 0) {
      if (this.keys[slot] === hopId) return slot
      slot = (slot + 1) & this.mask
    }

    return undefined
  }

  private hash(hopId: number): number {
    const lowBits = hopId >>> 0
    const highBits = Math.floor(hopId / 0x100000000) >>> 0
    return Math.imul(lowBits ^ highBits, 0x9e3779b1) & this.mask
  }
}
