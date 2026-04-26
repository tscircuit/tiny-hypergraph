import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"
import {
  computeRegionCost,
  isKnownSingleLayerMask,
} from "lib/computeRegionCost"

const createTopology = (
  regionAvailableZMask: number,
  portZ: number,
): TinyHyperGraphTopology => ({
  portCount: 4,
  regionCount: 2,
  regionIncidentPorts: [[0, 1, 2, 3], []],
  incidentPortRegion: [
    [0, 1],
    [0, 1],
    [0, 1],
    [0, 1],
  ],
  regionWidth: new Float64Array([3, 1]),
  regionHeight: new Float64Array([3, 1]),
  regionCenterX: new Float64Array(2).fill(0),
  regionCenterY: new Float64Array(2).fill(0),
  regionAvailableZMask: new Int32Array([regionAvailableZMask, 0]),
  portAngleForRegion1: new Int32Array([0, 9000, 18000, 27000]),
  portAngleForRegion2: new Int32Array(4),
  portX: new Float64Array([1, 0, -1, 0]),
  portY: new Float64Array([0, 1, 0, -1]),
  portZ: new Int32Array([portZ, portZ, portZ, portZ]),
})

const createProblem = (): TinyHyperGraphProblem => ({
  routeCount: 2,
  portSectionMask: new Int8Array(4).fill(1),
  routeStartPort: new Int32Array([0, 1]),
  routeEndPort: new Int32Array([2, 3]),
  routeNet: new Int32Array([0, 1]),
  regionNetId: new Int32Array(2).fill(-1),
})

const getCrossingCost = (regionAvailableZMask: number, portZ: number) => {
  const solver = new TinyHyperGraphSolver(
    createTopology(regionAvailableZMask, portZ),
    createProblem(),
  )

  solver.state.currentRouteNetId = 0
  solver.appendSegmentToRegionCache(0, 0, 2)

  solver.state.currentRouteNetId = 1
  return solver.computeG(
    {
      nextRegionId: 0,
      portId: 1,
      f: 0,
      g: 0,
      h: 0,
    },
    3,
  )
}

test("same-layer crossings in known single-layer regions are rejected as candidates", () => {
  const topLayerCrossingCost = getCrossingCost(1 << 0, 0)
  const bottomLayerCrossingCost = getCrossingCost(1 << 1, 1)
  const innerLayer2CrossingCost = getCrossingCost(1 << 2, 2)
  const innerLayer3CrossingCost = getCrossingCost(1 << 3, 3)
  const multiLayerCrossingCost = getCrossingCost((1 << 0) | (1 << 1), 0)

  expect(topLayerCrossingCost).toBe(Number.POSITIVE_INFINITY)
  expect(bottomLayerCrossingCost).toBe(Number.POSITIVE_INFINITY)
  expect(innerLayer2CrossingCost).toBe(Number.POSITIVE_INFINITY)
  expect(innerLayer3CrossingCost).toBe(Number.POSITIVE_INFINITY)
  expect(multiLayerCrossingCost).toBeLessThan(0.1)
})

test("single-bit availableZ masks are all treated as known single-layer regions", () => {
  expect(isKnownSingleLayerMask(1 << 0)).toBe(true)
  expect(isKnownSingleLayerMask(1 << 1)).toBe(true)
  expect(isKnownSingleLayerMask(1 << 2)).toBe(true)
  expect(isKnownSingleLayerMask(1 << 3)).toBe(true)
  expect(isKnownSingleLayerMask((1 << 0) | (1 << 1))).toBe(false)
  expect(isKnownSingleLayerMask(0)).toBe(false)
})

test("region cost uses the supplied via size", () => {
  const width = 3
  const height = 3
  const sameLayerIntersections = 1
  const crossLayerIntersections = 0
  const entryExitChanges = 0
  const traceCount = 2
  const regionAvailableZMask = 0

  const smallerViaCost = computeRegionCost(
    width,
    height,
    sameLayerIntersections,
    crossLayerIntersections,
    entryExitChanges,
    traceCount,
    regionAvailableZMask,
    0.45,
  )
  const largerViaCost = computeRegionCost(
    width,
    height,
    sameLayerIntersections,
    crossLayerIntersections,
    entryExitChanges,
    traceCount,
    regionAvailableZMask,
    0.9,
  )

  expect(largerViaCost).toBeGreaterThan(smallerViaCost)
})

test("same-layer crossings incur the impossible single-layer penalty for higher routed layers too", () => {
  const width = 3
  const height = 3
  const sameLayerIntersections = 1
  const crossLayerIntersections = 0
  const entryExitChanges = 0
  const traceCount = 2

  expect(
    computeRegionCost(
      width,
      height,
      sameLayerIntersections,
      crossLayerIntersections,
      entryExitChanges,
      traceCount,
      1 << 2,
      0.45,
    ),
  ).toBeGreaterThan(10)

  expect(
    computeRegionCost(
      width,
      height,
      sameLayerIntersections,
      crossLayerIntersections,
      entryExitChanges,
      traceCount,
      1 << 3,
      0.45,
    ),
  ).toBeGreaterThan(10)
})
