import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSectionSolver } from "lib/section-solver"
import { createSectionSolverFixturePortMask, sectionSolverFixtureGraph } from "../fixtures/section-solver.fixture"

test("section subproblems retain immutable copper instead of dropping the optional physical cost model", () => {
  const graph = structuredClone(sectionSolverFixtureGraph)
  for (const region of graph.regions) {
    region.d = {...region.d, fixedCopperTraceWidth: 0.1, fixedCopperSegments: [
      {netId: null, x1: 1000, y1: 1000, x2: 1001, y2: 1001, z: 0, width: 0.1, clearance: 0.1},
    ]}
  }
  const {topology, problem, solution} = loadSerializedHyperGraph(graph)
  problem.portSectionMask = createSectionSolverFixturePortMask(topology)
  const section = new TinyHyperGraphSectionSolver(topology, problem, solution, {MAX_ITERATIONS: 5000, RIP_THRESHOLD_RAMP_ATTEMPTS: 0, GREEDY_FINAL_ROUTE_ITERS: 0})
  section.setup()
  expect(section.sectionSolver).toBeDefined()
  expect(section.sectionSolver!.problem.fixedCopperSegmentsByRegion).toEqual(problem.fixedCopperSegmentsByRegion)
  expect(section.sectionSolver!.problem.fixedCopperTraceWidthByRegion).toEqual(problem.fixedCopperTraceWidthByRegion)
  section.solve()
  expect(section.solved).toBe(true)
  expect(section.failed).toBe(false)
})
