import type { PortId, RegionId } from "../types"

type RouteSegment = {
  fromPortId: PortId
  toPortId: PortId
  regionId: RegionId
}

// A preloaded trace can leave a port and return along the same cells. Preserve
// every traversal, including repeated intermediate ports, when serializing it.
export const orderClosedRouteSegments = (
  routeId: number,
  startPortId: PortId,
  segments: readonly RouteSegment[],
): { orderedPortIds: PortId[]; orderedRegionIds: RegionId[] } => {
  const byPort = new Map<PortId, number[]>()
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!
    for (const portId of [segment.fromPortId, segment.toPortId]) {
      const incident = byPort.get(portId) ?? []
      incident.push(index)
      byPort.set(portId, incident)
    }
  }
  if ([...byPort.values()].some((incident) => incident.length % 2 !== 0)) {
    throw new Error(
      `Route ${routeId} contains an open branch in its closed path`,
    )
  }

  const used = new Uint8Array(segments.length)
  const cursor = new Map<PortId, number>()
  const ports = [startPortId]
  const regions: RegionId[] = []
  const orderedPortIds: PortId[] = []
  const orderedRegionIds: RegionId[] = []
  let usedCount = 0
  while (ports.length > 0) {
    const portId = ports[ports.length - 1]!
    const incident = byPort.get(portId) ?? []
    let next = cursor.get(portId) ?? 0
    while (next < incident.length && used[incident[next]!] !== 0) next++
    cursor.set(portId, next + 1)
    if (next < incident.length) {
      const index = incident[next]!
      const segment = segments[index]!
      used[index] = 1
      usedCount++
      ports.push(
        segment.fromPortId === portId ? segment.toPortId : segment.fromPortId,
      )
      regions.push(segment.regionId)
    } else {
      orderedPortIds.push(ports.pop()!)
      if (regions.length > 0) orderedRegionIds.push(regions.pop()!)
    }
  }
  if (usedCount !== segments.length) {
    throw new Error(`Route ${routeId} contains disconnected solved segments`)
  }
  return {
    orderedPortIds: orderedPortIds.reverse(),
    orderedRegionIds: orderedRegionIds.reverse(),
  }
}
