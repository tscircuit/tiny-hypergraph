import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { PreparedPortPointRoutingSolver } from "lib/prepared/PreparedPortPointRoutingSolver"

test("checks the destination crossing before accepting a route without via space", (): void => {
  for (const Solver of [TinyHyperGraphSolver, PreparedPortPointRoutingSolver]) {
    for (const frontier of [false, true]) {
      for (const completion of [false, true]) {
        for (const [enforceViaSpace, regionSize, expectedSolved] of [
          [true, 0.2, false],
          [true, 1, true],
          [false, 0.2, true],
        ] as const) {
          const solver = new Solver(
            {
              portCount: 6,
              regionCount: 5,
              regionIncidentPorts: [[0, 1, 2, 3], [4, 0], [1], [5, 2], [3]],
              incidentPortRegion: [[1, 0], [0, 2], [3, 0], [0, 4], [1], [3]],
              regionWidth: new Float64Array([regionSize, 1, 1, 1, 1]),
              regionHeight: new Float64Array([regionSize, 1, 1, 1, 1]),
              regionCenterX: new Float64Array([0, -0.6, 0.6, 0, 0]),
              regionCenterY: new Float64Array([0, 0, 0, -0.6, 0.6]),
              regionAvailableZMask: new Int32Array([3, 1, 1, 1, 1]),
              portAngleForRegion1: new Int32Array([
                0, 0, 9000, 9000, 18000, 27000,
              ]),
              portAngleForRegion2: new Int32Array([
                18000, 18000, 27000, 27000, 0, 0,
              ]),
              portX: new Float64Array([-0.1, 0.1, 0, 0, -0.6, 0]),
              portY: new Float64Array([0, 0, -0.1, 0.1, 0, -0.6]),
              portZ: new Int32Array(6),
            },
            {
              routeCount: 2,
              portSectionMask: new Int8Array(6).fill(1),
              routeStartPort: new Int32Array([4, 5]),
              routeEndPort: new Int32Array([1, 3]),
              routeNet: new Int32Array([0, 1]),
              regionNetId: new Int32Array([-1, 0, 0, 1, 1]),
            },
            {
              minViaPadDiameter: 0.3,
              ENFORCE_VIA_SPACE: enforceViaSpace,
              ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
              GREEDY_FINAL_ROUTE_ITERS: 1,
              MAX_ITERATIONS: 100,
              STATIC_REACHABILITY_PRECHECK: false,
              OWNED_REGIONAL_HOP_FRONTIER: frontier,
              USE_SPARSE_CANDIDATE_STORAGE: false,
            },
          )
          if (completion) solver.tryFinalAcceptance()
          else solver.solve()
          expect({
            solver: Solver.name,
            frontier,
            completion,
            enforceViaSpace,
            regionSize,
            solved: solver.solved,
          }).toEqual({
            solver: Solver.name,
            frontier,
            completion,
            enforceViaSpace,
            regionSize,
            solved: expectedSolved,
          })
          if (expectedSolved) {
            expect(
              new Set(solver.state.regionSegments[0].map(([route]) => route))
                .size,
            ).toBe(2)
          }
        }
      }
    }
  }
})
