import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphBusSolver, TinyHyperGraphSolver } from "lib/index"
import {
  BUS_REGION_SPAN_ROUTE_COUNT,
  BUS_REGION_SPAN_SHARED_PORTS_PER_MIDDLE_EDGE,
  busRegionSpanFixture,
} from "tests/fixtures/bus-region-span.fixture"

const countSharedPorts = (regionAId: string, regionBId: string) =>
  busRegionSpanFixture.ports.filter(
    (port) =>
      (port.region1Id === regionAId && port.region2Id === regionBId) ||
      (port.region1Id === regionBId && port.region2Id === regionAId),
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

test("repro: six-trace slit middle requires spanning both middle regions", () => {
  const { topology, problem } = loadSerializedHyperGraph(busRegionSpanFixture)
  const plainSolver = new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 50_000,
  })

  expect(problem.routeCount).toBe(BUS_REGION_SPAN_ROUTE_COUNT)
  expect(countSharedPorts("top-main", "mid-left")).toBe(
    BUS_REGION_SPAN_SHARED_PORTS_PER_MIDDLE_EDGE,
  )
  expect(countSharedPorts("top-main", "mid-right")).toBe(
    BUS_REGION_SPAN_SHARED_PORTS_PER_MIDDLE_EDGE,
  )
  expect(countSharedPorts("mid-left", "bottom-main")).toBe(
    BUS_REGION_SPAN_SHARED_PORTS_PER_MIDDLE_EDGE,
  )
  expect(countSharedPorts("mid-right", "bottom-main")).toBe(
    BUS_REGION_SPAN_SHARED_PORTS_PER_MIDDLE_EDGE,
  )
  expect(problem.routeCount).toBeGreaterThan(
    countSharedPorts("top-main", "mid-left"),
  )
  expect(problem.routeCount).toBeGreaterThan(
    countSharedPorts("top-main", "mid-right"),
  )

  plainSolver.solve()

  expect(plainSolver.solved).toBe(true)
  expect(plainSolver.failed).toBe(false)

  const solvedRoutes = plainSolver.getOutput().solvedRoutes ?? []
  const routesUsingMidLeft = solvedRoutes.filter((route) =>
    route.path.some((node) => node.nextRegionId === "mid-left"),
  )
  const routesUsingMidRight = solvedRoutes.filter((route) =>
    route.path.some((node) => node.nextRegionId === "mid-right"),
  )

  expect(solvedRoutes).toHaveLength(BUS_REGION_SPAN_ROUTE_COUNT)
  expect(routesUsingMidLeft.length).toBeGreaterThan(0)
  expect(routesUsingMidRight.length).toBeGreaterThan(0)
})

test("repro: current bus solver fails on the split-middle span fixture", () => {
  const { topology, problem } = loadSerializedHyperGraph(busRegionSpanFixture)
  const busSolver = new TinyHyperGraphBusSolver(topology, problem, {
    MAX_ITERATIONS: 50_000,
  })
  const regionIndexBySerializedId = getRegionIndexBySerializedId(topology)

  const midLeftRegionIndex = regionIndexBySerializedId.get("mid-left")
  const midRightRegionIndex = regionIndexBySerializedId.get("mid-right")

  expect(midLeftRegionIndex).toBeDefined()
  expect(midRightRegionIndex).toBeDefined()
  expect(
    busSolver.centerGoalHopDistanceByRegion[midLeftRegionIndex!],
  ).toBeGreaterThan(2)
  expect(
    busSolver.centerGoalHopDistanceByRegion[midRightRegionIndex!],
  ).toBeGreaterThan(2)

  busSolver.solve()

  expect(busSolver.solved).toBe(false)
  expect(busSolver.failed).toBe(true)
  expect(busSolver.error).toBeTruthy()
})
