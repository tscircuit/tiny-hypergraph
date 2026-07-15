import { expect, test } from "bun:test"
import type { Candidate } from "lib/core"
import { IndexedCandidateHeap } from "lib/indexed-candidate-heap"

const candidate = (params: {
  portId: number
  nextRegionId: number
  estimatedViaCount: number
  regionRiskCost: number
  routeLengthCost: number
  f?: number
}): Candidate => ({
  portId: params.portId,
  nextRegionId: params.nextRegionId,
  estimatedViaCount: params.estimatedViaCount,
  regionRiskCost: params.regionRiskCost,
  routeLengthCost: params.routeLengthCost,
  g: params.regionRiskCost,
  f: params.f ?? params.regionRiskCost,
  h: (params.f ?? params.regionRiskCost) - params.regionRiskCost,
})

test("keeps one lowest-risk queued label per hop and closes expanded hops", () => {
  const heap = new IndexedCandidateHeap(10)
  const firstHop = candidate({
    portId: 1,
    nextRegionId: 2,
    estimatedViaCount: 0,
    regionRiskCost: 10,
    routeLengthCost: 5,
  })
  const fewerViaButRiskierFirstHop = candidate({
    portId: 1,
    nextRegionId: 2,
    estimatedViaCount: 0,
    regionRiskCost: 11,
    routeLengthCost: 1,
    f: 1,
  })
  const lowerRiskFirstHop = candidate({
    portId: 1,
    nextRegionId: 2,
    estimatedViaCount: 1,
    regionRiskCost: 5,
    routeLengthCost: 20,
    f: 20,
  })
  const secondHop = candidate({
    portId: 2,
    nextRegionId: 2,
    estimatedViaCount: 0,
    regionRiskCost: 1,
    routeLengthCost: 1,
  })

  heap.queue(firstHop)
  heap.queue(fewerViaButRiskierFirstHop)
  heap.queue(lowerRiskFirstHop)
  heap.queue(secondHop)

  expect(heap.length).toBe(2)
  expect(heap.dequeue()).toBe(secondHop)

  heap.queue(
    candidate({
      portId: 2,
      nextRegionId: 2,
      estimatedViaCount: 0,
      regionRiskCost: 0,
      routeLengthCost: 0,
    }),
  )
  expect(heap.length).toBe(1)
  expect(heap.dequeue()).toBe(lowerRiskFirstHop)
  expect(heap.dequeue()).toBeUndefined()

  heap.clear()
  heap.queue(secondHop)
  expect(heap.toArray()).toEqual([secondHop])
})
