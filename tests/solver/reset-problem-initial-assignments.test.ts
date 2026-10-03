import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

test("resetting an independent problem preserves constructor initial assignments", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 4,
    regionIncidentPorts: [[0, 1], [2, 3], [0, 1], [2, 3]],
    incidentPortRegion: [[0, 2], [0, 2], [1, 3], [1, 3]],
    regionWidth: new Float64Array([10, 10, 10, 10]),
    regionHeight: new Float64Array([10, 10, 10, 10]),
    regionCenterX: new Float64Array([0, 20, 0, 20]),
    regionCenterY: new Float64Array(4),
    portAngleForRegion1: new Int32Array([0, 180, 0, 180]),
    portX: new Float64Array([0, 10, 20, 30]),
    portY: new Float64Array(4),
    portZ: new Int32Array(4),
  }
  const firstProblem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array([1, 1, 1, 1]),
    routeStartPort: new Int32Array([2]),
    routeEndPort: new Int32Array([3]),
    routeNet: new Int32Array([30]),
    regionNetId: new Int32Array([-1, -1, -1, -1]),
  }
  const nextProblem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array([1, 1, 1, 1]),
    routeStartPort: new Int32Array([0, 2]),
    routeEndPort: new Int32Array([1, 3]),
    routeNet: new Int32Array([7, 11]),
    regionNetId: new Int32Array([-1, -1, -1, -1]),
    initialAssignments: [{ routeId: 0, regionId: 0, fromPortId: 0, toPortId: 1 }],
  }
  const options = {
    STATIC_REACHABILITY_PRECHECK: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  }
  const reused = new TinyHyperGraphSolver(topology, firstProblem, options)
  reused.solve()
  expect(reused.solved).toBe(true)
  reused.resetForProblem(nextProblem)
  const fresh = new TinyHyperGraphSolver(topology, nextProblem, options)

  expect(reused.state.regionSegments).toEqual(fresh.state.regionSegments)
  expect(reused.state.regionIntersectionCaches).toEqual(
    fresh.state.regionIntersectionCaches,
  )
  expect([...reused.state.portAssignment]).toEqual([7, 7, -1, -1])
  expect(reused.state.unroutedRoutes).toEqual([1])
  expect(reused.stats).toEqual(fresh.stats)
  reused.solve()
  fresh.solve()
  expect(reused.solved).toBe(true)
  expect(reused.failed).toBe(false)
  expect(reused.iterations).toBe(fresh.iterations)
  expect(reused.getOutput()).toEqual(fresh.getOutput())

  reused.resetForProblem(firstProblem)
  expect(reused.state.unroutedRoutes).toEqual([0])
  expect([...reused.state.portAssignment]).toEqual([-1, -1, -1, -1])
  expect(reused.stats).toEqual({})
})
