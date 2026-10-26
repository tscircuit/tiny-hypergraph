import { expect, test } from "bun:test"
import type { TinyHyperGraphTopology } from "lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

class CapacityBlockerSolver extends SelectiveReripTinyHyperGraphSolver {
  plan(forbidden = new Set<number>()) {
    this.state.currentRouteId = 2
    this.state.currentRouteNetId = this.problem.routeNet[2]!
    return this.findRelaxedBlockerPath(forbidden)
  }
}

test("capacity blockers remove every committed alias and recheck hypothetical occupancy without mutating seeds", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 6,
    regionCount: 1,
    regionIncidentPorts: [[0, 1, 2, 3, 4, 5]],
    incidentPortRegion: [[0], [0], [0], [0], [0], [0]],
    regionWidth: new Float64Array([2]),
    regionHeight: new Float64Array([2]),
    regionCenterX: new Float64Array([0]),
    regionCenterY: new Float64Array([0]),
    regionAvailableZMask: new Int32Array([255]),
    portAngleForRegion1: new Int32Array([0, 6000, 12000, 18000, 24000, 30000]),
    portX: new Float64Array([1, 0.5, -0.5, -1, -0.5, 0.5]),
    portY: new Float64Array([0, 1, 1, 0, -1, -1]),
    portZ: new Int32Array([0, 7, 0, 7, 0, 7]),
  }
  const solver = new CapacityBlockerSolver(topology, {
    routeCount: 3,
    portSectionMask: new Int8Array(6).fill(1),
    routeStartPort: new Int32Array([0, 2, 4]),
    routeEndPort: new Int32Array([1, 3, 5]),
    routeNet: new Int32Array([0, 0, 1]),
    regionNetId: new Int32Array([-1]),
    initialAssignments: [
      { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 1 },
      { routeId: 1, regionId: 0, fromPortId: 2, toPortId: 3 },
    ],
  })
  const ignoredCalls: number[][] = []
  topology.regionSegmentFeasibility = ({
    fromPortId,
    toPortId,
    netId,
    regionSegments,
    ignoredRouteIds,
  }) => {
    ignoredCalls.push([...(ignoredRouteIds ?? [])])
    if (topology.portZ[fromPortId] === topology.portZ[toPortId])
      return { feasible: true }
    const blockers = regionSegments
      .filter(
        ([routeId, from, to]) =>
          !ignoredRouteIds?.has(routeId) &&
          topology.portZ[from] !== topology.portZ[to] &&
          solver.problem.routeNet[routeId] !== netId,
      )
      .map(([routeId]) => routeId)
    return blockers.length
      ? { feasible: false, blockerRouteIds: blockers }
      : { feasible: true }
  }
  const before = structuredClone(solver.state.regionSegments)
  const result = solver.plan()
  expect(result.found).toBe(true)
  if (!result.found) throw new Error("Expected a removable capacity blocker")
  expect([...result.owners].sort()).toEqual([0, 1])
  expect(result.hops.at(-1)!.data!.resources).toContainEqual({
    kind: "region_segment_feasibility",
    regionId: 0,
    fromPortId: 4,
    toPortId: 5,
    owners: [0, 1],
  })
  expect(ignoredCalls).toContainEqual([0, 1])
  expect(solver.state.regionSegments).toEqual(before)
  expect(solver.plan(new Set([0])).found).toBe(false)
  expect(solver.plan(new Set([1])).found).toBe(false)
  const ownSolver = new CapacityBlockerSolver(topology, {
    ...solver.problem,
    routeNet: new Int32Array([0, 0, 0]),
  })
  const ownNet = ownSolver.plan()
  expect(ownNet.found).toBe(true)
  if (!ownNet.found) throw new Error("Expected same-net capacity sharing")
  expect(ownNet.owners.size).toBe(0)
  topology.regionSegmentFeasibility = () => ({
    feasible: false,
    blockerRouteIds: [],
  })
  expect(solver.plan().found).toBe(false)
  expect(solver.state.regionSegments).toEqual(before)
})
