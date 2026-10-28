import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSectionSolver } from "../../lib/section-solver"
import { TinyHyperGraphSectionPipelineSolver } from "../../lib/section-solver/TinyHyperGraphSectionPipelineSolver"
import { createSectionSolverFixturePortMask, sectionSolverFixtureGraph } from "../fixtures/section-solver.fixture"

test("section clones, candidate masks, and serialized replay preserve prohibited shortcuts", () => {
  const graph = structuredClone(sectionSolverFixtureGraph)
  for (const port of graph.ports) {
    if (["b0t", "c0t"].includes(port.portId)) port.d!.allowedNetId = "net-1"
    if (["b1b", "c1b"].includes(port.portId)) port.d!.allowedNetId = "net-0"
  }
  const { topology, problem, solution } = loadSerializedHyperGraph(graph)
  problem.portSectionMask = createSectionSolverFixturePortMask(topology)
  const section = new TinyHyperGraphSectionSolver(topology, problem, solution, { MAX_ITERATIONS: 5_000, RIP_THRESHOLD_RAMP_ATTEMPTS: 0, GREEDY_FINAL_ROUTE_ITERS: 0 })
  section.setup()
  expect(section.sectionSolver).toBeDefined()
  expect(section.sectionSolver!.problem.portNetId).toEqual(problem.portNetId)
  section.solve()
  expect(section.solved).toBe(true)
  expect(section.failed).toBe(false)

  const pipelineGraph = structuredClone(graph)
  for (const route of pipelineGraph.solvedRoutes ?? []) {
    for (let index = 1; index < route.path.length; index++) {
      const from = route.path[index - 1]!
      const to = route.path[index]!
      const region = pipelineGraph.regions.find((candidate) => candidate.regionId === from.nextRegionId)!
      region.assignments ??= []
      region.assignments.push({
        connectionId: route.connection.connectionId,
        regionPort1Id: from.portId,
        regionPort2Id: to.portId,
      })
    }
  }
  const pipeline = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: pipelineGraph,
    solveGraphOptions: { MAX_ITERATIONS: 5_000, RIP_THRESHOLD_RAMP_ATTEMPTS: 0, GREEDY_FINAL_ROUTE_ITERS: 0 },
    sectionSolverOptions: { MAX_ITERATIONS: 5_000, RIP_THRESHOLD_RAMP_ATTEMPTS: 0, GREEDY_FINAL_ROUTE_ITERS: 0 },
  })
  pipeline.solve()
  expect(pipeline.solved).toBe(true)
  expect(pipeline.failed).toBe(false)
  expect(Number(pipeline.stats.sectionSearchCandidateCount)).toBeGreaterThan(0)
  for (const output of [section.getOutput(), pipeline.getOutput()]) {
    if (!output) throw new Error("Solved section pipeline did not return a graph")
    for (const route of output.solvedRoutes ?? []) {
      const prohibited = route.connection.mutuallyConnectedNetworkId === "net-0" ? ["b0t", "c0t"] : ["b1b", "c1b"]
      expect(route.path.some((point) => prohibited.includes(point.portId))).toBe(false)
    }
    const replay = loadSerializedHyperGraph(output)
    const portIndex = output.ports.findIndex((port) => port.portId === "b0t")
    expect(replay.problem.portNetId?.[portIndex]).toBe(1)
  }
})
