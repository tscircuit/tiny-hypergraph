import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  clearTinyHyperGraphSectionSolverCache,
  getTinyHyperGraphSectionSolverCacheStats,
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionSolver,
  type TinyHyperGraphSolver,
} from "lib/index"
import {
  createSectionSolverFixturePortMask,
  sectionSolverFixturePortIds,
  sectionSolverFixtureGraph,
} from "tests/fixtures/section-solver.fixture"

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

const getSolvedRoutePortIds = (
  output: ReturnType<TinyHyperGraphSectionSolver["getOutput"]>,
) =>
  Object.fromEntries(
    (output.solvedRoutes ?? []).map((solvedRoute) => [
      solvedRoute.connection.connectionId,
      solvedRoute.path.map((candidate) => candidate.portId),
    ]),
  )

const getSerializedOutputMaxRegionCost = (
  serializedHyperGraph: ReturnType<TinyHyperGraphSectionSolver["getOutput"]>,
) => {
  const replay = loadSerializedHyperGraph(serializedHyperGraph)
  const replayedSolver = new TinyHyperGraphSectionSolver(
    replay.topology,
    replay.problem,
    replay.solution,
  )

  return getMaxRegionCost(replayedSolver.baselineSolver)
}

const rotatePoint = (x: number, y: number, quarterTurns: 0 | 1 | 2 | 3) => {
  switch (quarterTurns) {
    case 0:
      return { x, y }
    case 1:
      return { x: -y, y: x }
    case 2:
      return { x: -x, y: -y }
    case 3:
      return { x: y, y: -x }
  }
}

const createTransformedSectionSolverFixtureGraph = ({
  prefix,
  scale,
  rotationQuarterTurns,
  translateX,
  translateY,
}: {
  prefix: string
  scale: number
  rotationQuarterTurns: 0 | 1 | 2 | 3
  translateX: number
  translateY: number
}): SerializedHyperGraph => {
  const regionIdMap = new Map(
    sectionSolverFixtureGraph.regions.map((region) => [
      region.regionId,
      `${prefix}${region.regionId}`,
    ]),
  )
  const portIdMap = new Map(
    sectionSolverFixtureGraph.ports.map((port) => [
      port.portId,
      `${prefix}${port.portId}`,
    ]),
  )
  const connectionIdMap = new Map(
    (sectionSolverFixtureGraph.connections ?? []).map((connection) => [
      connection.connectionId,
      `${prefix}${connection.connectionId}`,
    ]),
  )

  const transformPoint = (x: number, y: number) => {
    const rotated = rotatePoint(x * scale, y * scale, rotationQuarterTurns)
    return {
      x: rotated.x + translateX,
      y: rotated.y + translateY,
    }
  }

  return {
    regions: sectionSolverFixtureGraph.regions.map((region) => {
      const center = transformPoint(
        Number(region.d?.center?.x ?? 0),
        Number(region.d?.center?.y ?? 0),
      )
      const width = Number(region.d?.width ?? 0) * scale
      const height = Number(region.d?.height ?? 0) * scale

      return {
        ...region,
        regionId: regionIdMap.get(region.regionId) ?? region.regionId,
        pointIds: region.pointIds.map(
          (portId) => portIdMap.get(portId) ?? portId,
        ),
        d: {
          ...region.d,
          center,
          width: rotationQuarterTurns % 2 === 0 ? width : height,
          height: rotationQuarterTurns % 2 === 0 ? height : width,
        },
      }
    }),
    ports: sectionSolverFixtureGraph.ports.map((port) => {
      const point = transformPoint(Number(port.d?.x ?? 0), Number(port.d?.y ?? 0))

      return {
        ...port,
        portId: portIdMap.get(port.portId) ?? port.portId,
        region1Id: regionIdMap.get(port.region1Id) ?? port.region1Id,
        region2Id: regionIdMap.get(port.region2Id) ?? port.region2Id,
        d: {
          ...port.d,
          x: point.x,
          y: point.y,
        },
      }
    }),
    connections: (sectionSolverFixtureGraph.connections ?? []).map(
      (connection) => ({
        ...connection,
        connectionId:
          connectionIdMap.get(connection.connectionId) ?? connection.connectionId,
        startRegionId:
          regionIdMap.get(connection.startRegionId) ?? connection.startRegionId,
        endRegionId:
          regionIdMap.get(connection.endRegionId) ?? connection.endRegionId,
        mutuallyConnectedNetworkId: connection.mutuallyConnectedNetworkId
          ? `${prefix}${connection.mutuallyConnectedNetworkId}`
          : connection.mutuallyConnectedNetworkId,
      }),
    ),
    solvedRoutes: (sectionSolverFixtureGraph.solvedRoutes ?? []).map((route) => ({
      ...route,
      connection: {
        ...route.connection,
        connectionId:
          connectionIdMap.get(route.connection.connectionId) ??
          route.connection.connectionId,
        startRegionId:
          regionIdMap.get(route.connection.startRegionId) ??
          route.connection.startRegionId,
        endRegionId:
          regionIdMap.get(route.connection.endRegionId) ??
          route.connection.endRegionId,
        mutuallyConnectedNetworkId: route.connection.mutuallyConnectedNetworkId
          ? `${prefix}${route.connection.mutuallyConnectedNetworkId}`
          : route.connection.mutuallyConnectedNetworkId,
      },
      path: route.path.map((candidate) => ({
        ...candidate,
        portId: portIdMap.get(candidate.portId) ?? candidate.portId,
        lastPortId:
          candidate.lastPortId !== undefined
            ? portIdMap.get(candidate.lastPortId) ?? candidate.lastPortId
            : undefined,
        lastRegionId:
          candidate.lastRegionId !== undefined
            ? regionIdMap.get(candidate.lastRegionId) ?? candidate.lastRegionId
            : undefined,
        nextRegionId:
          candidate.nextRegionId !== undefined
            ? regionIdMap.get(candidate.nextRegionId) ?? candidate.nextRegionId
            : undefined,
      })),
    })),
  }
}

const createPrefixedSectionSolverFixturePortMask = (
  topology: Parameters<typeof createSectionSolverFixturePortMask>[0],
  prefix: string,
) => {
  const sectionPortIds = new Set(
    sectionSolverFixturePortIds.map((portId) => `${prefix}${portId}`),
  )

  return Int8Array.from(
    topology.portMetadata?.map((metadata) =>
      sectionPortIds.has(metadata?.serializedPortId) ? 1 : 0,
    ) ?? [],
  )
}

test("section solver reattaches fixed prefixes and suffixes after optimizing the section", () => {
  clearTinyHyperGraphSectionSolverCache()

  const { topology, problem, solution } = loadSerializedHyperGraph(
    sectionSolverFixtureGraph,
  )
  problem.portSectionMask = createSectionSolverFixturePortMask(topology)

  const sectionSolver = new TinyHyperGraphSectionSolver(
    topology,
    problem,
    solution,
  )

  sectionSolver.solve()

  expect(sectionSolver.solved).toBe(true)
  expect(sectionSolver.failed).toBe(false)
  expect(sectionSolver.stats.optimized).toBe(true)
  expect(getMaxRegionCost(sectionSolver.getSolvedSolver())).toBeLessThan(
    getMaxRegionCost(sectionSolver.baselineSolver),
  )

  const optimizedRoutePortIds = getSolvedRoutePortIds(sectionSolver.getOutput())

  expect(optimizedRoutePortIds["route-0"]?.slice(0, 2)).toEqual(["s0", "a0"])
  expect(optimizedRoutePortIds["route-0"]?.slice(-2)).toEqual(["d0", "t0"])
  expect(optimizedRoutePortIds["route-1"]?.slice(0, 2)).toEqual(["s1", "a1"])
  expect(optimizedRoutePortIds["route-1"]?.slice(-2)).toEqual(["d1", "t1"])
  expect(optimizedRoutePortIds["route-0"]).not.toEqual([
    "s0",
    "a0",
    "b0x",
    "c1x",
    "d0",
    "t0",
  ])
  expect(optimizedRoutePortIds["route-1"]).not.toEqual([
    "s1",
    "a1",
    "b1x",
    "c0x",
    "d1",
    "t1",
  ])
})

test("section solver visualize highlights the section without idle gray port-region connector lines", () => {
  clearTinyHyperGraphSectionSolverCache()

  const { topology, problem, solution } = loadSerializedHyperGraph(
    sectionSolverFixtureGraph,
  )
  problem.portSectionMask = createSectionSolverFixturePortMask(topology)

  const sectionSolver = new TinyHyperGraphSectionSolver(
    topology,
    problem,
    solution,
  )

  sectionSolver.setup()
  const graphics = sectionSolver.visualize()

  expect(
    (graphics.lines ?? []).some(
      (line) => line.strokeColor === "rgba(100, 100, 100, 0.3)",
    ),
  ).toBe(false)
  expect(
    (graphics.rects ?? []).some(
      (rect) => rect.stroke === "rgba(245, 158, 11, 0.95)",
    ) ||
      (graphics.polygons ?? []).some(
        (polygon) => polygon.stroke === "rgba(245, 158, 11, 0.95)",
      ),
  ).toBe(true)
  expect(
    (graphics.circles ?? []).some(
      (circle) => circle.stroke === "rgba(245, 158, 11, 0.95)",
    ),
  ).toBe(true)
  expect(graphics.title).toContain("sectionPorts=")
})

test("section solver enforces section-specific rip thresholds and max rip cap", () => {
  clearTinyHyperGraphSectionSolverCache()

  const { topology, problem, solution } = loadSerializedHyperGraph(
    sectionSolverFixtureGraph,
  )
  problem.portSectionMask = createSectionSolverFixturePortMask(topology)

  const sectionSolver = new TinyHyperGraphSectionSolver(
    topology,
    problem,
    solution,
    {
      DISTANCE_TO_COST: 0.2,
      RIP_THRESHOLD_START: 0.11,
      RIP_THRESHOLD_END: 0.22,
      RIP_THRESHOLD_RAMP_ATTEMPTS: 9,
      RIP_CONGESTION_REGION_COST_FACTOR: 0.33,
      MAX_ITERATIONS: 4567,
      MAX_RIPS: 80,
      MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT: 3,
      EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST: 2,
    },
  )

  sectionSolver.setup()

  expect(sectionSolver.DISTANCE_TO_COST).toBe(0.2)
  expect(sectionSolver.sectionSolver?.DISTANCE_TO_COST).toBe(0.2)
  expect(sectionSolver.RIP_THRESHOLD_START).toBe(0.05)
  expect(sectionSolver.sectionSolver?.RIP_THRESHOLD_START).toBe(0.05)
  expect(sectionSolver.RIP_THRESHOLD_END).toBe(
    sectionSolver.sectionBaselineSummary.maxRegionCost,
  )
  expect(sectionSolver.sectionSolver?.RIP_THRESHOLD_END).toBe(
    sectionSolver.sectionBaselineSummary.maxRegionCost,
  )
  expect(sectionSolver.sectionSolver?.RIP_THRESHOLD_RAMP_ATTEMPTS).toBe(9)
  expect(sectionSolver.sectionSolver?.RIP_CONGESTION_REGION_COST_FACTOR).toBe(
    0.33,
  )
  expect(sectionSolver.sectionSolver?.MAX_ITERATIONS).toBe(4567)
  expect(sectionSolver.MAX_RIPS).toBe(20)
  expect(sectionSolver.sectionSolver?.MAX_RIPS).toBe(20)
  expect(
    sectionSolver.sectionSolver?.MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT,
  ).toBe(3)
  expect(
    sectionSolver.sectionSolver?.EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST,
  ).toBe(2)
})

test("section solver cache rehydrates an equivalent translated, rotated, and same-bucket scaled section", () => {
  clearTinyHyperGraphSectionSolverCache()

  const original = loadSerializedHyperGraph(sectionSolverFixtureGraph)
  original.problem.portSectionMask = createSectionSolverFixturePortMask(
    original.topology,
  )

  const originalSolver = new TinyHyperGraphSectionSolver(
    original.topology,
    original.problem,
    original.solution,
  )
  originalSolver.solve()

  expect(originalSolver.solved).toBe(true)
  expect(originalSolver.stats.cacheHit).toBe(false)

  const prefix = "cache-"
  const transformedGraph = createTransformedSectionSolverFixtureGraph({
    prefix,
    scale: 1.2,
    rotationQuarterTurns: 1,
    translateX: 40,
    translateY: -18,
  })
  const transformed = loadSerializedHyperGraph(transformedGraph)
  transformed.problem.portSectionMask = createPrefixedSectionSolverFixturePortMask(
    transformed.topology,
    prefix,
  )

  const transformedSolver = new TinyHyperGraphSectionSolver(
    transformed.topology,
    transformed.problem,
    transformed.solution,
  )
  transformedSolver.solve()

  expect(transformedSolver.solved).toBe(true)
  expect(transformedSolver.failed).toBe(false)
  expect(transformedSolver.stats.cacheHit).toBe(true)
  expect(transformedSolver.stats.cacheStatus).toBe("hit")
  expect(getMaxRegionCost(transformedSolver.getSolvedSolver())).toBeLessThan(
    getMaxRegionCost(transformedSolver.baselineSolver),
  )

  const transformedRoutePortIds = getSolvedRoutePortIds(transformedSolver.getOutput())
  expect(transformedRoutePortIds[`${prefix}route-0`]?.slice(0, 2)).toEqual([
    `${prefix}s0`,
    `${prefix}a0`,
  ])
  expect(transformedRoutePortIds[`${prefix}route-0`]?.slice(-2)).toEqual([
    `${prefix}d0`,
    `${prefix}t0`,
  ])
  expect(transformedRoutePortIds[`${prefix}route-1`]?.slice(0, 2)).toEqual([
    `${prefix}s1`,
    `${prefix}a1`,
  ])
  expect(transformedRoutePortIds[`${prefix}route-1`]?.slice(-2)).toEqual([
    `${prefix}d1`,
    `${prefix}t1`,
  ])

  expect(getTinyHyperGraphSectionSolverCacheStats()).toMatchObject({
    entries: 1,
    lookups: 2,
    hits: 1,
    misses: 1,
    rejectedHits: 0,
    stores: 1,
  })
})

test("section pipeline visualize renders the input graph at iteration zero", () => {
  const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: sectionSolverFixtureGraph,
  })

  const graphics = pipelineSolver.visualize()

  expect((graphics.rects ?? []).length + (graphics.polygons ?? []).length).toBe(
    sectionSolverFixtureGraph.regions.length,
  )
  expect((graphics.circles ?? []).length).toBeGreaterThan(0)
  expect(graphics.title).toContain("iter=0")
})

test("section pipeline searches multiple masks and commits an improving output on hg07 sample029", () => {
  const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: datasetHg07.sample029,
  })

  pipelineSolver.solve()

  expect(pipelineSolver.solved).toBe(true)
  expect(pipelineSolver.failed).toBe(false)
  expect(pipelineSolver.stats.sectionSearchCandidateCount).toBeGreaterThan(1)
  expect(pipelineSolver.selectedSectionCandidateLabel).toBeDefined()
  expect(
    [...(pipelineSolver.selectedSectionMask ?? [])].some((value) => value === 1),
  ).toBe(true)

  const solveGraphOutput =
    pipelineSolver.getStageOutput<ReturnType<TinyHyperGraphSectionSolver["getOutput"]>>(
      "solveGraph",
    )
  const optimizeSectionOutput =
    pipelineSolver.getStageOutput<ReturnType<TinyHyperGraphSectionSolver["getOutput"]>>(
      "optimizeSection",
    )

  expect(solveGraphOutput).toBeDefined()
  expect(optimizeSectionOutput).toBeDefined()
  expect(
    getSerializedOutputMaxRegionCost(optimizeSectionOutput!),
  ).toBeLessThan(getSerializedOutputMaxRegionCost(solveGraphOutput!))
})
