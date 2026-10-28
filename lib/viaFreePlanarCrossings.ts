import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "./core"
import type { NetId, PortId, RegionId, RouteId } from "./types"

type Geometry = Pick<TinyHyperGraphTopology,
  "portX" | "portY" | "portZ" | "regionWidth" | "regionHeight" |
  "regionCenterX" | "regionCenterY">
type Permissions = Pick<TinyHyperGraphProblem,
  "routeNet" | "regionLayerChangeAllowedNetIds" | "regionBoundaryPortOrderPreserved">

const getOpenBoundarySide = (t: Geometry, region: RegionId, port: PortId): number => {
  const x = t.portX[port], y = t.portY[port]
  const cx = t.regionCenterX[region], cy = t.regionCenterY[region]
  const width = t.regionWidth[region], height = t.regionHeight[region]
  if (![x, y, cx, cy, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return -1
  const dx = Math.abs(x - cx), dy = Math.abs(y - cy)
  // Allow only floating-point roundoff, not projected or interior endpoints.
  const epsilon = 32 * Number.EPSILON * Math.max(1, Math.abs(x), Math.abs(y), Math.abs(cx), Math.abs(cy), width, height)
  if (epsilon > Math.min(width, height) * 1e-8) return -1
  if (dx > width / 2 + epsilon || dy > height / 2 + epsilon) return -1
  const vertical = Math.abs(dx - width / 2) <= epsilon
  const horizontal = Math.abs(dy - height / 2) <= epsilon
  if (vertical === horizontal) return -1 // Interior points and corners are unproven.
  return vertical ? (x < cx ? 0 : 2) : (y < cy ? 1 : 3)
}

/** A hard planar obstruction requires two owners with no permitted via center.
 * Coarse layer masks alone are insufficient: detailed routing may use more layers.
 * Four distinct open rectangle sides preserve alternating order even when the
 * caller redistributes ports along an edge. Same-side order additionally requires
 * an explicit caller guarantee covering generated ports and fixed anchors.
 * Interior, projected, corner, tangent, and uncertain cases remain unproven.
 */
export const isViaFreePlanarCrossing = (
  t: Geometry, p: Permissions, region: RegionId,
  from: PortId, to: PortId, net: NetId,
  otherFrom: PortId, otherTo: PortId, otherNet: NetId,
): boolean => {
  const allowed = p.regionLayerChangeAllowedNetIds?.[region]
  if (allowed === undefined || net === otherNet || allowed.has(net) || allowed.has(otherNet)) return false
  const z = t.portZ[from]
  if (z < 0 || t.portZ[to] !== z || t.portZ[otherFrom] !== z || t.portZ[otherTo] !== z) return false
  let sides = 0
  for (const port of [from, to, otherFrom, otherTo]) {
    const side = getOpenBoundarySide(t, region, port)
    if (side === -1) return false
    if (p.regionBoundaryPortOrderPreserved?.[region] !== 1 && (sides & (1 << side)) !== 0) return false
    sides |= 1 << side
  }
  const ax = t.portX[from], ay = t.portY[from]
  const bx = t.portX[to] - ax, by = t.portY[to] - ay
  const cx = t.portX[otherFrom] - ax, cy = t.portY[otherFrom] - ay
  const dx = t.portX[otherTo] - ax, dy = t.portY[otherTo] - ay
  const first = bx * cy - by * cx, second = bx * dy - by * dx
  const third = (dx - cx) * -cy - (dy - cy) * -cx
  const fourth = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx)
  const epsilon = 128 * Number.EPSILON * Math.max(1,
    Math.abs(bx * cy), Math.abs(by * cx), Math.abs(bx * dy), Math.abs(by * dx),
    Math.abs((dx - cx) * cy), Math.abs((dy - cy) * cx),
    Math.abs((dx - cx) * (by - cy)), Math.abs((dy - cy) * (bx - cx)))
  const opposite = (a: number, b: number) => (a > epsilon && b < -epsilon) || (a < -epsilon && b > epsilon)
  return opposite(first, second) && opposite(third, fourth)
}

export const isViaFreePlanarHopAllowed = (
  t: Geometry, p: Permissions, segments: Array<[RouteId, PortId, PortId][]>,
  region: RegionId, from: PortId, to: PortId, net: NetId,
): boolean => {
  const allowed = p.regionLayerChangeAllowedNetIds?.[region]
  if (allowed === undefined || allowed.has(net)) return true
  for (const [route, otherFrom, otherTo] of segments[region] ?? []) {
    if (isViaFreePlanarCrossing(t, p, region, from, to, net, otherFrom, otherTo, p.routeNet[route])) return false
  }
  return true
}

export const assertViaFreePlanarRouting = (
  t: Geometry, p: Permissions, segments: Array<[RouteId, PortId, PortId][]>,
): void => {
  if (p.regionLayerChangeAllowedNetIds === undefined) return
  for (let region = 0; region < segments.length; region++) {
    if (p.regionLayerChangeAllowedNetIds[region] === undefined) continue
    for (const [route, from, to] of segments[region]) {
      if (!isViaFreePlanarHopAllowed(t, p, segments, region, from, to, p.routeNet[route])) {
        throw new Error(`Region ${region} has a crossing between nets that cannot change layers`)
      }
    }
  }
}
