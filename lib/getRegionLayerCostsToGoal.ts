import { computeRegionCost } from "./computeRegionCost"
import type { TinyHyperGraphSolver } from "./core"
import { MinHeap } from "./MinHeap"
import type { HopId, PortId, RegionId } from "./types"

type RegionPortGroup = { regionId: RegionId; z: number; ports: PortId[] }
type RegionCostGraph = {
  solver: TinyHyperGraphSolver
  groups: RegionPortGroup[]
  groupsByRegion: Map<RegionId, number[]>
  groupByHop: Map<HopId, number>
  traversalCosts: Map<RegionId, number[]>
  costs: number[]
}
export type RemainingRouteCosts = {
  costByHop: Map<HopId, number>
  unsettledCost: number
}

const findPortGroupRoot = (parents: number[], portIndex: number): number => {
  while (parents[portIndex] !== portIndex) portIndex = parents[portIndex]
  return portIndex
}

const getRegionPortGroups = (
  regionId: RegionId,
  graph: RegionCostGraph,
): number[] => {
  const cachedGroups = graph.groupsByRegion.get(regionId)
  if (cachedGroups) return cachedGroups
  const { solver, groups, groupByHop } = graph
  const { topology, problem, state } = solver
  const regionGroups: number[] = []
  graph.groupsByRegion.set(regionId, regionGroups)
  if (solver.isRegionReservedForDifferentNet(regionId)) return regionGroups
  const ports = topology.regionIncidentPorts[regionId].filter(
    (portId) =>
      !solver.isPortReservedForDifferentNet(portId) &&
      (state.portAssignment[portId] === -1 ||
        state.portAssignment[portId] === state.currentRouteNetId) &&
      (problem.portSectionMask[portId] !== 0 || portId === state.goalPortId),
  )
  const parent = ports.map((_, index) => index)
  const cache = state.regionIntersectionCaches[regionId]
  const hasBlockingSegments =
    solver.isKnownSingleLayerRegion(regionId) &&
    cache.netIds.some((netId) => netId !== state.currentRouteNetId)
  if (!hasBlockingSegments) {
    const firstPortByLayer = new Map<number, number>()
    for (let index = 0; index < ports.length; index++) {
      const z = topology.portZ[ports[index]]
      const first = firstPortByLayer.get(z)
      if (first === undefined) firstPortByLayer.set(z, index)
      else parent[index] = first
    }
  } else {
    for (let right = 1; right < ports.length; right++) {
      for (let left = 0; left < right; left++) {
        if (topology.portZ[ports[left]] !== topology.portZ[ports[right]])
          continue
        const leftRoot = findPortGroupRoot(parent, left)
        const rightRoot = findPortGroupRoot(parent, right)
        if (leftRoot === rightRoot) continue
        if (
          !Number.isFinite(
            solver.computeG(
              { portId: ports[left], nextRegionId: regionId, g: 0, h: 0, f: 0 },
              ports[right],
            ),
          )
        )
          continue
        parent[rightRoot] = leftRoot
      }
    }
  }
  const groupByRoot = new Map<number, number>()
  for (let index = 0; index < ports.length; index++) {
    const root = findPortGroupRoot(parent, index)
    let groupId = groupByRoot.get(root)
    if (groupId === undefined) {
      groupId = groups.length
      groupByRoot.set(root, groupId)
      regionGroups.push(groupId)
      groups.push({ regionId, z: topology.portZ[ports[index]], ports: [] })
      graph.costs.push(Infinity)
    }
    groups[groupId].ports.push(ports[index])
    groupByHop.set(solver.getHopId(ports[index], regionId), groupId)
  }
  graph.traversalCosts.set(
    regionId,
    [0, 1].map(
      (layerChanges) =>
        computeRegionCost(
          topology.regionWidth[regionId],
          topology.regionHeight[regionId],
          cache.existingSameLayerIntersections,
          cache.existingCrossingLayerIntersections,
          cache.existingEntryExitLayerChanges + layerChanges,
          cache.existingSegmentCount + 1,
          topology.regionAvailableZMask?.[regionId] ?? 0,
          solver.minViaPadDiameter,
          solver.TRACE_DENSITY_COST_FACTOR,
        ) -
        cache.existingRegionCost +
        state.regionCongestionCost[regionId],
    ),
  )
  return regionGroups
}

/** Lower bounds on remaining costs, grouping ports reachable without a single-layer crossing. */
export const getRegionLayerCostsToGoal = (
  solver: TinyHyperGraphSolver,
): RemainingRouteCosts => {
  const { topology, problem, state } = solver
  const graph: RegionCostGraph = {
    solver,
    groups: [],
    groupsByRegion: new Map(),
    groupByHop: new Map(),
    traversalCosts: new Map(),
    costs: [],
  }
  const { groups, groupByHop, traversalCosts, costs } = graph
  const startPortId = problem.routeStartPort[state.currentRouteId!]
  const startRegionId = solver.getStartingNextRegionId(
    state.currentRouteId!,
    startPortId,
  )
  if (startRegionId !== undefined) getRegionPortGroups(startRegionId, graph)
  const startGroupId =
    startRegionId === undefined
      ? undefined
      : groupByHop.get(solver.getHopId(startPortId, startRegionId))
  const queue = new MinHeap<{ groupId: number; cost: number }>(
    [],
    (a, b) => a.cost - b.cost,
  )
  for (const regionId of topology.incidentPortRegion[state.goalPortId]) {
    const regionGroups = getRegionPortGroups(regionId, graph)
    const goalGroupId = groupByHop.get(
      solver.getHopId(state.goalPortId, regionId),
    )
    if (goalGroupId === undefined) continue
    for (const groupId of regionGroups) {
      if (solver.isKnownSingleLayerRegion(regionId) && groupId !== goalGroupId)
        continue
      const cost =
        traversalCosts.get(regionId)![
          Number(groups[groupId].z !== topology.portZ[state.goalPortId])
        ] + (problem.portPenalty?.[state.goalPortId] ?? 0)
      costs[groupId] = cost
      queue.queue({ groupId, cost })
    }
  }
  let unsettledCost = Infinity
  while (queue.length > 0) {
    const { groupId, cost } = queue.dequeue()!
    if (cost > costs[groupId]) continue
    if (groupId === startGroupId) {
      unsettledCost = cost
      break
    }
    const { regionId, z, ports } = groups[groupId]
    for (const portId of ports) {
      for (const nextRegionId of topology.incidentPortRegion[portId]) {
        if (nextRegionId === regionId) continue
        const regionGroups = getRegionPortGroups(nextRegionId, graph)
        const exitGroupId = groupByHop.get(
          solver.getHopId(portId, nextRegionId),
        )
        if (exitGroupId === undefined) continue
        for (const entryGroupId of regionGroups) {
          if (
            solver.isKnownSingleLayerRegion(nextRegionId) &&
            entryGroupId !== exitGroupId
          )
            continue
          const nextCost =
            cost +
            (problem.portPenalty?.[portId] ?? 0) +
            traversalCosts.get(nextRegionId)![
              Number(groups[entryGroupId].z !== z)
            ]
          if (nextCost >= costs[entryGroupId]) continue
          costs[entryGroupId] = nextCost
          queue.queue({ groupId: entryGroupId, cost: nextCost })
        }
      }
    }
  }
  return {
    costByHop: new Map(
      [...groupByHop].map(([hopId, groupId]) => [
        hopId,
        Math.min(costs[groupId], unsettledCost),
      ]),
    ),
    unsettledCost,
  }
}
