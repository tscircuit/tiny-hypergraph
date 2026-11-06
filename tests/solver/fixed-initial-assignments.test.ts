import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  loadSerializedHyperGraph,
  PreparedPortPointRoutingSolver,
  RegionPathSolver,
  TinyHyperGraphBusSolver,
  TinyHyperGraphSectionSolver,
  TinyHyperGraphSolver,
} from "lib/index"
import type { PortId } from "lib/types"

const loadFixedT113Board = () => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/t113-route201-real-repro.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as { serializedHyperGraph: SerializedHyperGraph }
  const graph = fixture.serializedHyperGraph
  const preloadedConnectionIds = new Set(
    graph.regions.flatMap((region) =>
      (region.assignments ?? []).map((assignment) => assignment.connectionId),
    ),
  )
  graph.connections = graph.connections?.map((connection) => {
    if (!preloadedConnectionIds.has(connection.connectionId)) return connection
    return { ...connection, isFixed: true }
  })
  return loadSerializedHyperGraph(graph)
}

test("fixed T113 fanout traces survive global retries and allow native same-net reuse", () => {
  const input = loadFixedT113Board()
  const solver = new PreparedPortPointRoutingSolver(
    input.topology,
    input.problem,
    { RIP_THRESHOLD_RAMP_ATTEMPTS: 0, MAX_ITERATIONS: 200_000 },
  )
  const initialRegionSegments = structuredClone(solver.state.regionSegments)
  const initialPortAssignment = new Int32Array(solver.state.portAssignment)

  expect(
    input.problem.routeIsFixed?.filter((isFixed) => isFixed === 1),
  ).toHaveLength(192)
  expect(solver.state.unroutedRoutes).toHaveLength(42)
  for (let retry = 0; retry < 2; retry++) {
    solver.resetRoutingStateForRerip()
    expect(solver.state.regionSegments).toEqual(initialRegionSegments)
    expect(solver.state.portAssignment).toEqual(initialPortAssignment)
    expect(solver.state.unroutedRoutes).toHaveLength(42)
    expect(
      solver.state.regionIntersectionCaches.reduce(
        (segmentCount, cache) => segmentCount + cache.existingSegmentCount,
        0,
      ),
    ).toBe(644)
  }

  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    solver.state.regionSegments.map((segments) =>
      segments.filter(
        ([routeId]) => input.problem.routeIsFixed?.[routeId] === 1,
      ),
    ),
  ).toEqual(initialRegionSegments)

  const reusedPorts = new Set<PortId>()
  for (const [
    routeId,
    fromPortId,
    toPortId,
  ] of solver.state.regionSegments.flat()) {
    if (input.problem.routeIsFixed?.[routeId] === 1) continue
    for (const portId of [fromPortId, toPortId]) {
      if (initialPortAssignment[portId] === -1) continue
      expect(input.problem.routeNet[routeId]).toBe(
        initialPortAssignment[portId],
      )
      reusedPorts.add(portId)
    }
  }
  expect(reusedPorts.size).toBeGreaterThan(0)

  const replay = loadSerializedHyperGraph(solver.getOutput())
  expect(replay.problem.routeIsFixed).toEqual(input.problem.routeIsFixed)
  const sectionSolver = new TinyHyperGraphSectionSolver(
    replay.topology,
    replay.problem,
    replay.solution,
    { MAX_RIPS: 0, MAX_ITERATIONS: 200_000 },
  )
  sectionSolver.solve()
  expect(sectionSolver.solved).toBe(true)
  expect(sectionSolver.activeRouteIds).toHaveLength(42)
  expect(
    sectionSolver.activeRouteIds.every(
      (routeId) => replay.problem.routeIsFixed?.[routeId] !== 1,
    ),
  ).toBe(true)
  expect(
    sectionSolver
      .getSolvedSolver()
      .state.regionSegments.map((segments) =>
        segments.filter(
          ([routeId]) => replay.problem.routeIsFixed?.[routeId] === 1,
        ),
      ),
  ).toEqual(initialRegionSegments)
})

test("base solver restores fixed T113 assignments and rejects an unseeded fixed route", () => {
  const input = loadFixedT113Board()
  const solver = new TinyHyperGraphSolver(input.topology, input.problem)
  const initialRegionSegments = structuredClone(solver.state.regionSegments)
  solver.resetRoutingStateForRerip()
  expect(solver.state.regionSegments).toEqual(initialRegionSegments)
  expect(
    () => new TinyHyperGraphBusSolver(input.topology, input.problem),
  ).toThrow("TinyHyperGraphBusSolver does not support fixed routes")
  expect(() => new RegionPathSolver(input.topology, input.problem)).toThrow(
    "RegionPathSolver does not support fixed routes",
  )
  const missingRouteId = input.problem.initialAssignments![0]!.routeId
  input.problem.initialAssignments = input.problem.initialAssignments?.filter(
    ({ routeId }) => routeId !== missingRouteId,
  )
  expect(() => new TinyHyperGraphSolver(input.topology, input.problem)).toThrow(
    `Fixed route ${missingRouteId} requires initial assignments`,
  )
})
