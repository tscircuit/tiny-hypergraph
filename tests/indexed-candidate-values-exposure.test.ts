import { expect, test } from "bun:test"
import type { Candidate } from "lib/core"
import { IndexedCandidateHeap } from "lib/indexed-candidate-heap"

const enqueue = (heap: IndexedCandidateHeap, hopId: number, g: number) =>
  heap.queueValues(hopId, 0, 1, hopId, g, 0, g, undefined)

test("pending reuse preserves exposed references and public queue hooks", () => {
  const heap = new IndexedCandidateHeap(10)
  enqueue(heap, 1, 10)
  const privateEntry = (heap as any).items[0] as Candidate
  enqueue(heap, 1, 5)
  expect((heap as any).items[0]).toBe(privateEntry)

  const exposed = heap.toArray()[0]
  enqueue(heap, 1, 2)
  expect(exposed).toBe(privateEntry)
  expect(exposed.g).toBe(5)
  const popped = heap.dequeue()!
  expect(popped).not.toBe(exposed)
  expect(popped.g).toBe(2)

  heap.clear()
  enqueue(heap, 2, 9)
  const fresh = (heap as any).items[0]
  enqueue(heap, 2, 4)
  expect((heap as any).items[0]).toBe(fresh)
  expect(popped.g).toBe(2)

  const publicEntry: Candidate = {
    hopId: 3,
    portId: 3,
    nextRegionId: 1,
    g: 8,
    h: 0,
    f: 8,
    prevCandidate: popped,
  }
  heap.queue(publicEntry)
  enqueue(heap, 2, 1)
  enqueue(heap, 3, 3)
  expect(fresh.g).toBe(4)
  expect(publicEntry.g).toBe(8)
  expect(publicEntry.prevCandidate).toBe(popped)
  expect(heap.dequeue()?.g).toBe(1)
  expect(heap.dequeue()?.g).toBe(3)

  const observed: Candidate[] = []
  class CustomizedHeap extends IndexedCandidateHeap {
    override queue(candidate: Candidate): void {
      observed.push(candidate)
      super.queue(candidate)
    }
  }
  const customized = new CustomizedHeap(10)
  enqueue(customized, 1, 10)
  enqueue(customized, 1, 5)
  expect(observed).toHaveLength(2)
  expect(observed[0].g).toBe(10)
  expect(customized.dequeue()).toBe(observed[1])

  const originalQueue = IndexedCandidateHeap.prototype.queue
  const patchedInputs: Candidate[] = []
  IndexedCandidateHeap.prototype.queue = function (candidate): void {
    patchedInputs.push(candidate)
    originalQueue.call(this, candidate)
  }
  try {
    const patched = new IndexedCandidateHeap(10)
    enqueue(patched, 1, 10)
    enqueue(patched, 1, 5)
    expect(patchedInputs).toHaveLength(2)
    expect(patchedInputs[0].g).toBe(10)
    expect(patched.dequeue()).toBe(patchedInputs[1])
  } finally {
    IndexedCandidateHeap.prototype.queue = originalQueue
  }

  // Clearing creates fresh pending entries rather than recycling ancestors.
  heap.clear()
  heap.queueValues(1, 0, 1, 1, 7, 0, 7, popped)
  enqueue(heap, 1, -0)
  const descendant = heap.dequeue()!
  expect(Object.is(descendant.g, -0)).toBe(true)
  expect(descendant.prevCandidate).toBeUndefined()
  expect(popped.g).toBe(2)

  const rootShape = new IndexedCandidateHeap(10)
  rootShape.queueValues(0, undefined, 0, 0, 10, 0, 10, undefined)
  const firstRoot = (rootShape as any).items[0] as Candidate
  rootShape.queueValues(-0, undefined, 0, 0, 3, 0, 3, undefined)
  const replacementRoot = rootShape.dequeue()!
  expect(Object.is(replacementRoot.hopId, -0)).toBe(true)
  expect(firstRoot.g).toBe(10)
  expect(Object.keys(replacementRoot)).toEqual([
    "hopId",
    "nextRegionId",
    "portId",
    "f",
    "g",
    "h",
  ])
  rootShape.clear()
  rootShape.queueValues(0, undefined, 0, 0, 10, 0, 10, undefined)
  rootShape.queueValues(0, 0, 1, 0, 3, 0, 3, popped)
  expect(Object.keys(rootShape.dequeue()!)).toEqual([
    "hopId",
    "prevRegionId",
    "nextRegionId",
    "portId",
    "g",
    "h",
    "f",
    "prevCandidate",
  ])
})
