import { expect, test } from "bun:test"
import {
  OutsideInPartialRipTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

test("an exhausted endpoint starts reripping without flooding the opposite frontier", () => {
  const chainPortCount = 200
  const portCount = chainPortCount + 1
  const regionCount = chainPortCount + 3
  const regionIncidentPorts: number[][] = Array.from(
    { length: regionCount },
    () => [],
  )
  const incidentPortRegion: number[][] = []
  for (let portId = 0; portId < portCount; portId++) {
    const firstRegionId = portId === chainPortCount ? portId + 1 : portId
    const secondRegionId = firstRegionId + 1
    incidentPortRegion.push([firstRegionId, secondRegionId])
    regionIncidentPorts[firstRegionId]!.push(portId)
    regionIncidentPorts[secondRegionId]!.push(portId)
  }
  incidentPortRegion[0]!.reverse()
  const topology: TinyHyperGraphTopology = {
    portCount,
    regionCount,
    regionIncidentPorts,
    incidentPortRegion,
    regionWidth: new Float64Array(regionCount).fill(1),
    regionHeight: new Float64Array(regionCount).fill(10),
    regionCenterX: Float64Array.from(
      { length: regionCount },
      (_, index) => index,
    ),
    regionCenterY: new Float64Array(regionCount),
    portAngleForRegion1: new Int32Array(portCount),
    portAngleForRegion2: new Int32Array(portCount).fill(18000),
    portX: Float64Array.from({ length: portCount }, (_, index) => index + 0.5),
    portY: new Float64Array(portCount),
    portZ: new Int32Array(portCount),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(portCount).fill(1),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([chainPortCount]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array(regionCount).fill(-1),
  }
  const solver = new OutsideInPartialRipTinyHyperGraphSolver(
    topology,
    problem,
    {
      STATIC_REACHABILITY_PRECHECK: false,
    },
  )
  while (solver.state.ripCount === 0 && !solver.failed) solver.step()

  expect(solver.solved).toBe(false)
  expect(solver.state.ripCount).toBe(1)
  expect(solver.iterations).toBe(2)
  expect(solver.stats.outsideInForwardExpansionCount).toBe(1)
  expect(solver.stats.outsideInReverseExpansionCount).toBe(1)
  expect(solver.stats.outsideInFallbackRouteCount).toBe(0)
})
