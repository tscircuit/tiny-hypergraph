import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "../../lib/core"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"
import { DistanceAwareTinyHyperGraphSolver } from "../../lib/distance-aware-tiny-hypergraph-solver"
import { OutsideInPartialRipTinyHyperGraphSolver } from "../../lib/outside-in-partial-rip-tiny-hypergraph-solver"
import { createNativePermissionFixture, permissionSolveOptions } from "../fixtures/portPermissions.fixture"

test("layer-change permissions move vias to a legal region without blocking planar traversal or owner vias", () => {
  for (const Solver of [TinyHyperGraphSolver, PreparedPortPointRoutingSolver, DistanceAwareTinyHyperGraphSolver, OutsideInPartialRipTinyHyperGraphSolver]) {
    for (const precheck of [false, true]) {
      for (const frontier of [false, true]) {
        for (const ownerAllowed of [false, true]) {
          const { topology, problem } = createNativePermissionFixture()
          delete problem.portNetId
          topology.portZ[1] = 1
          topology.portZ[2] = 0
          topology.portZ[3] = 1
          problem.regionLayerChangeAllowedNetIds = [undefined, new Set(ownerAllowed ? [0] : []), undefined, undefined]
          const solver = new Solver(topology, problem, { ...permissionSolveOptions, STATIC_REACHABILITY_PRECHECK: precheck, OWNED_REGIONAL_HOP_FRONTIER: frontier })
          solver.solve()
          expect(solver.solved && !solver.failed).toBe(true)
          expect(solver.state.regionSegments[1]).toEqual([[0, 0, ownerAllowed ? 1 : 2]])
          expect(solver.state.regionSegments[2]).toEqual([[0, ownerAllowed ? 1 : 2, 3]])
          if (!ownerAllowed) {
            expect(topology.portZ[solver.state.regionSegments[1]![0]![1]]).toBe(topology.portZ[solver.state.regionSegments[1]![0]![2]])
          }
        }
        const { topology, problem } = createNativePermissionFixture()
        problem.portSectionMask[1] = 0
        problem.regionLayerChangeAllowedNetIds = [undefined, new Set([1]), new Set([1]), undefined]
        const solver = new Solver(topology, problem, { ...permissionSolveOptions, STATIC_REACHABILITY_PRECHECK: precheck, OWNED_REGIONAL_HOP_FRONTIER: frontier })
        solver.solve()
        expect(solver.solved && !solver.failed).toBe(false)
        topology.portZ.fill(0)
        const planar = new Solver(topology, problem, permissionSolveOptions)
        planar.solve()
        expect(planar.solved && !planar.failed).toBe(true)
      }
    }
  }
  const legacy = createNativePermissionFixture()
  const explicitFree = structuredClone(legacy)
  explicitFree.problem.regionLayerChangeAllowedNetIds = Array.from({ length: 4 }, () => undefined)
  const a = new PreparedPortPointRoutingSolver(legacy.topology, legacy.problem, permissionSolveOptions)
  const b = new PreparedPortPointRoutingSolver(explicitFree.topology, explicitFree.problem, permissionSolveOptions)
  a.solve()
  b.solve()
  expect(a.state.regionSegments).toEqual(b.state.regionSegments)
  expect(a.iterations).toBe(b.iterations)
})
