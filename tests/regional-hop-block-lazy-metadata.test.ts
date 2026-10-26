import { expect, test } from "bun:test"
import {
  createRegionalBlockFixture,
  expandRegionalBlockFixture,
  seedRegionalBlockCosts,
  snapshotRegionalBlockSolver,
} from "./fixtures/regional-blocks"

const runRegionalBlockMetadataCase = ({
  owned,
  variant,
}: {
  owned: boolean
  variant: string
}): {
  error: string | undefined
  getterCalls: number
  setterCalls: number
  injectedIncreases: number
  solver: unknown
} => {
  const solver = createRegionalBlockFixture({ owned, goalPortId: 20 })
  if (variant === "reserved-goal") solver.state.portAssignment[20] = 9
  if (variant === "duplicates") {
    solver.topology.regionIncidentPorts[0] =
      solver.topology.regionIncidentPorts[0].flatMap((portId) => [
        portId,
        portId,
      ])
  }
  if (variant === "invalid-first" || variant === "masked-invalid") {
    delete solver.topology.incidentPortRegion[19]
    if (variant === "masked-invalid") solver.problem.portSectionMask[19] = 0
  }
  if (variant === "earlier-score-error") {
    solver.computeG = (): number => {
      throw new Error("Earlier scoring failure")
    }
  } else if (variant !== "invalid-first" && variant !== "masked-invalid") {
    seedRegionalBlockCosts(solver)
  }
  let getterCalls = 0
  let setterCalls = 0
  let injectedIncreases = 0
  if (variant === "custom-getter") {
    const getCost = solver.getCandidateBestCost.bind(solver)
    solver.getCandidateBestCost = (hopId): number => {
      getterCalls++
      return getCost(hopId)
    }
  }
  if (variant === "custom-setter") {
    const setCost = solver.setCandidateBestCost.bind(solver)
    solver.setCandidateBestCost = (hopId, cost): void => {
      setterCalls++
      setCost(hopId, cost)
    }
  }
  let error: string | undefined
  try {
    expandRegionalBlockFixture(solver, { portId: 64, g: 10 })
    if (variant === "reserved-goal") {
      solver.state.portAssignment[20] = -1
      expandRegionalBlockFixture(solver, { portId: 65, g: 10 })
    }
    if (variant === "active-increase") {
      solver.state.currentRouteId = 0
      solver.state.currentRouteNetId = 7
      solver.state.goalPortId = 73
      solver.state.candidateQueue.clear()
      solver.resetCandidateBestCosts()
      seedRegionalBlockCosts(solver)
      solver.state.portAssignment[0] = 9
      solver.setCandidateBestCost(solver.getHopId(1, 1), 100)
      expandRegionalBlockFixture(solver, { portId: 66, g: 10 })
      const computeG = solver.computeG.bind(solver)
      solver.computeG = (...args): number => {
        injectedIncreases++
        solver.setCandidateBestCost(solver.getHopId(40, 1), 100)
        return computeG(...args)
      }
      expandRegionalBlockFixture(solver, { portId: 0, g: 10 })
    }
  } catch (caught) {
    error = (caught as Error).message
  }
  return {
    error,
    getterCalls,
    setterCalls,
    injectedIncreases,
    solver: snapshotRegionalBlockSolver(solver),
  }
}

test("block pruning preserves early goals, callback errors and unknown metadata", (): void => {
  for (const variant of [
    "reserved-goal",
    "masked-invalid",
    "invalid-first",
    "earlier-score-error",
    "custom-getter",
    "custom-setter",
    "active-increase",
    "duplicates",
  ]) {
    const original = runRegionalBlockMetadataCase({ owned: false, variant })
    expect(
      runRegionalBlockMetadataCase({ owned: true, variant }),
      variant,
    ).toEqual(original)
    if (variant === "invalid-first") expect(original.error).toBeDefined()
    else if (variant === "earlier-score-error") {
      expect(original.error).toBe("Earlier scoring failure")
    } else expect(original.error).toBeUndefined()
    if (variant === "active-increase") {
      expect(original.injectedIncreases).toBeGreaterThan(0)
    }
  }
})
