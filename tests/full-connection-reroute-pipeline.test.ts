import { expect, test } from "bun:test"
import { TinyHyperGraphSectionPipelineSolver } from "../lib/section-solver/TinyHyperGraphSectionPipelineSolver"
import { FullConnectionRerouteSolver } from "../lib/full-connection-reroute-solver"
import { sectionSolverFixtureGraph } from "./fixtures/section-solver.fixture"

test("pipeline consumes full-connection reroutes before section optimization", () => {
  const solver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: structuredClone(sectionSolverFixtureGraph),
    fullConnectionReroute: {},
    createSectionMask: ({ topology }) => new Int8Array(topology.portCount),
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const reroute = solver.getSolver<FullConnectionRerouteSolver>("rerouteFullConnections")!
  expect(reroute.solved).toBe(true)
  expect(reroute.stats.finalMaxRegionCost).toBeLessThanOrEqual(reroute.stats.initialMaxRegionCost)
  expect(solver.getOutput()).toEqual(reroute.getOutput())
})
