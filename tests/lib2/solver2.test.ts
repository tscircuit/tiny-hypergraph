import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import {
  loadSerializedHyperGraph,
  SerializedGraphLoadInvariantError,
} from "lib2/graph-load"
import { TinyHyperGraphSolver } from "lib/index"
import {
  ParseGraphError,
  SerializedGraphOutputInvariantError,
  SolveGraphError,
  SolverInvariantError,
  TinyHyperGraphSolver2,
  solveGraph,
} from "lib2/index"

const getMaxRegionCost = (
  solver: TinyHyperGraphSolver | TinyHyperGraphSolver2,
) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

test("lib2 solveGraph returns a typed parse error for invalid input", () => {
  const result = solveGraph({ regions: [] })

  expect(result._tag).toBe("err")
  if (result._tag === "err") {
    expect(result.error).toBeInstanceOf(ParseGraphError)
    expect(result.error.message).toBe(
      "Invalid serialized graph: expected ports array",
    )
  }
})

test("lib2 solveGraph solves and serializes hg07 sample002", () => {
  const serializedGraph = datasetHg07.sample002 as SerializedHyperGraph
  const { topology, problem } = loadSerializedHyperGraph(serializedGraph)
  const result = solveGraph(serializedGraph)

  expect(result._tag).toBe("ok")
  if (result._tag === "ok") {
    expect(result.value.solver.solved).toBe(true)
    expect(result.value.solver.failed).toBe(false)
    expect(result.value.graph.regions).toHaveLength(topology.regionCount)
    expect(result.value.graph.ports).toHaveLength(topology.portCount)
    expect(result.value.graph.solvedRoutes).toHaveLength(problem.routeCount)
  }
})

test("lib2 solver facade matches core solver on hg07 sample002", () => {
  const serializedGraph = datasetHg07.sample002 as SerializedHyperGraph
  const { topology, problem } = loadSerializedHyperGraph(serializedGraph)
  const coreSolver = new TinyHyperGraphSolver(topology, problem)
  const lib2Solver = new TinyHyperGraphSolver2(topology, problem)

  coreSolver.solve()
  const lib2Result = lib2Solver.solveResult()

  expect(coreSolver.solved).toBe(true)
  expect(coreSolver.failed).toBe(false)
  expect(lib2Result._tag).toBe("ok")
  expect(lib2Solver.solved).toBe(true)
  expect(lib2Solver.failed).toBe(false)
  expect(getMaxRegionCost(lib2Solver)).toBeCloseTo(
    getMaxRegionCost(coreSolver),
    10,
  )
})

test("lib2 solveResult preserves thrown invariant causes", () => {
  const serializedGraph = datasetHg07.sample002 as SerializedHyperGraph
  const { topology, problem } = loadSerializedHyperGraph(serializedGraph)
  const invariantError = new SolverInvariantError(undefined, "forced test")

  class ThrowingSolver extends TinyHyperGraphSolver2 {
    override _step() {
      throw invariantError
    }
  }

  const solver = new ThrowingSolver(topology, problem)
  const result = solver.solveResult()

  expect(result._tag).toBe("err")
  if (result._tag === "err") {
    expect(result.error).toBeInstanceOf(SolveGraphError)
    if (result.error instanceof SolveGraphError) {
      expect(result.error.errorCause).toBe(invariantError)
    }
  }
})

test("lib2 output rejects missing network metadata", () => {
  const serializedGraph = datasetHg07.sample002 as SerializedHyperGraph
  const { topology, problem } = loadSerializedHyperGraph(serializedGraph)
  const solver = new TinyHyperGraphSolver2(topology, problem)
  const result = solver.solveResult()

  expect(result._tag).toBe("ok")
  delete (solver.problem.routeMetadata?.[0] as { mutuallyConnectedNetworkId?: string })
    .mutuallyConnectedNetworkId

  expect(() => solver.getOutput()).toThrow(SerializedGraphOutputInvariantError)
})

test("lib2 graph loader rejects solved route ports that do not exist", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      {
        regionId: "r0",
        pointIds: ["p0", "p1"],
        d: { center: { x: 0, y: 0 }, width: 1, height: 1 },
      },
      {
        regionId: "r1",
        pointIds: ["p0", "p1"],
        d: { center: { x: 1, y: 0 }, width: 1, height: 1 },
      },
    ],
    ports: [
      { portId: "p0", region1Id: "r0", region2Id: "r1", d: { x: 0, y: 0, z: 0 } },
      { portId: "p1", region1Id: "r0", region2Id: "r1", d: { x: 1, y: 0, z: 0 } },
    ],
    connections: [
      {
        connectionId: "c0",
        startRegionId: "r0",
        endRegionId: "r1",
      },
    ],
    solvedRoutes: [
      {
        connection: {
          connectionId: "c0",
          startRegionId: "r0",
          endRegionId: "r1",
        },
        path: [
          { portId: "p0", nextRegionId: "r0", g: 0, h: 0, f: 0, hops: 0, ripRequired: false },
          { portId: "missing-port", nextRegionId: "r1", g: 1, h: 0, f: 1, hops: 1, ripRequired: false },
        ],
        requiredRip: false,
      },
    ],
  }

  expect(() => loadSerializedHyperGraph(graph)).toThrow(
    SerializedGraphLoadInvariantError,
  )
})

test("lib2 solver fails before seeding a route with no legal starting region", () => {
  const topology = {
    portCount: 2,
    regionCount: 1,
    regionIncidentPorts: [[0, 1]],
    incidentPortRegion: [[0], [0]],
    regionWidth: new Float64Array([1]),
    regionHeight: new Float64Array([1]),
    regionCenterX: new Float64Array([0]),
    regionCenterY: new Float64Array([0]),
    portAngleForRegion1: new Int32Array([0, 9000]),
    portX: new Float64Array([0, 1]),
    portY: new Float64Array([0, 0]),
    portZ: new Int32Array([0, 0]),
  }
  const problem = {
    routeCount: 1,
    portSectionMask: new Int8Array([1, 1]),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([1]),
    regionNetId: new Int32Array([2]),
  }
  const solver = new TinyHyperGraphSolver2(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
  })

  solver.solve()

  expect(solver.failed).toBe(true)
  expect(solver.error).toBe("Start port 0 has no legal starting region")
})
