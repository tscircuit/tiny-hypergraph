import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type Candidate,
  type TinyHyperGraphTopology,
  type TinyHyperGraphProblem,
} from "../lib/core"
import { ParallelRegionCostPool } from "../lib/parallel/ParallelRegionCostPool"
import { createRegionCostExecutor } from "./fixtures/createRegionCostExecutor"

test("parallel region tables preserve exact costs for owned nets, crossing restrictions and cache changes", async () => {
  const executor = createRegionCostExecutor(4)
  try {
    for (const mask of [1, 3]) {
      const topology: TinyHyperGraphTopology = {
        portCount: 4,
        regionCount: 1,
        regionIncidentPorts: [[0, 1, 2, 3]],
        incidentPortRegion: [[0], [0], [0], [0]],
        portX: Float64Array.of(1, 0, -1, 0),
        portY: Float64Array.of(0, 1, 0, -1),
        portZ: Int32Array.of(0, 0, 0, 1),
        portAngleForRegion1: Int32Array.of(0, 9000, 18000, 27000),
        regionWidth: Float64Array.of(2),
        regionHeight: Float64Array.of(2),
        regionCenterX: Float64Array.of(0),
        regionCenterY: Float64Array.of(0),
        regionAvailableZMask: Int32Array.of(mask),
      }
      const problem: TinyHyperGraphProblem = {
        routeCount: 3,
        routeStartPort: Int32Array.of(0, 0, 1),
        routeEndPort: Int32Array.of(2, 2, 3),
        routeNet: Int32Array.of(7, 11, 12),
        regionNetId: Int32Array.of(-1),
        portSectionMask: new Int8Array(4).fill(1),
        portPenalty: Float64Array.of(0, 0.25, Infinity, 0.125),
        initialAssignments: [
          { routeId: 1, regionId: 0, fromPortId: 0, toPortId: 2 },
        ],
      }
      const solver = new TinyHyperGraphSolver(topology, problem, {
        TRACE_DENSITY_COST_FACTOR: 0.7,
        STATIC_REACHABILITY_PRECHECK: false,
      })
      const pool = new ParallelRegionCostPool(solver, executor)
      try {
        await pool.start()
        for (let update = 0; update < 2; update++) {
          await pool.prepare()
          for (const net of [7, 11, 12])
            for (let from = 0; from < 4; from++)
              for (let to = 0; to < 4; to++) {
                solver.state.currentRouteNetId = net
                const candidate: Candidate = {
                  portId: from,
                  nextRegionId: 0,
                  f: 0,
                  g: 0.3456789,
                  h: 0,
                }
                solver.regionCostProvider = undefined
                const expected = solver.computeG(candidate, to)
                solver.regionCostProvider = (current, neighbor) =>
                  pool.lookup(current, neighbor)
                expect(solver.computeG(candidate, to)).toBe(expected)
                solver.regionCostProvider = undefined
              }
          if (update === 0) {
            solver.state.currentRouteNetId = 12
            solver.appendSegmentToRegionCache(0, 1, 3)
            solver.state.regionCongestionCost[0] = 0.45678
          }
        }
        expect(pool.cacheHits).toBeGreaterThan(0)
        expect(pool.cacheMisses).toBeGreaterThan(0)
      } finally {
        solver.regionCostProvider = undefined
        await pool.dispose()
      }
    }
  } finally {
    executor.dispose()
  }
})
