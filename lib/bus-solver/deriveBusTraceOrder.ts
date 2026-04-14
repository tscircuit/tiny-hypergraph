import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "../core"
import type { RouteId } from "../types"

export interface OrderedBusTrace {
  routeId: RouteId
  orderIndex: number
  signedIndexFromCenter: number
  distanceFromCenter: number
  score: number
  connectionId: string
}

export interface BusTraceOrder {
  traces: OrderedBusTrace[]
  centerTraceIndex: number
  centerTraceRouteId: RouteId
  normalX: number
  normalY: number
}

const EPSILON = 1e-9

const getConnectionId = (
  problem: TinyHyperGraphProblem,
  routeId: RouteId,
): string => {
  const metadata = problem.routeMetadata?.[routeId]
  return typeof metadata?.connectionId === "string"
    ? metadata.connectionId
    : `route-${routeId}`
}

export const deriveBusTraceOrder = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
): BusTraceOrder => {
  if (problem.routeCount === 0) {
    throw new Error("Bus solver requires at least one route")
  }

  let startCenterX = 0
  let startCenterY = 0
  let endCenterX = 0
  let endCenterY = 0

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const startPortId = problem.routeStartPort[routeId]!
    const endPortId = problem.routeEndPort[routeId]!
    startCenterX += topology.portX[startPortId]
    startCenterY += topology.portY[startPortId]
    endCenterX += topology.portX[endPortId]
    endCenterY += topology.portY[endPortId]
  }

  startCenterX /= problem.routeCount
  startCenterY /= problem.routeCount
  endCenterX /= problem.routeCount
  endCenterY /= problem.routeCount

  let directionX = endCenterX - startCenterX
  let directionY = endCenterY - startCenterY
  const directionLength = Math.hypot(directionX, directionY)

  if (directionLength <= EPSILON) {
    directionX = 1
    directionY = 0
  } else {
    directionX /= directionLength
    directionY /= directionLength
  }

  const normalX = -directionY
  const normalY = directionX

  const rawTraceScores = Array.from(
    { length: problem.routeCount },
    (_, routeId) => {
      const startPortId = problem.routeStartPort[routeId]!
      const endPortId = problem.routeEndPort[routeId]!
      const startProjection =
        (topology.portX[startPortId] - startCenterX) * normalX +
        (topology.portY[startPortId] - startCenterY) * normalY
      const endProjection =
        (topology.portX[endPortId] - endCenterX) * normalX +
        (topology.portY[endPortId] - endCenterY) * normalY

      return {
        routeId,
        connectionId: getConnectionId(problem, routeId),
        startProjection,
        endProjection,
      }
    },
  )

  const endpointCorrelation = rawTraceScores.reduce(
    (sum, trace) => sum + trace.startProjection * trace.endProjection,
    0,
  )
  const endProjectionMultiplier = endpointCorrelation < 0 ? -1 : 1

  const orderedScores = rawTraceScores
    .map((trace) => ({
      routeId: trace.routeId,
      connectionId: trace.connectionId,
      score:
        (trace.startProjection +
          trace.endProjection * endProjectionMultiplier) /
        2,
    }))
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.connectionId.localeCompare(right.connectionId),
    )

  const centerTraceIndex = Math.floor((orderedScores.length - 1) / 2)
  const traces: OrderedBusTrace[] = orderedScores.map((trace, orderIndex) => ({
    routeId: trace.routeId,
    orderIndex,
    signedIndexFromCenter: orderIndex - centerTraceIndex,
    distanceFromCenter: Math.abs(orderIndex - centerTraceIndex),
    score: trace.score,
    connectionId: trace.connectionId,
  }))

  return {
    traces,
    centerTraceIndex,
    centerTraceRouteId: traces[centerTraceIndex]!.routeId,
    normalX,
    normalY,
  }
}
