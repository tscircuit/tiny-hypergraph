import { expect, test } from "bun:test"
import { convertPortPointPathingSolverInputToSerializedHyperGraph } from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  filterPortPointPathingSolverInputByConnectionPatches,
  TinyHyperGraphBusSolver,
  type ConnectionPatchSelection,
} from "lib/index"

const createCm5ioBus1Solver = async () => {
  const fullInput = await Bun.file(
    new URL("../fixtures/CM5IO_HyperGraph.json", import.meta.url),
  ).json()
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

  return new TinyHyperGraphBusSolver(topology, problem, {
    MAX_ITERATIONS: 250_000,
  })
}

test("CM5IO bus1 evaluates one centerline candidate per step and visualizes all inferred routes", async () => {
  const solver = await createCm5ioBus1Solver()

  solver.step()
  solver.step()

  expect(solver.iterations).toBe(2)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(false)
  expect(solver.stats.busCenterConnectionId).toBe("source_trace_108")
  expect(solver.stats.openCandidateCount).toBeGreaterThan(0)
  expect(solver.stats.previewRouteCount).toBe(9)

  const graphics = solver.visualize()
  const renderedRouteIds = new Set(
    (graphics.lines ?? [])
      .flatMap((line) =>
        solver.busTraceOrder.traces
          .map((trace) => trace.connectionId)
          .filter((connectionId) => line.label?.includes(connectionId)),
      )
      .filter(Boolean),
  )

  expect(renderedRouteIds.size).toBe(9)
  expect(
    solver.state.regionSegments.reduce(
      (segmentCount, regionSegments) => segmentCount + regionSegments.length,
      0,
    ),
  ).toBeGreaterThan(0)
  expect(
    solver.state.regionSegments.every((regionSegments) =>
      regionSegments.every(
        ([, fromPortId, toPortId]) =>
          solver.topology.portZ[fromPortId] === 0 &&
          solver.topology.portZ[toPortId] === 0,
      ),
    ),
  ).toBe(true)
})

test("CM5IO bus1 never accepts an intersecting centerline bus solution", async () => {
  const solver = await createCm5ioBus1Solver()

  solver.solve()

  expect(solver.stats.busCenterConnectionId).toBe("source_trace_108")
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput().solvedRoutes).toHaveLength(9)
  expect(
    solver.state.regionSegments.reduce(
      (segmentCount, regionSegments) => segmentCount + regionSegments.length,
      0,
    ),
  ).toBeGreaterThan(0)

  const sameLayerIntersectionCount = solver.state.regionIntersectionCaches.reduce(
    (total, regionCache) => total + regionCache.existingSameLayerIntersections,
    0,
  )
  const crossingLayerIntersectionCount = solver.state.regionIntersectionCaches.reduce(
    (total, regionCache) =>
      total + regionCache.existingCrossingLayerIntersections,
    0,
  )

  expect(sameLayerIntersectionCount).toBe(0)
  expect(crossingLayerIntersectionCount).toBe(0)

  const routeIdsByPortId = new Map<number, Set<number>>()
  for (const regionSegments of solver.state.regionSegments) {
    for (const [routeId, fromPortId, toPortId] of regionSegments) {
      if (solver.problem.routeStartPort[routeId] !== fromPortId) {
        const fromPortRouteIds =
          routeIdsByPortId.get(fromPortId) ?? new Set<number>()
        fromPortRouteIds.add(routeId)
        routeIdsByPortId.set(fromPortId, fromPortRouteIds)
      }
      if (solver.problem.routeEndPort[routeId] !== toPortId) {
        const toPortRouteIds =
          routeIdsByPortId.get(toPortId) ?? new Set<number>()
        toPortRouteIds.add(routeId)
        routeIdsByPortId.set(toPortId, toPortRouteIds)
      }
    }
  }

  for (const routeIds of routeIdsByPortId.values()) {
    expect(routeIds.size).toBe(1)
  }
  expect(
    solver.state.regionSegments.every((regionSegments) =>
      regionSegments.every(
        ([, fromPortId, toPortId]) =>
          solver.topology.portZ[fromPortId] === 0 &&
          solver.topology.portZ[toPortId] === 0,
      ),
    ),
  ).toBe(true)
})
