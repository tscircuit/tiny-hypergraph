import type { TinyHyperGraphSolver } from "./core"
import { MinHeap } from "./MinHeap"
import type { PortId, RegionId } from "./types"

/** Lower bounds on mandatory port penalties, allowing free travel inside regions. */
export const getRemainingPortPenalty = (
  solver: TinyHyperGraphSolver,
  startPortId: PortId,
): Float64Array => {
  const { topology, problem, state } = solver
  const costs = new Float64Array(topology.regionCount).fill(Infinity)
  const queue = new MinHeap<{ regionId: RegionId; cost: number }>(
    [],
    (left, right) => left.cost - right.cost,
  )
  for (const regionId of topology.incidentPortRegion[state.goalPortId]!) {
    if (solver.isRegionReservedForDifferentNet(regionId)) continue
    costs[regionId] = problem.portPenalty?.[state.goalPortId] ?? 0
    queue.queue({ regionId, cost: costs[regionId]! })
  }
  const startRegionId = solver.getStartingNextRegionId(
    state.currentRouteId!,
    startPortId,
  )
  let unsettledCost = Infinity
  while (queue.length > 0) {
    const { regionId, cost } = queue.dequeue()!
    if (cost !== costs[regionId]) continue
    if (regionId === startRegionId) {
      unsettledCost = cost
      break
    }
    for (const portId of topology.regionIncidentPorts[regionId]!) {
      if (solver.isPortReservedForDifferentNet(portId)) continue
      const assignedNetId = state.portAssignment[portId]
      if (assignedNetId !== -1 && assignedNetId !== state.currentRouteNetId)
        continue
      if (problem.portSectionMask[portId] === 0) continue
      for (const nextRegionId of topology.incidentPortRegion[portId]!) {
        if (
          nextRegionId === regionId ||
          solver.isRegionReservedForDifferentNet(nextRegionId)
        )
          continue
        const nextCost = cost + (problem.portPenalty?.[portId] ?? 0)
        if (nextCost >= costs[nextRegionId]!) continue
        costs[nextRegionId] = nextCost
        queue.queue({ regionId: nextRegionId, cost: nextCost })
      }
    }
  }
  // Tentative distances are upper bounds. Cap them at the settled search radius
  // so stopping at the start region still produces an admissible heuristic.
  for (let regionId = 0; regionId < costs.length; regionId++) {
    costs[regionId] = Math.min(costs[regionId]!, unsettledCost)
  }
  return costs
}
