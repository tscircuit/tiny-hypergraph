import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  getTinyHyperGraphSolverOptions,
  TinyHyperGraphSolver,
  type TinyHyperGraphInitialAssignment,
} from "../core"
import { loadSerializedHyperGraph } from "../compat/loadSerializedHyperGraph"
import { TinyHyperGraphSectionSolver } from "../section-solver"

export type RegionCostScore = {
  maxRegionCost: number
  squaredRegionCostSum: number
}

export const getRouteAssignments = (
  solver: TinyHyperGraphSolver,
): TinyHyperGraphInitialAssignment[] =>
  solver.state.regionSegments.flatMap((segments, regionId) =>
    segments.map(([routeId, fromPortId, toPortId]) => ({
      routeId,
      regionId,
      fromPortId,
      toPortId,
    })),
  )

export const getAssignmentKey = (segment: TinyHyperGraphInitialAssignment) =>
  `${segment.routeId}:${segment.regionId}:${Math.min(segment.fromPortId, segment.toPortId)}:${Math.max(segment.fromPortId, segment.toPortId)}`

export const getRegionCostScore = (
  solver: TinyHyperGraphSolver,
): RegionCostScore => {
  let maxRegionCost = 0
  let squaredRegionCostSum = 0
  for (const cache of solver.state.regionIntersectionCaches) {
    const cost = cache.existingRegionCost
    if (!Number.isFinite(cost) || cost < 0)
      throw new Error("Invalid region cost cache")
    maxRegionCost = Math.max(maxRegionCost, cost)
    squaredRegionCostSum += cost * cost
  }
  if (!Number.isFinite(squaredRegionCostSum))
    throw new Error("Invalid total region cost")
  return { maxRegionCost, squaredRegionCostSum }
}

export const getAssignmentInventory = (
  segments: TinyHyperGraphInitialAssignment[],
) => JSON.stringify(segments.map(getAssignmentKey).sort())

export const hasWorseRegionCosts = (
  next: RegionCostScore,
  previous: RegionCostScore,
) =>
  next.maxRegionCost > previous.maxRegionCost ||
  next.squaredRegionCostSum > previous.squaredRegionCostSum

// Do not replace this with assignment replay: caches depend on insertion order.
// The section constructor rebuilds in route/path order, exactly as downstream does.
export function replaySerializedSolution(
  solver: TinyHyperGraphSolver,
  options: ReturnType<typeof getTinyHyperGraphSolverOptions>,
  expectedIdentity?: string,
  output: SerializedHyperGraph = solver.getOutput(),
) {
  for (const region of output.regions) {
    if (
      ![
        region.d?.center?.x,
        region.d?.center?.y,
        region.d?.width,
        region.d?.height,
      ].every(Number.isFinite) ||
      !(Number(region.d?.width) > 0) ||
      !(Number(region.d?.height) > 0)
    ) {
      throw new Error("Invalid region geometry")
    }
  }
  for (const port of output.ports) {
    if (![port.d?.x, port.d?.y, port.d?.z].every(Number.isFinite))
      throw new Error("Invalid port geometry")
  }
  const connections = output.connections ?? []
  const routes = output.solvedRoutes ?? []
  for (const ids of [
    output.regions.map((region) => region.regionId),
    output.ports.map((port) => port.portId),
    connections.map((connection) => connection.connectionId),
    routes.map((route) => route.connection.connectionId),
  ]) {
    if (new Set(ids).size !== ids.length)
      throw new Error("Duplicate exported identity")
  }
  if (
    connections.length !== solver.problem.routeCount ||
    routes.length !== connections.length ||
    routes.some(
      (route, routeId) =>
        JSON.stringify(route.connection) !==
        JSON.stringify(connections[routeId]),
    )
  )
    throw new Error("Exported route inventory changed")
  const identity = JSON.stringify({
    regions: output.regions.map(({ assignments: _, ...region }) => region),
    ports: output.ports,
    connections,
  })
  if (expectedIdentity !== undefined && identity !== expectedIdentity)
    throw new Error("Exported topology or identity changed")
  const loaded = loadSerializedHyperGraph(output)
  // Numeric inventory comparison is safe only if loading kept the identity order.
  if (
    loaded.topology.regionCount !== solver.topology.regionCount ||
    loaded.topology.portCount !== solver.topology.portCount ||
    loaded.problem.routeCount !== solver.problem.routeCount ||
    output.regions.some(
      (region, regionId) =>
        (
          loaded.topology.regionMetadata?.[regionId] as {
            serializedRegionId?: string
          }
        )?.serializedRegionId !== region.regionId,
    ) ||
    output.ports.some(
      (port, portId) =>
        (
          loaded.topology.portMetadata?.[portId] as {
            serializedPortId?: string
          }
        )?.serializedPortId !== port.portId,
    ) ||
    connections.some(
      (connection, routeId) =>
        (loaded.problem.routeMetadata?.[routeId] as { connectionId?: string })
          ?.connectionId !== connection.connectionId,
    ) ||
    loaded.problem.routeStartPort.some(
      (portId, routeId) => portId !== solver.problem.routeStartPort[routeId],
    ) ||
    loaded.problem.routeEndPort.some(
      (portId, routeId) => portId !== solver.problem.routeEndPort[routeId],
    )
  )
    throw new Error("Reloaded identity or endpoints changed")
  const expected = getAssignmentInventory(getRouteAssignments(solver))
  if (
    getAssignmentInventory(loaded.problem.initialAssignments ?? []) !== expected
  )
    throw new Error("Exported assignment inventory changed")
  const pathAssignments: TinyHyperGraphInitialAssignment[] = []
  loaded.solution.solvedRoutePathSegments.forEach((segments, routeId) => {
    if (segments.length !== routes[routeId].path.length - 1)
      throw new Error("Exported path contains unmapped ports")
    segments.forEach(([fromPortId, toPortId], segmentIndex) => {
      const regionId =
        loaded.solution.solvedRoutePathRegionIds?.[routeId]?.[segmentIndex]
      if (regionId === undefined)
        throw new Error("Exported path contains unmapped region")
      pathAssignments.push({ routeId, regionId, fromPortId, toPortId })
    })
  })
  if (getAssignmentInventory(pathAssignments) !== expected)
    throw new Error("Exported path inventory differs from assignments")
  const replay = new TinyHyperGraphSectionSolver(
    loaded.topology,
    loaded.problem,
    loaded.solution,
    options,
  ).baselineSolver
  if (getAssignmentInventory(getRouteAssignments(replay)) !== expected)
    throw new Error("Exported path inventory differs from assignments")
  return { score: getRegionCostScore(replay), identity }
}

/** Conservative validation: a route must be one simple endpoint-to-endpoint chain. */
export function getOrderedRoutes(
  solver: TinyHyperGraphSolver,
  immutableComplex = new Map<number, string[]>(),
  discover = false,
): TinyHyperGraphInitialAssignment[][] {
  const { problem, topology } = solver
  const assignmentsByRoute: TinyHyperGraphInitialAssignment[][] = Array.from(
    { length: problem.routeCount },
    () => [],
  )
  const portOwners = new Map<number, number>()
  const reservePort = (portId: number, netId: number) => {
    if (portOwners.has(portId) && portOwners.get(portId) !== netId)
      throw new Error("Conflicting port or endpoint reservation")
    portOwners.set(portId, netId)
  }
  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    reservePort(problem.routeStartPort[routeId], problem.routeNet[routeId])
    reservePort(problem.routeEndPort[routeId], problem.routeNet[routeId])
  }
  for (const segment of getRouteAssignments(solver)) {
    if (!assignmentsByRoute[segment.routeId])
      throw new Error("Invalid route id")
    const netId = problem.routeNet[segment.routeId]
    if (
      problem.regionNetId[segment.regionId] !== -1 &&
      problem.regionNetId[segment.regionId] !== netId
    )
      throw new Error("Conflicting region reservation")
    for (const portId of [segment.fromPortId, segment.toPortId]) {
      if (!topology.incidentPortRegion[portId]?.includes(segment.regionId))
        throw new Error("Nonincident segment")
      reservePort(portId, netId)
      if (solver.state.portAssignment[portId] !== netId)
        throw new Error("Incorrect port assignment")
    }
    assignmentsByRoute[segment.routeId].push(segment)
  }
  return assignmentsByRoute.map((segments, routeId) => {
    const adjacent = new Map<number, number[]>()
    for (const segment of segments) {
      adjacent.set(segment.fromPortId, [
        ...(adjacent.get(segment.fromPortId) ?? []),
        segment.toPortId,
      ])
      adjacent.set(segment.toPortId, [
        ...(adjacent.get(segment.toPortId) ?? []),
        segment.fromPortId,
      ])
    }
    const seen = new Set<number>(),
      pending = [problem.routeStartPort[routeId]]
    while (pending.length) {
      const portId = pending.pop()!
      if (seen.has(portId)) continue
      seen.add(portId)
      pending.push(...(adjacent.get(portId) ?? []))
    }
    if (
      !seen.has(problem.routeEndPort[routeId]) ||
      segments.some(
        (segment) =>
          !seen.has(segment.fromPortId) || !seen.has(segment.toPortId),
      )
    )
      throw new Error("Disconnected route segments")
    const complex =
      problem.routeStartPort[routeId] === problem.routeEndPort[routeId] ||
      [...adjacent].some(
        ([portId, neighbors]) =>
          neighbors.length !==
          (portId === problem.routeStartPort[routeId] ||
          portId === problem.routeEndPort[routeId]
            ? 1
            : 2),
      )
    if (complex) {
      const signature = segments.map(getAssignmentKey).sort()
      if (discover) immutableComplex.set(routeId, signature)
      else if (
        JSON.stringify(signature) !==
        JSON.stringify(immutableComplex.get(routeId))
      )
        throw new Error("Unsupported route changed")
      return segments
    }
    if (immutableComplex.has(routeId))
      throw new Error("Unsupported route structure changed")
    let portId = problem.routeStartPort[routeId]
    const remaining = new Set(segments)
    const path: TinyHyperGraphInitialAssignment[] = []
    const visited = new Set([portId])
    while (portId !== problem.routeEndPort[routeId]) {
      const next = [...remaining].filter(
        (segment) =>
          segment.fromPortId === portId || segment.toPortId === portId,
      )
      if (next.length !== 1) throw new Error("Incomplete or branching route")
      const segment = next[0]
      const toPortId =
        segment.fromPortId === portId ? segment.toPortId : segment.fromPortId
      if (visited.has(toPortId)) throw new Error("Cyclic route")
      path.push({ ...segment, fromPortId: portId, toPortId })
      remaining.delete(segment)
      visited.add(toPortId)
      portId = toPortId
    }
    if (remaining.size) throw new Error("Disconnected route segments")
    return path
  })
}
