import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { DuplicateCongestedPortSolver, TinyHyperGraphSolver } from "lib/index"

const createRegion = (
  regionId: string,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  pointIds: string[],
): SerializedHyperGraph["regions"][number] => ({
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
): SerializedHyperGraph["ports"][number] => ({
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

test("duplicate congested port solver can preserve legacy port-use estimation", () => {
  const graph = createDuplicatePortFixture()
  const sharedChoke = graph.ports.find(
    (port) => port.portId === "shared-choke",
  )!
  sharedChoke.d = {
    ...sharedChoke.d,
    tinyHypergraphPortPenalty: 1_000,
  }

  const penaltyAwareSolver = new DuplicateCongestedPortSolver(graph)
  penaltyAwareSolver.solve()
  const compatibilitySolver = new DuplicateCongestedPortSolver(graph, {
    useSerializedPortPenalties: false,
  })
  compatibilitySolver.solve()

  expect(penaltyAwareSolver.report.portUseCounts["shared-neighbor"]).toBe(2)
  expect(compatibilitySolver.report.portUseCounts["shared-choke"]).toBe(2)
})

test("isolated boundary duplicates keep their positions when incident regions are swapped", () => {
  const graph = createDuplicatePortFixture()
  graph.ports = graph.ports.filter((port) => port.portId !== "shared-neighbor")
  for (const region of graph.regions) {
    region.pointIds = region.pointIds.filter(
      (portId) => portId !== "shared-neighbor",
    )
    if (region.regionId === "left" || region.regionId === "right") {
      region.d = { ...region.d, width: 2 }
    }
  }
  const reversedGraph = structuredClone(graph)
  const reversedPort = reversedGraph.ports.find(
    (port) => port.portId === "shared-choke",
  )!
  const originalRegion1Id = reversedPort.region1Id
  reversedPort.region1Id = reversedPort.region2Id
  reversedPort.region2Id = originalRegion1Id

  const duplicatePositions = [graph, reversedGraph].map((inputGraph) => {
    const solver = new DuplicateCongestedPortSolver(inputGraph)
    solver.solve()
    expect(solver.solved).toBe(true)
    const duplicatePort = solver
      .getOutput()
      .ports.find((port) => port.portId === "shared-choke::dup1")!
    expect(duplicatePort).toBeDefined()
    return { x: duplicatePort.d?.x, y: duplicatePort.d?.y }
  })

  expect(duplicatePositions[0]).toEqual(duplicatePositions[1])
})

test.each([
  ["vertical", 0],
  ["horizontal", 0],
  ["vertical", 0.01],
  ["horizontal", 0.01],
] as const)(
  "isolated duplicates stay on a short %s shared edge from tangent position %f",
  (boundaryOrientation, sourceCoordinate) => {
    const graph = createDuplicatePortFixture()
    graph.ports = graph.ports.filter(
      (port) => port.portId !== "shared-neighbor",
    )
    for (const region of graph.regions) {
      region.pointIds = region.pointIds.filter(
        (portId) => portId !== "shared-neighbor",
      )
    }
    graph.regions.push(
      createRegion("c-start", -4, 0.2, 2, 2, ["c-start-port"]),
      createRegion("c-end", 4, 0.2, 2, 2, ["c-end-port"]),
    )
    graph.ports.push(
      createPort("c-start-port", "c-start", "left", -3, 0.2),
      createPort("c-end-port", "right", "c-end", 3, 0.2),
    )
    graph.connections!.push({
      connectionId: "connection-c",
      startRegionId: "c-start",
      endRegionId: "c-end",
      mutuallyConnectedNetworkId: "net-c",
    })
    const leftRegion = graph.regions.find(
      (region) => region.regionId === "left",
    )!
    const rightRegion = graph.regions.find(
      (region) => region.regionId === "right",
    )!
    leftRegion.pointIds.push("c-start-port")
    rightRegion.pointIds.push("c-end-port")
    const normalAxis = boundaryOrientation === "vertical" ? "x" : "y"
    const tangentAxis = boundaryOrientation === "vertical" ? "y" : "x"
    const faceGap = 4e-7
    leftRegion.d = {
      center: { [normalAxis]: -1, [tangentAxis]: 0 },
      width: boundaryOrientation === "vertical" ? 2 : 0.02,
      height: boundaryOrientation === "vertical" ? 0.02 : 2,
    }
    rightRegion.d = {
      center: { [normalAxis]: 1 + faceGap, [tangentAxis]: 0.01 },
      width: boundaryOrientation === "vertical" ? 2 : 0.04,
      height: boundaryOrientation === "vertical" ? 0.04 : 2,
    }
    const sourcePort = graph.ports.find(
      (port) => port.portId === "shared-choke",
    )!
    sourcePort.d = {
      z: 0,
      [normalAxis]: faceGap / 2,
      [tangentAxis]: sourceCoordinate,
    }
    const solver = new DuplicateCongestedPortSolver(graph)
    solver.solve()
    expect(solver.solved).toBe(true)
    const duplicates = solver
      .getOutput()
      .ports.filter((port) => port.d?.duplicatedFromPortId === "shared-choke")
    expect(duplicates).toHaveLength(2)
    const tangentPositions = duplicates.map((port) =>
      getNumber(port.d?.[tangentAxis]),
    )
    expect(new Set(tangentPositions).size).toBe(2)
    for (const port of duplicates) {
      expect(port.d?.[normalAxis]).toBe(sourcePort.d[normalAxis])
      expect(getNumber(port.d?.[tangentAxis])).toBeGreaterThan(
        sourceCoordinate === 0 ? 0 : -0.01,
      )
      expect(getNumber(port.d?.[tangentAxis])).toBeLessThan(0.01)
    }
  },
)
