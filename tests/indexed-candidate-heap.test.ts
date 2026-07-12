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
  expect(heap.dequeue()).toBe(secondHop)

  heap.queue(candidate({ portId: 2, nextRegionId: 2, g: 0, f: 0 }))
  expect(heap.length).toBe(1)
  expect(heap.dequeue()).toBe(betterFirstHop)
  expect(heap.dequeue()).toBeUndefined()

  heap.clear()
  heap.queue(secondHop)
  expect(heap.toArray()).toEqual([secondHop])
})
