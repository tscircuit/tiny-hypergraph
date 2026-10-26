import type {
  TinyHyperGraphProblem,
  TinyHyperGraphRegionSegmentFeasibilityContext,
  TinyHyperGraphRegionSegmentFeasibilityResult,
  TinyHyperGraphTopology,
} from "lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

export class AlternativeCapacityProbe extends SelectiveReripTinyHyperGraphSolver {
  plan(routeId: number, forbidden = new Set<number>()) {
    this.state.currentRouteId = routeId
    this.state.currentRouteNetId = this.problem.routeNet[routeId]!
    return this.findRelaxedBlockerPath(forbidden)
  }
}

/** Independent finite electrical-owner capacity model used by the fixtures. */
export function ownerCapacityHook(capacity: number) {
  return (
    context: TinyHyperGraphRegionSegmentFeasibilityContext,
  ): TinyHyperGraphRegionSegmentFeasibilityResult => {
    const groups = new Map<number, number[]>()
    for (const [routeId] of context.regionSegments) {
      if (context.ignoredRouteIds?.has(routeId)) continue
      const net = context.problem.routeNet[routeId]!
      if (net === context.netId) continue
      if (!groups.has(net)) groups.set(net, [])
      if (!groups.get(net)!.includes(routeId)) groups.get(net)!.push(routeId)
    }
    const ownerGroups = [...groups.values()]
    const removals = ownerGroups.length + 1 - capacity
    if (removals <= 0) return { feasible: true }
    const alternatives: number[][] = []
    const choose = (
      index: number,
      remaining: number,
      owners: number[],
    ): void => {
      if (remaining === 0) {
        alternatives.push(owners)
        return
      }
      for (let next = index; next <= ownerGroups.length - remaining; next++) {
        choose(next + 1, remaining - 1, [...owners, ...ownerGroups[next]!])
      }
    }
    choose(0, removals, [])
    return { feasible: false, alternativeBlockerRouteIdSets: alternatives }
  }
}

export function createCapacityProbe(
  ownerNets: number[],
  assigned = ownerNets.map((_, index) => index),
): { solver: AlternativeCapacityProbe; candidate: number } {
  const routeCount = ownerNets.length + 1
  const portCount = routeCount * 2
  const topology: TinyHyperGraphTopology = {
    portCount,
    regionCount: 1,
    regionIncidentPorts: [
      Array.from({ length: portCount }, (_, index) => index),
    ],
    incidentPortRegion: Array.from({ length: portCount }, () => [0]),
    regionWidth: new Float64Array([4]),
    regionHeight: new Float64Array([4]),
    regionCenterX: new Float64Array([0]),
    regionCenterY: new Float64Array([0]),
    regionAvailableZMask: new Int32Array([255]),
    portAngleForRegion1: Int32Array.from({ length: portCount }, (_, id) =>
      Math.round((id * 36000) / portCount),
    ),
    portX: Float64Array.from({ length: portCount }, (_, id) =>
      Math.cos((id * Math.PI * 2) / portCount),
    ),
    portY: Float64Array.from({ length: portCount }, (_, id) =>
      Math.sin((id * Math.PI * 2) / portCount),
    ),
    portZ: Int32Array.from({ length: portCount }, (_, id) => (id % 2 ? 7 : 0)),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount,
    portSectionMask: new Int8Array(portCount).fill(1),
    routeStartPort: Int32Array.from({ length: routeCount }, (_, id) => id * 2),
    routeEndPort: Int32Array.from(
      { length: routeCount },
      (_, id) => id * 2 + 1,
    ),
    routeNet: new Int32Array([...ownerNets, 99]),
    regionNetId: new Int32Array([-1]),
    initialAssignments: assigned.map((routeId) => ({
      routeId,
      regionId: 0,
      fromPortId: routeId * 2,
      toPortId: routeId * 2 + 1,
    })),
  }
  return {
    solver: new AlternativeCapacityProbe(topology, problem),
    candidate: ownerNets.length,
  }
}
