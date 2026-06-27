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
  const fromPortRegions = topology.incidentPortRegion[fromPortId]
  const toPortRegions = topology.incidentPortRegion[toPortId]
  const fromAngle =
    fromPortRegions[0] === regionId || fromPortRegions[1] !== regionId
      ? topology.portAngleForRegion1[fromPortId]
      : (topology.portAngleForRegion2?.[fromPortId] ??
        topology.portAngleForRegion1[fromPortId])
  const toAngle =
    toPortRegions[0] === regionId || toPortRegions[1] !== regionId
      ? topology.portAngleForRegion1[toPortId]
      : (topology.portAngleForRegion2?.[toPortId] ??
        topology.portAngleForRegion1[toPortId])
  const fromZ = topology.portZ[fromPortId]
  const toZ = topology.portZ[toPortId]

  scratch.lesserAngle = fromAngle < toAngle ? fromAngle : toAngle
  scratch.greaterAngle = fromAngle < toAngle ? toAngle : fromAngle
  scratch.layerMask = (1 << fromZ) | (1 << toZ)
  scratch.entryExitLayerChanges = fromZ !== toZ ? 1 : 0

  return scratch
}
