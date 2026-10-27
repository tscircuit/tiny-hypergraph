import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
  type TinyHyperGraphProblem,
  type Candidate,
} from "../lib/core"
import { ParallelRegionCostPool } from "../lib/parallel/ParallelRegionCostPool"
import { createRegionCostExecutor } from "./fixtures/createRegionCostExecutor"

test("dense region row chunks cover every pair and rebuild exactly for owned-net changes", async () => {
  const executor = createRegionCostExecutor(4)
  const count = 192
  const topology: TinyHyperGraphTopology = {
    portCount: count,
    regionCount: 1,
    regionIncidentPorts: [Array.from({ length: count }, (_, i) => i)],
    incidentPortRegion: Array.from({ length: count }, () => [0]),
    portX: Float64Array.from({ length: count }, (_, i) =>
      Math.cos((i * Math.PI * 2) / count),
    ),
    portY: Float64Array.from({ length: count }, (_, i) =>
      Math.sin((i * Math.PI * 2) / count),
    ),
    portZ: Int32Array.from({ length: count }, (_, i) => i % 2),
    portAngleForRegion1: Int32Array.from({ length: count }, (_, i) =>
      Math.round((i * 36000) / count),
    ),
    regionAvailableZMask: Int32Array.of(3),
    regionCenterX: Float64Array.of(0),
    regionCenterY: Float64Array.of(0),
    regionWidth: Float64Array.of(2),
    regionHeight: Float64Array.of(2),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    routeStartPort: Int32Array.of(1, 0),
    routeEndPort: Int32Array.of(count - 1, count / 2),
    routeNet: Int32Array.of(7, 11),
    regionNetId: Int32Array.of(-1),
    portSectionMask: new Int8Array(count).fill(1),
    initialAssignments: [
      { routeId: 1, regionId: 0, fromPortId: 0, toPortId: count / 2 },
    ],
  }
  const solver = new TinyHyperGraphSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
  })
  const pool = new ParallelRegionCostPool(solver, executor)
  try {
    await pool.start()
    const candidate: Candidate = {
      portId: 0,
      nextRegionId: 0,
      f: 0,
      g: 1.2345,
      h: 0,
    }
    for (const net of [7, 11, 7]) {
      solver.state.currentRouteNetId = net
      await pool.prepare(net)
      for (let from = 0; from < count; from++)
        for (let to = 0; to < count; to++) {
          candidate.portId = from
          solver.regionCostProvider = undefined
          const expected = solver.computeG(candidate, to)
          solver.regionCostProvider = (current, neighbor) =>
            pool.lookup(current, neighbor)
          expect(solver.computeG(candidate, to)).toBe(expected)
        }
      solver.regionCostProvider = undefined
    }
    expect(pool.maximumParticipatingWorkers).toBe(4)
    expect(pool.totals.tables).toBe(3)
    expect(pool.totals.cells).toBe((3 * count * (count + 1)) / 2)
    expect(pool.cacheMisses).toBe(0)
  } finally {
    solver.regionCostProvider = undefined
    await pool.dispose()
    executor.dispose()
  }
})
