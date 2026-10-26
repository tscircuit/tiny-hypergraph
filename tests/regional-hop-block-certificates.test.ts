import { expect, test } from "bun:test"
import {
  checkRegionalBlockList,
  createRegionalBlockFixture,
  expandRegionalBlockFixture,
  seedRegionalBlockCosts,
  snapshotRegionalBlockSolver,
} from "./fixtures/regional-blocks"

test("regional block certificates preserve ordered decisions across closure and resets", (): void => {
  for (const transition of [
    "none",
    "close-tail",
    "close-block",
    "lower-cost",
    "increase-cost",
    "nan-cost",
    "clear",
    "generation-wrap",
    "neighbors",
    "net",
    "goal",
  ]) {
    const original = createRegionalBlockFixture({ owned: false })
    const optimized = createRegionalBlockFixture({ owned: true })
    for (const solver of [original, optimized]) {
      seedRegionalBlockCosts(solver)
      expandRegionalBlockFixture(solver, { portId: 64, g: 10 })
    }
    expect(snapshotRegionalBlockSolver(optimized)).toEqual(
      snapshotRegionalBlockSolver(original),
    )
    const frontier = optimized["regionalHopFrontiers"].get(0)!
    expect([...frontier.blockBestCostBounds!.slice(0, 4)]).toEqual([
      1, 1, 1, 1,
    ])
    let recomputedBlocks = 0
    const updateBound = optimized["updateRegionalHopBlockBound"].bind(optimized)
    optimized["updateRegionalHopBlockBound"] = (...args): void => {
      recomputedBlocks++
      updateBound(...args)
    }
    for (const solver of [original, optimized]) {
      if (transition === "close-tail" || transition === "close-block") {
        const ports =
          transition === "close-tail"
            ? [15, 31, 47, 63]
            : Array.from({ length: 16 }, (_, portId) => portId + 16)
        for (const portId of ports) {
          solver.state.candidateQueue.queue({
            hopId: solver.getHopId(portId, 1),
            portId,
            nextRegionId: 1,
            g: 1,
            h: 0,
            f: 1,
          })
          solver.state.candidateQueue.dequeue()
        }
      }
      if (transition === "lower-cost") {
        solver.setCandidateBestCost(solver.getHopId(20, 1), 0.5)
      }
      if (transition === "increase-cost" || transition === "nan-cost") {
        solver.setCandidateBestCost(
          solver.getHopId(20, 1),
          transition === "increase-cost" ? 100 : NaN,
        )
      }
      if (transition === "clear") solver.state.candidateQueue.clear()
      if (transition === "generation-wrap") {
        solver.state.candidateBestCostGeneration = 0xffffffff
        solver.resetCandidateBestCosts()
      }
      if (transition === "neighbors") {
        solver.topology.regionIncidentPorts[0] = [
          ...solver.topology.regionIncidentPorts[0],
        ].reverse()
      }
      if (transition === "net") solver.state.currentRouteNetId = 8
      if (transition === "goal") solver.state.goalPortId = 20
      expandRegionalBlockFixture(solver, { portId: 65, g: 10 })
    }
    expect(snapshotRegionalBlockSolver(optimized), transition).toEqual(
      snapshotRegionalBlockSolver(original),
    )
    checkRegionalBlockList(optimized)
    if (["none", "close-tail", "close-block", "lower-cost"].includes(transition)) {
      expect(recomputedBlocks, transition).toBe(1)
    }
  }
})
