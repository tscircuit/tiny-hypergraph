import type { TinyHyperGraphTopology } from "./domain"
import type { PortId, RegionId } from "./types"

/** Geometry for one routed segment inside one region. */
export type SegmentGeometry = {
  readonly lesserAngle: number
  readonly greaterAngle: number
  readonly layerMask: number
  readonly entryExitLayerChanges: number
}

/** Mutable scratch object used by hot route-cost code to avoid allocations. */
export type SegmentGeometryScratch = {
  lesserAngle: number
  greaterAngle: number
  layerMask: number
  entryExitLayerChanges: number
}

export class SegmentGeometryTopologyError extends Error {
  readonly _tag = "SegmentGeometryTopologyError"

  constructor(reason: string) {
    super(`Invalid segment geometry topology: ${reason}`)
  }
}

/**
 * Create reusable segment geometry scratch storage.
 *
 * @returns A mutable scratch object initialized to zero values.
 */
export function createSegmentGeometryScratch(): SegmentGeometryScratch {
  return {
    lesserAngle: 0,
    greaterAngle: 0,
    layerMask: 0,
    entryExitLayerChanges: 0,
  }
}

const getPortAngleForRegion = (
  topology: TinyHyperGraphTopology,
  regionId: RegionId,
  portId: PortId,
): number => {
  const portRegions = topology.incidentPortRegion[portId]

  if (portRegions[0] === regionId) {
    return topology.portAngleForRegion1[portId]
  }

  if (portRegions[1] === regionId) {
    const angle = topology.portAngleForRegion2?.[portId]
    if (angle === undefined) {
      throw new SegmentGeometryTopologyError(
        `port ${portId} is missing region-2 angle for region ${regionId}`,
      )
    }

    return angle
  }

  throw new SegmentGeometryTopologyError(
    `port ${portId} is not incident to region ${regionId}`,
  )
}

/**
 * Read segment geometry for a pair of ports in a region.
 *
 * @param topology - The loaded graph topology.
 * @param regionId - Region containing the segment.
 * @param fromPortId - First port of the segment.
 * @param toPortId - Second port of the segment.
 * @param scratch - Mutable output storage.
 * @returns The populated scratch value.
 */
export function readSegmentGeometry(
  topology: TinyHyperGraphTopology,
  regionId: RegionId,
  fromPortId: PortId,
  toPortId: PortId,
  scratch: SegmentGeometryScratch,
): SegmentGeometryScratch {
  const fromAngle = getPortAngleForRegion(topology, regionId, fromPortId)
  const toAngle = getPortAngleForRegion(topology, regionId, toPortId)
  const fromZ = topology.portZ[fromPortId]
  const toZ = topology.portZ[toPortId]

  scratch.lesserAngle = fromAngle < toAngle ? fromAngle : toAngle
  scratch.greaterAngle = fromAngle < toAngle ? toAngle : fromAngle
  scratch.layerMask = (1 << fromZ) | (1 << toZ)
  scratch.entryExitLayerChanges = fromZ !== toZ ? 1 : 0

  return scratch
}
