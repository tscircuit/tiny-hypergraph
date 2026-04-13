import type { TinyHyperGraphTopology } from "../core"
import type { PortId } from "../types"

const EPSILON = 1e-9

const getPortPoint = (topology: TinyHyperGraphTopology, portId: PortId) => ({
  x: topology.portX[portId],
  y: topology.portY[portId],
  z: topology.portZ[portId],
})

const orientation = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)

const hasOppositeSigns = (left: number, right: number) =>
  (left > EPSILON && right < -EPSILON) || (left < -EPSILON && right > EPSILON)

export const doSegmentsIntersectInXY = (
  topology: TinyHyperGraphTopology,
  portAId: PortId,
  portBId: PortId,
  portCId: PortId,
  portDId: PortId,
) => {
  const portA = getPortPoint(topology, portAId)
  const portB = getPortPoint(topology, portBId)
  const portC = getPortPoint(topology, portCId)
  const portD = getPortPoint(topology, portDId)

  const abC = orientation(portA.x, portA.y, portB.x, portB.y, portC.x, portC.y)
  const abD = orientation(portA.x, portA.y, portB.x, portB.y, portD.x, portD.y)
  const cdA = orientation(portC.x, portC.y, portD.x, portD.y, portA.x, portA.y)
  const cdB = orientation(portC.x, portC.y, portD.x, portD.y, portB.x, portB.y)

  return hasOppositeSigns(abC, abD) && hasOppositeSigns(cdA, cdB)
}

export const doSegmentsOverlapInZ = (
  topology: TinyHyperGraphTopology,
  portAId: PortId,
  portBId: PortId,
  portCId: PortId,
  portDId: PortId,
) => {
  const zA1 = topology.portZ[portAId]
  const zA2 = topology.portZ[portBId]
  const zB1 = topology.portZ[portCId]
  const zB2 = topology.portZ[portDId]

  return zA1 === zB1 || zA1 === zB2 || zA2 === zB1 || zA2 === zB2
}

export const doSegmentsConflict = (
  topology: TinyHyperGraphTopology,
  portAId: PortId,
  portBId: PortId,
  portCId: PortId,
  portDId: PortId,
) =>
  doSegmentsOverlapInZ(topology, portAId, portBId, portCId, portDId) &&
  doSegmentsIntersectInXY(topology, portAId, portBId, portCId, portDId)

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

const getPointToPointDistance3d = (
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
) => Math.hypot(x1 - x2, y1 - y2, z1 - z2)

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

const getPointToSegmentDistance3d = (
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
) => {
  const abX = bx - ax
  const abY = by - ay
  const abZ = bz - az
  const abLengthSquared = abX * abX + abY * abY + abZ * abZ

  if (abLengthSquared <= EPSILON) {
    return getPointToPointDistance3d(px, py, pz, ax, ay, az)
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((px - ax) * abX + (py - ay) * abY + (pz - az) * abZ) / abLengthSquared,
    ),
  )
  const projectionX = ax + abX * t
  const projectionY = ay + abY * t
  const projectionZ = az + abZ * t

  return getPointToPointDistance3d(
    px,
    py,
    pz,
    projectionX,
    projectionY,
    projectionZ,
  )
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

export const getWeightedDistanceFromPortToPolyline = (
  topology: TinyHyperGraphTopology,
  portId: PortId,
  polylinePortIds: readonly PortId[],
  zDistanceScale: number,
) => {
  if (polylinePortIds.length === 0) {
    return Number.POSITIVE_INFINITY
  }

  const point = getPortPoint(topology, portId)
  const pointZ = point.z * zDistanceScale

  if (polylinePortIds.length === 1) {
    const anchor = getPortPoint(topology, polylinePortIds[0]!)
    return getPointToPointDistance3d(
      point.x,
      point.y,
      pointZ,
      anchor.x,
      anchor.y,
      anchor.z * zDistanceScale,
    )
  }

  let bestDistance = Number.POSITIVE_INFINITY

  for (let index = 1; index < polylinePortIds.length; index++) {
    const start = getPortPoint(topology, polylinePortIds[index - 1]!)
    const end = getPortPoint(topology, polylinePortIds[index]!)
    bestDistance = Math.min(
      bestDistance,
      getPointToSegmentDistance3d(
        point.x,
        point.y,
        pointZ,
        start.x,
        start.y,
        start.z * zDistanceScale,
        end.x,
        end.y,
        end.z * zDistanceScale,
      ),
    )
  }

  return bestDistance
}
