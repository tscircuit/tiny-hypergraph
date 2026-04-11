import { expect, test } from "bun:test"
import { convertPortPointPathingSolverInputToSerializedHyperGraph } from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphBusAwareSolver } from "lib/index"

test("CM5IO bus-aware pipeline routes every connection and drives the worst hotspot below 4.3", async () => {
  const input = await Bun.file(
    new URL("../fixtures/CM5IO_HyperGraph.json", import.meta.url),
  ).json()
  const serializedHyperGraph =
    convertPortPointPathingSolverInputToSerializedHyperGraph(input)
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  const solver = new TinyHyperGraphBusAwareSolver(topology, problem, {
    EXPLORATION_MAX_ITERATIONS: 50_000,
    COMPLETION_MAX_ITERATIONS: 200_000,
    HOTSPOT_REPAIR_MAX_ITERATIONS: 50_000,
    HOTSPOT_GROUP_REPAIR_ROUNDS: 5,
    HOTSPOT_GROUP_CANDIDATE_LIMIT: 6,
  })

  solver.solve()

  const output = solver.getOutput()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(output?.solvedRoutes).toHaveLength(problem.routeCount)
  expect(Number(solver.stats?.explorationBestRoutedCount)).toBeGreaterThan(150)
  expect(String(solver.stats?.finalStage)).toBe("hotspot_group_repair")
  expect(Number(solver.stats?.hotspotRepairCommittedGroupCount)).toBeGreaterThan(0)
  expect(Number(solver.stats?.finalMaxRegionCost)).toBeLessThan(4.3)
})
