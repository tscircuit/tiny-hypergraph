import "bun-match-svg"
import {
  computeConvexRegions,
  type ConvexRegionsComputeInput,
  type Point,
} from "@tscircuit/find-convex-regions"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import * as datasetHg07 from "dataset-hg07"
import {
  getSvgFromGraphicsObject,
  stackGraphicsVertically,
} from "graphics-debug"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  PolyHyperGraphSolver,
  TinyHyperGraphSolver,
  loadSerializedHyperGraphAsPoly,
} from "lib/index"
import { sameNetSharedBottleneckFixture } from "tests/fixtures/same-net-shared-bottleneck.fixture"

const getMaxRegionCost = (
  solver: TinyHyperGraphSolver | PolyHyperGraphSolver,
) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

const obstacleConvexRegionInput: ConvexRegionsComputeInput = {
  bounds: { minX: 0, maxX: 12, minY: 0, maxY: 8 },
  rects: [
    {
      center: { x: 4, y: 4 },
      width: 1.2,
      height: 4.6,
      ccwRotation: 0.25,
    },
    {
      center: { x: 8, y: 4 },
      width: 1.2,
      height: 4.6,
      ccwRotation: -0.3,
    },
  ],
  polygons: [
    {
      points: [
        { x: 5.7, y: 1.2 },
        { x: 6.8, y: 1.8 },
        { x: 6.3, y: 2.9 },
        { x: 5.2, y: 2.4 },
      ],
    },
    {
      points: [
        { x: 5.3, y: 5.1 },
        { x: 6.5, y: 4.8 },
        { x: 7.2, y: 5.9 },
        { x: 6.2, y: 6.8 },
        { x: 5.1, y: 6.2 },
      ],
    },
  ],
  vias: [
    { center: { x: 2.2, y: 2.1 }, diameter: 0.6 },
    { center: { x: 9.8, y: 5.9 }, diameter: 0.7 },
  ],
  clearance: 0.25,
  concavityTolerance: 0,
  usePolyanyaMerge: true,
  viaSegments: 8,
}

const roundPointCoord = (value: number) => Math.round(value * 1e5) / 1e5

const pointKey = (point: Point) =>
  `${roundPointCoord(point.x)},${roundPointCoord(point.y)}`

const segmentKey = (a: Point, b: Point) => {
  const aKey = pointKey(a)
  const bKey = pointKey(b)
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`
}

const getCentroid = (polygon: Point[]): Point =>
  polygon.reduce(
    (sum, point) => ({
      x: sum.x + point.x / polygon.length,
      y: sum.y + point.y / polygon.length,
    }),
    { x: 0, y: 0 },
  )

const createPinPolygon = (center: Point): Point[] => [
  { x: center.x - 0.08, y: center.y - 0.08 },
  { x: center.x + 0.08, y: center.y - 0.08 },
  { x: center.x, y: center.y + 0.08 },
]

const createObstacleConvexRegionHyperGraph = (): {
  serializedHyperGraph: SerializedHyperGraph
  freeRegionCount: number
  sharedPortCount: number
  routeRegionPairs: Array<[number, number]>
} => {
  const convexRegions = computeConvexRegions(obstacleConvexRegionInput)
  const regions: SerializedHyperGraph["regions"] = convexRegions.regions.map(
    (points, regionIndex) => ({
      regionId: `free-${regionIndex}`,
      pointIds: [],
      d: { polygon: points },
    }),
  )
  const ports: SerializedHyperGraph["ports"] = []
  const edgeEntries = new Map<
    string,
    Array<{ regionIndex: number; a: Point; b: Point }>
  >()

  for (
    let regionIndex = 0;
    regionIndex < convexRegions.regions.length;
    regionIndex++
  ) {
    const polygon = convexRegions.regions[regionIndex]!
    for (let pointIndex = 0; pointIndex < polygon.length; pointIndex++) {
      const a = polygon[pointIndex]!
      const b = polygon[(pointIndex + 1) % polygon.length]!
      const key = segmentKey(a, b)
      const entries = edgeEntries.get(key) ?? []
      entries.push({ regionIndex, a, b })
      edgeEntries.set(key, entries)
    }
  }

  let portIndex = 0
  for (const entries of edgeEntries.values()) {
    if (entries.length !== 2) continue

    const [first, second] = entries
    const portId = `shared-port-${String(portIndex).padStart(3, "0")}`
    const x = (first!.a.x + first!.b.x) / 2
    const y = (first!.a.y + first!.b.y) / 2

    ports.push({
      portId,
      region1Id: `free-${first!.regionIndex}`,
      region2Id: `free-${second!.regionIndex}`,
      d: { x, y, z: 0 },
    })
    regions[first!.regionIndex]!.pointIds.push(portId)
    regions[second!.regionIndex]!.pointIds.push(portId)
    portIndex += 1
  }

  const centroids = convexRegions.regions.map(getCentroid)
  const routeRegionPairs: Array<[number, number]> = [
    [4, 15],
    [0, 9],
  ]
  const connections: NonNullable<SerializedHyperGraph["connections"]> = []

  routeRegionPairs.forEach(([startRegionIndex, endRegionIndex], routeIndex) => {
    const startRegionId = `pin-${routeIndex}-start`
    const endRegionId = `pin-${routeIndex}-end`
    const startPortId = `pin-port-${routeIndex}-start`
    const endPortId = `pin-port-${routeIndex}-end`
    const startPoint = centroids[startRegionIndex]!
    const endPoint = centroids[endRegionIndex]!

    regions.push({
      regionId: startRegionId,
      pointIds: [startPortId],
      d: {
        polygon: createPinPolygon(startPoint),
        isConnectionRegion: true,
      },
    })
    regions.push({
      regionId: endRegionId,
      pointIds: [endPortId],
      d: {
        polygon: createPinPolygon(endPoint),
        isConnectionRegion: true,
      },
    })
    regions[startRegionIndex]!.pointIds.push(startPortId)
    regions[endRegionIndex]!.pointIds.push(endPortId)
    ports.push({
      portId: startPortId,
      region1Id: startRegionId,
      region2Id: `free-${startRegionIndex}`,
      d: { x: startPoint.x, y: startPoint.y, z: 0 },
    })
    ports.push({
      portId: endPortId,
      region1Id: `free-${endRegionIndex}`,
      region2Id: endRegionId,
      d: { x: endPoint.x, y: endPoint.y, z: 0 },
    })
    connections.push({
      connectionId: `obstacle-route-${routeIndex}`,
      startRegionId,
      endRegionId,
      mutuallyConnectedNetworkId: `obstacle-net-${routeIndex}`,
    })
  })

  return {
    serializedHyperGraph: { regions, ports, connections },
    freeRegionCount: convexRegions.regions.length,
    sharedPortCount: portIndex,
    routeRegionPairs,
  }
}

test("loadSerializedHyperGraphAsPoly converts serialized rect regions to polygon topology", () => {
  const { topology, mapping } = loadSerializedHyperGraphAsPoly(
    datasetHg07.sample002 as SerializedHyperGraph,
  )

  expect(topology.regionVertexStart.length).toBe(topology.regionCount)
  expect(topology.regionVertexCount.length).toBe(topology.regionCount)
  expect(topology.regionArea[0]).toBeGreaterThan(0)
  expect(topology.regionPerimeter[0]).toBeGreaterThan(0)
  expect(topology.portBoundaryPositionForRegion1.length).toBe(
    topology.portCount,
  )
  expect(mapping.serializedRegionIdToRegionId.size).toBe(topology.regionCount)
})

test("poly solver roughly matches core solver max region cost on sample002", () => {
  const coreLoaded = loadSerializedHyperGraph(
    datasetHg07.sample002 as SerializedHyperGraph,
  )
  const polyLoaded = loadSerializedHyperGraphAsPoly(
    datasetHg07.sample002 as SerializedHyperGraph,
  )
  const coreSolver = new TinyHyperGraphSolver(
    coreLoaded.topology,
    coreLoaded.problem,
  )
  const polySolver = new PolyHyperGraphSolver(
    polyLoaded.topology,
    polyLoaded.problem,
  )

  coreSolver.solve()
  polySolver.solve()

  expect(coreSolver.solved).toBe(true)
  expect(polySolver.solved).toBe(true)
  expect(polySolver.failed).toBe(false)
  expect(
    Math.abs(getMaxRegionCost(polySolver) - getMaxRegionCost(coreSolver)),
  ).toBeLessThanOrEqual(0.05)
})

test("poly solver handles same-net shared bottleneck fixture", () => {
  const { topology, problem } = loadSerializedHyperGraphAsPoly(
    sameNetSharedBottleneckFixture,
  )
  const solver = new PolyHyperGraphSolver(topology, problem)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
})

test("poly solver routes obstacle-generated convex regions and renders polygon SVG", () => {
  const {
    serializedHyperGraph,
    freeRegionCount,
    sharedPortCount,
    routeRegionPairs,
  } = createObstacleConvexRegionHyperGraph()
  const { topology, problem, mapping } =
    loadSerializedHyperGraphAsPoly(serializedHyperGraph)
  const solver = new PolyHyperGraphSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK_MAX_HOPS: 64,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 3,
  })
  const beforeSolveGraphics = solver.visualize()

  solver.solve()
  const afterSolveGraphics = solver.visualize()
  const route0StartRegionId = mapping.serializedRegionIdToRegionId.get(
    `free-${routeRegionPairs[0]![0]}`,
  )

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(freeRegionCount).toBeGreaterThanOrEqual(20)
  expect(sharedPortCount).toBeGreaterThanOrEqual(25)
  expect((afterSolveGraphics.polygons ?? []).length).toBe(
    serializedHyperGraph.regions.length,
  )
  expect(typeof route0StartRegionId).toBe("number")
  expect(getMaxRegionCost(solver)).toBeGreaterThan(0)
  expect(solver.state.regionSegments.flat().length).toBeGreaterThanOrEqual(18)

  const stagedSvg = getSvgFromGraphicsObject(
    stackGraphicsVertically([beforeSolveGraphics, afterSolveGraphics], {
      titles: ["before solve", "after solve"],
    }),
  )
  expect(stagedSvg).toMatchSvgSnapshot(import.meta.path)
})
