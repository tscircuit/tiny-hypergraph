import "bun-match-svg"
import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  getSvgFromGraphicsObject,
  stackGraphicsVertically,
} from "graphics-debug"
import {
  FixedTopologyPortalLayerRefinementSolver,
  loadSerializedHyperGraph,
} from "lib/index"

const createRegion = (regionId: string, pointIds: string[]) => ({
  regionId,
  pointIds,
  d: {
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    availableZ: [0, 1],
  },
})

const graph = {
  regions: [
    createRegion("start", ["start-port"]),
    createRegion("r0", ["start-port", "g1-z0", "g1-z1"]),
    createRegion("r1", ["g1-z0", "g1-z1", "g2-z0", "g2-z1"]),
    createRegion("r2", ["g2-z0", "g2-z1", "end-port"]),
    createRegion("end", ["end-port"]),
  ],
  ports: [
    {
      portId: "start-port",
      region1Id: "start",
      region2Id: "r0",
      d: { x: -3, y: 0, z: 0 },
    },
    {
      portId: "g1-z0",
      region1Id: "r0",
      region2Id: "r1",
      d: { x: -1, y: 0, z: 0, physicalPortGroupId: "g1" },
    },
    {
      portId: "g1-z1",
      region1Id: "r0",
      region2Id: "r1",
      d: { x: -1, y: 0, z: 1, physicalPortGroupId: "g1" },
    },
    {
      portId: "g2-z0",
      region1Id: "r1",
      region2Id: "r2",
      d: { x: 1, y: 0, z: 0, physicalPortGroupId: "g2" },
    },
    {
      portId: "g2-z1",
      region1Id: "r1",
      region2Id: "r2",
      d: { x: 1, y: 0, z: 1, physicalPortGroupId: "g2" },
    },
    {
      portId: "end-port",
      region1Id: "r2",
      region2Id: "end",
      d: { x: 3, y: 0, z: 0 },
    },
  ],
  connections: [
    {
      connectionId: "route-a",
      startRegionId: "start",
      endRegionId: "end",
    },
  ],
  solvedRoutes: [
    {
      connection: {
        connectionId: "route-a",
        startRegionId: "start",
        endRegionId: "end",
      },
      requiredRip: false,
      path: [
        {
          portId: "start-port",
          nextRegionId: "r0",
          g: 0,
          h: 0,
          f: 0,
          hops: 0,
          ripRequired: false,
        },
        {
          portId: "g1-z0",
          lastRegionId: "r0",
          nextRegionId: "r1",
          g: 1,
          h: 0,
          f: 1,
          hops: 1,
          ripRequired: false,
        },
        {
          portId: "g2-z1",
          lastRegionId: "r1",
          nextRegionId: "r2",
          g: 2,
          h: 0,
          f: 2,
          hops: 2,
          ripRequired: false,
        },
        {
          portId: "end-port",
          lastRegionId: "r2",
          nextRegionId: "end",
          g: 3,
          h: 0,
          f: 3,
          hops: 3,
          ripRequired: false,
        },
      ],
    },
  ],
} as SerializedHyperGraph

test("refines portal layers while preserving the fixed region sequence", () => {
  const { topology, problem, solution } = loadSerializedHyperGraph(graph)
  expect(topology.physicalPortalGroupCount).toBe(2)
  expect(topology.portPhysicalGroupId?.[1]).toBe(
    topology.portPhysicalGroupId?.[2],
  )
  expect(topology.portPhysicalGroupId?.[3]).toBe(
    topology.portPhysicalGroupId?.[4],
  )
  const solver = new FixedTopologyPortalLayerRefinementSolver(
    topology,
    problem,
    solution,
  )
  const beforeRefinementGraphics = solver.visualize()

  solver.solve()

  const output = solver.getOutput()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.predictedViaDemandBefore).toBe(2)
  expect(solver.stats.predictedViaDemandAfter).toBe(0)
  expect(solver.stats.acceptedCandidateCount).toBe(1)
  expect(
    output.solvedRoutes?.[0]?.path.map((candidate) => candidate.nextRegionId),
  ).toEqual(["r0", "r1", "r2", "end"])
  expect(
    output.solvedRoutes?.[0]?.path.map((candidate) => candidate.portId),
  ).toEqual(["start-port", "g1-z0", "g2-z0", "end-port"])
  const stagedSvg = getSvgFromGraphicsObject(
    stackGraphicsVertically([beforeRefinementGraphics, solver.visualize()], {
      titles: ["before refinement", "after refinement"],
    }),
  )
  expect(stagedSvg).toMatchSvgSnapshot(import.meta.path)

  const repeatedLoad = loadSerializedHyperGraph(graph)
  const repeatedSolver = new FixedTopologyPortalLayerRefinementSolver(
    repeatedLoad.topology,
    repeatedLoad.problem,
    repeatedLoad.solution,
  )
  repeatedSolver.solve()
  expect(repeatedSolver.getOutput()).toEqual(output)

  const lockedLoad = loadSerializedHyperGraph(graph)
  lockedLoad.problem.portalLayerRefinementLockedRouteMask = Int8Array.from([1])
  const lockedSolver = new FixedTopologyPortalLayerRefinementSolver(
    lockedLoad.topology,
    lockedLoad.problem,
    lockedLoad.solution,
  )
  lockedSolver.solve()
  expect(lockedSolver.stats.acceptedCandidateCount).toBe(0)
  expect(lockedSolver.stats.rejectedForLockedAssignmentCount).toBe(1)
  expect(
    lockedSolver
      .getOutput()
      .solvedRoutes?.[0]?.path.map((candidate) => candidate.portId),
  ).toEqual(["start-port", "g1-z0", "g2-z1", "end-port"])

  const reservedAlternativeLoad = loadSerializedHyperGraph(graph)
  reservedAlternativeLoad.problem.routeCount = 2
  reservedAlternativeLoad.problem.routeStartPort = Int32Array.from([0, 3])
  reservedAlternativeLoad.problem.routeEndPort = Int32Array.from([5, 3])
  reservedAlternativeLoad.problem.routeNet = Int32Array.from([0, 1])
  reservedAlternativeLoad.problem.routeMetadata = [
    ...(reservedAlternativeLoad.problem.routeMetadata ?? []),
    { connectionId: "fixed-port-owner" },
  ]
  reservedAlternativeLoad.problem.portalLayerRefinementLockedRouteMask =
    Int8Array.from([0, 1])
  reservedAlternativeLoad.solution.solvedRoutePathSegments.push([])
  reservedAlternativeLoad.solution.solvedRoutePathRegionIds?.push([])
  const reservedAlternativeSolver =
    new FixedTopologyPortalLayerRefinementSolver(
      reservedAlternativeLoad.topology,
      reservedAlternativeLoad.problem,
      reservedAlternativeLoad.solution,
    )
  reservedAlternativeSolver.solve()
  expect(reservedAlternativeSolver.stats.acceptedCandidateCount).toBe(0)
  expect(
    reservedAlternativeSolver.stats.rejectedForNoViaDemandImprovementCount,
  ).toBeGreaterThan(0)
  expect(
    reservedAlternativeSolver.stats.rejectedForNoEntryExitImprovementCount,
  ).toBeGreaterThan(0)
  expect(reservedAlternativeSolver.routePlans[0]?.orderedPortIds).toEqual([
    0, 1, 4, 5,
  ])
})

test("replaces changed segments in place without reordering other routes", () => {
  const multiRouteGraph = structuredClone(graph) as SerializedHyperGraph
  multiRouteGraph.regions.push(
    createRegion("b-start", ["b-start-port"]),
    createRegion("b-end", ["b-end-port"]),
  )
  for (const [regionId, pointIds] of [
    ["r0", ["b-start-port", "b-g1"]],
    ["r1", ["b-g1", "b-g2"]],
    ["r2", ["b-g2", "b-end-port"]],
  ] as const) {
    multiRouteGraph.regions
      .find((region) => region.regionId === regionId)!
      .pointIds.push(...pointIds)
  }
  multiRouteGraph.ports.push(
    {
      portId: "b-start-port",
      region1Id: "b-start",
      region2Id: "r0",
      d: { x: -3, y: 4, z: 0 },
    },
    {
      portId: "b-g1",
      region1Id: "r0",
      region2Id: "r1",
      d: { x: -1, y: 4, z: 0 },
    },
    {
      portId: "b-g2",
      region1Id: "r1",
      region2Id: "r2",
      d: { x: 1, y: 4, z: 0 },
    },
    {
      portId: "b-end-port",
      region1Id: "r2",
      region2Id: "b-end",
      d: { x: 3, y: 4, z: 0 },
    },
  )
  multiRouteGraph.connections?.push({
    connectionId: "route-b",
    startRegionId: "b-start",
    endRegionId: "b-end",
  })
  multiRouteGraph.solvedRoutes?.push({
    connection: {
      connectionId: "route-b",
      startRegionId: "b-start",
      endRegionId: "b-end",
    },
    requiredRip: false,
    path: [
      {
        portId: "b-start-port",
        nextRegionId: "r0",
        g: 0,
        h: 0,
        f: 0,
        hops: 0,
        ripRequired: false,
      },
      {
        portId: "b-g1",
        lastRegionId: "r0",
        nextRegionId: "r1",
        g: 1,
        h: 0,
        f: 1,
        hops: 1,
        ripRequired: false,
      },
      {
        portId: "b-g2",
        lastRegionId: "r1",
        nextRegionId: "r2",
        g: 2,
        h: 0,
        f: 2,
        hops: 2,
        ripRequired: false,
      },
      {
        portId: "b-end-port",
        lastRegionId: "r2",
        nextRegionId: "b-end",
        g: 3,
        h: 0,
        f: 3,
        hops: 3,
        ripRequired: false,
      },
    ],
  })

  const { topology, problem, solution } =
    loadSerializedHyperGraph(multiRouteGraph)
  const solver = new FixedTopologyPortalLayerRefinementSolver(
    topology,
    problem,
    solution,
  )
  const routeOrderBefore = solver.refinedSolver.state.regionSegments.map(
    (segments) => segments.map(([routeId]) => routeId),
  )

  solver.solve()

  expect(solver.stats.acceptedCandidateCount).toBe(1)
  expect(
    solver.refinedSolver.state.regionSegments.map((segments) =>
      segments.map(([routeId]) => routeId),
    ),
  ).toEqual(routeOrderBefore)
})
