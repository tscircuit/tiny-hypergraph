import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolution,
  TinyHyperGraphTopology,
  TinyHyperGraphWorkingState,
} from "./index"
import type { PortId, RegionId, RouteId } from "./types"

export interface RouteSegment {
  regionId: RegionId
  fromPortId: PortId
  toPortId: PortId
}

export const cloneSolution = (
  solution: TinyHyperGraphSolution,
): TinyHyperGraphSolution => ({
  solvedRoutePathSegments: solution.solvedRoutePathSegments.map((segments) =>
    segments.map(([fromPortId, toPortId]) => [fromPortId, toPortId]),
  ),
  solvedRouteRegionIds: solution.solvedRouteRegionIds?.map((regionIds) => [
    ...regionIds,
  ]),
})

export const getRouteSegmentsByRouteFromWorkingState = (
  problem: TinyHyperGraphProblem,
  regionSegments: TinyHyperGraphWorkingState["regionSegments"],
): Array<RouteSegment[]> => {
  const routeSegmentsByRoute = Array.from(
    { length: problem.routeCount },
    () => [] as RouteSegment[],
  )

  regionSegments.forEach((segmentsForRegion, regionId) => {
    for (const [routeId, fromPortId, toPortId] of segmentsForRegion) {
      routeSegmentsByRoute[routeId]!.push({
        regionId,
        fromPortId,
        toPortId,
      })
    }
  })

  return routeSegmentsByRoute
}

export const getOrderedRoutePath = (
  problem: TinyHyperGraphProblem,
  routeId: RouteId,
  routeSegments: RouteSegment[],
): {
  orderedPortIds: PortId[]
  orderedRegionIds: RegionId[]
} => {
  if (routeSegments.length === 0) {
    throw new Error(`Route ${routeId} has no solved segments`)
  }

  const startPortId = problem.routeStartPort[routeId]
  const endPortId = problem.routeEndPort[routeId]
  const segmentsByPort = new Map<
    PortId,
    Array<RouteSegment & { segmentIndex: number }>
  >()

  routeSegments.forEach((routeSegment, segmentIndex) => {
    const indexedRouteSegment = {
      ...routeSegment,
      segmentIndex,
    }

    const fromPortSegments = segmentsByPort.get(routeSegment.fromPortId) ?? []
    fromPortSegments.push(indexedRouteSegment)
    segmentsByPort.set(routeSegment.fromPortId, fromPortSegments)

    const toPortSegments = segmentsByPort.get(routeSegment.toPortId) ?? []
    toPortSegments.push(indexedRouteSegment)
    segmentsByPort.set(routeSegment.toPortId, toPortSegments)
  })

  const orderedPortIds = [startPortId]
  const orderedRegionIds: RegionId[] = []
  const usedSegmentIndices = new Set<number>()
  let currentPortId = startPortId
  let previousPortId: PortId | undefined

  while (currentPortId !== endPortId) {
    const nextSegments = (segmentsByPort.get(currentPortId) ?? []).filter(
      (routeSegment) => {
        if (usedSegmentIndices.has(routeSegment.segmentIndex)) return false

        const nextPortId =
          routeSegment.fromPortId === currentPortId
            ? routeSegment.toPortId
            : routeSegment.fromPortId

        return nextPortId !== previousPortId
      },
    )

    if (nextSegments.length !== 1) {
      throw new Error(
        `Route ${routeId} is not a single ordered path from ${startPortId} to ${endPortId}`,
      )
    }

    const nextSegment = nextSegments[0]!
    const nextPortId =
      nextSegment.fromPortId === currentPortId
        ? nextSegment.toPortId
        : nextSegment.fromPortId

    usedSegmentIndices.add(nextSegment.segmentIndex)
    orderedRegionIds.push(nextSegment.regionId)
    orderedPortIds.push(nextPortId)
    previousPortId = currentPortId
    currentPortId = nextPortId
  }

  if (usedSegmentIndices.size !== routeSegments.length) {
    throw new Error(`Route ${routeId} contains disconnected solved segments`)
  }

  return {
    orderedPortIds,
    orderedRegionIds,
  }
}

export const createSolutionFromRouteSegments = (
  problem: TinyHyperGraphProblem,
  routeSegmentsByRoute: Array<RouteSegment[]>,
): TinyHyperGraphSolution => {
  const orderedPaths = routeSegmentsByRoute.map((routeSegments, routeId) =>
    getOrderedRoutePath(problem, routeId, routeSegments),
  )

  return {
    solvedRoutePathSegments: orderedPaths.map(({ orderedPortIds }) => {
      const pathSegments: Array<[PortId, PortId]> = []
      for (let portIndex = 1; portIndex < orderedPortIds.length; portIndex++) {
        pathSegments.push([
          orderedPortIds[portIndex - 1]!,
          orderedPortIds[portIndex]!,
        ])
      }

      return pathSegments
    }),
    solvedRouteRegionIds: orderedPaths.map(
      ({ orderedRegionIds }) => orderedRegionIds,
    ),
  }
}

export const createSolutionFromWorkingState = (
  problem: TinyHyperGraphProblem,
  state: TinyHyperGraphWorkingState,
): TinyHyperGraphSolution =>
  createSolutionFromRouteSegments(
    problem,
    getRouteSegmentsByRouteFromWorkingState(problem, state.regionSegments),
  )

const getSharedRegionIdsForPorts = (
  topology: TinyHyperGraphTopology,
  fromPortId: PortId,
  toPortId: PortId,
): RegionId[] => {
  const fromRegions = topology.incidentPortRegion[fromPortId] ?? []
  const toRegions = new Set(topology.incidentPortRegion[toPortId] ?? [])

  return fromRegions.filter((regionId) => toRegions.has(regionId))
}

export const getSolvedRouteRegionIds = (
  topology: TinyHyperGraphTopology,
  solution: TinyHyperGraphSolution,
): Array<RegionId[]> =>
  solution.solvedRoutePathSegments.map((segments, routeId) => {
    const explicitRegionIds = solution.solvedRouteRegionIds?.[routeId]

    return segments.map(([fromPortId, toPortId], segmentIndex) => {
      const explicitRegionId = explicitRegionIds?.[segmentIndex]
      if (explicitRegionId !== undefined) {
        return explicitRegionId
      }

      const sharedRegionIds = getSharedRegionIdsForPorts(
        topology,
        fromPortId,
        toPortId,
      )

      if (sharedRegionIds.length === 0) {
        throw new Error(
          `Route ${routeId} segment ${segmentIndex} between ports ${fromPortId} and ${toPortId} has no shared region`,
        )
      }

      return sharedRegionIds[0]!
    })
  })

export const getRouteSegmentsByRouteFromSolution = (
  topology: TinyHyperGraphTopology,
  solution: TinyHyperGraphSolution,
): Array<RouteSegment[]> => {
  const routeRegionIds = getSolvedRouteRegionIds(topology, solution)

  return solution.solvedRoutePathSegments.map((segments, routeId) =>
    segments.map(([fromPortId, toPortId], segmentIndex) => ({
      regionId: routeRegionIds[routeId]?.[segmentIndex] ?? 0,
      fromPortId,
      toPortId,
    })),
  )
}
