import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "./core"
import { MinHeap } from "./MinHeap"
import type { PortId, RouteId } from "./types"

type PortCost = { portId: PortId; cost: number }

/** Lower bounds through ports available to the current routing attempt. */
export function createRemainingCostLookup({
  topology,
  problem,
  routeId,
  distanceToCost,
  portAssignment,
  portReservations,
  regionCosts,
}: {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  routeId: RouteId
  distanceToCost: number
  portAssignment: Int32Array
  portReservations: Int32Array
  regionCosts: Float64Array
}): (portId: PortId) => number {
  const costs = new Float64Array(topology.portCount).fill(Infinity)
  const settled = new Uint8Array(topology.portCount)
  const pending = new MinHeap<PortCost>(
    [],
    (left, right) => left.cost - right.cost,
  )
  const goalPortId = problem.routeEndPort[routeId]
  const netId = problem.routeNet[routeId]
  costs[goalPortId] = 0
  pending.queue({ portId: goalPortId, cost: 0 })

  return (requestedPortId: PortId): number => {
    // Continue the same reverse search only as far as the forward search needs.
    while (!settled[requestedPortId] && pending.length > 0) {
      const { portId, cost } = pending.dequeue()!
      if (settled[portId]) continue
      settled[portId] = 1

      for (const regionId of topology.incidentPortRegion[portId]) {
        const reservedNetId = problem.regionNetId[regionId]
        if (reservedNetId !== -1 && reservedNetId !== netId) continue

        for (const neighborPortId of topology.regionIncidentPorts[regionId]) {
          if (settled[neighborPortId]) continue
          if (problem.portSectionMask[neighborPortId] === 0) continue
          const assignedNetId = portAssignment[neighborPortId]
          if (assignedNetId !== -1 && assignedNetId !== netId) continue
          const reservedPortNetId = portReservations[neighborPortId]
          if (reservedPortNetId !== -1 && reservedPortNetId !== netId) continue
          const dx = topology.portX[portId] - topology.portX[neighborPortId]
          const dy = topology.portY[portId] - topology.portY[neighborPortId]
          // In reverse, pay the arrival port of the corresponding forward hop.
          const nextCost =
            cost +
            regionCosts[regionId] +
            Math.sqrt(dx * dx + dy * dy) * distanceToCost +
            (problem.portPenalty?.[portId] ?? 0)
          if (nextCost >= costs[neighborPortId]) continue
          costs[neighborPortId] = nextCost
          pending.queue({ portId: neighborPortId, cost: nextCost })
        }
      }
    }
    return costs[requestedPortId]
  }
}
