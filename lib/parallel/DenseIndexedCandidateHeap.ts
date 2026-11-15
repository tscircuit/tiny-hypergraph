import type { Candidate } from "../core"
import {
  IndexedCandidateHeap,
  type CompactCandidateHopIndex,
} from "../indexed-candidate-heap"

/** Native candidates always carry a valid compact hop ID. Specialize that
 * case while preserving IndexedCandidateHeap's replacement and tie order. */
export class DenseIndexedCandidateHeap extends IndexedCandidateHeap {
  private denseItems: Candidate[] = []
  private generations: Uint32Array
  private positions: Int32Array
  private generation = 1
  private epochToken = {}
  constructor(
    regionCount: number,
    private readonly hops: CompactCandidateHopIndex,
  ) {
    super(regionCount)
    this.generations = new Uint32Array(hops.hopCapacity)
    this.positions = new Int32Array(hops.hopCapacity)
  }
  override get closureEpoch() {
    return this.epochToken
  }
  override get length() {
    return this.denseItems.length
  }
  override toArray() {
    return [...this.denseItems]
  }
  override clear() {
    this.denseItems.length = 0
    this.epochToken = {}
    if (this.generation === 0xffffffff) {
      this.generations.fill(0)
      this.generation = 1
    } else this.generation++
  }
  override isClosedHopId(hop: number) {
    return (
      this.generations[hop] === this.generation && this.positions[hop] === -1
    )
  }
  override isClosedHop(port: number, region: number) {
    const incident = this.hops.incidentPortRegion[port]
    const slot =
      this.hops.firstRegionByPortId[port] === region
        ? 0
        : this.hops.secondRegionByPortId[port] === region
          ? 1
          : incident.indexOf(region)
    return (
      slot >= 0 && this.isClosedHopId(port * this.hops.hopSlotStride + slot)
    )
  }
  override queue(candidate: Candidate) {
    const hop = candidate.hopId!
    if (this.generations[hop] === this.generation) {
      const index = this.positions[hop]
      if (index < 0) return
      const old = this.denseItems[index]
      if (candidate.g >= old.g) return
      this.denseItems[index] = candidate
      if (candidate.f <= old.f) this.up(index)
      else this.down(index)
      return
    }
    this.generations[hop] = this.generation
    this.denseItems.push(candidate)
    this.up(this.denseItems.length - 1)
  }
  override dequeue() {
    const best = this.denseItems[0]
    if (!best) return undefined
    this.positions[best.hopId!] = -1
    const last = this.denseItems.pop()!
    if (this.denseItems.length) {
      this.denseItems[0] = last
      this.down(0)
    }
    return best
  }
  private up(start: number) {
    const items = this.denseItems,
      positions = this.positions
    const candidate = items[start]
    let i = start
    while (i > 0) {
      const parentIndex = (i - 1) >> 1,
        parent = items[parentIndex]
      if (parent.f <= candidate.f) break
      items[i] = parent
      positions[parent.hopId!] = i
      i = parentIndex
    }
    items[i] = candidate
    positions[candidate.hopId!] = i
  }
  private down(start: number) {
    const items = this.denseItems,
      positions = this.positions
    const candidate = items[start],
      length = items.length
    let i = start
    while (true) {
      const left = i * 2 + 1
      if (left >= length) break
      const right = left + 1
      const childIndex =
        right < length && items[right].f < items[left].f ? right : left
      const child = items[childIndex]
      if (candidate.f <= child.f) break
      items[i] = child
      positions[child.hopId!] = i
      i = childIndex
    }
    items[i] = candidate
    positions[candidate.hopId!] = i
  }
}
