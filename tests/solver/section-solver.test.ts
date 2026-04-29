import { expect, test } from "bun:test"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  DEFAULT_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
  OPT_IN_DEEP_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionSolver,
  type TinyHyperGraphSolver,
} from "lib/index"
import type { SerializedHyperGraphWithRuntimeConfig } from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import {
  createSectionSolverFixturePortMask,
  sectionSolverFixtureGraph,
} from "tests/fixtures/section-solver.fixture"

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

const getSolvedRoutePortIds = (
  output: ReturnType<TinyHyperGraphSectionSolver["getOutput"]>,
) =>
  Object.fromEntries(
    (output.solvedRoutes ?? []).map((solvedRoute) => [
      solvedRoute.connection.connectionId,
      solvedRoute.path.map((candidate) => candidate.portId),
    ]),
  )

const getSerializedOutputMaxRegionCost = (
  serializedHyperGraph: ReturnType<TinyHyperGraphSectionSolver["getOutput"]>,
) => {
  const replay = loadSerializedHyperGraph(serializedHyperGraph)
  const replayedSolver = new TinyHyperGraphSectionSolver(
    replay.topology,
    replay.problem,
    replay.solution,
  )

  return getMaxRegionCost(replayedSolver.baselineSolver)
}

const getSerializedOutputLayerChangeCount = (
  serializedHyperGraph: ReturnType<TinyHyperGraphSectionSolver["getOutput"]>,
) => {
  const portZByPortId = new Map(
    serializedHyperGraph.ports.map((port) => [port.portId, port.d?.z]),
  )
  let layerChangeCount = 0

  for (const solvedRoute of serializedHyperGraph.solvedRoutes ?? []) {
    for (let i = 1; i < solvedRoute.path.length; i++) {
      if (
        portZByPortId.get(solvedRoute.path[i - 1]!.portId) !==
        portZByPortId.get(solvedRoute.path[i]!.portId)
      ) {
        layerChangeCount += 1
      }
    }
  }

  return layerChangeCount
}

const getSectionPipelineOutput = (
  pipelineSolver: TinyHyperGraphSectionPipelineSolver,
): ReturnType<TinyHyperGraphSectionSolver["getOutput"]> => {
  const output = pipelineSolver.getOutput()
  if (!output) {
    throw new Error("Expected section pipeline output to be defined")
  }

  return output
}

test("section solver reattaches fixed prefixes and suffixes after optimizing the section", () => {
  const { topology, problem, solution } = loadSerializedHyperGraph(
    sectionSolverFixtureGraph,
  )
  problem.portSectionMask = createSectionSolverFixturePortMask(topology)

  const sectionSolver = new TinyHyperGraphSectionSolver(
    topology,
    problem,
    solution,
  )

  sectionSolver.solve()

  expect(sectionSolver.solved).toBe(true)
  expect(sectionSolver.failed).toBe(false)
  expect(sectionSolver.stats.optimized).toBe(true)
  expect(getMaxRegionCost(sectionSolver.getSolvedSolver())).toBeLessThan(
    getMaxRegionCost(sectionSolver.baselineSolver),
  )

  const optimizedRoutePortIds = getSolvedRoutePortIds(sectionSolver.getOutput())

  expect(optimizedRoutePortIds["route-0"]?.slice(0, 2)).toEqual(["s0", "a0"])
  expect(optimizedRoutePortIds["route-0"]?.slice(-2)).toEqual(["d0", "t0"])
  expect(optimizedRoutePortIds["route-1"]?.slice(0, 2)).toEqual(["s1", "a1"])
  expect(optimizedRoutePortIds["route-1"]?.slice(-2)).toEqual(["d1", "t1"])
  expect(optimizedRoutePortIds["route-0"]).not.toEqual([
    "s0",
    "a0",
    "b0x",
    "c1x",
    "d0",
    "t0",
  ])
  expect(optimizedRoutePortIds["route-1"]).not.toEqual([
    "s1",
    "a1",
    "b1x",
    "c0x",
    "d1",
    "t1",
  ])
})

test("section solver visualize highlights the section without idle gray port-region connector lines", () => {
  const { topology, problem, solution } = loadSerializedHyperGraph(
    sectionSolverFixtureGraph,
  )
  problem.portSectionMask = createSectionSolverFixturePortMask(topology)

  const sectionSolver = new TinyHyperGraphSectionSolver(
    topology,
    problem,
    solution,
  )

  sectionSolver.setup()
  const graphics = sectionSolver.visualize()

  expect(
    (graphics.lines ?? []).some(
      (line) => line.strokeColor === "rgba(100, 100, 100, 0.3)",
    ),
  ).toBe(false)
  expect(
    (graphics.rects ?? []).some(
      (rect) => rect.stroke === "rgba(245, 158, 11, 0.95)",
    ) ||
      (graphics.polygons ?? []).some(
        (polygon) => polygon.stroke === "rgba(245, 158, 11, 0.95)",
      ),
  ).toBe(true)
  expect(
    (graphics.circles ?? []).some(
      (circle) => circle.stroke === "rgba(245, 158, 11, 0.95)",
    ),
  ).toBe(true)
  expect(graphics.title).toContain("sectionPorts=")
})

test("section solver enforces section-specific rip thresholds and max rip cap", () => {
  const { topology, problem, solution } = loadSerializedHyperGraph(
    sectionSolverFixtureGraph,
  )
  problem.portSectionMask = createSectionSolverFixturePortMask(topology)

  const sectionSolver = new TinyHyperGraphSectionSolver(
    topology,
    problem,
    solution,
    {
      DISTANCE_TO_COST: 0.2,
      minViaPadDiameter: 0.25,
      RIP_THRESHOLD_START: 0.11,
      RIP_THRESHOLD_END: 0.22,
      RIP_THRESHOLD_RAMP_ATTEMPTS: 9,
      RIP_CONGESTION_REGION_COST_FACTOR: 0.33,
      MAX_ITERATIONS: 4567,
      MAX_RIPS: 80,
      MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT: 3,
      EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST: 2,
    },
  )

  sectionSolver.setup()

  expect(sectionSolver.DISTANCE_TO_COST).toBe(0.2)
  expect(sectionSolver.sectionSolver?.DISTANCE_TO_COST).toBe(0.2)
  expect(sectionSolver.minViaPadDiameter).toBe(0.25)
  expect(sectionSolver.sectionSolver?.minViaPadDiameter).toBe(0.25)
  expect(sectionSolver.RIP_THRESHOLD_START).toBe(0.05)
  expect(sectionSolver.sectionSolver?.RIP_THRESHOLD_START).toBe(0.05)
  expect(sectionSolver.RIP_THRESHOLD_END).toBe(
    Math.max(0.05, sectionSolver.sectionBaselineSummary.maxRegionCost),
  )
  expect(sectionSolver.sectionSolver?.RIP_THRESHOLD_END).toBe(
    Math.max(0.05, sectionSolver.sectionBaselineSummary.maxRegionCost),
  )
  expect(sectionSolver.sectionSolver?.RIP_THRESHOLD_RAMP_ATTEMPTS).toBe(9)
  expect(sectionSolver.sectionSolver?.RIP_CONGESTION_REGION_COST_FACTOR).toBe(
    0.33,
  )
  expect(sectionSolver.sectionSolver?.MAX_ITERATIONS).toBe(4567)
  expect(sectionSolver.STATIC_REACHABILITY_PRECHECK).toBe(false)
  expect(sectionSolver.sectionSolver?.STATIC_REACHABILITY_PRECHECK).toBe(false)
  expect(sectionSolver.MAX_RIPS).toBe(20)
  expect(sectionSolver.sectionSolver?.MAX_RIPS).toBe(20)
  expect(
    sectionSolver.sectionSolver?.MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT,
  ).toBe(3)
  expect(
    sectionSolver.sectionSolver
      ?.EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST,
  ).toBe(2)
})

test("section pipeline visualize renders the input graph at iteration zero", () => {
  const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: sectionSolverFixtureGraph,
  })

  const graphics = pipelineSolver.visualize()

  expect((graphics.rects ?? []).length + (graphics.polygons ?? []).length).toBe(
    sectionSolverFixtureGraph.regions.length,
  )
  expect((graphics.circles ?? []).length).toBeGreaterThan(0)
  expect(graphics.title).toContain("iter=0")
})

test("section pipeline visualize infers z-layer labels from incident ports", () => {
  const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: sectionSolverFixtureGraph,
  })

  const graphics = pipelineSolver.visualize()
  const startRegionRect = (graphics.rects ?? []).find((rect) =>
    rect.label?.includes("region: region-0"),
  )
  const startPortCircle = (graphics.circles ?? []).find((circle) =>
    circle.label?.includes("port: s0"),
  )

  expect(startRegionRect?.layer).toBe("z0")
  expect(startPortCircle?.layer).toBe("z0")
})

test("section pipeline searches multiple masks and commits an improving output on hg07 sample029", () => {
  const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: datasetHg07.sample029,
  })

  pipelineSolver.solve()

  expect(pipelineSolver.solved).toBe(true)
  expect(pipelineSolver.failed).toBe(false)
  expect(pipelineSolver.stats.sectionSearchCandidateCount).toBeGreaterThan(1)
  expect(pipelineSolver.selectedSectionCandidateLabel).toBeDefined()
  expect(
    [...(pipelineSolver.selectedSectionMask ?? [])].some(
      (value) => value === 1,
    ),
  ).toBe(true)

  const solveGraphOutput =
    pipelineSolver.getStageOutput<
      ReturnType<TinyHyperGraphSectionSolver["getOutput"]>
    >("solveGraph")
  const optimizeSectionOutput =
    pipelineSolver.getStageOutput<
      ReturnType<TinyHyperGraphSectionSolver["getOutput"]>
    >("optimizeSection")

  expect(solveGraphOutput).toBeDefined()
  expect(optimizeSectionOutput).toBeDefined()
  expect(getSerializedOutputMaxRegionCost(optimizeSectionOutput!)).toBeLessThan(
    getSerializedOutputMaxRegionCost(solveGraphOutput!),
  )
})

test("section pipeline accepts MAX_HOT_REGIONS through sectionSolverOptions", () => {
  const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: datasetHg07.sample029,
    sectionSolverOptions: {
      MAX_HOT_REGIONS: 1,
    },
  })

  pipelineSolver.solve()

  expect(pipelineSolver.solved).toBe(true)
  expect(pipelineSolver.failed).toBe(false)
  expect(pipelineSolver.stats.sectionSearchGeneratedCandidateCount).toBe(5)
  expect(pipelineSolver.stats.sectionSearchCandidateCount).toBeGreaterThan(0)
})

test("section pipeline applies top-level minViaPadDiameter to both stages", () => {
  const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: datasetHg07.sample029,
    minViaPadDiameter: 0.25,
    sectionSolverOptions: {
      MAX_HOT_REGIONS: 1,
    },
  })

  pipelineSolver.solve()

  const solveGraphSolver =
    pipelineSolver.getSolver<TinyHyperGraphSolver>("solveGraph")
  const sectionSolver =
    pipelineSolver.getSolver<TinyHyperGraphSectionSolver>("optimizeSection")

  expect(pipelineSolver.solved).toBe(true)
  expect(pipelineSolver.failed).toBe(false)
  expect(solveGraphSolver?.minViaPadDiameter).toBe(0.25)
  expect(sectionSolver?.minViaPadDiameter).toBe(0.25)
  expect(sectionSolver?.baselineSolver.minViaPadDiameter).toBe(0.25)
})

test("section pipeline only uses threehop and fourhop families when explicitly enabled", () => {
  const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: datasetHg07.sample029,
    sectionSolverOptions: {
      MAX_HOT_REGIONS: 1,
    },
    sectionSearchConfig: {
      candidateFamilies: [
        ...DEFAULT_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
        ...OPT_IN_DEEP_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
      ],
    },
  })

  pipelineSolver.solve()

  expect(pipelineSolver.solved).toBe(true)
  expect(pipelineSolver.failed).toBe(false)
  expect(pipelineSolver.stats.sectionSearchGeneratedCandidateCount).toBe(18)
  expect(pipelineSolver.stats.sectionSearchCandidateCount).toBeGreaterThan(0)
})

test("section pipeline effort increases search budget and reduces layer changes on hg07 sample032", () => {
  const baselinePipelineSolver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: datasetHg07.sample032,
  })
  baselinePipelineSolver.solve()

  const highEffortSerializedHyperGraph: SerializedHyperGraphWithRuntimeConfig =
    {
      ...datasetHg07.sample032,
      effort: 64,
    }
  const highEffortPipelineSolver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: highEffortSerializedHyperGraph,
  })
  highEffortPipelineSolver.solve()

  expect(baselinePipelineSolver.solved).toBe(true)
  expect(highEffortPipelineSolver.solved).toBe(true)
  expect(baselinePipelineSolver.failed).toBe(false)
  expect(highEffortPipelineSolver.failed).toBe(false)

  const baselineSolveGraphSolver =
    baselinePipelineSolver.getSolver<TinyHyperGraphSolver>("solveGraph")
  const highEffortSolveGraphSolver =
    highEffortPipelineSolver.getSolver<TinyHyperGraphSolver>("solveGraph")
  const baselineOutput = getSectionPipelineOutput(baselinePipelineSolver)
  const highEffortOutput = getSectionPipelineOutput(highEffortPipelineSolver)

  expect(baselineSolveGraphSolver).toBeDefined()
  expect(highEffortSolveGraphSolver).toBeDefined()
  expect(
    highEffortSolveGraphSolver!.RIP_THRESHOLD_RAMP_ATTEMPTS,
  ).toBeGreaterThan(baselineSolveGraphSolver!.RIP_THRESHOLD_RAMP_ATTEMPTS)
  expect(highEffortSolveGraphSolver!.LAYER_CHANGE_COST).toBeGreaterThan(
    baselineSolveGraphSolver!.LAYER_CHANGE_COST,
  )
  expect(getSerializedOutputLayerChangeCount(highEffortOutput)).toBeLessThan(
    getSerializedOutputLayerChangeCount(baselineOutput),
  )
})
