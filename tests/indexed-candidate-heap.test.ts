import { expect, test } from "bun:test"
import type { Candidate } from "lib/core"
import { IndexedCandidateHeap } from "lib/indexed-candidate-heap"

const candidate = (params: {
  portId: number
  nextRegionId: number
  g: number
  f: number
}): Candidate => ({
  portId: params.portId,
  nextRegionId: params.nextRegionId,
  g: params.g,
  f: params.f,
  h: params.f - params.g,
})

test("keeps the lowest-cost queued directed hop and closes dequeued hops", () => {
  const heap = new IndexedCandidateHeap(10)
  const firstHop = candidate({ portId: 1, nextRegionId: 2, g: 10, f: 10 })
  const worseFirstHop = candidate({ portId: 1, nextRegionId: 2, g: 11, f: 1 })
  const betterFirstHop = candidate({ portId: 1, nextRegionId: 2, g: 5, f: 20 })
  const secondHop = candidate({ portId: 2, nextRegionId: 2, g: 1, f: 1 })

  heap.queue(firstHop)
  heap.queue(worseFirstHop)
  heap.queue(betterFirstHop)
  heap.queue(secondHop)

  expect(heap.length).toBe(2)
  expect(secondHop.hopId).toBe(22)
  expect(heap.isClosedHopId(22)).toBe(false)
  expect(heap.dequeue()).toBe(secondHop)
  expect(heap.isClosedHopId(22)).toBe(true)

  heap.queue(candidate({ portId: 2, nextRegionId: 2, g: 0, f: 0 }))
  expect(heap.length).toBe(1)
  expect(heap.dequeue()).toBe(betterFirstHop)
  expect(heap.dequeue()).toBeUndefined()

  heap.clear()
  heap.queue(secondHop)
  expect(heap.toArray()).toEqual([secondHop])
})

test("uses compact generation-scoped hop state when topology slots are provided", () => {
  const heap = new IndexedCandidateHeap(20, {
    hopCapacity: 6,
    hopSlotStride: 2,
    firstRegionByPortId: Int32Array.from([1, 3, 5]),
    secondRegionByPortId: Int32Array.from([2, 4, 6]),
    incidentPortRegion: [
      [1, 2],
      [3, 4],
      [5, 6],
    ],
  })
  const first = candidate({ portId: 1, nextRegionId: 3, g: 5, f: 5 })
  const replacement = candidate({ portId: 1, nextRegionId: 3, g: 2, f: 2 })
  const second = candidate({ portId: 2, nextRegionId: 6, g: 3, f: 3 })

  heap.queue(first)
  heap.queue(replacement)
  heap.queue(second)

  expect(heap.length).toBe(2)
  expect(heap.dequeue()).toBe(replacement)
  expect(heap.isClosedHop(1, 3)).toBe(true)
  heap.queue(candidate({ portId: 1, nextRegionId: 3, g: 1, f: 1 }))
  expect(heap.dequeue()).toBe(second)

  heap.clear()
  expect(heap.isClosedHop(1, 3)).toBe(false)
  heap.queue(first)
  expect(heap.dequeue()).toBe(first)
})
