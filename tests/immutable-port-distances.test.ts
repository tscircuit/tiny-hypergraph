import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  getTinyHyperGraphSolverOptions,
  IndexedCandidateHeap,
  loadSerializedHyperGraph,
  SelectiveReripTinyHyperGraphSolver,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"
import fixture from "./fixtures/bugreport87-unused-port-repro.json"
import * as visual from "./fixtures/performanceVisual"

const solve = (cache: boolean) => {
  const { topology, problem } = loadSerializedHyperGraph(
    fixture.serializedHyperGraph as unknown as SerializedHyperGraph,
  )
  const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem, {
    ...fixture.solveGraphOptions,
    OWNED_REGIONAL_HOP_FRONTIER: true,
    ...(cache ? { CACHE_IMMUTABLE_PORT_DISTANCES: true } : {}),
  })
  expect(solver.CACHE_IMMUTABLE_PORT_DISTANCES).toBe(cache)
  expect(
    getTinyHyperGraphSolverOptions(solver).CACHE_IMMUTABLE_PORT_DISTANCES,
  ).toBe(cache)
  const epochs = new Set<object>()
  let squareRoots = 0
  const sqrt = Math.sqrt
  Math.sqrt = (value) => {
    squareRoots++
    return sqrt(value)
  }
  try {
    while (!solver.solved && !solver.failed) {
      solver.step()
      epochs.add(
        (solver.state.candidateQueue as IndexedCandidateHeap).closureEpoch,
      )
    }
  } finally {
    Math.sqrt = sqrt
  }
  expect(solver.solved).toBe(true)
  return { solver, squareRoots, epochs: epochs.size }
}

test("immutable distances reuse exact geometry across rerips and reset with the problem", async () => {
  const before = solve(false)
  const after = solve(true)
  expect(after.solver.state).toEqual(before.solver.state)
  expect(after.solver.getOutput()).toEqual(before.solver.getOutput())
  expect(after.solver.stats).toEqual(before.solver.stats)
  expect(after.solver.iterations).toBe(before.solver.iterations)
  expect(after.epochs).toBe(before.epochs)
  expect(after.epochs).toBeGreaterThan(1)
  expect(after.solver.state.ripCount).toBeGreaterThan(0)
  expect(after.squareRoots).toBeLessThan(before.squareRoots / 2)

  const graphics = visual.performanceCanvas(
    "Reuse fixed port distances without changing the search",
    "Existing 52-route rerip regression. Route 49 excerpt; complete output, queue, routing state and statistics match.",
  )
  const segments = before.solver.state.regionSegments
    .flat()
    .filter(([route]) => route === 49)
  const ports = segments.flatMap(([, from, to]) => [from, to])
  expect(segments.length).toBeGreaterThan(0)
  const { portX, portY } = before.solver.topology
  const bounds = {
    minX: Math.min(...ports.map((id) => portX[id])),
    maxX: Math.max(...ports.map((id) => portX[id])),
    minY: Math.min(...ports.map((id) => portY[id])),
    maxY: Math.max(...ports.map((id) => portY[id])),
  }
  for (const [left, run, title, color] of [
    [24, before, "Before: recompute distance", visual.beforeColor],
    [624, after, "After: reuse exact distance", visual.afterColor],
  ] as const) {
    visual.visualPanel(graphics, left, title, "Route 49: same geometry.", color)
    const project = visual.projectVisual(bounds, left + 24, 190, 504, 280)
    const { portX, portY } = run.solver.topology
    const point = (id: number) => project({ x: portX[id], y: portY[id] })
    for (const [, from, to] of run.solver.state.regionSegments
      .flat()
      .filter(([route]) => route === 49)) {
      graphics.lines.push({
        points: [point(from), point(to)],
        strokeColor: color,
        strokeWidth: 3,
      })
    }
  }
  visual.visualMetric(
    graphics,
    "Math.sqrt calls during the complete solve",
    before.squareRoots,
    after.squareRoots,
    `${after.solver.iterations.toLocaleString("en-US")} identical iterations; ${after.solver.state.ripCount} rerips; ${after.epochs} queue epochs. Counts include unchanged heuristic work.`,
  )
  await visual.expectPerformanceSvg(graphics, import.meta.path)

  // Base solver permits independent-problem reset. Exercise the owned distance
  // expansion directly so each cached number and its live scaling are visible.
  const topology: TinyHyperGraphTopology = {
    portCount: 3,
    regionCount: 4,
    regionIncidentPorts: [[0, 1], [0], [1, 2], [2]],
    incidentPortRegion: [
      [0, 1],
      [0, 2],
      [2, 3],
    ],
    regionWidth: new Float64Array(4).fill(100),
    regionHeight: new Float64Array(4).fill(100),
    regionCenterX: new Float64Array(4),
    regionCenterY: new Float64Array(4),
    portAngleForRegion1: new Int32Array(3),
    portX: new Float64Array(3),
    portY: new Float64Array(3),
    portZ: new Int32Array(3),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    routeStartPort: Int32Array.from([0]),
    routeEndPort: Int32Array.from([2]),
    routeNet: new Int32Array(1),
    regionNetId: new Int32Array(4).fill(-1),
    portSectionMask: new Int8Array(3).fill(1),
  }
  const reused = new TinyHyperGraphSolver(topology, problem, {
    OWNED_REGIONAL_HOP_FRONTIER: true,
    CACHE_IMMUTABLE_PORT_DISTANCES: true,
    STATIC_REACHABILITY_PRECHECK: false,
  })
  reused["ADD_SEGMENT_DISTANCE_TO_G"] = true
  reused.state.candidateQueue = new IndexedCandidateHeap(4)
  for (const x of [3, 6, -0, Infinity, NaN]) {
    topology.portX[1] = x
    topology.portY[1] = Number.isFinite(x) && x !== 0 ? 4 : 0
    reused.resetForProblem(problem)
    reused._setup()
    const distance = Math.sqrt(x * x + topology.portY[1] ** 2)
    for (const factor of [1, 2]) {
      reused.DISTANCE_TO_COST = factor
      reused.resetRoutingStateForRerip()
      reused._step()
      const queued = reused.state.candidateQueue.toArray()[0]
      expect(queued?.g).toBe(
        Number.isFinite(distance) ? distance * factor : undefined,
      )
    }
  }
})
