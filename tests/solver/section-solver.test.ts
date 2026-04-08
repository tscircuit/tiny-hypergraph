import { expect, test } from "bun:test"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  TinyHyperGraphMultiSectionUnravelSolver,
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionSolver,
  type TinyHyperGraphSolver,
  type TinyHyperGraphUnravelSolver,
} from "lib/index"
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

const createPortMaskForSerializedPortIds = (
  topology: Parameters<typeof createSectionSolverFixturePortMask>[0],
  serializedPortIds: string[],
) => {
  const selectedPortIds = new Set(serializedPortIds)
  return Int8Array.from(
    topology.portMetadata?.map((metadata) =>
      selectedPortIds.has(metadata?.serializedPortId ?? "") ? 1 : 0,
    ) ?? [],
  )
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

test("section solver supports multiple disjoint active spans on the same original route", () => {
  const { topology, problem, solution } = loadSerializedHyperGraph(
    sectionSolverFixtureGraph,
  )
  problem.portSectionMask = createPortMaskForSerializedPortIds(topology, [
    "a0",
    "c1x",
    "a1",
    "c0x",
  ])

  const sectionSolver = new TinyHyperGraphSectionSolver(
    topology,
    problem,
    solution,
  )

  sectionSolver.solve()

  expect(sectionSolver.solved).toBe(true)
  expect(sectionSolver.failed).toBe(false)
  expect(sectionSolver.activeRouteIds.length).toBe(4)

  const output = sectionSolver.getOutput()
  const routePortIds = getSolvedRoutePortIds(output)

  expect(output.solvedRoutes?.length).toBe(2)
  expect(routePortIds["route-0"]?.[0]).toBe("s0")
  expect(routePortIds["route-0"]?.at(-1)).toBe("t0")
  expect(routePortIds["route-1"]?.[0]).toBe("s1")
  expect(routePortIds["route-1"]?.at(-1)).toBe("t1")
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
  expect(sectionSolver.RIP_THRESHOLD_START).toBe(0.05)
  expect(sectionSolver.sectionSolver?.RIP_THRESHOLD_START).toBe(0.05)
  expect(sectionSolver.RIP_THRESHOLD_END).toBe(
    sectionSolver.sectionBaselineSummary.maxRegionCost,
  )
  expect(sectionSolver.sectionSolver?.RIP_THRESHOLD_END).toBe(
    sectionSolver.sectionBaselineSummary.maxRegionCost,
  )
  expect(sectionSolver.sectionSolver?.RIP_THRESHOLD_RAMP_ATTEMPTS).toBe(9)
  expect(sectionSolver.sectionSolver?.RIP_CONGESTION_REGION_COST_FACTOR).toBe(
    0.33,
  )
  expect(sectionSolver.sectionSolver?.MAX_ITERATIONS).toBe(4567)
  expect(sectionSolver.MAX_RIPS).toBe(20)
  expect(sectionSolver.sectionSolver?.MAX_RIPS).toBe(20)
  expect(
    sectionSolver.sectionSolver?.MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT,
  ).toBe(3)
  expect(
    sectionSolver.sectionSolver?.EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST,
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

test(
  "section pipeline searches multiple masks and commits an improving output on hg07 sample029",
  () => {
    const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
      serializedHyperGraph: datasetHg07.sample029,
    })

    pipelineSolver.solve()

    expect(pipelineSolver.solved).toBe(true)
    expect(pipelineSolver.failed).toBe(false)
    expect(pipelineSolver.stats.sectionSearchCandidateCount).toBeGreaterThan(1)
    expect(pipelineSolver.selectedSectionCandidateLabel).toBeDefined()
    expect(
      [...(pipelineSolver.selectedSectionMask ?? [])].some((value) => value === 1),
    ).toBe(true)

    const solveGraphOutput =
      pipelineSolver.getStageOutput<ReturnType<TinyHyperGraphSectionSolver["getOutput"]>>(
        "solveGraph",
      )
    const optimizeSectionOutput =
      pipelineSolver.getStageOutput<ReturnType<TinyHyperGraphSectionSolver["getOutput"]>>(
        "optimizeSection",
      )
    const unravelOutput =
      pipelineSolver.getStageOutput<ReturnType<TinyHyperGraphUnravelSolver["getOutput"]>>(
        "unravel",
      )

    expect(solveGraphOutput).toBeDefined()
    expect(optimizeSectionOutput).toBeDefined()
    expect(unravelOutput).toBeDefined()
    expect(
      getSerializedOutputMaxRegionCost(optimizeSectionOutput!),
    ).toBeLessThan(getSerializedOutputMaxRegionCost(solveGraphOutput!))
    expect(getSerializedOutputMaxRegionCost(unravelOutput!)).toBeLessThanOrEqual(
      getSerializedOutputMaxRegionCost(optimizeSectionOutput!),
    )
    expect(getSerializedOutputMaxRegionCost(pipelineSolver.getOutput()!)).toBe(
      getSerializedOutputMaxRegionCost(unravelOutput!),
    )
  },
  { timeout: 30000 },
)

test(
  "section pipeline accepts MAX_HOT_REGIONS through sectionSolverOptions",
  () => {
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
  },
  { timeout: 30000 },
)

test("section pipeline stage stats expose the unravel solver's own iteration count", () => {
  const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: datasetHg07.sample002,
  })

  pipelineSolver.solve()

  const unravelSolver =
    pipelineSolver.getSolver<TinyHyperGraphUnravelSolver>("unravel")

  expect(unravelSolver).toBeDefined()
  expect(pipelineSolver.getStageStats().unravel?.iterations).toBe(
    unravelSolver!.iterations,
  )
  expect(Number(pipelineSolver.stats.unravelSolverIterations)).toBe(
    unravelSolver!.iterations,
  )
  expect(Number(pipelineSolver.stats.unravelAttemptedCandidateCount)).toBe(
    Number(unravelSolver!.stats.attemptedCandidateCount),
  )
  expect(
    pipelineSolver.iterations - pipelineSolver.firstIterationOfStage.unravel!,
  ).toBe(unravelSolver!.iterations)
})

test("section pipeline runs the multi-section unravel stage across multiple roots on hg07 sample002", () => {
  const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: datasetHg07.sample002,
    unravelSolverOptions: {
      MAX_SECTIONS: 4,
      MAX_SECTION_ATTEMPTS_PER_ROOT_REGION: 1,
    },
  })

  pipelineSolver.solve()

  const unravelSolver =
    pipelineSolver.getSolver<TinyHyperGraphMultiSectionUnravelSolver>("unravel")

  expect(unravelSolver).toBeDefined()
  expect(Number(unravelSolver!.stats.sectionsCompleted)).toBeGreaterThan(1)
  expect(
    Array.isArray(unravelSolver!.stats.attemptedRootRegionIds)
      ? new Set(unravelSolver!.stats.attemptedRootRegionIds as number[]).size
      : 0,
  ).toBeGreaterThan(1)
})
