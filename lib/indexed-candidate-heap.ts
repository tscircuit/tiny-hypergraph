import type { Candidate } from "./core"

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

  constructor(private readonly regionCount: number) {}

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
  }

  isClosedHop(portId: number, nextRegionId: number): boolean {
    return this.closedHopIds.has(portId * this.regionCount + nextRegionId)
  }

  queue(candidate: Candidate): void {
    const hopId = this.getHopId(candidate)
    if (this.closedHopIds.has(hopId)) return

    const existingIndex = this.indexByHopId.get(hopId)
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
    this.indexByHopId.set(hopId, index)
    this.siftUp(index)
  }

  dequeue(): Candidate | undefined {
    const bestCandidate = this.items[0]
    if (!bestCandidate) return undefined

    const bestHopId = this.getHopId(bestCandidate)
    this.closedHopIds.add(bestHopId)
    this.indexByHopId.delete(bestHopId)

    const lastCandidate = this.items.pop()!
    if (this.items.length > 0) {
      this.items[0] = lastCandidate
      this.indexByHopId.set(this.getHopId(lastCandidate), 0)
      this.siftDown(0)
    }
    return bestCandidate
  }

  private getHopId(candidate: Candidate): number {
    return candidate.portId * this.regionCount + candidate.nextRegionId
  }

  private siftUp(startIndex: number): void {
    const candidate = this.items[startIndex]!
    let index = startIndex
    while (index > 0) {
      const parentIndex = (index - 1) >> 1
      const parentCandidate = this.items[parentIndex]!
      if (parentCandidate.f <= candidate.f) break
      this.items[index] = parentCandidate
      this.indexByHopId.set(this.getHopId(parentCandidate), index)
      index = parentIndex
    }
    if (index === startIndex) return
    this.items[index] = candidate
    this.indexByHopId.set(this.getHopId(candidate), index)
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
      this.indexByHopId.set(this.getHopId(smallestChild), index)
      index = smallestChildIndex
    }
    if (index === startIndex) return
    this.items[index] = candidate
    this.indexByHopId.set(this.getHopId(candidate), index)
  }
}
