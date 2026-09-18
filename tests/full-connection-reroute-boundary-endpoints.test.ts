import { expect, test } from "bun:test"
import { sample005 } from "dataset-hg07"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import { FullConnectionRerouteSolver } from "../lib/full-connection-reroute-solver"
import { TinyHyperGraphSectionSolver } from "../lib/section-solver"
import { TinyHyperGraphSectionPipelineSolver } from "../lib/section-solver/TinyHyperGraphSectionPipelineSolver"

test("circuit005 can reroute boundary endpoints through the unblocked terminal side", () => {
  const baseline = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: sample005,
  })
  baseline.solve()
  const original = baseline.getOutput()!
  const loaded = loadSerializedHyperGraph(original)
  const initial = new TinyHyperGraphSectionSolver(
    loaded.topology,
    loaded.problem,
    loaded.solution,
  )
  const hotRegionId =
    initial.baselineSolver.state.regionIntersectionCaches.findIndex(
      (cache) => cache.existingRegionCost > 0,
    )
  const routesThroughHotRegion = new Set(
    initial.baselineSolver.state.regionSegments[hotRegionId]!.map(
      ([routeId]) => routeId,
    ),
  )
  // Every candidate touches the hot region at an endpoint. The previous filter skipped all six.
  expect(routesThroughHotRegion.size).toBe(6)
  for (const routeId of routesThroughHotRegion) {
    expect([
      ...loaded.topology.incidentPortRegion[
        loaded.problem.routeStartPort[routeId]!
      ]!,
      ...loaded.topology.incidentPortRegion[
        loaded.problem.routeEndPort[routeId]!
      ]!,
    ]).toContain(hotRegionId)
  }

  const reroute = new FullConnectionRerouteSolver(
    loaded.topology,
    loaded.problem,
    loaded.solution,
    {},
    {},
    original,
  )
  reroute.solve()
  expect(reroute.solved).toBe(true)
  expect(reroute.failed).toBe(false)
  expect(reroute.stats.rerouteAttempts).toBe(6)
  expect(reroute.stats.acceptedReroutes).toBeGreaterThan(0)

  const output = reroute.getOutput()
  const replay = loadSerializedHyperGraph(output)
  const final = new TinyHyperGraphSectionSolver(
    replay.topology,
    replay.problem,
    replay.solution,
  )
  expect(final.baselineSummary.maxRegionCost).toBeLessThan(
    initial.baselineSummary.maxRegionCost,
  )
  expect(final.baselineSummary.totalRegionCost).toBeLessThan(
    initial.baselineSummary.totalRegionCost,
  )
  expect(output.solvedRoutes).toHaveLength(original.connections!.length)
  expect(replay.problem.routeStartPort).toEqual(loaded.problem.routeStartPort)
  expect(replay.problem.routeEndPort).toEqual(loaded.problem.routeEndPort)
  let changedRoutes = 0
  for (let routeId = 0; routeId < loaded.problem.routeCount; routeId++) {
    if (
      JSON.stringify(replay.solution.solvedRoutePathSegments[routeId]) ===
      JSON.stringify(loaded.solution.solvedRoutePathSegments[routeId])
    )
      continue
    changedRoutes++
    expect(replay.solution.solvedRoutePathRegionIds![routeId]).not.toContain(
      hotRegionId,
    )
  }
  expect(changedRoutes).toBeGreaterThan(0)
})
