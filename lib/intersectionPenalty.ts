const EPSILON = 1e-9

export const computePenaltyPointContribution = (
  distance: number,
  radius: number,
  magnitude: number,
  falloff: number,
) => {
  if (radius <= 0 || magnitude === 0 || distance >= radius) {
    return 0
  }

  const clampedFalloff = Math.max(falloff, EPSILON)
  const normalizedDistance = Math.min(Math.max(distance / radius, 0), 1)

  return magnitude * Math.pow(1 - normalizedDistance, clampedFalloff)
}

export const getLineSegmentIntersectionPoint = (
  ax1: number,
  ay1: number,
  ax2: number,
  ay2: number,
  bx1: number,
  by1: number,
  bx2: number,
  by2: number,
): { x: number; y: number } | null => {
  const aDx = ax2 - ax1
  const aDy = ay2 - ay1
  const bDx = bx2 - bx1
  const bDy = by2 - by1
  const denominator = aDx * bDy - aDy * bDx

  if (Math.abs(denominator) <= EPSILON) {
    return null
  }

  const deltaX = bx1 - ax1
  const deltaY = by1 - ay1
  const t = (deltaX * bDy - deltaY * bDx) / denominator
  const u = (deltaX * aDy - deltaY * aDx) / denominator

  if (t <= EPSILON || t >= 1 - EPSILON || u <= EPSILON || u >= 1 - EPSILON) {
    return null
  }

  return {
    x: ax1 + aDx * t,
    y: ay1 + aDy * t,
  }
}
