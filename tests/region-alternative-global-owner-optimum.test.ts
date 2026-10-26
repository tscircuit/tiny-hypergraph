import { expect, test } from "bun:test"
import type { TinyHyperGraphTopology } from "lib/core"
import { AlternativeCapacityProbe } from "./fixtures/alternative-region-capacity.fixture"

test("a future mandatory blocker makes the shared alternative globally cheaper than the first local choice", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 8,
    regionCount: 2,
    regionIncidentPorts: [
      [0, 1, 3, 4, 5, 6],
      [1, 2, 6, 7],
    ],
    incidentPortRegion: [[0], [0, 1], [1], [0], [0], [0], [0, 1], [1]],
    regionWidth: new Float64Array([1, 1]),
    regionHeight: new Float64Array([4, 4]),
    regionCenterX: new Float64Array([-0.5, 0.5]),
    regionCenterY: new Float64Array([0, 0]),
    regionAvailableZMask: new Int32Array([255, 255]),
    portAngleForRegion1: new Int32Array([
      18000, 0, 0, 13500, 4500, 22500, 31500, 31500,
    ]),
    portAngleForRegion2: new Int32Array([0, 18000, 0, 0, 0, 0, 22500, 0]),
    portX: new Float64Array([-1, 0, 1, -1, 0, -1, 0, 1]),
    portY: new Float64Array([0, 0, 0, 1, 1, -1, -1, -1]),
    portZ: new Int32Array([0, 7, 0, 0, 7, 0, 7, 0]),
  }
  const portSectionMask = new Int8Array(8).fill(1)
  // The candidate's assigned section uses port 1. Port 6 still carries the
  // committed owner across both regions but is not another candidate exit.
  portSectionMask[6] = 0
  const solver = new AlternativeCapacityProbe(topology, {
    routeCount: 3,
    routeStartPort: new Int32Array([3, 5, 0]),
    routeEndPort: new Int32Array([4, 7, 2]),
    routeNet: new Int32Array([0, 1, 2]),
    regionNetId: new Int32Array([-1, -1]),
    portSectionMask,
    initialAssignments: [
      { routeId: 0, regionId: 0, fromPortId: 3, toPortId: 4 },
      { routeId: 1, regionId: 0, fromPortId: 5, toPortId: 6 },
      { routeId: 1, regionId: 1, fromPortId: 6, toPortId: 7 },
    ],
  })
  const ignoredAtSecondRegion: number[][] = []
  topology.regionSegmentFeasibility = ({ regionId, ignoredRouteIds }) => {
    if (regionId === 0) {
      if (ignoredRouteIds?.has(0) || ignoredRouteIds?.has(1))
        return { feasible: true }
      return { feasible: false, alternativeBlockerRouteIdSets: [[0], [1]] }
    }
    ignoredAtSecondRegion.push([...(ignoredRouteIds ?? [])])
    return ignoredRouteIds?.has(1)
      ? { feasible: true }
      : { feasible: false, blockerRouteIds: [1] }
  }
  const result = solver.plan(2)
  expect(result.found).toBe(true)
  if (!result.found) throw new Error("Expected the shared owner alternative")
  expect([...result.owners]).toEqual([1])
  expect(result.distance).toBe(2)
  expect(result.states.map(({ portId }) => portId)).toEqual([0, 1, 2])
  expect(ignoredAtSecondRegion).toContainEqual([1])
  expect(solver.state.regionSegments).toEqual([
    [
      [0, 3, 4],
      [1, 5, 6],
    ],
    [[1, 6, 7]],
  ])
})
