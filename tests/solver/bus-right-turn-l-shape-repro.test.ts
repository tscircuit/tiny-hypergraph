import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphBusSolver, TinyHyperGraphSolver } from "lib/index"
import {
  BUS_RIGHT_TURN_L_SHAPE_BRIDGE_REGION_COUNT,
  BUS_RIGHT_TURN_L_SHAPE_ROUTE_COUNT,
  BUS_RIGHT_TURN_L_SHAPE_SHARED_PORTS_PER_SPLIT_EDGE,
  BUS_RIGHT_TURN_L_SHAPE_SPLIT_STAGE_COUNT,
  busRightTurnLShapeFixture,
} from "tests/fixtures/bus-right-turn-l-shape.fixture"

const countSharedPorts = (regionAId: string, regionBId: string) =>
  busRightTurnLShapeFixture.ports.filter(
    (port) =>
      (port.region1Id === regionAId && port.region2Id === regionBId) ||
      (port.region1Id === regionBId && port.region2Id === regionAId),
  ).length

const countRoutesUsingRegion = (
  solvedRoutes: NonNullable<ReturnType<TinyHyperGraphSolver["getOutput"]>["solvedRoutes"]>,
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

test("repro: region-19 turns right into an L-shaped top-bottom split", () => {
  const { topology, problem } = loadSerializedHyperGraph(
    busRightTurnLShapeFixture,
  )
  const plainSolver = new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 100_000,
  })
  const regionIndexBySerializedId = getRegionIndexBySerializedId(topology)

  expect(problem.routeCount).toBe(BUS_RIGHT_TURN_L_SHAPE_ROUTE_COUNT)
  expect(BUS_RIGHT_TURN_L_SHAPE_SPLIT_STAGE_COUNT).toBe(3)
  expect(BUS_RIGHT_TURN_L_SHAPE_BRIDGE_REGION_COUNT).toBe(3)
  expect(regionIndexBySerializedId.get("bridge-final")).toBe(19)
  expect(countSharedPorts("top-main", "split-a-left")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(countSharedPorts("top-main", "split-a-right")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(countSharedPorts("bridge-lower", "split-b-left")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(countSharedPorts("bridge-lower", "split-b-right")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(countSharedPorts("bridge-final", "split-c-top")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(countSharedPorts("bridge-final", "split-c-bottom")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(countSharedPorts("split-c-top", "right-main")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(countSharedPorts("split-c-bottom", "right-main")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_SHARED_PORTS_PER_SPLIT_EDGE,
  )
  expect(problem.routeCount).toBeGreaterThan(
    countSharedPorts("bridge-final", "split-c-top"),
  )

  plainSolver.solve()

  expect(plainSolver.solved).toBe(true)
  expect(plainSolver.failed).toBe(false)

  const solvedRoutes = plainSolver.getOutput().solvedRoutes ?? []

  expect(solvedRoutes).toHaveLength(BUS_RIGHT_TURN_L_SHAPE_ROUTE_COUNT)
  expect(countRoutesUsingRegion(solvedRoutes, "bridge-final")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_ROUTE_COUNT,
  )
  expect(countRoutesUsingRegion(solvedRoutes, "split-a-left")).toBeGreaterThan(0)
  expect(countRoutesUsingRegion(solvedRoutes, "split-a-right")).toBeGreaterThan(0)
  expect(countRoutesUsingRegion(solvedRoutes, "split-b-left")).toBeGreaterThan(0)
  expect(countRoutesUsingRegion(solvedRoutes, "split-b-right")).toBeGreaterThan(0)
  expect(countRoutesUsingRegion(solvedRoutes, "split-c-top")).toBeGreaterThan(0)
  expect(countRoutesUsingRegion(solvedRoutes, "split-c-bottom")).toBeGreaterThan(0)
  expect(countRoutesUsingRegion(solvedRoutes, "right-main")).toBe(
    BUS_RIGHT_TURN_L_SHAPE_ROUTE_COUNT,
  )
})

test("repro: bus solver currently fails the region-19 right turn and L-shaped split", () => {
  const { topology, problem } = loadSerializedHyperGraph(
    busRightTurnLShapeFixture,
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
  const splitCTopRegionIndex = regionIndexBySerializedId.get("split-c-top")
  const splitCBottomRegionIndex = regionIndexBySerializedId.get("split-c-bottom")

  expect(splitALeftRegionIndex).toBeDefined()
  expect(splitARightRegionIndex).toBeDefined()
  expect(splitBLeftRegionIndex).toBeDefined()
  expect(splitBRightRegionIndex).toBeDefined()
  expect(splitCTopRegionIndex).toBeDefined()
  expect(splitCBottomRegionIndex).toBeDefined()
  expect(regionIndexBySerializedId.get("bridge-final")).toBe(19)
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
    busSolver.centerGoalHopDistanceByRegion[splitCTopRegionIndex!],
  ).toBeGreaterThan(2)
  expect(
    busSolver.centerGoalHopDistanceByRegion[splitCBottomRegionIndex!],
  ).toBeGreaterThan(2)

  busSolver.solve()
  plainSolver.solve()

  expect(plainSolver.solved).toBe(true)
  expect(plainSolver.failed).toBe(false)
  expect(busSolver.solved).toBe(false)
  expect(busSolver.failed).toBe(true)
  expect(busSolver.error).toBe(
    "Failed to infer a complete bus preview from the centerline",
  )
})
