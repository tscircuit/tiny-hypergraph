import {
  candidateQualityDominatesOrEquals,
  compareCandidatesByQuality,
  getCandidateQuality,
  type Candidate,
} from "./core"

/**
 * Candidate queue that retains the nondominated quality frontier for each hop.
 */
export class IndexedCandidateHeap {
  private items: Candidate[] = []

  constructor(private readonly regionCount: number) {}

  get length(): number {
    return this.items.length
  }

  toArray(): Candidate[] {
    return [...this.items]
  }

  clear(): void {
    this.items.length = 0
  }

  removeWhere(predicate: (candidate: Candidate) => boolean): void {
    this.items = this.items.filter((candidate) => !predicate(candidate))
    this.heapify()
  }

  queue(candidate: Candidate): void {
    const hopId = this.getHopId(candidate)
    const quality = getCandidateQuality(candidate)
    if (
      this.items.some(
        (existingCandidate) =>
          this.getHopId(existingCandidate) === hopId &&
          candidateQualityDominatesOrEquals(
            getCandidateQuality(existingCandidate),
            quality,
          ),
      )
    ) {
      return
    }

    const retainedItems = this.items.filter(
      (existingCandidate) =>
        this.getHopId(existingCandidate) !== hopId ||
        !candidateQualityDominatesOrEquals(
          quality,
          getCandidateQuality(existingCandidate),
        ),
    )
    if (retainedItems.length !== this.items.length) {
      this.items = retainedItems
      this.heapify()
    }

    const index = this.items.length
    this.items.push(candidate)
    this.siftUp(index)
  }

  dequeue(): Candidate | undefined {
    const bestCandidate = this.items[0]
    if (!bestCandidate) return undefined

    const lastCandidate = this.items.pop()!
    if (this.items.length > 0) {
      this.items[0] = lastCandidate
      this.siftDown(0)
    }
    return bestCandidate
  }

  private getHopId(candidate: Candidate): number {
    return candidate.portId * this.regionCount + candidate.nextRegionId
  }

  private swap(leftIndex: number, rightIndex: number): void {
    const leftCandidate = this.items[leftIndex]!
    this.items[leftIndex] = this.items[rightIndex]!
    this.items[rightIndex] = leftCandidate
  }

  private heapify(): void {
    for (let index = (this.items.length >> 1) - 1; index >= 0; index--) {
      this.siftDown(index)
    }
  }

  private siftUp(startIndex: number): void {
    let index = startIndex
    while (index > 0) {
      const parentIndex = (index - 1) >> 1
      if (
        compareCandidatesByQuality(
          this.items[parentIndex]!,
          this.items[index]!,
        ) <= 0
      ) {
        return
      }
      this.swap(index, parentIndex)
      index = parentIndex
    }
  }

  private siftDown(startIndex: number): void {
    let index = startIndex
    while (true) {
      const leftChildIndex = index * 2 + 1
      if (leftChildIndex >= this.items.length) return

      const rightChildIndex = leftChildIndex + 1
      const smallestChildIndex =
        rightChildIndex < this.items.length &&
        compareCandidatesByQuality(
          this.items[rightChildIndex]!,
          this.items[leftChildIndex]!,
        ) < 0
          ? rightChildIndex
          : leftChildIndex
      if (
        compareCandidatesByQuality(
          this.items[index]!,
          this.items[smallestChildIndex]!,
        ) <= 0
      ) {
        return
      }
      this.swap(index, smallestChildIndex)
      index = smallestChildIndex
    }
  }
}
