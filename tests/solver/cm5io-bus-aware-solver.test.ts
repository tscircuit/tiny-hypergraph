import { expect, test } from "bun:test"
import { convertPortPointPathingSolverInputToSerializedHyperGraph } from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphBusAwareSolver } from "lib/index"

test("CM5IO bus-aware pipeline routes every connection and drives the worst hotspot below 2.6", async () => {
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
    ALTERNATING_REPAIR_CYCLES: 3,
    REPRESENTATIVE_CORRIDOR_ROUNDS: 3,
    REPRESENTATIVE_CORRIDOR_CANDIDATE_LIMIT: 6,
    HOTSPOT_GROUP_REPAIR_ROUNDS: 5,
    HOTSPOT_GROUP_CANDIDATE_LIMIT: 6,
    SECTION_POLISH_ROUNDS: 3,
    SECTION_POLISH_MAX_HOT_REGIONS: 4,
    SECTION_POLISH_MAX_ITERATIONS: 500_000,
  })

  solver.solve()

  const output = solver.getOutput()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(output?.solvedRoutes).toHaveLength(problem.routeCount)
  expect(Number(solver.stats?.explorationBestRoutedCount)).toBeGreaterThan(150)
  expect(String(solver.stats?.finalStage)).toBe("representative_corridor_polish")
  expect(Number(solver.stats?.alternatingRepairCycleCount)).toBeGreaterThan(1)
  expect(Number(solver.stats?.hotspotRepairCommittedGroupCount)).toBeGreaterThan(0)
  expect(Number(solver.stats?.sectionPolishCommittedCount)).toBeGreaterThan(0)
  expect(
    Number(solver.stats?.representativeCorridorCommittedGroupCount),
  ).toBeGreaterThan(0)
  expect(String(solver.stats?.representativeCorridorCommittedGroupIds)).toContain(
    "bus-41-55a",
  )
  expect(Number(solver.stats?.finalMaxRegionCost)).toBeLessThan(2.6)
})
