import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "./core"
import { MinHeap } from "./MinHeap"
import type { PortId, RegionId, RouteId } from "./types"

type RegionCost = { regionId: RegionId; cost: number }

/**
 * Lower bounds for the port penalties still needed to reach a route's goal.
 * Region crossings are free here; congestion and distance remain in the search.
 */
export function getRemainingPortCosts({
  topology,
  problem,
  routeId,
}: {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  routeId: RouteId
}): Float64Array {
  const portCosts = new Float64Array(topology.portCount).fill(Infinity)
  const regionCosts = new Float64Array(topology.regionCount).fill(Infinity)
  const pending = new MinHeap<RegionCost>(
    [],
    (left, right) => left.cost - right.cost,
  )
  const goalPortId: PortId = problem.routeEndPort[routeId]
  const netId = problem.routeNet[routeId]
  const goalCost = problem.portPenalty?.[goalPortId] ?? 0

  for (const regionId of topology.incidentPortRegion[goalPortId]) {
    const reservedNetId = problem.regionNetId[regionId]
    if (reservedNetId !== -1 && reservedNetId !== netId) continue
    regionCosts[regionId] = goalCost
    pending.queue({ regionId, cost: goalCost })
  }

  while (pending.length > 0) {
    const { regionId, cost } = pending.dequeue()!
    if (cost !== regionCosts[regionId]) continue

    for (const portId of topology.regionIncidentPorts[regionId]) {
      if (portId === goalPortId || problem.portSectionMask[portId] === 0)
        continue
      if (cost >= portCosts[portId]) continue
      portCosts[portId] = cost

      // Reverse traversal pays the port being crossed, not the arrival region.
      const nextCost = cost + (problem.portPenalty?.[portId] ?? 0)
      for (const nextRegionId of topology.incidentPortRegion[portId]) {
        const reservedNetId = problem.regionNetId[nextRegionId]
        if (reservedNetId !== -1 && reservedNetId !== netId) continue
        if (nextCost >= regionCosts[nextRegionId]) continue
        regionCosts[nextRegionId] = nextCost
        pending.queue({ regionId: nextRegionId, cost: nextCost })
      }
    }
  }

  portCosts[goalPortId] = 0
  return portCosts
}
