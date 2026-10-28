import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSectionSolver } from "../../lib/section-solver"
import { TinyHyperGraphSectionPipelineSolver } from "../../lib/section-solver/TinyHyperGraphSectionPipelineSolver"
import { createSectionSolverFixturePortMask, sectionSolverFixtureGraph } from "../fixtures/section-solver.fixture"

test("section problem clones and candidate replay retain explicit boundary-order metadata", () => {
  const graph = structuredClone(sectionSolverFixtureGraph)
  graph.regions[0].d!.boundaryPortOrderPreserved = true
  const { topology, problem, solution } = loadSerializedHyperGraph(graph)
  expect(problem.regionBoundaryPortOrderPreserved?.[0]).toBe(1)
  problem.portSectionMask = createSectionSolverFixturePortMask(topology)
  const options = { MAX_ITERATIONS: 5_000, RIP_THRESHOLD_RAMP_ATTEMPTS: 0, GREEDY_FINAL_ROUTE_ITERS: 0 }
  const section = new TinyHyperGraphSectionSolver(topology, problem, solution, options)
  section.setup()
  expect(section.sectionSolver!.problem.regionBoundaryPortOrderPreserved).toEqual(problem.regionBoundaryPortOrderPreserved)
  section.solve()
  expect(section.solved && !section.failed).toBe(true)
  const pipelineGraph = structuredClone(graph)
  for (const route of pipelineGraph.solvedRoutes ?? []) {
    for (let index = 1; index < route.path.length; index++) {
      const from = route.path[index - 1], to = route.path[index]
      const region = pipelineGraph.regions.find((candidate) => candidate.regionId === from.nextRegionId)!
      region.assignments ??= []
      region.assignments.push({ connectionId: route.connection.connectionId, regionPort1Id: from.portId, regionPort2Id: to.portId })
    }
  }
  const pipeline = new TinyHyperGraphSectionPipelineSolver({ serializedHyperGraph: pipelineGraph,
    solveGraphOptions: options, sectionSolverOptions: options })
  pipeline.solve()
  expect(pipeline.solved && !pipeline.failed).toBe(true)
  expect(Number(pipeline.stats.sectionSearchCandidateCount)).toBeGreaterThan(0)
  for (const output of [section.getOutput(), pipeline.getOutput()]) {
    const replay = loadSerializedHyperGraph(output!)
    expect(replay.problem.regionBoundaryPortOrderPreserved).toEqual(problem.regionBoundaryPortOrderPreserved)
    expect(output!.regions[0].d!.boundaryPortOrderPreserved).toBe(true)
  }
})
