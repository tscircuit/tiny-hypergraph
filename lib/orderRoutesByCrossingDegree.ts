import type { PortId, RouteId } from "./types"

type CrossingTopology = {
  portX: ArrayLike<number>
  portY: ArrayLike<number>
  portZ: ArrayLike<number>
}

type RegionSegment = readonly [RouteId, PortId, PortId]

/**
 * Route the leaves of a crossing group before its center. The final center
 * then sees all crossing constraints and can share one excursion across them.
 * Weight repeated crossings separately and preserve the existing tie order.
 */
export const orderRoutesByCrossingDegree = (
  topology: CrossingTopology,
  regionSegments: ReadonlyArray<ReadonlyArray<RegionSegment>>,
  routeNetIds: ArrayLike<number>,
  routeOrder: readonly RouteId[],
): RouteId[] => {
  const { portX, portY, portZ } = topology
  const degrees = new Float64Array(routeNetIds.length)
  for (const segments of regionSegments) {
    for (let index = 0; index < segments.length; index++) {
      const [routeId, firstPort, secondPort] = segments[index]
      const netId = routeNetIds[routeId]
      const layerMask = (1 << portZ[firstPort]) | (1 << portZ[secondPort])
      const startX = portX[firstPort]
      const startY = portY[firstPort]
      const dx = portX[secondPort] - startX
      const dy = portY[secondPort] - startY
      for (let previousIndex = 0; previousIndex < index; previousIndex++) {
        const [otherRouteId, otherFirstPort, otherSecondPort] =
          segments[previousIndex]
        if (routeNetIds[otherRouteId] === netId) continue
        const otherLayerMask =
          (1 << portZ[otherFirstPort]) | (1 << portZ[otherSecondPort])
        if ((layerMask & otherLayerMask) === 0) continue
        const otherDx = portX[otherSecondPort] - portX[otherFirstPort]
        const otherDy = portY[otherSecondPort] - portY[otherFirstPort]
        const denominator = dx * otherDy - dy * otherDx
        if (denominator === 0) continue
        const offsetX = portX[otherFirstPort] - startX
        const offsetY = portY[otherFirstPort] - startY
        const position = (offsetX * otherDy - offsetY * otherDx) / denominator
        const otherPosition = (offsetX * dy - offsetY * dx) / denominator
        if (
          position <= 0 ||
          position >= 1 ||
          otherPosition <= 0 ||
          otherPosition >= 1
        ) {
          continue
        }
        degrees[routeId] += 1
        degrees[otherRouteId] += 1
      }
    }
  }
  const orderedRoutes = [...routeOrder]
  orderedRoutes.sort(
    (first, second): number => degrees[first] - degrees[second],
  )
  return orderedRoutes
}
