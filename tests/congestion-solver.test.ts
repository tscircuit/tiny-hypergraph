import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphProblem,
} from "../lib/core"
import { TinyHyperGraphCongestionSolver } from "../lib/TinyHyperGraphCongestionSolver"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSectionSolver } from "../lib/section-solver"
import { TinyHyperGraphSectionPipelineSolver } from "../lib/section-solver/TinyHyperGraphSectionPipelineSolver"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

function fixture(routeCount = 2) {
  // Four spokes meet at region 4; region 9 offers a spacious detour.
  const incidentPortRegion = [
    [0, 5],
    [0, 4],
    [4, 1],
    [1, 6],
    [2, 7],
    [2, 4],
    [4, 3],
    [3, 8],
    [0, 9],
    [9, 1],
    [2, 9],
    [9, 3],
  ]
  const topology: TinyHyperGraphTopology = {
    portCount: 12,
    regionCount: 10,
    incidentPortRegion,
    regionIncidentPorts: Array.from({ length: 10 }, (_, r) =>
      incidentPortRegion.flatMap((rs, p) => (rs.includes(r) ? [p] : [])),
    ),
    regionWidth: new Float64Array(10).fill(10),
    regionHeight: new Float64Array(10).fill(10),
    regionCenterX: new Float64Array(10),
    regionCenterY: new Float64Array(10),
    portX: new Float64Array([-2, -1, 1, 2, 0, 0, 0, 0, -1, 1, -1, 1]),
    portY: new Float64Array([0, 0, 0, 0, 2, 1, -1, -2, 3, 3, 4, 4]),
    portZ: new Int32Array(12),
    portAngleForRegion1: new Int32Array([
      0, 0, 0, 0, 0, 0, 27000, 0, 0, 0, 0, 0,
    ]),
    portAngleForRegion2: new Int32Array([
      0, 18000, 0, 0, 0, 9000, 0, 0, 0, 0, 0, 0,
    ]),
  }
  topology.regionWidth[4] = 1
  topology.regionHeight[4] = 1
  const problem: TinyHyperGraphProblem = {
    routeCount,
    routeStartPort: Int32Array.from({ length: routeCount }, (_, r) =>
      r % 2 ? 4 : 0,
    ),
    routeEndPort: Int32Array.from({ length: routeCount }, (_, r) =>
      r % 2 ? 7 : 3,
    ),
    routeNet: Int32Array.from({ length: routeCount }, (_, r) => r % 2),
    regionNetId: new Int32Array(10).fill(-1),
    portSectionMask: new Int8Array(12).fill(1),
    initialAssignments: Array.from({ length: routeCount }, (_, r) =>
      (r % 2
        ? [
            [2, 4, 5],
            [4, 5, 6],
            [3, 6, 7],
          ]
        : [
            [0, 0, 1],
            [4, 1, 2],
            [1, 2, 3],
          ]
      ).map(([regionId, fromPortId, toPortId]) => ({
        routeId: r,
        regionId,
        fromPortId,
        toPortId,
      })),
    ).flat(),
  }
  const solver = new TinyHyperGraphSolver(topology, problem, {
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
    STATIC_REACHABILITY_PRECHECK: false,
    TRACE_DENSITY_COST_FACTOR: 1,
  })
  solver.solve()
  delete solver.problem.initialAssignments
  expect(solver.solved).toBe(true)
  return solver
}

const solverOptions = {
  TRACE_DENSITY_COST_FACTOR: 1,
  RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  STATIC_REACHABILITY_PRECHECK: false,
}
function replayQuality(
  graph: SerializedHyperGraph,
  options: TinyHyperGraphSolverOptions = solverOptions,
) {
  const { topology, problem, solution } = loadSerializedHyperGraph(graph)
  const replay = new TinyHyperGraphSectionSolver(
    topology,
    problem,
    solution,
    options,
  ).baselineSolver
  const costs = replay.state.regionIntersectionCaches.map(
    (c) => c.existingRegionCost,
  )
  return {
    max: Math.max(0, ...costs),
    sumSquares: costs.reduce((sum, c) => sum + c * c, 0),
  }
}
function optimize(
  graph: SerializedHyperGraph,
  options: ConstructorParameters<typeof TinyHyperGraphCongestionSolver>[1] = {},
) {
  const solver = new TinyHyperGraphCongestionSolver(graph, {
    solverOptions,
    ...options,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  return solver
}

test("reroutes one connection around congestion without changing input, metadata, or protected routes", () => {
  const graph = JSON.parse(
    JSON.stringify(fixture().getOutput())
      .replaceAll("region-", "external-region-")
      .replaceAll("port-", "external-port-"),
  ) as SerializedHyperGraph
  graph.regions[0]!.d!.customLabel = "Keep this region metadata"
  graph.ports[0]!.d!.customLabel = "Keep this port metadata"
  const before = structuredClone(graph)
  const result = optimize(graph, {
    maxTrials: 1,
    preservedRouteIds: new Set([1]),
  }).getOutput()
  expect(replayQuality(result).max).toBeLessThanOrEqual(
    replayQuality(graph).max,
  )
  expect(replayQuality(result).sumSquares).toBeLessThan(
    replayQuality(graph).sumSquares,
  )
  expect(result.connections).toEqual(graph.connections)
  expect(result.ports).toEqual(graph.ports)
  expect(result.regions.map(({ assignments, ...region }) => region)).toEqual(
    graph.regions.map(({ assignments, ...region }) => region),
  )
  expect(result.solvedRoutes![1]).toEqual(graph.solvedRoutes![1])
  for (let i = 0; i < graph.solvedRoutes!.length; i++) {
    expect(result.solvedRoutes![i]!.path[0]!.portId).toBe(
      graph.solvedRoutes![i]!.path[0]!.portId,
    )
    expect(result.solvedRoutes![i]!.path.at(-1)!.portId).toBe(
      graph.solvedRoutes![i]!.path.at(-1)!.portId,
    )
  }
  expect(graph).toEqual(before)
})

test("zero budget and fully protected routes return the exact incumbent", () => {
  const graph = fixture().getOutput()
  expect(optimize(graph, { maxTrials: 0 }).getOutput()).toEqual(graph)
  expect(
    optimize(graph, { preservedRouteIds: new Set([0, 1]) }).getOutput(),
  ).toEqual(graph)
})

test("a bounded failed search and a reserved detour leave the incumbent unchanged", () => {
  const graph = fixture().getOutput()
  expect(
    optimize(graph, { maxTrials: 1, maxIterationsPerTrial: 1 }).getOutput(),
  ).toEqual(graph)
  graph.regions[9]!.d!.netId = 55
  const before = structuredClone(graph)
  expect(optimize(graph).getOutput()).toEqual(graph)
  expect(graph).toEqual(before)
})

test("seeded reroutes are deterministic and use nondefault scoring options", () => {
  const graph = fixture(4).getOutput()
  const options = {
    seed: 123,
    solverOptions: {
      ...solverOptions,
      TRACE_DENSITY_COST_FACTOR: 2,
      minViaPadDiameter: 0.6,
    },
  }
  const first = optimize(graph, options).getOutput()
  expect(optimize(graph, options).getOutput()).toEqual(first)
  expect(replayQuality(first, options.solverOptions).max).toBeLessThanOrEqual(
    replayQuality(graph, options.solverOptions).max,
  )
  expect(
    replayQuality(first, options.solverOptions).sumSquares,
  ).toBeLessThanOrEqual(replayQuality(graph, options.solverOptions).sumSquares)
})

test("incomplete or inconsistent serialized routes conservatively keep the input", () => {
  for (const mutate of [
    (g: SerializedHyperGraph) => {
      g.solvedRoutes!.pop()
    },
    (g: SerializedHyperGraph) => {
      g.solvedRoutes!.push(structuredClone(g.solvedRoutes![0]!))
    },
    (g: SerializedHyperGraph) => {
      g.ports[1]!.portId = g.ports[0]!.portId
    },
    (g: SerializedHyperGraph) => {
      g.regions.find((r) => r.assignments?.length)!.assignments!.pop()
    },
    (g: SerializedHyperGraph) => {
      g.ports[0]!.d!.x = NaN
    },
  ]) {
    const graph = fixture().getOutput()
    mutate(graph)
    const before = structuredClone(graph)
    expect(optimize(graph).getOutput()).toEqual(before)
    expect(graph).toEqual(before)
  }
})

test("pipeline skips congestion by default and forwards opt-in output and scoring options", () => {
  const graph = fixture().getOutput()
  for (const region of graph.regions) delete region.assignments
  const input = {
    serializedHyperGraph: graph,
    createSectionMask: ({ topology }: { topology: TinyHyperGraphTopology }) =>
      new Int8Array(topology.portCount),
    sectionSolverOptions: solverOptions,
  }
  const standard = new TinyHyperGraphSectionPipelineSolver(input)
  standard.solve()
  expect(standard.solved).toBe(true)
  expect(standard.getSolver("optimizeCongestion")).toBeUndefined()
  expect(standard.getOutput()).toEqual(
    standard.getStageOutput<SerializedHyperGraph>("optimizeSection")!,
  )
  const enabled = new TinyHyperGraphSectionPipelineSolver({
    ...input,
    congestionSolverOptions: { maxTrials: 1, preservedRouteIds: new Set([1]) },
  })
  enabled.solve()
  expect(enabled.solved).toBe(true)
  const stage =
    enabled.getSolver<TinyHyperGraphCongestionSolver>("optimizeCongestion")!
  expect(stage).toBeInstanceOf(TinyHyperGraphCongestionSolver)
  expect(enabled.getOutput()).toEqual(stage.getOutput())
  expect(stage.getOutput()).toEqual(
    optimize(enabled.getStageOutput<SerializedHyperGraph>("optimizeSection")!, {
      maxTrials: 1,
      preservedRouteIds: new Set([1]),
      solverOptions: enabled.getSectionSolverOptions(),
    }).getOutput(),
  )
})

test("port masks remain unchanged and prevent using a blocked detour", () => {
  const graph = fixture().getOutput()
  const portSectionMask = new Int8Array(graph.ports.length).fill(1)
  portSectionMask.fill(0, 8)
  const before = new Int8Array(portSectionMask)
  const solver = optimize(graph, { portSectionMask })
  expect(solver.report.accepted).toBe(0)
  expect(solver.getOutput()).toEqual(graph)
  expect(portSectionMask).toEqual(before)
})

test("invalid budgets reject and trial iteration limits are respected", () => {
  const graph = fixture().getOutput()
  for (const options of [
    { maxTrials: -1 },
    { maxTrials: NaN },
    { maxIterationsPerTrial: 0 },
  ]) {
    expect(() => new TinyHyperGraphCongestionSolver(graph, options)).toThrow()
  }
  const solver = optimize(graph, { maxTrials: 2, maxIterationsPerTrial: 1 })
  expect(solver.report.trials.length).toBeLessThanOrEqual(2)
  expect(solver.report.trials.every((trial) => trial.iterations <= 1)).toBe(
    true,
  )
  expect(solver.report.accepted).toBe(0)
})

test("the default preserves route zero while allowing other routes to improve", () => {
  const graph = fixture().getOutput()
  const solver = optimize(graph)
  expect(solver.getOutput().solvedRoutes![0]).toEqual(graph.solvedRoutes![0])
  expect(solver.report.trials.every((trial) => trial.routeId !== 0)).toBe(true)
  expect(solver.report.accepted).toBeGreaterThan(0)
})

test("HG07 sample025 stays within the downstream replay envelope", async () => {
  // This case previously looked cheaper in trial insertion order but became
  // worse when its serialized routes were replayed in connection order.
  const { default: graph } = await import("dataset-hg07/samples/sample025.json")
  const pipeline = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: graph,
  })
  pipeline.solve()
  expect(pipeline.solved).toBe(true)
  const before = pipeline.getOutput()!
  const solver = optimize(before, {
    solverOptions: pipeline.getSectionSolverOptions(),
  })
  const initial = replayQuality(before, pipeline.getSectionSolverOptions())
  const final = replayQuality(
    solver.getOutput(),
    pipeline.getSectionSolverOptions(),
  )
  expect(final.max).toBeLessThanOrEqual(initial.max + 1e-9)
  expect(final.sumSquares).toBeLessThanOrEqual(initial.sumSquares + 1e-8)
  expect(solver.report.final!.maxRegionCost).toBeCloseTo(final.max, 12)
  expect(solver.report.final!.squaredRegionCostSum).toBeCloseTo(
    final.sumSquares,
    12,
  )
})

test("pipeline protects preloaded connections even when the explicit protected set is empty", () => {
  const pipeline = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: fixture().getOutput(),
    createSectionMask: ({ topology }) => new Int8Array(topology.portCount),
    congestionSolverOptions: { preservedRouteIds: new Set() },
  })
  pipeline.solve()
  expect(pipeline.solved).toBe(true)
  const stage =
    pipeline.getSolver<TinyHyperGraphCongestionSolver>("optimizeCongestion")!
  expect(stage.report.trials).toEqual([])
  expect(pipeline.getOutput()).toEqual(
    pipeline.getStageOutput<SerializedHyperGraph>("optimizeSection")!,
  )
})

test("pipeline timeout retains the last complete congestion improvement", () => {
  const sectionOutput = fixture().getOutput()
  const input = structuredClone(sectionOutput)
  for (const region of input.regions) delete region.assignments
  const pipeline = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: input,
    sectionSolverOptions: solverOptions,
    congestionSolverOptions: {},
  })
  // Start at the new stage so the fixture's congested routes reach it unchanged.
  pipeline.pipelineOutputs.solveGraph = sectionOutput
  pipeline.pipelineOutputs.optimizeSection = sectionOutput
  pipeline.currentPipelineStageIndex = 2
  pipeline.step()
  const stage =
    pipeline.getSolver<TinyHyperGraphCongestionSolver>("optimizeCongestion")!
  while (!stage.report.accepted && !stage.solved && !pipeline.failed) {
    pipeline.step()
  }
  expect(stage.report.accepted).toBeGreaterThan(0)
  expect(stage.solved).toBe(false)
  const acceptedOutput = stage.getOutput()
  expect(replayQuality(acceptedOutput).max).toBeLessThan(
    replayQuality(sectionOutput).max,
  )

  pipeline.MAX_ITERATIONS = pipeline.iterations + 1
  pipeline.step()
  expect(pipeline.solved).toBe(true)
  expect(pipeline.failed).toBe(false)
  expect(pipeline.getOutput()).toEqual(acceptedOutput)
})
