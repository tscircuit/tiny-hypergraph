import { expect, test } from "bun:test"
import type {
  SerializedGraphPort,
  SerializedGraphRegion,
  SerializedHyperGraph,
} from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { DuplicateCongestedPortSolver, TinyHyperGraphSolver } from "lib/index"

const createRegion = (
  regionId: string,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  pointIds: string[],
): SerializedGraphRegion => ({
  regionId,
  pointIds,
  d: {
    center: { x: centerX, y: centerY },
    width,
    height,
  },
})

const createPort = (
  portId: string,
  region1Id: string,
  region2Id: string,
  x: number,
  y: number,
): SerializedGraphPort => ({
  portId,
  region1Id,
  region2Id,
  d: { x, y, z: 0 },
})

const getNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0

const getPortIndexBySerializedId = (
  topology: ReturnType<typeof loadSerializedHyperGraph>["topology"],
  serializedPortId: string,
) =>
  topology.portMetadata?.findIndex(
    (metadata) =>
      typeof metadata === "object" &&
      metadata !== null &&
      "serializedPortId" in metadata &&
      metadata.serializedPortId === serializedPortId,
  ) ?? -1

const createParallelPortFixture = (): SerializedHyperGraph => ({
  regions: [
    createRegion("start", -4, 0, 2, 2, ["start-port"]),
    createRegion("left", -1, 0, 4, 6, ["start-port", "middle-a", "middle-b"]),
    createRegion("right", 1, 0, 4, 6, ["middle-a", "middle-b", "end-port"]),
    createRegion("end", 4, 0, 2, 2, ["end-port"]),
  ],
  ports: [
    createPort("start-port", "start", "left", -3, 0),
    createPort("middle-a", "left", "right", 0, 0),
    createPort("middle-b", "left", "right", 0, 2),
    createPort("end-port", "right", "end", 3, 0),
  ],
  connections: [
    {
      connectionId: "connection-a",
      startRegionId: "start",
      endRegionId: "end",
      mutuallyConnectedNetworkId: "net-a",
    },
  ],
})

const createDuplicatePortFixture = (): SerializedHyperGraph => ({
  regions: [
    createRegion("a-start", -4, 0, 2, 2, ["a-start-port"]),
    createRegion("b-start", -4, -0.2, 2, 2, ["b-start-port"]),
    createRegion("left", -1, 0, 4, 10, [
      "a-start-port",
      "b-start-port",
      "shared-choke",
      "shared-neighbor",
    ]),
    createRegion("right", 1, 0, 4, 10, [
      "shared-choke",
      "shared-neighbor",
      "a-end-port",
      "b-end-port",
    ]),
    createRegion("a-end", 4, 0, 2, 2, ["a-end-port"]),
    createRegion("b-end", 4, -0.2, 2, 2, ["b-end-port"]),
  ],
  ports: [
    createPort("a-start-port", "a-start", "left", -3, 0),
    createPort("b-start-port", "b-start", "left", -3, -0.2),
    createPort("shared-choke", "left", "right", 0, 0),
    createPort("shared-neighbor", "left", "right", 0, 4),
    createPort("a-end-port", "right", "a-end", 3, 0),
    createPort("b-end-port", "right", "b-end", 3, -0.2),
  ],
  connections: [
    {
      connectionId: "connection-a",
      startRegionId: "a-start",
      endRegionId: "a-end",
      mutuallyConnectedNetworkId: "net-a",
    },
    {
      connectionId: "connection-b",
      startRegionId: "b-start",
      endRegionId: "b-end",
      mutuallyConnectedNetworkId: "net-b",
    },
  ],
})

test("core solver applies port penalties when choosing an intermediate port", () => {
  const { topology, problem } = loadSerializedHyperGraph(
    createParallelPortFixture(),
  )
  const penalizedPortIndex = getPortIndexBySerializedId(topology, "middle-a")
  expect(penalizedPortIndex).toBeGreaterThanOrEqual(0)

  problem.portPenalty = new Float64Array(topology.portCount)
  problem.portPenalty[penalizedPortIndex] = 1_000

  const solver = new TinyHyperGraphSolver(topology, problem, {
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
    STATIC_REACHABILITY_PRECHECK: false,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    solver.getOutput().solvedRoutes?.[0]?.path.map(({ portId }) => portId),
  ).toEqual(["start-port", "middle-b", "end-port"])
})

test("duplicate congested port solver duplicates independently reused ports in line with the boundary", () => {
  const duplicatePortProximity = 0.2
  const solver = new DuplicateCongestedPortSolver(
    createDuplicatePortFixture(),
    {
      duplicatePortProximity,
    },
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.report.portUseCounts["shared-choke"]).toBe(2)
  expect(solver.report.duplicatedPorts).toContainEqual({
    sourcePortId: "shared-choke",
    duplicatePortIds: ["shared-choke::dup1"],
    useCount: 2,
  })

  const output = solver.getOutput()
  const sourcePort = output.ports.find(
    (port) => port.portId === "shared-choke",
  )!
  const nearestPort = output.ports.find(
    (port) => port.portId === "shared-neighbor",
  )!
  const duplicatePort = output.ports.find(
    (port) => port.portId === "shared-choke::dup1",
  )!

  const sourcePoint = {
    x: getNumber(sourcePort.d?.x),
    y: getNumber(sourcePort.d?.y),
  }
  const nearestVector = {
    x: getNumber(nearestPort.d?.x) - sourcePoint.x,
    y: getNumber(nearestPort.d?.y) - sourcePoint.y,
  }
  const duplicateVector = {
    x: getNumber(duplicatePort.d?.x) - sourcePoint.x,
    y: getNumber(duplicatePort.d?.y) - sourcePoint.y,
  }
  const duplicateDistance = Math.hypot(duplicateVector.x, duplicateVector.y)
  const crossProduct =
    nearestVector.x * duplicateVector.y - nearestVector.y * duplicateVector.x

  expect(duplicatePort.d?.duplicatedFromPortId).toBe("shared-choke")
  expect(duplicatePort.d?.duplicateIndex).toBe(1)
  expect(duplicateDistance).toBeGreaterThan(0)
  expect(duplicateDistance).toBeLessThanOrEqual(duplicatePortProximity)
  expect(Math.abs(crossProduct)).toBeLessThan(1e-9)
  expect(output.solvedRoutes).toBeUndefined()
  expect(
    output.regions
      .filter(
        (region) => region.regionId === "left" || region.regionId === "right",
      )
      .every((region) => region.pointIds.includes("shared-choke::dup1")),
  ).toBe(true)
})

test("duplicate congested port solver exposes queued route solving progress", () => {
  const solver = new DuplicateCongestedPortSolver(
    createDuplicatePortFixture(),
    {
      duplicatePortProximity: 0.2,
    },
  )

  solver.step()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(false)
  expect(solver.activeSubSolver).not.toBeNull()
  expect(solver.stats.duplicateCongestedPortRouteCount).toBe(2)
  expect(solver.stats.duplicateCongestedPortRoutesSolved).toBe(0)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.activeSubSolver).toBeNull()
  expect(solver.stats.duplicateCongestedPortRoutesSolved).toBe(2)
  expect(solver.report.duplicatedPorts).toContainEqual({
    sourcePortId: "shared-choke",
    duplicatePortIds: ["shared-choke::dup1"],
    useCount: 2,
  })
})

test("duplicate congested port solver reports setup errors", () => {
  const solver = new DuplicateCongestedPortSolver({
    regions: [createRegion("start", 0, 0, 2, 2, ["missing-port"])],
    ports: [createPort("missing-port", "start", "missing-end-region", 1, 0)],
    connections: [
      {
        connectionId: "connection-a",
        startRegionId: "start",
        endRegionId: "missing-end-region",
        mutuallyConnectedNetworkId: "net-a",
      },
    ],
  })

  solver.step()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toBeString()
  expect(solver.error).toContain("missing-end-region")
})
