/** Immutable manufactured copper, in the same physical frame as the ports. */
export interface TinyHyperGraphFixedCopperSegment {
  /** -1 means no proven routed owner, so every routed net is foreign. */
  netId: number
  x1: number
  y1: number
  x2: number
  y2: number
  z: number
  width: number
  clearance: number
}

export interface FixedCopperProblem {
  fixedCopperSegmentsByRegion?: readonly (readonly TinyHyperGraphFixedCopperSegment[])[]
  fixedCopperTraceWidthByRegion?: Float64Array
}

export const assertValidFixedCopperProblem = (
  regionCount: number,
  problem: FixedCopperProblem,
): void => {
  const segments = problem.fixedCopperSegmentsByRegion
  if (segments === undefined) {
    if (problem.fixedCopperTraceWidthByRegion !== undefined) {
      throw new Error("Fixed copper trace widths require fixed copper segments")
    }
    return
  }
  if (segments.length !== regionCount ||
    problem.fixedCopperTraceWidthByRegion?.length !== regionCount) {
    throw new Error("Fixed copper segments and trace widths must match regionCount")
  }
  for (let regionId = 0; regionId < regionCount; regionId++) {
    const traceWidth = problem.fixedCopperTraceWidthByRegion[regionId]
    if (!Number.isFinite(traceWidth) || traceWidth < 0) {
      throw new Error(`Fixed copper region ${regionId} has invalid trace width`)
    }
    if (!Array.isArray(segments[regionId])) {
      throw new Error(`Fixed copper region ${regionId} segments must be an array`)
    }
    for (const segment of segments[regionId]) {
      if (typeof segment !== "object" || segment === null) {
        throw new Error(`Fixed copper region ${regionId} has invalid segment geometry or ownership`)
      }
      if (![segment.x1, segment.y1, segment.x2, segment.y2,
        segment.width, segment.clearance].every(Number.isFinite) ||
        segment.width < 0 || segment.clearance < 0 ||
        !Number.isInteger(segment.z) || segment.z < 0 || segment.z > 30 ||
        !Number.isInteger(segment.netId) || segment.netId < -1) {
        throw new Error(`Fixed copper region ${regionId} has invalid segment geometry or ownership`)
      }
    }
  }
}

const pointSegmentDistanceSquared = (
  x: number, y: number, ax: number, ay: number, bx: number, by: number,
): number => {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 :
    Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared))
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2
}

/** Finite segments, including degenerate through-via footprints. */
export const fixedCopperCapsuleTouchesChord = (
  x1: number, y1: number, x2: number, y2: number,
  segment: TinyHyperGraphFixedCopperSegment,
  traceWidth: number,
): boolean => {
  const radius = (segment.width + traceWidth) / 2 + segment.clearance
  if (Math.max(x1, x2) < Math.min(segment.x1, segment.x2) - radius ||
    Math.min(x1, x2) > Math.max(segment.x1, segment.x2) + radius ||
    Math.max(y1, y2) < Math.min(segment.y1, segment.y2) - radius ||
    Math.min(y1, y2) > Math.max(segment.y1, segment.y2) + radius) return false
  const dx = x2 - x1
  const dy = y2 - y1
  const fx = segment.x2 - segment.x1
  const fy = segment.y2 - segment.y1
  const a = dx * (segment.y1 - y1) - dy * (segment.x1 - x1)
  const b = dx * (segment.y2 - y1) - dy * (segment.x2 - x1)
  const c = fx * (y1 - segment.y1) - fy * (x1 - segment.x1)
  const d = fx * (y2 - segment.y1) - fy * (x2 - segment.x1)
  if (((a < 0 && b > 0) || (a > 0 && b < 0)) &&
    ((c < 0 && d > 0) || (c > 0 && d < 0))) return true
  return Math.min(
    pointSegmentDistanceSquared(x1, y1, segment.x1, segment.y1, segment.x2, segment.y2),
    pointSegmentDistanceSquared(x2, y2, segment.x1, segment.y1, segment.x2, segment.y2),
    pointSegmentDistanceSquared(segment.x1, segment.y1, x1, y1, x2, y2),
    pointSegmentDistanceSquared(segment.x2, segment.y2, x1, y1, x2, y2),
  ) <= radius * radius
}
