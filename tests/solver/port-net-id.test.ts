import { expect, test } from "bun:test"
import { TinyHyperGraphSolver, type TinyHyperGraphProblem } from "../../lib/core"
import {
  createNativePermissionFixture,
  getUsedRoutePortIds,
  permissionSolveOptions,
} from "../fixtures/portPermissions.fixture"

test("sole port owners use distinct ports while foreign nets, blocked endpoints, and invalid native restrictions are rejected", () => {
  for (const precheck of [false, true]) {
    for (const frontier of [false, true]) {
      for (const netId of [0, 1, 2]) {
        const { topology, problem } = createNativePermissionFixture(netId)
        problem.portNetId![2] = 1
        const solver = new TinyHyperGraphSolver(topology, problem, {
          ...permissionSolveOptions,
          STATIC_REACHABILITY_PRECHECK: precheck,
          OWNED_REGIONAL_HOP_FRONTIER: frontier,
        })
        solver.solve()
        expect(solver.solved && !solver.failed).toBe(netId !== 2)
        if (netId === 2) {
          expect(getUsedRoutePortIds(solver)).not.toContain(1)
          expect(getUsedRoutePortIds(solver)).not.toContain(2)
        } else {
          expect(getUsedRoutePortIds(solver)).toContain(netId === 0 ? 1 : 2)
          expect(getUsedRoutePortIds(solver)).not.toContain(netId === 0 ? 2 : 1)
        }
      }
      for (const blockedPort of [0, 1, 3]) {
        const { topology, problem } = createNativePermissionFixture()
        problem.portNetId = Int32Array.from({ length: 4 }, (_, portId) => portId === blockedPort ? -2 : -1)
        problem.portSectionMask[2] = 0
        const options = {
          ...permissionSolveOptions,
          STATIC_REACHABILITY_PRECHECK: precheck,
          OWNED_REGIONAL_HOP_FRONTIER: frontier,
        }
        if (blockedPort !== 1) {
          expect(() => new TinyHyperGraphSolver(topology, problem, options)).toThrow("does not allow")
          continue
        }
        const solver = new TinyHyperGraphSolver(topology, problem, options)
        solver.solve()
        expect(solver.solved && !solver.failed).toBe(false)
        expect(solver.failed).toBe(true)
      }
    }
  }
  for (const requiredNetId of [-1, 0, -2, 1]) {
    const { topology, problem } = createNativePermissionFixture()
    problem.routeEndPort[0] = 0
    problem.portNetId = Int32Array.of(requiredNetId, -1, -1, -1)
    if (requiredNetId === -2 || requiredNetId === 1) {
      expect(() => new TinyHyperGraphSolver(topology, problem, permissionSolveOptions)).toThrow("does not allow")
      continue
    }
    const solver = new TinyHyperGraphSolver(topology, problem, permissionSolveOptions)
    solver.solve()
    expect(solver.solved && !solver.failed).toBe(true)
  }
  const legacy = createNativePermissionFixture(2)
  delete legacy.problem.portNetId
  const legacySolver = new TinyHyperGraphSolver(legacy.topology, legacy.problem, permissionSolveOptions)
  legacySolver.solve()
  expect(legacySolver.solved).toBe(true)
  expect(getUsedRoutePortIds(legacySolver)).toContain(1)
  for (const invalid of [[], [-1, 0, -1, -1], new Int32Array(), Int32Array.of(-1, -3, -1, -1), Float64Array.of(-1, 0.5, -1, -1), Float64Array.of(-1, NaN, -1, -1)]) {
    const { topology, problem } = createNativePermissionFixture()
    problem.portNetId = invalid as unknown as TinyHyperGraphProblem["portNetId"]
    expect(() => new TinyHyperGraphSolver(topology, problem, permissionSolveOptions)).toThrow()
  }
})
