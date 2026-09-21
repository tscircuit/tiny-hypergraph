import type { Candidate } from "./core"
import type { RegionId } from "./types"

export interface CompactCandidateHopIndex {
  hopCapacity: number
  hopSlotStride: number
  firstRegionByPortId: Int32Array
  secondRegionByPortId: Int32Array
  incidentPortRegion: RegionId[][]
}

/**
 * Candidate queue keyed by the directed hop represented by a candidate.
 *
 * A queued hop has at most one entry. A lower-cost candidate replaces the
 * existing entry in place, and a dequeued hop is closed until the queue is
 * cleared for the next route search.
 */
export class IndexedCandidateHeap {
  private items: Candidate[] = []
  private indexByHopId = new Map<number, number>()
  private closedHopIds = new Set<number>()
  private hopStateGeneration?: Uint32Array
  private hopIndexOrClosed?: Int32Array
  private currentHopStateGeneration = 1

  constructor(
    private readonly regionCount: number,
    private readonly compactHopIndex?: CompactCandidateHopIndex,
  ) {
    if (compactHopIndex) {
      this.hopStateGeneration = new Uint32Array(compactHopIndex.hopCapacity)
      this.hopIndexOrClosed = new Int32Array(compactHopIndex.hopCapacity)
    }
  }

  get length(): number {
    return this.items.length
  }

  toArray(): Candidate[] {
    return [...this.items]
  }

  clear(): void {
    this.items.length = 0
    this.indexByHopId.clear()
    this.closedHopIds.clear()
    if (!this.hopStateGeneration) return

    if (this.currentHopStateGeneration === 0xffffffff) {
      this.hopStateGeneration.fill(0)
      this.currentHopStateGeneration = 1
    } else {
      this.currentHopStateGeneration += 1
    }
  }

  isClosedHop(portId: number, nextRegionId: number): boolean {
    return this.isHopClosed(this.getHopIdFromValues(portId, nextRegionId))
  }

  queue(candidate: Candidate): void {
    const hopId = this.getHopId(candidate)
    if (this.isHopClosed(hopId)) return

    const existingIndex = this.getQueuedHopIndex(hopId)
    if (existingIndex !== undefined) {
      const existingCandidate = this.items[existingIndex]!
      if (candidate.g >= existingCandidate.g) return

      this.items[existingIndex] = candidate
      if (candidate.f <= existingCandidate.f) {
        this.siftUp(existingIndex)
      } else {
        this.siftDown(existingIndex)
      }
      return
    }

    const index = this.items.length
    this.items.push(candidate)
    this.siftUp(index)
  }

  dequeue(): Candidate | undefined {
    const bestCandidate = this.items[0]
    if (!bestCandidate) return undefined

    const bestHopId = this.getHopId(bestCandidate)
    this.closeHop(bestHopId)

    const lastCandidate = this.items.pop()!
    if (this.items.length > 0) {
      this.items[0] = lastCandidate
      this.siftDown(0)
    }
    return bestCandidate
  }

  private getHopId(candidate: Candidate): number {
    return this.getHopIdFromValues(candidate.portId, candidate.nextRegionId)
  }

  private getHopIdFromValues(portId: number, nextRegionId: number): number {
    const compactHopIndex = this.compactHopIndex
    if (!compactHopIndex) return portId * this.regionCount + nextRegionId

    const baseHopId = portId * compactHopIndex.hopSlotStride
    if (compactHopIndex.firstRegionByPortId[portId] === nextRegionId) {
      return baseHopId
    }
    if (compactHopIndex.secondRegionByPortId[portId] === nextRegionId) {
      return baseHopId + 1
    }

    const incidentRegionIds = compactHopIndex.incidentPortRegion[portId]
    for (let slot = 2; slot < (incidentRegionIds?.length ?? 0); slot++) {
      if (incidentRegionIds![slot] === nextRegionId) return baseHopId + slot
    }

    return -(portId * this.regionCount + nextRegionId) - 1
  }

  private getQueuedHopIndex(hopId: number): number | undefined {
    if (
      hopId >= 0 &&
      this.hopStateGeneration?.[hopId] === this.currentHopStateGeneration
    ) {
      const index = this.hopIndexOrClosed![hopId]!
      return index >= 0 ? index : undefined
    }
    return this.indexByHopId.get(hopId)
  }

  private isHopClosed(hopId: number): boolean {
    if (
      hopId >= 0 &&
      this.hopStateGeneration?.[hopId] === this.currentHopStateGeneration
    ) {
      return this.hopIndexOrClosed![hopId] === -1
    }
    return this.closedHopIds.has(hopId)
  }

  private setQueuedHopIndex(hopId: number, index: number): void {
    if (hopId >= 0 && this.hopStateGeneration) {
      this.hopStateGeneration[hopId] = this.currentHopStateGeneration
      this.hopIndexOrClosed![hopId] = index
      return
    }
    this.indexByHopId.set(hopId, index)
  }

  private closeHop(hopId: number): void {
    if (hopId >= 0 && this.hopStateGeneration) {
      this.hopStateGeneration[hopId] = this.currentHopStateGeneration
      this.hopIndexOrClosed![hopId] = -1
      return
    }
    this.indexByHopId.delete(hopId)
    this.closedHopIds.add(hopId)
  }

  private siftUp(startIndex: number): void {
    const candidate = this.items[startIndex]!
    let index = startIndex
    while (index > 0) {
      const parentIndex = (index - 1) >> 1
      const parent = this.items[parentIndex]!
      if (parent.f <= candidate.f) break
      this.items[index] = parent
      this.setQueuedHopIndex(this.getHopId(parent), index)
      index = parentIndex
    }
    this.items[index] = candidate
    this.setQueuedHopIndex(this.getHopId(candidate), index)
  }

  private siftDown(startIndex: number): void {
    const candidate = this.items[startIndex]!
    let index = startIndex
    while (true) {
      const leftChildIndex = index * 2 + 1
      if (leftChildIndex >= this.items.length) break

      const rightChildIndex = leftChildIndex + 1
      const smallestChildIndex =
        rightChildIndex < this.items.length &&
        this.items[rightChildIndex]!.f < this.items[leftChildIndex]!.f
          ? rightChildIndex
          : leftChildIndex
      const smallestChild = this.items[smallestChildIndex]!
      if (candidate.f <= smallestChild.f) break
      this.items[index] = smallestChild
      this.setQueuedHopIndex(this.getHopId(smallestChild), index)
      index = smallestChildIndex
    }
    this.items[index] = candidate
    this.setQueuedHopIndex(this.getHopId(candidate), index)
  }
}
