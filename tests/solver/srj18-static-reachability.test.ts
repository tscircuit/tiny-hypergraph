import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/core"
import {
  createStaticallyUnroutableRouteSummary,
  getStaticallyUnroutableRoutes,
} from "lib/static-reachability"

test("srj18 sample004 passes static reachability precheck", () => {
  const sample = JSON.parse(
    readFileSync(
      "node_modules/dataset-srj18/generated-datasets/srj18/sample004.hg.json",
      "utf8",
    ),
  ) as SerializedHyperGraph
  const { topology, problem } = loadSerializedHyperGraph(sample)
  const solver = new TinyHyperGraphSolver(topology, problem)

  const staticallyUnroutableRoutes = getStaticallyUnroutableRoutes({
    topology,
    problem,
    problemSetup: solver.problemSetup,
    portAssignment: solver.state.portAssignment,
    routeIds: solver.state.unroutedRoutes,
    maxPrecheckHops: solver.STATIC_REACHABILITY_PRECHECK_MAX_HOPS,
    getStartingNextRegionId: (routeId, startingPortId) =>
      solver.getStartingNextRegionId(routeId, startingPortId),
    getRouteSummary: (routeId) =>
      createStaticallyUnroutableRouteSummary({
        problem,
        routeId,
      }),
  })

  expect(staticallyUnroutableRoutes).toEqual([])
})
