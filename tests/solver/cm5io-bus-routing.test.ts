import { expect, test } from "bun:test"
import { convertPortPointPathingSolverInputToSerializedHyperGraph } from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  filterPortPointPathingSolverInputByConnectionPatches,
  TinyHyperGraphBusSolver,
  type ConnectionPatchSelection,
} from "lib/index"

test("CM5IO bus1 bus solver expands one search candidate per step", async () => {
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
  const solver = new TinyHyperGraphBusSolver(topology, problem)

  solver.step()

  expect(solver.iterations).toBe(1)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(false)
  expect(solver.stats.busPhase).toBe("center")
  expect(solver.stats.currentTraceConnectionId).toBe("source_trace_108")
  expect(solver.stats.openCandidateCount).toBeGreaterThan(0)

  const graphics = solver.visualize()
  const activeCandidatePoint = (graphics.points ?? []).find((point) =>
    point.label?.includes("active candidate"),
  )
  const previewCandidateLines = (graphics.lines ?? []).filter((line) =>
    line.label?.includes("candidate path"),
  )
  const renderedTraceIds = new Set(
    solver.busTraceOrder.traces
      .map((trace) => trace.connectionId)
      .filter((connectionId) =>
        (graphics.lines ?? []).some((line) =>
          line.label?.includes(connectionId),
        ),
      ),
  )

  expect(activeCandidatePoint?.label).toContain("active candidate")
  expect(activeCandidatePoint?.label).toContain("route: source_trace_108")
  expect(previewCandidateLines.length).toBeGreaterThan(0)
  expect(renderedTraceIds.size).toBeGreaterThan(1)
  expect((graphics.lines ?? []).some((line) => line.strokeDash === "3 3")).toBe(
    false,
  )
  expect(
    (graphics.lines ?? []).some((line) => line.strokeDash === "10 5"),
  ).toBe(false)
})

test("CM5IO bus1 solves with fixed-centerline bus routing", async () => {
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
  const solver = new TinyHyperGraphBusSolver(topology, problem)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.busCenterConnectionId).toBe("source_trace_108")
  expect(
    solver.state.regionSegments.reduce((segmentCount, segments) => {
      return segmentCount + segments.length
    }, 0),
  ).toBeGreaterThan(0)
  expect(solver.getOutput().solvedRoutes).toHaveLength(9)

  const routeIdsByPortId = new Map<number, Set<number>>()
  for (const regionSegments of solver.state.regionSegments) {
    for (const [routeId, fromPortId, toPortId] of regionSegments) {
      const fromPortRoutes =
        routeIdsByPortId.get(fromPortId) ?? new Set<number>()
      fromPortRoutes.add(routeId)
      routeIdsByPortId.set(fromPortId, fromPortRoutes)

      const toPortRoutes = routeIdsByPortId.get(toPortId) ?? new Set<number>()
      toPortRoutes.add(routeId)
      routeIdsByPortId.set(toPortId, toPortRoutes)
    }
  }

  for (const routeIds of routeIdsByPortId.values()) {
    expect(routeIds.size).toBe(1)
  }
})
