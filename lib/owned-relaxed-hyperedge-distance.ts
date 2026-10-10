import type { TinyHyperGraphTopology } from "./core"

/**
 * Certifies skipped native validation without changing the unsafe-input path.
 * At most P*R*degree edges enter the precheck, and a weighted parent chain is
 * no deeper than the expansion budget plus one. With Q*EPS <=1/16, sequential
 * rounding cannot double either nonnegative sum. Coordinates bounded by
 * MAX/(16Q) give native hypot <=4M and every accumulated distance <=MAX/2.
 */
export const getOwnedHyperedgeDistanceBound = (
  topology: TinyHyperGraphTopology,
  maxExpandedLabels: number,
  startPortId: number,
  startRegionId: number,
  goalPortId: number,
): number | undefined => {
  const portCount = topology.portCount
  const regionCount = topology.regionCount
  if (
    !Number.isSafeInteger(portCount) ||
    !Number.isSafeInteger(regionCount) ||
    portCount <= 0 ||
    regionCount <= 0 ||
    !Number.isSafeInteger(maxExpandedLabels) ||
    maxExpandedLabels < 0 ||
    !Number.isInteger(startPortId) ||
    startPortId < 0 ||
    startPortId >= portCount ||
    !Number.isInteger(goalPortId) ||
    goalPortId < 0 ||
    goalPortId >= portCount ||
    !Number.isInteger(startRegionId) ||
    startRegionId < 0 ||
    startRegionId >= regionCount
  ) {
    return undefined
  }

  const portX = topology.portX
  const portY = topology.portY
  if (
    !(portX instanceof Float64Array) ||
    !(portY instanceof Float64Array) ||
    portX.length < portCount ||
    portY.length < portCount ||
    (typeof SharedArrayBuffer !== "undefined" &&
      (portX.buffer instanceof SharedArrayBuffer ||
        portY.buffer instanceof SharedArrayBuffer))
  ) {
    return undefined
  }

  let maxDegree = 0
  for (let regionId = 0; regionId < regionCount; regionId++) {
    const ports = topology.regionIncidentPorts[regionId]
    if (!Array.isArray(ports)) return undefined
    maxDegree = Math.max(maxDegree, ports.length)
    for (const portId of ports) {
      if (!Number.isInteger(portId) || portId < 0 || portId >= portCount) {
        return undefined
      }
    }
  }
  for (let portId = 0; portId < portCount; portId++) {
    const regions = topology.incidentPortRegion[portId]
    if (!Array.isArray(regions)) return undefined
    for (const regionId of regions) {
      if (
        !Number.isInteger(regionId) ||
        regionId < 0 ||
        regionId >= regionCount
      ) {
        return undefined
      }
    }
  }

  const edgeCountBound = portCount * regionCount * maxDegree
  const pathDepthBound = maxExpandedLabels + 1
  const workBound = Math.max(1, edgeCountBound, pathDepthBound)
  if (
    !Number.isSafeInteger(edgeCountBound) ||
    !Number.isSafeInteger(pathDepthBound) ||
    !Number.isSafeInteger(workBound) ||
    workBound > 1 / (16 * Number.EPSILON)
  ) {
    return undefined
  }

  let maxCoordinate = 0
  for (let portId = 0; portId < portCount; portId++) {
    const x = portX[portId]!
    const y = portY[portId]!
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
    maxCoordinate = Math.max(maxCoordinate, Math.abs(x), Math.abs(y))
  }
  if (maxCoordinate > Number.MAX_VALUE / (16 * workBound)) {
    return undefined
  }
  return maxCoordinate * 4
}
