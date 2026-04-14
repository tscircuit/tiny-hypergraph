import type { TinyHyperGraphTopology } from "../core"
import type { PortId, RegionId, RouteId } from "../types"
import type { BusCenterCandidate, TracePreview } from "./busSolverTypes"
import { getPortDistance } from "./geometry"

export const getCenterCandidatePath = (candidate: BusCenterCandidate) => {
  const path: BusCenterCandidate[] = []
  let cursor: BusCenterCandidate | undefined = candidate

  while (cursor) {
    path.unshift(cursor)
    cursor = cursor.prevCandidate as BusCenterCandidate | undefined
  }

  return path
}

export const getCenterCandidatePathKey = (candidate: BusCenterCandidate) =>
  getCenterCandidatePath(candidate)
    .map(
      (pathCandidate) =>
        `${pathCandidate.portId}:${pathCandidate.nextRegionId}:${pathCandidate.atGoal ? 1 : 0}`,
    )
    .join("|")

export const centerCandidatePathContainsHop = (
  candidate: BusCenterCandidate,
  portId: PortId,
  nextRegionId: RegionId,
) => {
  let cursor: BusCenterCandidate | undefined = candidate

  while (cursor) {
    if (cursor.portId === portId && cursor.nextRegionId === nextRegionId) {
      return true
    }

    cursor = cursor.prevCandidate as BusCenterCandidate | undefined
  }

  return false
}

export const centerCandidatePathContainsRegion = (
  candidate: BusCenterCandidate,
  regionId: RegionId,
) => {
  let cursor: BusCenterCandidate | undefined = candidate

  while (cursor) {
    if (cursor.nextRegionId === regionId) {
      return true
    }

    cursor = cursor.prevCandidate as BusCenterCandidate | undefined
  }

  return false
}

export const getGuidePortIds = (
  centerPath: BusCenterCandidate[],
  sharedStepCount: number,
) => {
  const guidePortIds = centerPath.map((pathCandidate) => pathCandidate.portId)
  const startIndex = Math.min(
    sharedStepCount,
    Math.max(guidePortIds.length - 1, 0),
  )
  return guidePortIds.slice(startIndex)
}

export const getCandidateBoundaryNormal = (candidate: BusCenterCandidate) => {
  if (
    candidate.boundaryNormalX === undefined ||
    candidate.boundaryNormalY === undefined
  ) {
    return undefined
  }

  return {
    x: candidate.boundaryNormalX,
    y: candidate.boundaryNormalY,
  }
}

export const getPolylineLength = (
  topology: TinyHyperGraphTopology,
  polylinePortIds: readonly PortId[],
) => {
  let totalLength = 0

  for (let portIndex = 1; portIndex < polylinePortIds.length; portIndex++) {
    totalLength += getPortDistance(
      topology,
      polylinePortIds[portIndex - 1]!,
      polylinePortIds[portIndex]!,
    )
  }

  return totalLength
}

export const getTracePreviewLength = (
  topology: TinyHyperGraphTopology,
  tracePreview: TracePreview,
) =>
  tracePreview.segments.reduce((sum, segment) => {
    return sum + getPortDistance(topology, segment.fromPortId, segment.toPortId)
  }, 0)

export const isPortIncidentToRegion = (
  topology: TinyHyperGraphTopology,
  portId: PortId,
  regionId: RegionId,
) => topology.incidentPortRegion[portId]?.includes(regionId) ?? false

export const ensurePortOwnership = (
  routeId: RouteId,
  portId: PortId,
  usedPortOwners: Map<PortId, RouteId>,
) => {
  const owner = usedPortOwners.get(portId)
  if (owner !== undefined && owner !== routeId) {
    return false
  }

  usedPortOwners.set(portId, routeId)
  return true
}
