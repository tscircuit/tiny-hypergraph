import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"
import {
  computeRegionCost,
  computeRoutingRiskRegionCost,
  DEFAULT_MIN_VIA_PAD_DIAMETER,
  isKnownSingleLayerMask,
  TRACE_VIA_MARGIN,
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

test("routing-risk treats distinct same-net routes as physical crossing owners", () => {
  const problem = createProblem()
  problem.routeNet.fill(0)
  const solver = new TinyHyperGraphSolver(createTopology(1 << 0, 0), problem, {
    REGION_COST_MODEL: "routing-risk",
  })

  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0
  solver.appendSegmentToRegionCache(0, 0, 2)

  solver.state.currentRouteId = 1
  solver.state.currentRouteNetId = 0
  expect(
    solver.computeG(
      {
        nextRegionId: 0,
        portId: 1,
        f: 0,
        g: 0,
        h: 0,
      },
      3,
    ),
  ).toBe(Number.POSITIVE_INFINITY)
})

test("single-bit availableZ masks are all treated as known single-layer regions", () => {
  expect(isKnownSingleLayerMask(1 << 0)).toBe(true)
  expect(isKnownSingleLayerMask(1 << 1)).toBe(true)
  expect(isKnownSingleLayerMask(1 << 2)).toBe(true)
  expect(isKnownSingleLayerMask(1 << 3)).toBe(true)
  expect(isKnownSingleLayerMask((1 << 0) | (1 << 1))).toBe(false)
  expect(isKnownSingleLayerMask(0)).toBe(false)
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
    ),
  ).toBeGreaterThan(10)
})

test("region cost uses min via pad diameter plus trace-via margin", () => {
  const area = 9
  const traceCount = 2
  const traceCountMult = 1 + traceCount / 5
  const minViaPadDiameter = 0.2
  const expectedCost =
    ((minViaPadDiameter + TRACE_VIA_MARGIN) ** 2 * traceCountMult) / area

  expect(
    computeRegionCost(3, 3, 0, 1, 0, traceCount, 0, minViaPadDiameter),
  ).toBeCloseTo(expectedCost)
  expect(computeRegionCost(3, 3, 0, 1, 0, traceCount)).toBeCloseTo(
    ((DEFAULT_MIN_VIA_PAD_DIAMETER + TRACE_VIA_MARGIN) ** 2 * traceCountMult) /
      area,
  )
})

test("routing-risk region cost follows the downstream tuned-capacity model", () => {
  const cost = computeRoutingRiskRegionCost(4, 2, 2, 1, 3, 0, 0.3)
  const estimatedVias = 2 * 0.82 + 1 * 0.2 + 3 * 0.41
  const usedCapacity = (estimatedVias / 2) ** 1.1
  const minimumSide = 2
  const effectiveSpan = Math.sqrt(8)
  const viaRatioFactor = Math.min(
    1.2,
    Math.max(0.85, (minimumSide / 0.5) ** 0.05),
  )
  const totalCapacity = ((effectiveSpan * viaRatioFactor) / 0.35 / 2) ** 1.1

  expect(cost).toBeCloseTo(usedCapacity / totalCapacity)
  expect(computeRoutingRiskRegionCost(4, 2, 1, 0, 0, 1 << 2)).toBe(1)

  const sparseCrossingRisk = computeRoutingRiskRegionCost(
    0.5,
    1.9,
    1,
    0,
    0,
    3,
    0.3,
    4,
  )
  const denseCrossingRisk = computeRoutingRiskRegionCost(
    0.5,
    1.9,
    1,
    0,
    0,
    3,
    0.3,
    5,
  )
  expect(denseCrossingRisk).toBeGreaterThan(sparseCrossingRisk)
})
