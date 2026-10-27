import { expect, test } from "bun:test"
import {
  DistanceAwareTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

const createSolver = (owned: boolean): DistanceAwareTinyHyperGraphSolver => {
  const portCount = 20
  const topology: TinyHyperGraphTopology = {
    portCount,
    regionCount: 4,
    regionIncidentPorts: [
      Array.from({ length: 19 }, (_, i) => i),
      Array.from({ length: 19 }, (_, i) => i + 1),
      [0],
      [19],
    ],
    incidentPortRegion: Array.from({ length: portCount }, (_, i) =>
      i === 0 ? [0, 2] : i === 19 ? [1, 3] : [0, 1],
    ),
    regionWidth: new Float64Array(4).fill(100),
    regionHeight: new Float64Array(4).fill(100),
    regionCenterX: new Float64Array(4),
    regionCenterY: new Float64Array(4),
    portAngleForRegion1: Int32Array.from({ length: portCount }, (_, i) => i * 100),
    portAngleForRegion2: Int32Array.from({ length: portCount }, (_, i) => i * 100),
    portX: Float64Array.from({ length: portCount }, (_, i) => i),
    portY: new Float64Array(portCount),
    portZ: new Int32Array(portCount),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    routeStartPort: Int32Array.from([0]),
    routeEndPort: Int32Array.from([19]),
    routeNet: Int32Array.from([7]),
    regionNetId: new Int32Array(4).fill(-1),
    portSectionMask: new Int8Array(portCount).fill(1),
  }
  const solver = new DistanceAwareTinyHyperGraphSolver(topology, problem, {
    OWNED_REGIONAL_HOP_FRONTIER: owned,
    STATIC_REACHABILITY_PRECHECK: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })
  solver.state.portAssignment.fill(9, 8)
  return solver
}

test("reject unavailable ports once per search without changing state, and reconsider them after reset", (): void => {
  const reference = createSolver(false)
  const optimized = createSolver(true)
  const calls = [0, 0]
  for (const [index, solver] of [reference, optimized].entries()) {
    const check = solver.isPortReservedForDifferentNet.bind(solver)
    solver.isPortReservedForDifferentNet = (portId): boolean => {
      if (portId === 8) calls[index]++
      return check(portId)
    }
  }
  for (let i = 0; i < 12; i++) {
    reference.step()
    optimized.step()
    expect(optimized.state).toEqual(reference.state)
    expect(optimized.iterations).toBe(reference.iterations)
  }
  expect(calls[0]).toBeGreaterThan(calls[1])
  expect(calls[1]).toBeLessThanOrEqual(2)
  for (const solver of [reference, optimized]) {
    solver.resetRoutingStateForRerip()
    solver.solve()
  }
  expect(optimized.solved).toBe(true)
  expect(optimized.state).toEqual(reference.state)
  expect(optimized.iterations).toBe(reference.iterations)
  expect(optimized.getOutput()).toEqual(reference.getOutput())
})
