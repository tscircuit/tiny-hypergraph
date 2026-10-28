import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

type Region = SerializedHyperGraph["regions"][number]
type Port = SerializedHyperGraph["ports"][number]
type Point = { x: number; y: number }
type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

const getBounds = (region: Region | undefined): Bounds | undefined => {
  if (!region) return undefined
  const d = region.d
  const b = d?.bounds
  let bounds: Bounds
  if (b !== undefined) {
    if (typeof b !== "object" || b === null) return undefined
    bounds = b as Bounds
  } else {
    const center = d?.center
    if (!center || typeof center.x !== "number" || typeof center.y !== "number" ||
      typeof d?.width !== "number" || typeof d?.height !== "number") return undefined
    bounds = { minX: center.x - d.width / 2, maxX: center.x + d.width / 2,
      minY: center.y - d.height / 2, maxY: center.y + d.height / 2 }
  }
  const { minX, maxX, minY, maxY } = bounds
  if (![minX, maxX, minY, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) return undefined
  // The loader uses explicit center/dimensions when present. A certificate must
  // not rely on contradictory legacy bounds to prove a different rectangle.
  const width = typeof d?.width === "number" ? d.width : maxX - minX
  const height = typeof d?.height === "number" ? d.height : maxY - minY
  const cx = typeof d?.center?.x === "number" ? d.center.x : (minX + maxX) / 2
  const cy = typeof d?.center?.y === "number" ? d.center.y : (minY + maxY) / 2
  const actual = [cx - width / 2, cx + width / 2, cy - height / 2, cy + height / 2]
  const declared = [minX, maxX, minY, maxY]
  const epsilon = 32 * Number.EPSILON * Math.max(1, ...actual.map(Math.abs), ...declared.map(Math.abs))
  if (![width, height, cx, cy, ...actual].every(Number.isFinite) || width <= 0 || height <= 0 ||
    actual.some((value, index) => Math.abs(value - declared[index]) > epsilon)) return undefined
  return bounds
}

/** A positive boundary-order promise forbids off-edge fallback geometry. */
export const getCertifiedBoundaryDuplicatePoints = (
  source: Port,
  first: Region | undefined,
  second: Region | undefined,
  preferred: Point,
  count: number,
  proximity: number,
): Point[] => {
  const fail = (): never => { throw new Error(`Port "${source.portId}" has a boundary-order certificate without a proven common rectangle edge`) }
  const a = getBounds(first), b = getBounds(second)
  const x = source.d?.x, y = source.d?.y
  if (!a || !b || typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return fail()
  const epsilon = 32 * Number.EPSILON * Math.max(1, Math.abs(x), Math.abs(y), ...Object.values(a).map(Math.abs), ...Object.values(b).map(Math.abs))
  if (epsilon > Math.min(a.maxX - a.minX, a.maxY - a.minY, b.maxX - b.minX, b.maxY - b.minY) * 1e-8) return fail()
  const edges: Array<{ vertical: boolean; min: number; max: number }> = []
  for (const vertical of [true, false]) {
    const normal = vertical ? x : y, tangent = vertical ? y : x
    const opposingFaces = vertical ? [[a.maxX, b.minX], [b.maxX, a.minX]] :
      [[a.maxY, b.minY], [b.maxY, a.minY]]
    const min = vertical ? Math.max(a.minY, b.minY) : Math.max(a.minX, b.minX)
    const max = vertical ? Math.min(a.maxY, b.maxY) : Math.min(a.maxX, b.maxX)
    if (max - min <= 4 * epsilon || tangent < min - epsilon || tangent > max + epsilon) continue
    if (opposingFaces.some(([av, bv]) => Math.abs(av - bv) <= epsilon && Math.abs(normal - av) <= epsilon && Math.abs(normal - bv) <= epsilon)) {
      edges.push({ vertical, min, max })
    }
  }
  if (edges.length !== 1) return fail()
  const { vertical, min, max } = edges[0]
  const tangent = vertical ? y : x
  const preferredTangent = vertical ? preferred.y : preferred.x
  const lowerRoom = tangent - min, upperRoom = max - tangent
  let sign = preferredTangent < 0 ? -1 : preferredTangent > 0 ? 1 : upperRoom >= lowerRoom ? 1 : -1
  let room = sign > 0 ? upperRoom : lowerRoom
  if (room <= 4 * epsilon) {
    sign = -sign
    room = sign > 0 ? upperRoom : lowerRoom
  }
  const extent = Math.min(proximity, room - 2 * epsilon)
  if (!(extent > 2 * epsilon) || !Number.isFinite(extent)) return fail()
  const points: Point[] = []
  let previous = tangent
  for (let index = 1; index <= count; index++) {
    const coordinate = tangent + sign * extent * index / (count + 1)
    if (coordinate <= min + epsilon || coordinate >= max - epsilon || coordinate === previous) return fail()
    // Preserve the source's already-proven normal coordinate; do not project a
    // suspect source onto a guessed boundary or follow the center-to-center normal.
    points.push(vertical ? { x, y: coordinate } : { x: coordinate, y })
    previous = coordinate
  }
  return points
}
