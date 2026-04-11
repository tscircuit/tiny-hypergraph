import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import { type Candidate, TinyHyperGraphSolver } from "lib/index"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"

const crossingSwapFixture: SerializedHyperGraph = {
  regions: [
    {
      regionId: "start-0",
      pointIds: ["s0"],
      d: { center: { x: -4, y: 2 }, width: 1, height: 1 },
    },
    {
      regionId: "start-1",
      pointIds: ["s1"],
      d: { center: { x: -4, y: -2 }, width: 1, height: 1 },
    },
    {
      regionId: "left",
      pointIds: ["s0", "s1", "edge-top", "edge-bottom"],
      d: { center: { x: -1.5, y: 0 }, width: 3, height: 6 },
    },
    {
      regionId: "right",
      pointIds: ["edge-top", "edge-bottom", "e0", "e1"],
      d: { center: { x: 1.5, y: 0 }, width: 3, height: 6 },
    },
    {
      regionId: "end-0",
      pointIds: ["e0"],
      d: { center: { x: 4, y: 2 }, width: 1, height: 1 },
    },
    {
      regionId: "end-1",
      pointIds: ["e1"],
      d: { center: { x: 4, y: -2 }, width: 1, height: 1 },
    },
  ],
  ports: [
    {
      portId: "s0",
      region1Id: "start-0",
      region2Id: "left",
      d: { x: -3, y: 2, z: 0 },
    },
    {
      portId: "s1",
      region1Id: "start-1",
      region2Id: "left",
      d: { x: -3, y: -2, z: 0 },
    },
    {
      portId: "edge-top",
      region1Id: "left",
      region2Id: "right",
      d: { x: 0, y: 2, z: 0 },
    },
    {
      portId: "edge-bottom",
      region1Id: "left",
      region2Id: "right",
      d: { x: 0, y: -2, z: 0 },
    },
    {
      portId: "e0",
      region1Id: "right",
      region2Id: "end-0",
      d: { x: 3, y: 2, z: 0 },
    },
    {
      portId: "e1",
      region1Id: "right",
      region2Id: "end-1",
      d: { x: 3, y: -2, z: 0 },
    },
  ],
  connections: [
    {
      connectionId: "route-0",
      startRegionId: "start-0",
      endRegionId: "end-0",
      mutuallyConnectedNetworkId: "net-0",
    },
    {
      connectionId: "route-1",
      startRegionId: "start-1",
      endRegionId: "end-1",
      mutuallyConnectedNetworkId: "net-1",
    },
  ],
}

const createTwoSegmentCandidate = (
  startPortId: number,
  middlePortId: number,
  leftRegionId: number,
  rightRegionId: number,
): Candidate => ({
  nextRegionId: rightRegionId,
  portId: middlePortId,
  f: 0,
  g: 0,
  h: 0,
  prevCandidate: {
    nextRegionId: leftRegionId,
    portId: startPortId,
    f: 0,
    g: 0,
    h: 0,
  },
})

test("onPathFound swaps an earlier route's edge port when that untangles two regions", () => {
  const { topology, problem } = loadSerializedHyperGraph(crossingSwapFixture)
  const solver = new TinyHyperGraphSolver(topology, problem)
  const portIndexById = new Map<string, number>()
  const regionIndexById = new Map<string, number>()

  topology.portMetadata?.forEach((metadata, portId) => {
    if (typeof metadata?.serializedPortId === "string") {
      portIndexById.set(metadata.serializedPortId, portId)
    }
  })
  topology.regionMetadata?.forEach((metadata, regionId) => {
    if (typeof metadata?.serializedRegionId === "string") {
      regionIndexById.set(metadata.serializedRegionId, regionId)
    }
  })

  const leftRegionId = regionIndexById.get("left")
  const rightRegionId = regionIndexById.get("right")
  const s0 = portIndexById.get("s0")
  const s1 = portIndexById.get("s1")
  const edgeTop = portIndexById.get("edge-top")
  const edgeBottom = portIndexById.get("edge-bottom")
  const e0 = portIndexById.get("e0")
  const e1 = portIndexById.get("e1")

  if (
    leftRegionId === undefined ||
    rightRegionId === undefined ||
    s0 === undefined ||
    s1 === undefined ||
    edgeTop === undefined ||
    edgeBottom === undefined ||
    e0 === undefined ||
    e1 === undefined
  ) {
    throw new Error("Fixture ids did not map to topology indexes")
  }

  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = problem.routeNet[0]
  solver.state.goalPortId = problem.routeEndPort[0]
  solver.onPathFound(
    createTwoSegmentCandidate(s0, edgeBottom, leftRegionId, rightRegionId),
  )

  solver.state.currentRouteId = 1
  solver.state.currentRouteNetId = problem.routeNet[1]
  solver.state.goalPortId = problem.routeEndPort[1]
  solver.onPathFound(
    createTwoSegmentCandidate(s1, edgeTop, leftRegionId, rightRegionId),
  )

  expect(
    solver.state.regionIntersectionCaches[leftRegionId]?.existingRegionCost,
  ).toBe(0)
  expect(
    solver.state.regionIntersectionCaches[rightRegionId]?.existingRegionCost,
  ).toBe(0)

  expect(solver.state.regionSegments[leftRegionId]).toEqual(
    expect.arrayContaining([
      [0, s0, edgeTop],
      [1, s1, edgeBottom],
    ]),
  )
  expect(solver.state.regionSegments[rightRegionId]).toEqual(
    expect.arrayContaining([
      [0, edgeTop, e0],
      [1, edgeBottom, e1],
    ]),
  )
  expect(solver.state.portAssignment[edgeTop]).toBe(problem.routeNet[0])
  expect(solver.state.portAssignment[edgeBottom]).toBe(problem.routeNet[1])
  expect(solver.stats.untangleAcceptedSwapCount).toBe(1)
})
