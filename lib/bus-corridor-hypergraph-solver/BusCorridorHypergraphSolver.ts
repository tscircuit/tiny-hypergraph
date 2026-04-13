import {
  TinyHyperGraphSolver,
  type Candidate,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "../core"
import type { PortId, RouteId } from "../types"

interface BusCorridorHypergraphSolverOptionTarget {
  CENTER_DISTANCE_TO_COST: number
  CENTERLINE_LAYER_DIFFERENCE_COST: number
}

export interface BusCorridorHypergraphSolverOptions
  extends TinyHyperGraphSolverOptions {
  CENTER_DISTANCE_TO_COST?: number
  CENTERLINE_LAYER_DIFFERENCE_COST?: number
}

interface PointLike {
  x: number
  y: number
}

interface CenterlineSegment {
  fromPortId: PortId
  toPortId: PortId
  x1: number
  y1: number
  x2: number
  y2: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const normalizeCoordinate = (value: number) => (Object.is(value, -0) ? 0 : value)

const getPortPointKey = (x: number, y: number) =>
  `${normalizeCoordinate(x).toFixed(9)},${normalizeCoordinate(y).toFixed(9)}`

const stripLayerSuffix = (portLabel: string) =>
  portLabel.replace(/_z\d+(?:::\d+)?$/, "")

const getPointToSegmentDistance = (
  pointX: number,
  pointY: number,
  segmentX1: number,
  segmentY1: number,
  segmentX2: number,
  segmentY2: number,
) => {
  const dx = segmentX2 - segmentX1
  const dy = segmentY2 - segmentY1
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return Math.hypot(pointX - segmentX1, pointY - segmentY1)
  }

  const projection = Math.max(
    0,
    Math.min(
      1,
      ((pointX - segmentX1) * dx + (pointY - segmentY1) * dy) / lengthSquared,
    ),
  )

  return Math.hypot(
    pointX - (segmentX1 + projection * dx),
    pointY - (segmentY1 + projection * dy),
  )
}

const getRoutePoint = (
  routeMetadata: unknown,
  pointIndex: number,
): PointLike | undefined => {
  if (!isRecord(routeMetadata)) {
    return undefined
  }

  const simpleRouteConnection = isRecord(routeMetadata.simpleRouteConnection)
    ? routeMetadata.simpleRouteConnection
    : undefined
  const pointsToConnect = Array.isArray(simpleRouteConnection?.pointsToConnect)
    ? simpleRouteConnection.pointsToConnect
    : undefined
  const point = isRecord(pointsToConnect?.[pointIndex])
    ? pointsToConnect[pointIndex]
    : undefined

  return typeof point?.x === "number" && typeof point?.y === "number"
    ? {
        x: point.x,
        y: point.y,
      }
    : undefined
}

const getExplicitBusOrder = (routeMetadata: unknown): number | undefined => {
  if (!isRecord(routeMetadata)) {
    return undefined
  }

  const busMetadata = isRecord(routeMetadata._bus)
    ? routeMetadata._bus
    : isRecord(routeMetadata.bus)
      ? routeMetadata.bus
      : undefined

  return typeof busMetadata?.order === "number" &&
    Number.isFinite(busMetadata.order)
    ? busMetadata.order
    : undefined
}

const getDominantAxis = (points: Array<PointLike | undefined>): "x" | "y" => {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of points) {
    if (!point) continue
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  const spreadX = Number.isFinite(minX) ? maxX - minX : 0
  const spreadY = Number.isFinite(minY) ? maxY - minY : 0

  return spreadX >= spreadY ? "x" : "y"
}

const getAverageAbsoluteRankDifference = (
  leftRanks: Float64Array,
  rightRanks: Float64Array,
  reverseRightRanks: boolean,
) => {
  let totalDifference = 0
  let comparableRouteCount = 0
  const maxRightRank = rightRanks.length - 1

  for (let routeId = 0; routeId < leftRanks.length; routeId++) {
    const leftRank = leftRanks[routeId]
    const rightRank = rightRanks[routeId]
    if (!Number.isFinite(leftRank) || !Number.isFinite(rightRank)) {
      continue
    }

    totalDifference += Math.abs(
      leftRank - (reverseRightRanks ? maxRightRank - rightRank : rightRank),
    )
    comparableRouteCount += 1
  }

  return comparableRouteCount > 0
    ? totalDifference / comparableRouteCount
    : Number.POSITIVE_INFINITY
}

const getRouteIdsInMedianFirstOrder = (routeIds: RouteId[]) => {
  const centerOutRouteIds: RouteId[] = []
  let left = Math.floor((routeIds.length - 1) / 2)
  let right = left + 1

  if (left >= 0) {
    centerOutRouteIds.push(routeIds[left]!)
  }

  while (left > 0 || right < routeIds.length) {
    left -= 1
    if (left >= 0) {
      centerOutRouteIds.push(routeIds[left]!)
    }
    if (right < routeIds.length) {
      centerOutRouteIds.push(routeIds[right]!)
      right += 1
    }
  }

  return centerOutRouteIds
}

const getRouteIdsInBusOrder = (problem: TinyHyperGraphProblem) => {
  const routeIds = Array.from(
    { length: problem.routeCount },
    (_, routeId) => routeId as RouteId,
  )
  const explicitBusOrders = routeIds.map((routeId) =>
    getExplicitBusOrder(problem.routeMetadata?.[routeId]),
  )

  if (explicitBusOrders.every((order) => order !== undefined)) {
    return [...routeIds].sort(
      (leftRouteId, rightRouteId) =>
        explicitBusOrders[leftRouteId]! - explicitBusOrders[rightRouteId]!,
    )
  }

  const startPoints = routeIds.map((routeId) =>
    getRoutePoint(problem.routeMetadata?.[routeId], 0),
  )
  const endPoints = routeIds.map((routeId) =>
    getRoutePoint(problem.routeMetadata?.[routeId], 1),
  )
  const startAxis = getDominantAxis(startPoints)
  const endAxis = getDominantAxis(endPoints)
  const startRankByRouteId = new Float64Array(problem.routeCount).fill(
    Number.POSITIVE_INFINITY,
  )
  const endRankByRouteId = new Float64Array(problem.routeCount).fill(
    Number.POSITIVE_INFINITY,
  )

  const startRoutesWithPoints = routeIds.filter((routeId) => startPoints[routeId])
  const endRoutesWithPoints = routeIds.filter((routeId) => endPoints[routeId])

  startRoutesWithPoints
    .sort((leftRouteId, rightRouteId) => {
      const leftPoint = startPoints[leftRouteId]!
      const rightPoint = startPoints[rightRouteId]!
      const leftValue = leftPoint[startAxis]
      const rightValue = rightPoint[startAxis]

      if (leftValue !== rightValue) {
        return leftValue - rightValue
      }

      return leftRouteId - rightRouteId
    })
    .forEach((routeId, rank) => {
      startRankByRouteId[routeId] = rank
    })

  endRoutesWithPoints
    .sort((leftRouteId, rightRouteId) => {
      const leftPoint = endPoints[leftRouteId]!
      const rightPoint = endPoints[rightRouteId]!
      const leftValue = leftPoint[endAxis]
      const rightValue = rightPoint[endAxis]

      if (leftValue !== rightValue) {
        return leftValue - rightValue
      }

      return leftRouteId - rightRouteId
    })
    .forEach((routeId, rank) => {
      endRankByRouteId[routeId] = rank
    })

  const reverseEndRanks =
    getAverageAbsoluteRankDifference(startRankByRouteId, endRankByRouteId, true) <
    getAverageAbsoluteRankDifference(startRankByRouteId, endRankByRouteId, false)

  return [...routeIds].sort((leftRouteId, rightRouteId) => {
    const leftStartRank = Number.isFinite(startRankByRouteId[leftRouteId])
      ? startRankByRouteId[leftRouteId]
      : leftRouteId
    const rightStartRank = Number.isFinite(startRankByRouteId[rightRouteId])
      ? startRankByRouteId[rightRouteId]
      : rightRouteId
    const leftEndRank = Number.isFinite(endRankByRouteId[leftRouteId])
      ? reverseEndRanks
        ? problem.routeCount - 1 - endRankByRouteId[leftRouteId]
        : endRankByRouteId[leftRouteId]
      : leftRouteId
    const rightEndRank = Number.isFinite(endRankByRouteId[rightRouteId])
      ? reverseEndRanks
        ? problem.routeCount - 1 - endRankByRouteId[rightRouteId]
        : endRankByRouteId[rightRouteId]
      : rightRouteId
    const leftAverageRank = (leftStartRank + leftEndRank) / 2
    const rightAverageRank = (rightStartRank + rightEndRank) / 2

    if (leftAverageRank !== rightAverageRank) {
      return leftAverageRank - rightAverageRank
    }
    if (leftStartRank !== rightStartRank) {
      return leftStartRank - rightStartRank
    }
    if (leftEndRank !== rightEndRank) {
      return leftEndRank - rightEndRank
    }

    return leftRouteId - rightRouteId
  })
}

export class BusCorridorHypergraphSolver extends TinyHyperGraphSolver {
  CENTER_DISTANCE_TO_COST = 0.1
  CENTERLINE_LAYER_DIFFERENCE_COST = 5

  readonly routeIdsInBusOrder: RouteId[]
  readonly routeIdsInSolveOrder: RouteId[]
  readonly routeDistanceFromCenterByRouteId: Float64Array
  readonly centerRouteId: RouteId | undefined
  readonly portPointKeyByPortId: string[]
  readonly portIdsByPointKey: Map<string, PortId[]>
  centerlineSegments: CenterlineSegment[]
  centerlineLayer: number | undefined

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: BusCorridorHypergraphSolverOptions,
  ) {
    super(topology, problem, options)

    if (options?.CENTER_DISTANCE_TO_COST !== undefined) {
      this.CENTER_DISTANCE_TO_COST = options.CENTER_DISTANCE_TO_COST
    }
    if (options?.CENTERLINE_LAYER_DIFFERENCE_COST !== undefined) {
      this.CENTERLINE_LAYER_DIFFERENCE_COST =
        options.CENTERLINE_LAYER_DIFFERENCE_COST
    }

    this.routeIdsInBusOrder = getRouteIdsInBusOrder(problem)
    this.routeIdsInSolveOrder = getRouteIdsInMedianFirstOrder(
      this.routeIdsInBusOrder,
    )
    this.centerRouteId = this.routeIdsInSolveOrder[0]
    this.routeDistanceFromCenterByRouteId = new Float64Array(
      problem.routeCount,
    )
    this.portPointKeyByPortId = Array.from(
      { length: topology.portCount },
      (_, portId) => getPortPointKey(topology.portX[portId], topology.portY[portId]),
    )
    this.portIdsByPointKey = new Map()
    this.centerlineSegments = []
    this.centerlineLayer = undefined

    const centerRouteIndex = Math.floor((this.routeIdsInBusOrder.length - 1) / 2)
    this.routeIdsInBusOrder.forEach((routeId, routeIndex) => {
      this.routeDistanceFromCenterByRouteId[routeId] = Math.abs(
        routeIndex - centerRouteIndex,
      )
    })
    this.portPointKeyByPortId.forEach((pointKey, portId) => {
      const portIds = this.portIdsByPointKey.get(pointKey) ?? []
      portIds.push(portId as PortId)
      this.portIdsByPointKey.set(pointKey, portIds)
    })

    this.state.unroutedRoutes = [...this.routeIdsInSolveOrder]
  }

  getPortDebugLabel(portId: PortId) {
    const serializedPortId = this.topology.portMetadata?.[portId]?.serializedPortId
    return serializedPortId ?? `port-${portId}`
  }

  getPortPointDebugLabel(portId: PortId) {
    return stripLayerSuffix(this.getPortDebugLabel(portId))
  }

  getAssignedPortPointOccupant(portId: PortId) {
    const pointKey = this.portPointKeyByPortId[portId]
    const portIds = pointKey ? this.portIdsByPointKey.get(pointKey) : undefined

    return portIds?.find(
      (candidatePortId) => this.state.portAssignment[candidatePortId] !== -1,
    )
  }

  isAssignedPort(portId: PortId) {
    return this.state.portAssignment[portId] !== -1
  }

  isAssignedPortPoint(portId: PortId) {
    return this.getAssignedPortPointOccupant(portId) !== undefined
  }

  setCenterlineLayerFromSolvedSegments(
    routeId: RouteId,
    solvedSegments: Array<{
      regionId: number
      fromPortId: PortId
      toPortId: PortId
    }>,
  ) {
    if (this.centerlineLayer !== undefined || routeId !== this.centerRouteId) {
      return
    }

    const layerCounts = new Map<number, number>()

    if (solvedSegments.length === 0) {
      const startPortId = this.problem.routeStartPort[routeId]
      this.centerlineLayer = this.topology.portZ[startPortId]
      return
    }

    for (const { fromPortId, toPortId } of solvedSegments) {
      for (const portId of [fromPortId, toPortId]) {
        const z = this.topology.portZ[portId]
        layerCounts.set(z, (layerCounts.get(z) ?? 0) + 1)
      }
    }

    const [preferredLayer] =
      [...layerCounts.entries()].sort((left, right) => {
        if (left[1] !== right[1]) {
          return right[1] - left[1]
        }

        return left[0] - right[0]
      })[0] ?? []

    this.centerlineLayer =
      preferredLayer ?? this.topology.portZ[this.problem.routeStartPort[routeId]]
  }

  setCenterlineGeometryFromSolvedSegments(
    routeId: RouteId,
    solvedSegments: Array<{
      regionId: number
      fromPortId: PortId
      toPortId: PortId
    }>,
  ) {
    if (routeId !== this.centerRouteId) {
      return
    }

    this.centerlineSegments = solvedSegments.map(({ fromPortId, toPortId }) => ({
      fromPortId,
      toPortId,
      x1: this.topology.portX[fromPortId],
      y1: this.topology.portY[fromPortId],
      x2: this.topology.portX[toPortId],
      y2: this.topology.portY[toPortId],
    }))
  }

  failForAssignedRoutePort(
    routeId: RouteId,
    portId: PortId,
    endpoint: "start" | "end" | "path",
  ) {
    const occupantPortId = this.getAssignedPortPointOccupant(portId) ?? portId
    const connectionId =
      this.problem.routeMetadata?.[routeId]?.connectionId ?? `route-${routeId}`
    this.failed = true
    this.error = `Bus route ${connectionId} cannot reuse assigned ${endpoint} port point ${this.getPortPointDebugLabel(portId)} via ${this.getPortDebugLabel(portId)} (occupied by ${this.getPortDebugLabel(occupantPortId)})`
    this.stats = {
      ...this.stats,
      failedRouteId: routeId,
      failedConnectionId: connectionId,
      failedPortId: portId,
      failedPortLabel: this.getPortDebugLabel(portId),
      failedPortPointLabel: this.getPortPointDebugLabel(portId),
      conflictingPortId: occupantPortId,
      conflictingPortLabel: this.getPortDebugLabel(occupantPortId),
      failedPortEndpoint: endpoint,
      ripCount: 0,
    }
  }

  override _step() {
    if (this.state.currentRouteId === undefined) {
      const nextRouteId = this.state.unroutedRoutes[0]

      if (nextRouteId !== undefined) {
        const startPortId = this.problem.routeStartPort[nextRouteId]
        if (this.isAssignedPortPoint(startPortId)) {
          this.failForAssignedRoutePort(nextRouteId, startPortId, "start")
          return
        }

        const endPortId = this.problem.routeEndPort[nextRouteId]
        if (this.isAssignedPortPoint(endPortId)) {
          this.failForAssignedRoutePort(nextRouteId, endPortId, "end")
          return
        }
      }
    }

    super._step()
  }

  getDistanceFromCenterline(portId: PortId) {
    if (this.centerlineSegments.length === 0) {
      return 0
    }

    const pointX = this.topology.portX[portId]
    const pointY = this.topology.portY[portId]
    let minDistance = Number.POSITIVE_INFINITY

    for (const segment of this.centerlineSegments) {
      minDistance = Math.min(
        minDistance,
        getPointToSegmentDistance(
          pointX,
          pointY,
          segment.x1,
          segment.y1,
          segment.x2,
          segment.y2,
        ),
      )
    }

    return Number.isFinite(minDistance) ? minDistance : 0
  }

  getRouteDistanceFromCenter(routeId: RouteId) {
    return this.routeDistanceFromCenterByRouteId[routeId] ?? 0
  }

  getCorridorPenalty(routeId: RouteId, boundaryPortId: PortId) {
    if (
      routeId === this.centerRouteId ||
      this.centerlineSegments.length === 0
    ) {
      return 0
    }

    return this.getDistanceFromCenterline(boundaryPortId) * this.CENTER_DISTANCE_TO_COST
  }

  getCenterlineLayerPenalty(routeId: RouteId, boundaryPortId: PortId) {
    if (
      routeId === this.centerRouteId ||
      this.centerlineLayer === undefined
    ) {
      return 0
    }

    const boundaryPortLayer = this.topology.portZ[boundaryPortId]
    return (
      Math.abs(boundaryPortLayer - this.centerlineLayer) *
      this.CENTERLINE_LAYER_DIFFERENCE_COST
    )
  }

  override _setup() {
    this.state.unroutedRoutes = [...this.routeIdsInSolveOrder]
    this.centerlineSegments = []
    this.centerlineLayer = undefined
    this.stats = {
      ...this.stats,
      routeIdsInBusOrder: [...this.routeIdsInBusOrder],
      routeIdsInSolveOrder: [...this.routeIdsInSolveOrder],
    }
    void this.problemSetup
  }

  override resetRoutingStateForRerip() {
    super.resetRoutingStateForRerip()
    this.state.unroutedRoutes = [...this.routeIdsInSolveOrder]
    this.centerlineSegments = []
    this.centerlineLayer = undefined
  }

  override onAllRoutesRouted() {
    this.stats = {
      ...this.stats,
      ripCount: 0,
    }
    this.solved = true
  }

  override onOutOfCandidates() {
    const failedRouteId = this.state.currentRouteId
    const failedConnectionId =
      failedRouteId !== undefined &&
      typeof this.problem.routeMetadata?.[failedRouteId]?.connectionId === "string"
        ? this.problem.routeMetadata[failedRouteId].connectionId
        : undefined

    this.failed = true
    this.error =
      failedConnectionId !== undefined
        ? `Out of candidates while routing ${failedConnectionId}`
        : failedRouteId !== undefined
          ? `Out of candidates while routing route ${failedRouteId}`
          : "Out of candidates while routing bus corridor"
    this.stats = {
      ...this.stats,
      failedRouteId,
      failedConnectionId,
      ripCount: 0,
    }
  }

  override isPortReservedForDifferentNet(portId: PortId): boolean {
    return (
      this.isAssignedPortPoint(portId) ||
      super.isPortReservedForDifferentNet(portId)
    )
  }

  override onPathFound(finalCandidate: Candidate) {
    const currentRouteId = this.state.currentRouteId
    if (currentRouteId === undefined) return

    const solvedSegments = this.getSolvedPathSegments(finalCandidate)
    for (const { fromPortId, toPortId } of solvedSegments) {
      if (this.isAssignedPortPoint(fromPortId)) {
        this.failForAssignedRoutePort(currentRouteId, fromPortId, "path")
        return
      }

      if (this.isAssignedPortPoint(toPortId)) {
        this.failForAssignedRoutePort(currentRouteId, toPortId, "path")
        return
      }
    }

    this.setCenterlineGeometryFromSolvedSegments(currentRouteId, solvedSegments)
    this.setCenterlineLayerFromSolvedSegments(currentRouteId, solvedSegments)
    super.onPathFound(finalCandidate)
  }

  override computeG(currentCandidate: Candidate, neighborPortId: PortId): number {
    const baseG = super.computeG(currentCandidate, neighborPortId)
    if (!Number.isFinite(baseG)) {
      return baseG
    }

    const currentRouteId = this.state.currentRouteId
    if (currentRouteId === undefined) {
      return baseG
    }

    return (
      baseG +
      this.getCorridorPenalty(currentRouteId, neighborPortId) +
      this.getCenterlineLayerPenalty(currentRouteId, neighborPortId)
    )
  }
}
