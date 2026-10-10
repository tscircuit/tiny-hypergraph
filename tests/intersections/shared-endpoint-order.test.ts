import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/core"
import { countIntersectionsFromAnglePairsDynamic } from "lib/countIntersectionsFromAnglePairsDynamic"
import {
  countNewIntersections,
  createDynamicAnglePairArrays,
} from "lib/countNewIntersections"
import type { DynamicAnglePair } from "lib/types"

test("shared boundary angles preserve proper crossing counts and cache energy in every insertion order", () => {
  const orders = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ]
  for (const layer of [0, 1]) {
    const pairs: DynamicAnglePair[] = [
      [0, 0, 0, 9000, 0],
      [1, 0, 0, 18000, 0],
      [2, 4500, layer, 13500, layer],
    ]
    const expected: [number, number, number] =
      layer === 0 ? [1, 0, 0] : [0, 1, 0]
    for (const order of orders) {
      const ordered = order.map((index) => pairs[index]!)
      expect(countIntersectionsFromAnglePairsDynamic(ordered)).toEqual(expected)
      const incremental = [0, 0, 0]
      for (let index = 0; index < ordered.length; index++) {
        const delta = countNewIntersections(
          createDynamicAnglePairArrays(ordered.slice(0, index)),
          ordered[index]!,
        )
        for (let field = 0; field < 3; field++)
          incremental[field]! += delta[field]!
      }
      expect(incremental).toEqual(expected)
    }
  }
  for (const [a, b] of [
    [0, 18000],
    [9000, 18000],
    [0, 9000],
  ]) {
    const first: DynamicAnglePair = [0, 0, 0, 9000, 0]
    const tied: DynamicAnglePair = [1, a!, 1, b!, 1]
    expect(
      countNewIntersections(createDynamicAnglePairArrays([first]), tied),
    ).toEqual([0, 0, 0])
    expect(
      countNewIntersections(createDynamicAnglePairArrays([tied]), first),
    ).toEqual([0, 0, 0])
  }
  const topology: TinyHyperGraphTopology = {
    portCount: 6,
    regionCount: 2,
    regionIncidentPorts: [[0, 1, 2, 3, 4, 5], []],
    incidentPortRegion: Array.from({ length: 6 }, () => [0, 1]),
    regionWidth: Float64Array.of(10, 1),
    regionHeight: Float64Array.of(10, 1),
    regionCenterX: new Float64Array(2),
    regionCenterY: new Float64Array(2),
    regionAvailableZMask: Int32Array.of(3, 0),
    portAngleForRegion1: Int32Array.of(0, 9000, 0, 18000, 4500, 13500),
    portX: Float64Array.of(1, 0, 1, -1, Math.SQRT1_2, -Math.SQRT1_2),
    portY: Float64Array.of(0, 1, 0, 0, Math.SQRT1_2, Math.SQRT1_2),
    portZ: new Int32Array(6),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 3,
    portSectionMask: new Int8Array(6).fill(1),
    routeStartPort: Int32Array.of(0, 2, 4),
    routeEndPort: Int32Array.of(1, 3, 5),
    routeNet: Int32Array.of(0, 1, 2),
    regionNetId: new Int32Array(2).fill(-1),
  }
  let firstEnergy: number | undefined
  for (const order of orders) {
    const solver = new TinyHyperGraphSolver(topology, problem, {
      VIA_COST: 0.6,
    })
    for (const routeId of order) {
      const from = problem.routeStartPort[routeId]!
      const to = problem.routeEndPort[routeId]!
      solver.state.currentRouteNetId = problem.routeNet[routeId]
      solver.state.regionSegments[0]!.push([routeId, from, to])
      solver.appendSegmentToRegionCache(0, from, to)
    }
    const cache = solver.state.regionIntersectionCaches[0]!
    expect(cache.existingSameLayerIntersections).toBe(1)
    const energy = solver.withPathEnergy({
      maxRegionCost: cache.existingRegionCost,
      totalRegionCost: cache.existingRegionCost,
    }).pathEnergy!
    firstEnergy ??= energy
    expect(energy).toBeCloseTo(firstEnergy)
  }
})
