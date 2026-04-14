import type { TinyHyperGraphTopology } from "../core"
import type { PortId } from "../types"

const EPSILON = 1e-9

const getPortPoint = (topology: TinyHyperGraphTopology, portId: PortId) => ({
  x: topology.portX[portId],
  y: topology.portY[portId],
  z: topology.portZ[portId],
})

export const getPortProjection = (
  topology: TinyHyperGraphTopology,
  portId: PortId,
  normalX: number,
  normalY: number,
) => topology.portX[portId] * normalX + topology.portY[portId] * normalY

export const getPortDistance = (
  topology: TinyHyperGraphTopology,
  fromPortId: PortId,
  toPortId: PortId,
) =>
  Math.hypot(
    topology.portX[fromPortId] - topology.portX[toPortId],
    topology.portY[fromPortId] - topology.portY[toPortId],
  )

const getPointToPointDistance = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) => Math.hypot(x1 - x2, y1 - y2)

const getPointToSegmentDistance = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) => {
  const abX = bx - ax
  const abY = by - ay
  const abLengthSquared = abX * abX + abY * abY

  if (abLengthSquared <= EPSILON) {
    return getPointToPointDistance(px, py, ax, ay)
  }

  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * abX + (py - ay) * abY) / abLengthSquared),
  )
  const projectionX = ax + abX * t
  const projectionY = ay + abY * t

  return getPointToPointDistance(px, py, projectionX, projectionY)
}

export const getDistanceFromPortToPolyline = (
  topology: TinyHyperGraphTopology,
  portId: PortId,
  polylinePortIds: readonly PortId[],
) => {
  if (polylinePortIds.length === 0) {
    return Number.POSITIVE_INFINITY
  }

  const point = getPortPoint(topology, portId)

  if (polylinePortIds.length === 1) {
    const anchor = getPortPoint(topology, polylinePortIds[0]!)
    return getPointToPointDistance(point.x, point.y, anchor.x, anchor.y)
  }

  let bestDistance = Number.POSITIVE_INFINITY

  for (let index = 1; index < polylinePortIds.length; index++) {
    const start = getPortPoint(topology, polylinePortIds[index - 1]!)
    const end = getPortPoint(topology, polylinePortIds[index]!)
    bestDistance = Math.min(
      bestDistance,
      getPointToSegmentDistance(
        point.x,
        point.y,
        start.x,
        start.y,
        end.x,
        end.y,
      ),
    )
  }

  return bestDistance
}

export const getPortProgressAlongPolyline = (
  topology: TinyHyperGraphTopology,
  portId: PortId,
  polylinePortIds: readonly PortId[],
) => {
  if (polylinePortIds.length <= 1) {
    return 0
  }

  const point = getPortPoint(topology, portId)
  let bestDistance = Number.POSITIVE_INFINITY
  let bestProgress = 0
  let accumulatedLength = 0

  for (let index = 1; index < polylinePortIds.length; index++) {
    const start = getPortPoint(topology, polylinePortIds[index - 1]!)
    const end = getPortPoint(topology, polylinePortIds[index]!)
    const abX = end.x - start.x
    const abY = end.y - start.y
    const abLength = Math.hypot(abX, abY)

    if (abLength <= EPSILON) {
      continue
    }

    const t = Math.max(
      0,
      Math.min(1, ((point.x - start.x) * abX + (point.y - start.y) * abY) / (abLength * abLength)),
    )
    const projectionX = start.x + abX * t
    const projectionY = start.y + abY * t
    const distance = getPointToPointDistance(
      point.x,
      point.y,
      projectionX,
      projectionY,
    )

    if (distance < bestDistance) {
      bestDistance = distance
      bestProgress = accumulatedLength + abLength * t
    }

    accumulatedLength += abLength
  }

  return bestProgress
}
