import { expect, test } from "bun:test"
import {
  checkRegionalBlockList,
  createRegionalBlockFixture,
  expandRegionalBlockFixture,
  serializeRegionalBlockSolver,
} from "./fixtures/regional-blocks"

type RandomState = { seed: number }

const nextRandom = (random: RandomState): number => {
  random.seed ^= random.seed << 13
  random.seed ^= random.seed >>> 17
  random.seed ^= random.seed << 5
  random.seed >>>= 0
  return random.seed / 0x100000000
}

test("wide regional blocks match the original loop on changing random costs", (): void => {
  const random: RandomState = { seed: 0xa125f319 }
  const costs = [0, 0.5, 1, 10, 100, Infinity, NaN]
  for (let scene = 0; scene < 200; scene++) {
    const original = createRegionalBlockFixture({ owned: false })
    const optimized = createRegionalBlockFixture({ owned: true })
    const neighbors = [...original.topology.regionIncidentPorts[0]]
    for (let index = neighbors.length - 1; index > 0; index--) {
      const other = Math.floor(nextRandom(random) * (index + 1))
      ;[neighbors[index], neighbors[other]] = [
        neighbors[other],
        neighbors[index],
      ]
    }
    if (scene % 2 === 0) neighbors.push(...neighbors.slice(16, 32))
    for (const solver of [original, optimized]) {
      solver.topology.regionIncidentPorts[0] = [...neighbors]
    }
    for (let portId = 0; portId < 64; portId++) {
      const cost = costs[Math.floor(nextRandom(random) * costs.length)]!
      const masked = nextRandom(random) < 0.05
      const occupied = nextRandom(random) < 0.05
      for (const solver of [original, optimized]) {
        solver.problem.portSectionMask[portId] = masked ? 0 : 1
        solver.state.portAssignment[portId] = occupied ? 9 : -1
        solver.setCandidateBestCost(solver.getHopId(portId, 1), cost)
      }
    }
    for (let step = 0; step < 8; step++) {
      const g = [0, 1, 10, 100][Math.floor(nextRandom(random) * 4)]!
      for (const solver of [original, optimized]) {
        if (step === 4) {
          solver.state.candidateQueue.clear()
          solver.resetCandidateBestCosts()
        }
        if (solver.state.currentRouteId === undefined) {
          solver.state.currentRouteId = 0
          solver.state.currentRouteNetId = 7
        }
        expandRegionalBlockFixture(solver, { portId: 64 + step, g })
      }
      expect(serializeRegionalBlockSolver(optimized), `${scene}/${step}`).toBe(
        serializeRegionalBlockSolver(original),
      )
      checkRegionalBlockList(optimized)
    }
  }
})
