import { expect, test } from "bun:test"
import type { Candidate } from "lib/core"
import { IndexedCandidateHeap } from "lib/indexed-candidate-heap"

const candidate = (params: {
  portId: number
  nextRegionId: number
  estimatedViaCount: number
  regionRiskCost: number
  routeLengthCost: number
}): Candidate => ({
  portId: params.portId,
  nextRegionId: params.nextRegionId,
  estimatedViaCount: params.estimatedViaCount,
  regionRiskCost: params.regionRiskCost,
  routeLengthCost: params.routeLengthCost,
  g: params.regionRiskCost,
  f: params.regionRiskCost,
  h: 0,
})

test("retains nondominated quality alternatives for a directed hop", () => {
  const heap = new IndexedCandidateHeap(10)
  const fewerViaFirstHop = candidate({
    portId: 1,
    nextRegionId: 2,
    estimatedViaCount: 0,
    regionRiskCost: 10,
    routeLengthCost: 5,
  })
  const lowerRiskFirstHop = candidate({
    portId: 1,
    nextRegionId: 2,
    estimatedViaCount: 1,
    regionRiskCost: 1,
    routeLengthCost: 1,
  })
  const dominatedFirstHop = candidate({
    portId: 1,
    nextRegionId: 2,
    estimatedViaCount: 1,
    regionRiskCost: 20,
    routeLengthCost: 6,
  })
  const shorterButRiskierSameViaHop = candidate({
    portId: 1,
    nextRegionId: 2,
    estimatedViaCount: 0,
    regionRiskCost: 11,
    routeLengthCost: 1,
  })
  const secondHop = candidate({
    portId: 2,
    nextRegionId: 2,
    estimatedViaCount: 0,
    regionRiskCost: 1,
    routeLengthCost: 1,
  })

  heap.queue(fewerViaFirstHop)
  heap.queue(lowerRiskFirstHop)
  heap.queue(dominatedFirstHop)
  heap.queue(shorterButRiskierSameViaHop)
  heap.queue(secondHop)

  expect(heap.length).toBe(3)
  const equalRiskCandidates = [heap.dequeue(), heap.dequeue()]
  expect(equalRiskCandidates).toContain(secondHop)
  expect(equalRiskCandidates).toContain(lowerRiskFirstHop)
  expect(heap.dequeue()).toBe(fewerViaFirstHop)
  expect(heap.dequeue()).toBeUndefined()

  heap.clear()
  heap.queue(secondHop)
  expect(heap.toArray()).toEqual([secondHop])
})
