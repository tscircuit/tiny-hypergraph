import { expect, test } from "bun:test"
import {
  convertPortPointPathingSolverInputToSerializedHyperGraph,
  type SerializedHyperGraphPortPointPathingSolverInput,
} from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  createRegionGraph,
  filterPortPointPathingSolverInputByConnectionPatches,
  RegionPathSolver,
  type ConnectionPatchSelection,
} from "lib/index"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/index"

const createDuplicateEdgeTopology = (): TinyHyperGraphTopology => ({
  portCount: 2,
  regionCount: 2,
  regionIncidentPorts: [
    [0, 1],
    [0, 1],
  ],
  incidentPortRegion: [
    [0, 1],
    [0, 1],
  ],
  regionWidth: new Float64Array([3, 3]),
  regionHeight: new Float64Array([3, 3]),
  regionCenterX: new Float64Array([0, 4]),
  regionCenterY: new Float64Array([0, 0]),
  regionMetadata: [
    { serializedRegionId: "left" },
    { serializedRegionId: "right" },
  ],
  portAngleForRegion1: new Int32Array(2),
  portAngleForRegion2: new Int32Array(2),
  portX: new Float64Array([1, 1]),
  portY: new Float64Array([0, 1]),
  portZ: new Int32Array(2),
})

const createCapacityCostTopology = (): TinyHyperGraphTopology => ({
  portCount: 8,
  regionCount: 6,
  regionIncidentPorts: [
    [0, 2],
    [4, 6],
    [0, 1, 4, 5],
    [2, 3, 6, 7],
    [1, 3],
    [5, 7],
  ],
  incidentPortRegion: [
    [0, 2],
    [2, 4],
    [0, 3],
    [3, 4],
    [1, 2],
    [2, 5],
    [1, 3],
    [3, 5],
  ],
  regionWidth: new Float64Array([5, 5, 3, 2, 5, 5]),
  regionHeight: new Float64Array([2, 2, 2, 2, 2, 2]),
  regionCenterX: new Float64Array([0, 0, 2, 2, 4, 4]),
  regionCenterY: new Float64Array([1, -1, 0, 2, 1, -1]),
  regionMetadata: [
    { serializedRegionId: "start-0" },
    { serializedRegionId: "start-1" },
    { serializedRegionId: "shared" },
    { serializedRegionId: "bypass" },
    { serializedRegionId: "end-0" },
    { serializedRegionId: "end-1" },
  ],
  portAngleForRegion1: new Int32Array(8),
  portAngleForRegion2: new Int32Array(8),
  portX: new Float64Array([1, 3, 1, 3, 1, 3, 1, 3]),
  portY: new Float64Array([1, 1, 2, 2, -1, -1, 0, 0]),
  portZ: new Int32Array(8),
})

const createCapacityCostProblem = (): TinyHyperGraphProblem => ({
  routeCount: 2,
  portSectionMask: new Int8Array(8).fill(1),
  routeMetadata: [
    {
      connectionId: "route-a",
      startRegionId: "start-0",
      endRegionId: "end-0",
    },
    {
      connectionId: "route-b",
      startRegionId: "start-1",
      endRegionId: "end-1",
    },
  ],
  routeStartPort: new Int32Array([0, 4]),
  routeEndPort: new Int32Array([1, 5]),
  routeNet: new Int32Array([0, 1]),
  regionNetId: new Int32Array([0, 1, -1, -1, 0, 1]),
})

test("createRegionGraph merges multiple ports between the same region pair into one edge", () => {
  const regionGraph = createRegionGraph(createDuplicateEdgeTopology())

  expect(regionGraph.edgeCount).toBe(1)
  expect(regionGraph.edges[0]?.portIds).toEqual([0, 1])
  expect(regionGraph.incidentEdges[0]).toHaveLength(1)
  expect(regionGraph.incidentEdges[1]).toHaveLength(1)
})

test("CM5IO bus1 fixture includes the complete bus1 trace set", async () => {
  const fullInput = (await Bun.file(
    new URL("../fixtures/CM5IO_HyperGraph.json", import.meta.url),
  ).json()) as SerializedHyperGraphPortPointPathingSolverInput
  const busSelection = (await Bun.file(
    new URL("../fixtures/CM5IO_bus1.json", import.meta.url),
  ).json()) as ConnectionPatchSelection
  const busOnlyFixture = filterPortPointPathingSolverInputByConnectionPatches(
    fullInput,
    busSelection,
  )

  const selectedConnectionIds = busSelection.connectionPatches
    .map((patch: { connectionId: string }) => patch.connectionId)
    .sort()
  const busOnlyConnectionIds = (
    Array.isArray(busOnlyFixture) ? busOnlyFixture[0] : busOnlyFixture
  ).connections
    .map((connection: { connectionId: string }) => connection.connectionId)
    .sort()

  expect(selectedConnectionIds).toHaveLength(
    busSelection.connectionPatches.length,
  )
  expect(busOnlyConnectionIds).toEqual(selectedConnectionIds)
})

test("RegionPathSolver capacity cost pushes later routes into alternate regions", () => {
  const solver = new RegionPathSolver(
    createCapacityCostTopology(),
    createCapacityCostProblem(),
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.state.solvedRouteRegionIds).toEqual([
    [0, 2, 4],
    [1, 3, 5],
  ])
  expect(solver.state.regionUsage[2]).toBe(1)
  expect(solver.state.regionUsage[3]).toBe(1)
  expect(solver.state.solvedRouteCosts[0]).toBeLessThan(
    solver.state.solvedRouteCosts[1],
  )
})

test("RegionPathSolver solves the full CM5IO bus1-only hypergraph fixture", async () => {
  const fullInput = (await Bun.file(
    new URL("../fixtures/CM5IO_HyperGraph.json", import.meta.url),
  ).json()) as SerializedHyperGraphPortPointPathingSolverInput
  const busSelection = (await Bun.file(
    new URL("../fixtures/CM5IO_bus1.json", import.meta.url),
  ).json()) as ConnectionPatchSelection

  const serializedHyperGraph =
    convertPortPointPathingSolverInputToSerializedHyperGraph(
      filterPortPointPathingSolverInputByConnectionPatches(
        fullInput,
        busSelection,
      ),
    )
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  const solver = new RegionPathSolver(topology, problem, {
    MAX_ITERATIONS: 2_000_000,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.state.solvedRouteRegionIds).toHaveLength(9)
  expect(
    solver.state.solvedRouteRegionIds.every(
      (regionPath) => regionPath.length >= 2,
    ),
  ).toBe(true)
})
