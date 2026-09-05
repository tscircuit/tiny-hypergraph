interface Point {
  x: number
  y: number
}

interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** Keep duplicates on a shared rectangular edge, including at its endpoints. */
export const getBoundaryDuplicatePortPlacement = (params: {
  sourcePoint: Point
  direction: Point
  region1Bounds: Bounds
  region2Bounds: Bounds
  duplicatePortProximity: number
}): { direction: Point; maxDistance: number } => {
  const minX = Math.max(params.region1Bounds.minX, params.region2Bounds.minX)
  const maxX = Math.min(params.region1Bounds.maxX, params.region2Bounds.maxX)
  const minY = Math.max(params.region1Bounds.minY, params.region2Bounds.minY)
  const maxY = Math.min(params.region1Bounds.maxY, params.region2Bounds.maxY)
  const epsilon = 1e-9
  const isVerticalEdge =
    Math.abs(maxX - minX) <= epsilon &&
    maxY - minY > epsilon &&
    Math.abs(params.sourcePoint.x - minX) <= epsilon
  const isHorizontalEdge =
    Math.abs(maxY - minY) <= epsilon &&
    maxX - minX > epsilon &&
    Math.abs(params.sourcePoint.y - minY) <= epsilon
  if (!isVerticalEdge && !isHorizontalEdge) {
    return {
      direction: params.direction,
      maxDistance: params.duplicatePortProximity,
    }
  }
  const sourceCoordinate = isVerticalEdge
    ? params.sourcePoint.y
    : params.sourcePoint.x
  const minCoordinate = isVerticalEdge ? minY : minX
  const maxCoordinate = isVerticalEdge ? maxY : maxX
  let sign =
    Math.sign(isVerticalEdge ? params.direction.y : params.direction.x) || 1
  let availableDistance =
    sign > 0
      ? maxCoordinate - sourceCoordinate
      : sourceCoordinate - minCoordinate
  if (availableDistance <= epsilon) {
    sign *= -1
    availableDistance =
      sign > 0
        ? maxCoordinate - sourceCoordinate
        : sourceCoordinate - minCoordinate
  }
  return {
    direction: isVerticalEdge ? { x: 0, y: sign } : { x: sign, y: 0 },
    maxDistance: Math.min(
      params.duplicatePortProximity,
      Math.max(0, availableDistance),
    ),
  }
}
