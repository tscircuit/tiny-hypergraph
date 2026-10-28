import type { TinyHyperGraphTopology } from "./core"
import { assertViaFreePlanarRouting } from "./viaFreePlanarCrossings"
import type { NetId, PortId, RegionId, RouteId } from "./types"

export interface RegionLayerChangeProblem {
  regionLayerChangeAllowedNetIds?: Array<ReadonlySet<NetId> | undefined>
}

export const isRegionLayerChangeAllowed = (
  topology: { portZ: Int32Array },
  problem: RegionLayerChangeProblem,
  regionId: RegionId,
  fromPortId: PortId,
  toPortId: PortId,
  netId: NetId,
): boolean => {
  if (topology.portZ[fromPortId] === topology.portZ[toPortId]) return true
  const allowed = problem.regionLayerChangeAllowedNetIds?.[regionId]
  return allowed === undefined || allowed.has(netId)
}

export const assertValidRegionLayerChangePermissions = (
  regionCount: number,
  problem: RegionLayerChangeProblem,
): void => {
  const permissions = problem.regionLayerChangeAllowedNetIds
  if (permissions === undefined) return
  if (!Array.isArray(permissions) || permissions.length !== regionCount) {
    throw new Error("regionLayerChangeAllowedNetIds must have one entry per region")
  }
  permissions.forEach((allowed, regionId) => {
    if (allowed === undefined) return
    if (!(allowed instanceof Set)) {
      throw new Error(`Region ${regionId} layer-change permission must be a Set`)
    }
    for (const netId of allowed) {
      if (!Number.isSafeInteger(netId) || netId < 0 || netId > 0x7fffffff) {
        throw new Error(`Region ${regionId} layer-change permission has invalid net ${netId}`)
      }
    }
  })
}

export const assertRegionLayerChangeAllowed = (
  topology: { portZ: Int32Array },
  problem: RegionLayerChangeProblem,
  regionId: RegionId,
  fromPortId: PortId,
  toPortId: PortId,
  netId: NetId,
): void => {
  if (!isRegionLayerChangeAllowed(topology, problem, regionId, fromPortId, toPortId, netId)) {
    throw new Error(`Region ${regionId} does not allow a layer change for net ${netId}`)
  }
}

export const assertRouteSegmentsAllowLayerChanges = (
  topology: TinyHyperGraphTopology,
  problem: RegionLayerChangeProblem & { routeNet: Int32Array },
  segments: Array<[RouteId, PortId, PortId][]>,
): void => {
  if (problem.regionLayerChangeAllowedNetIds === undefined) return
  assertViaFreePlanarRouting(topology, problem, segments)
  for (let regionId = 0; regionId < segments.length; regionId++) {
    for (const [routeId, fromPortId, toPortId] of segments[regionId]) {
      assertRegionLayerChangeAllowed(topology, problem, regionId, fromPortId, toPortId, problem.routeNet[routeId])
    }
  }
}
