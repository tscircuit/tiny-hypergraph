import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphBusSolver, TinyHyperGraphSolver } from "lib/index"
import {
  BUS_DOUBLE_SPLIT_LONG_SPAN_BRIDGE_REGION_COUNT,
  BUS_DOUBLE_SPLIT_LONG_SPAN_ROUTE_COUNT,
  BUS_DOUBLE_SPLIT_LONG_SPAN_SHARED_PORTS_PER_SPLIT_EDGE,
  BUS_DOUBLE_SPLIT_LONG_SPAN_SPLIT_STAGE_COUNT,
  busDoubleSplitLongSpanFixture,
} from "tests/fixtures/bus-double-split-long-span.fixture"

const countSharedPorts = (regionAId: string, regionBId: string) =>
  busDoubleSplitLongSpanFixture.ports.filter(
    (port) =>
      (port.region1Id === regionAId && port.region2Id === regionBId) ||
      (port.region1Id === regionBId && port.region2Id === regionAId),
  ).length

const countRoutesUsingRegion = (
  solvedRoutes: NonNullable<
    ReturnType<TinyHyperGraphSolver["getOutput"]>["solvedRoutes"]
  >,
  regionId: string,
) =>
  solvedRoutes.filter((route) =>
    route.path.some((node) => node.nextRegionId === regionId),
  ).length

const getRegionIndexBySerializedId = (
  topology: ReturnType<typeof loadSerializedHyperGraph>["topology"],
) => {
  const regionIndexBySerializedId = new Map<string, number>()

  topology.regionMetadata?.forEach((metadata, regionIndex) => {
    const serializedRegionId = (metadata as { serializedRegionId?: string })
      .serializedRegionId
    if (typeof serializedRegionId === "string") {
      regionIndexBySerializedId.set(serializedRegionId, regionIndex)
    }
  })

  return regionIndexBySerializedId
}

test("repro: six-trace triple split requires both split halves at all stages", () => {
  const { topology, problem } = loadSerializedHyperGraph(
    busDoubleSplitLongSpanFixture,
  )
  const plainSolver = new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 100_000,
  })

  expect(problem.routeCount).toBe(BUS_DOUBLE_SPLIT_LONG_SPAN_ROUTE_COUNT)
  expect(BUS_DOUBLE_SPLIT_LONG_SPAN_SPLIT_STAGE_COUNT).toBe(3)
  expect(BUS_DOUBLE_SPLIT_LONG_SPAN_BRIDGE_REGION_COUNT).toBe(3)
  expect(countSharedPorts("top-main", "split-a-left")).toBe(
    BUS_DOUBLE_SPLIT_LONG_SPAN_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(countSharedPorts("top-main", "split-a-right")).toBe(
    BUS_DOUBLE_SPLIT_LONG_SPAN_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(countSharedPorts("bridge-lower", "split-b-left")).toBe(
    BUS_DOUBLE_SPLIT_LONG_SPAN_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(countSharedPorts("bridge-lower", "split-b-right")).toBe(
    BUS_DOUBLE_SPLIT_LONG_SPAN_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(countSharedPorts("bridge-final", "split-c-left")).toBe(
    BUS_DOUBLE_SPLIT_LONG_SPAN_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(countSharedPorts("bridge-final", "split-c-right")).toBe(
    BUS_DOUBLE_SPLIT_LONG_SPAN_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(problem.routeCount).toBeGreaterThan(
    countSharedPorts("top-main", "split-a-left"),
  )
  expect(problem.routeCount).toBeGreaterThan(
    countSharedPorts("bridge-lower", "split-b-left"),
  )
  expect(problem.routeCount).toBeGreaterThan(
    countSharedPorts("bridge-final", "split-c-left"),
  )

  plainSolver.solve()

  expect(plainSolver.solved).toBe(true)
  expect(plainSolver.failed).toBe(false)

  const solvedRoutes = plainSolver.getOutput().solvedRoutes ?? []

  expect(solvedRoutes).toHaveLength(BUS_DOUBLE_SPLIT_LONG_SPAN_ROUTE_COUNT)
  expect(countRoutesUsingRegion(solvedRoutes, "split-a-left")).toBeGreaterThan(
    0,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "split-a-right")).toBeGreaterThan(
    0,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "bridge-upper")).toBe(
    BUS_DOUBLE_SPLIT_LONG_SPAN_ROUTE_COUNT,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "bridge-lower")).toBe(
    BUS_DOUBLE_SPLIT_LONG_SPAN_ROUTE_COUNT,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "split-b-left")).toBeGreaterThan(
    0,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "split-b-right")).toBeGreaterThan(
    0,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "bridge-final")).toBe(
    BUS_DOUBLE_SPLIT_LONG_SPAN_ROUTE_COUNT,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "split-c-left")).toBeGreaterThan(
    0,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "split-c-right")).toBeGreaterThan(
    0,
  )
})

test("repro: bus solver spans all three split stages across the long bridge", () => {
  const { topology, problem } = loadSerializedHyperGraph(
    busDoubleSplitLongSpanFixture,
  )
  const busSolver = new TinyHyperGraphBusSolver(topology, problem, {
    MAX_ITERATIONS: 100_000,
  })
  const plainSolver = new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 100_000,
  })
  const regionIndexBySerializedId = getRegionIndexBySerializedId(topology)

  const splitALeftRegionIndex = regionIndexBySerializedId.get("split-a-left")
  const splitARightRegionIndex = regionIndexBySerializedId.get("split-a-right")
  const splitBLeftRegionIndex = regionIndexBySerializedId.get("split-b-left")
  const splitBRightRegionIndex = regionIndexBySerializedId.get("split-b-right")
  const splitCLeftRegionIndex = regionIndexBySerializedId.get("split-c-left")
  const splitCRightRegionIndex = regionIndexBySerializedId.get("split-c-right")

  expect(splitALeftRegionIndex).toBeDefined()
  expect(splitARightRegionIndex).toBeDefined()
  expect(splitBLeftRegionIndex).toBeDefined()
  expect(splitBRightRegionIndex).toBeDefined()
  expect(splitCLeftRegionIndex).toBeDefined()
  expect(splitCRightRegionIndex).toBeDefined()
  expect(
    busSolver.centerGoalHopDistanceByRegion[splitALeftRegionIndex!],
  ).toBeGreaterThan(6)
  expect(
    busSolver.centerGoalHopDistanceByRegion[splitARightRegionIndex!],
  ).toBeGreaterThan(6)
  expect(
    busSolver.centerGoalHopDistanceByRegion[splitBLeftRegionIndex!],
  ).toBeGreaterThan(4)
  expect(
    busSolver.centerGoalHopDistanceByRegion[splitBRightRegionIndex!],
  ).toBeGreaterThan(4)
  expect(
    busSolver.centerGoalHopDistanceByRegion[splitCLeftRegionIndex!],
  ).toBeGreaterThan(2)
  expect(
    busSolver.centerGoalHopDistanceByRegion[splitCRightRegionIndex!],
  ).toBeGreaterThan(2)

  busSolver.solve()
  plainSolver.solve()

  expect(busSolver.solved).toBe(true)
  expect(busSolver.failed).toBe(false)

  const solvedRoutes = busSolver.getOutput().solvedRoutes ?? []
  const sameLayerIntersectionCount =
    busSolver.state.regionIntersectionCaches.reduce(
      (total, regionCache) =>
        total + regionCache.existingSameLayerIntersections,
      0,
    )
  const crossingLayerIntersectionCount =
    busSolver.state.regionIntersectionCaches.reduce(
      (total, regionCache) =>
        total + regionCache.existingCrossingLayerIntersections,
      0,
    )
  const plainSameLayerIntersectionCount =
    plainSolver.state.regionIntersectionCaches.reduce(
      (total, regionCache) =>
        total + regionCache.existingSameLayerIntersections,
      0,
    )
  const plainCrossingLayerIntersectionCount =
    plainSolver.state.regionIntersectionCaches.reduce(
      (total, regionCache) =>
        total + regionCache.existingCrossingLayerIntersections,
      0,
    )

  expect(solvedRoutes).toHaveLength(BUS_DOUBLE_SPLIT_LONG_SPAN_ROUTE_COUNT)
  expect(countRoutesUsingRegion(solvedRoutes, "split-a-left")).toBeGreaterThan(
    0,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "split-a-right")).toBeGreaterThan(
    0,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "bridge-upper")).toBe(
    BUS_DOUBLE_SPLIT_LONG_SPAN_ROUTE_COUNT,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "bridge-lower")).toBe(
    BUS_DOUBLE_SPLIT_LONG_SPAN_ROUTE_COUNT,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "split-b-left")).toBeGreaterThan(
    0,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "split-b-right")).toBeGreaterThan(
    0,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "bridge-final")).toBe(
    BUS_DOUBLE_SPLIT_LONG_SPAN_ROUTE_COUNT,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "split-c-left")).toBeGreaterThan(
    0,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "split-c-right")).toBeGreaterThan(
    0,
  )
  expect(sameLayerIntersectionCount).toBeLessThanOrEqual(
    plainSameLayerIntersectionCount,
  )
  expect(crossingLayerIntersectionCount).toBeLessThanOrEqual(
    plainCrossingLayerIntersectionCount,
  )
})
