import { MinHeap } from "../MinHeap"
import {
  createEmptyRegionIntersectionCache,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "../core"
import type { PortId, RegionId, RouteId } from "../types"

type Vector2 = {
  x: number
  y: number
}

interface BusRoutePlan {
  routeId: RouteId
  routeNetId: number
  startPortId: PortId
  endPortId: PortId
  startTransitRegionId: RegionId
  endTransitRegionId: RegionId
  startOuterRegionId?: RegionId
  endOuterRegionId?: RegionId
  orderKey: number
  orderNorm: number
  regionPath: RegionId[]
}

interface BusGroup {
  busId: string
  orderingVector: Vector2
  routePlans: BusRoutePlan[]
  regionProjectionNorm: Float64Array
}

interface BusRegionEdge {
  key: string
  regionAId: RegionId
  regionBId: RegionId
  portIds: PortId[]
  capacity: number
}

interface RegionPathCandidate {
  regionId: RegionId
  cost: number
}

interface EdgePortOccurrence {
  routePlan: BusRoutePlan
  stepIndex: number
}

export interface TinyHyperGraphBusRoutingSolverOptions
  extends TinyHyperGraphSolverOptions {
  BUS_SIDE_BIAS_FACTOR?: number
  REGION_CAPACITY_COST_FACTOR?: number
  EDGE_CAPACITY_COST_FACTOR?: number
  REGION_HOP_COST?: number
}

const DEFAULT_ORDERING_VECTOR: Vector2 = { x: 0, y: 1 }
const VECTOR_EPSILON = 1e-9

const compareRegionPathCandidates = (
  left: RegionPathCandidate,
  right: RegionPathCandidate,
) => {
  if (left.cost !== right.cost) {
    return left.cost - right.cost
  }

  return left.regionId - right.regionId
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const getFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

const getNonNegativeFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined

const getVectorFromValue = (value: unknown): Vector2 | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const x = getFiniteNumber(Number(value.x))
  const y = getFiniteNumber(Number(value.y))

  if (x === undefined || y === undefined) {
    return undefined
  }

  return {
    x,
    y,
  }
}

const normalizeVector = (vector: Vector2 | undefined): Vector2 => {
  const source = vector ?? DEFAULT_ORDERING_VECTOR
  const magnitude = Math.hypot(source.x, source.y)

  if (!Number.isFinite(magnitude) || magnitude <= VECTOR_EPSILON) {
    return DEFAULT_ORDERING_VECTOR
  }

  return {
    x: source.x / magnitude,
    y: source.y / magnitude,
  }
}

const vectorsAreEquivalent = (left: Vector2, right: Vector2) =>
  Math.abs(left.x - right.x) <= VECTOR_EPSILON &&
  Math.abs(left.y - right.y) <= VECTOR_EPSILON

const projectOntoVector = (x: number, y: number, vector: Vector2) =>
  x * vector.x + y * vector.y

const normalizeProjection = (value: number, min: number, max: number) =>
  max - min <= VECTOR_EPSILON ? 0.5 : (value - min) / (max - min)

const getRegionPairKey = (regionAId: RegionId, regionBId: RegionId) =>
  regionAId < regionBId
    ? `${regionAId}:${regionBId}`
    : `${regionBId}:${regionAId}`

const getRouteBoundaryPortKey = (routeId: RouteId, stepIndex: number) =>
  `${routeId}:${stepIndex}`

const getSerializedRegionId = (regionMetadata: unknown, regionId: RegionId) => {
  if (isRecord(regionMetadata)) {
    if (typeof regionMetadata.serializedRegionId === "string") {
      return regionMetadata.serializedRegionId
    }

    if (typeof regionMetadata.regionId === "string") {
      return regionMetadata.regionId
    }
  }

  return `region-${regionId}`
}

const getBusIdFromRouteMetadata = (
  routeMetadata: unknown,
): string | undefined => {
  if (!isRecord(routeMetadata)) {
    return undefined
  }

  if (typeof routeMetadata.busId === "string") {
    return routeMetadata.busId
  }

  if (isRecord(routeMetadata.d) && typeof routeMetadata.d.busId === "string") {
    return routeMetadata.d.busId
  }

  if (isRecord(routeMetadata.bus)) {
    if (typeof routeMetadata.bus.busId === "string") {
      return routeMetadata.bus.busId
    }

    if (typeof routeMetadata.bus.id === "string") {
      return routeMetadata.bus.id
    }
  }

  if (isRecord(routeMetadata.d) && isRecord(routeMetadata.d.bus)) {
    if (typeof routeMetadata.d.bus.busId === "string") {
      return routeMetadata.d.bus.busId
    }

    if (typeof routeMetadata.d.bus.id === "string") {
      return routeMetadata.d.bus.id
    }
  }

  return undefined
}

const getOrderingVectorFromRouteMetadata = (
  routeMetadata: unknown,
): Vector2 | undefined => {
  if (!isRecord(routeMetadata)) {
    return undefined
  }

  const candidates = [
    routeMetadata.orderingVector,
    routeMetadata.busOrderingVector,
    isRecord(routeMetadata.d) ? routeMetadata.d.orderingVector : undefined,
    isRecord(routeMetadata.d) ? routeMetadata.d.busOrderingVector : undefined,
    isRecord(routeMetadata.bus) ? routeMetadata.bus.orderingVector : undefined,
    isRecord(routeMetadata.d) && isRecord(routeMetadata.d.bus)
      ? routeMetadata.d.bus.orderingVector
      : undefined,
  ]

  for (const candidate of candidates) {
    const vector = getVectorFromValue(candidate)
    if (vector) {
      return vector
    }
  }

  return undefined
}

const applyTinyHyperGraphBusRoutingSolverOptions = (
  solver: TinyHyperGraphBusRoutingSolver,
  options?: TinyHyperGraphBusRoutingSolverOptions,
) => {
  if (!options) {
    return
  }

  if (options.BUS_SIDE_BIAS_FACTOR !== undefined) {
    solver.BUS_SIDE_BIAS_FACTOR = options.BUS_SIDE_BIAS_FACTOR
  }
  if (options.REGION_CAPACITY_COST_FACTOR !== undefined) {
    solver.REGION_CAPACITY_COST_FACTOR = options.REGION_CAPACITY_COST_FACTOR
  }
  if (options.EDGE_CAPACITY_COST_FACTOR !== undefined) {
    solver.EDGE_CAPACITY_COST_FACTOR = options.EDGE_CAPACITY_COST_FACTOR
  }
  if (options.REGION_HOP_COST !== undefined) {
    solver.REGION_HOP_COST = options.REGION_HOP_COST
  }
}

export class TinyHyperGraphBusRoutingSolver extends TinyHyperGraphSolver {
  BUS_SIDE_BIAS_FACTOR = 2
  REGION_CAPACITY_COST_FACTOR = 0.5
  EDGE_CAPACITY_COST_FACTOR = 0.5
  REGION_HOP_COST = 0.001

  private serializedRegionIdToIndex = new Map<string, RegionId>()
  private abstractEdgesByRegion: BusRegionEdge[][] = []
  private abstractEdgeByKey = new Map<string, BusRegionEdge>()
  private regionUsageCount: Int32Array
  private portUsageCount: Int32Array
  private abstractEdgeUsageCount = new Map<string, number>()
  private busGroups?: BusGroup[]

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphBusRoutingSolverOptions,
  ) {
    super(topology, problem, options)
    this.regionUsageCount = new Int32Array(topology.regionCount)
    this.portUsageCount = new Int32Array(topology.portCount)
    applyTinyHyperGraphBusRoutingSolverOptions(this, options)
  }

  override _setup() {
    this.initializeBusRoutingGraph()
    this.busGroups = this.buildBusGroups()
    this.stats = {
      ...this.stats,
      mode: "bus-routing",
      busCount: this.busGroups.length,
    }
  }

  override _step() {
    if (this.solved || this.failed) {
      return
    }

    try {
      this.resetBusRoutingState()
      const busGroups = this.busGroups ?? this.buildBusGroups()

      for (const busGroup of busGroups) {
        this.solveBusGroup(busGroup)
      }

      this.state.unroutedRoutes = []
      this.state.currentRouteId = undefined
      this.state.currentRouteNetId = undefined
      this.state.goalPortId = -1
      this.solved = true
      this.stats = {
        ...this.stats,
        mode: "bus-routing",
        busCount: busGroups.length,
        routedRouteCount: this.problem.routeCount,
      }
    } catch (error) {
      this.failed = true
      this.error = error instanceof Error ? error.message : String(error)
    }
  }

  private initializeBusRoutingGraph() {
    if (this.abstractEdgesByRegion.length > 0) {
      return
    }

    this.serializedRegionIdToIndex.clear()
    for (let regionId = 0; regionId < this.topology.regionCount; regionId++) {
      this.serializedRegionIdToIndex.set(
        getSerializedRegionId(
          this.topology.regionMetadata?.[regionId],
          regionId,
        ),
        regionId,
      )
    }

    const edgeAccumulator = new Map<string, BusRegionEdge>()

    for (let portId = 0; portId < this.topology.portCount; portId++) {
      const [incidentRegionAId, incidentRegionBId] =
        this.topology.incidentPortRegion[portId] ?? []

      if (incidentRegionAId === undefined || incidentRegionBId === undefined) {
        continue
      }

      const regionAId = Math.min(incidentRegionAId, incidentRegionBId)
      const regionBId = Math.max(incidentRegionAId, incidentRegionBId)
      const edgeKey = getRegionPairKey(regionAId, regionBId)
      const edge =
        edgeAccumulator.get(edgeKey) ??
        ({
          key: edgeKey,
          regionAId,
          regionBId,
          portIds: [],
          capacity: 0,
        } satisfies BusRegionEdge)

      edge.portIds.push(portId)
      edge.capacity += this.getPortCapacity(portId)
      edgeAccumulator.set(edgeKey, edge)
    }

    this.abstractEdgesByRegion = Array.from(
      { length: this.topology.regionCount },
      () => [] as BusRegionEdge[],
    )
    this.abstractEdgeByKey = new Map()

    for (const edge of edgeAccumulator.values()) {
      this.abstractEdgeByKey.set(edge.key, edge)
      this.abstractEdgesByRegion[edge.regionAId]!.push(edge)
      this.abstractEdgesByRegion[edge.regionBId]!.push(edge)
    }
  }

  private resetBusRoutingState() {
    this.state.portAssignment.fill(-1)
    this.state.regionSegments = Array.from(
      { length: this.topology.regionCount },
      () => [],
    )
    this.state.regionIntersectionCaches = Array.from(
      { length: this.topology.regionCount },
      () => createEmptyRegionIntersectionCache(),
    )
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.unroutedRoutes = []
    this.state.candidateQueue.clear()
    this.state.goalPortId = -1
    this.state.ripCount = 0
    this.state.regionCongestionCost.fill(0)
    this.regionUsageCount = new Int32Array(this.topology.regionCount)
    this.portUsageCount = new Int32Array(this.topology.portCount)
    this.abstractEdgeUsageCount = new Map<string, number>()
  }

  private buildBusGroups(): BusGroup[] {
    this.initializeBusRoutingGraph()

    const groupsByBusId = new Map<
      string,
      {
        busId: string
        orderingVector: Vector2
        routePlans: BusRoutePlan[]
      }
    >()

    for (let routeId = 0; routeId < this.problem.routeCount; routeId++) {
      const routeMetadata = this.problem.routeMetadata?.[routeId]
      const busId =
        getBusIdFromRouteMetadata(routeMetadata) ?? `route-${routeId}`
      const orderingVector = normalizeVector(
        getOrderingVectorFromRouteMetadata(routeMetadata),
      )
      const existingGroup = groupsByBusId.get(busId)

      if (
        existingGroup &&
        !vectorsAreEquivalent(existingGroup.orderingVector, orderingVector)
      ) {
        throw new Error(
          `Bus "${busId}" has inconsistent ordering vectors across its connections`,
        )
      }

      const routePlan = this.createBusRoutePlan(routeId)

      if (existingGroup) {
        existingGroup.routePlans.push(routePlan)
      } else {
        groupsByBusId.set(busId, {
          busId,
          orderingVector,
          routePlans: [routePlan],
        })
      }
    }

    return Array.from(groupsByBusId.values())
      .map((group) => {
        const routePlans = group.routePlans
          .map((routePlan) => ({
            ...routePlan,
            orderKey: this.getRouteOrderKey(routePlan, group.orderingVector),
          }))
          .sort((left, right) => {
            if (left.orderKey !== right.orderKey) {
              return left.orderKey - right.orderKey
            }

            return left.routeId - right.routeId
          })
          .map((routePlan, index, routePlans) => ({
            ...routePlan,
            orderNorm:
              routePlans.length <= 1 ? 0.5 : index / (routePlans.length - 1),
          }))

        return {
          busId: group.busId,
          orderingVector: group.orderingVector,
          routePlans,
          regionProjectionNorm: this.computeRegionProjectionNorm(
            group.orderingVector,
          ),
        } satisfies BusGroup
      })
      .sort((left, right) => {
        if (left.routePlans.length !== right.routePlans.length) {
          return right.routePlans.length - left.routePlans.length
        }

        return left.busId.localeCompare(right.busId)
      })
  }

  private createBusRoutePlan(routeId: RouteId): BusRoutePlan {
    const routeMetadata = this.problem.routeMetadata?.[routeId]
    const startOuterRegionId =
      isRecord(routeMetadata) && typeof routeMetadata.startRegionId === "string"
        ? this.serializedRegionIdToIndex.get(routeMetadata.startRegionId)
        : undefined
    const endOuterRegionId =
      isRecord(routeMetadata) && typeof routeMetadata.endRegionId === "string"
        ? this.serializedRegionIdToIndex.get(routeMetadata.endRegionId)
        : undefined
    const startPortId = this.problem.routeStartPort[routeId]
    const endPortId = this.problem.routeEndPort[routeId]
    const startTransitRegionId = this.resolveStartTransitRegion(
      routeId,
      startPortId,
      startOuterRegionId,
    )
    const endTransitRegionId = this.resolveEndTransitRegion(
      routeId,
      endPortId,
      endOuterRegionId,
    )

    if (
      startTransitRegionId === undefined ||
      endTransitRegionId === undefined
    ) {
      throw new Error(
        `Route ${routeId} could not determine transit regions for bus routing`,
      )
    }

    return {
      routeId,
      routeNetId: this.problem.routeNet[routeId],
      startPortId,
      endPortId,
      startTransitRegionId,
      endTransitRegionId,
      startOuterRegionId,
      endOuterRegionId,
      orderKey: 0,
      orderNorm: 0.5,
      regionPath: [],
    }
  }

  private resolveStartTransitRegion(
    routeId: RouteId,
    startPortId: PortId,
    startOuterRegionId?: RegionId,
  ): RegionId | undefined {
    const candidateRegionIds =
      this.topology.incidentPortRegion[startPortId] ?? []

    return (
      candidateRegionIds.find(
        (regionId) =>
          regionId !== startOuterRegionId &&
          this.problem.regionNetId[regionId] === -1,
      ) ??
      candidateRegionIds.find(
        (regionId) =>
          regionId !== startOuterRegionId &&
          this.problem.regionNetId[regionId] === this.problem.routeNet[routeId],
      ) ??
      candidateRegionIds.find((regionId) => regionId !== startOuterRegionId) ??
      this.getStartingNextRegionId(routeId, startPortId)
    )
  }

  private resolveEndTransitRegion(
    routeId: RouteId,
    endPortId: PortId,
    endOuterRegionId?: RegionId,
  ): RegionId | undefined {
    const candidateRegionIds = this.topology.incidentPortRegion[endPortId] ?? []

    return (
      candidateRegionIds.find(
        (regionId) =>
          regionId !== endOuterRegionId &&
          this.problem.regionNetId[regionId] === -1,
      ) ??
      candidateRegionIds.find(
        (regionId) =>
          regionId !== endOuterRegionId &&
          this.problem.regionNetId[regionId] === this.problem.routeNet[routeId],
      ) ??
      candidateRegionIds.find((regionId) => regionId !== endOuterRegionId) ??
      candidateRegionIds[0]
    )
  }

  private computeRegionProjectionNorm(orderingVector: Vector2) {
    const projections = new Float64Array(this.topology.regionCount)
    let minProjection = Number.POSITIVE_INFINITY
    let maxProjection = Number.NEGATIVE_INFINITY

    for (let regionId = 0; regionId < this.topology.regionCount; regionId++) {
      const projection = projectOntoVector(
        this.topology.regionCenterX[regionId],
        this.topology.regionCenterY[regionId],
        orderingVector,
      )

      projections[regionId] = projection
      minProjection = Math.min(minProjection, projection)
      maxProjection = Math.max(maxProjection, projection)
    }

    return Float64Array.from(projections, (projection) =>
      normalizeProjection(projection, minProjection, maxProjection),
    )
  }

  private getRouteOrderKey(routePlan: BusRoutePlan, orderingVector: Vector2) {
    const startProjection = projectOntoVector(
      this.topology.portX[routePlan.startPortId],
      this.topology.portY[routePlan.startPortId],
      orderingVector,
    )
    const endProjection = projectOntoVector(
      this.topology.portX[routePlan.endPortId],
      this.topology.portY[routePlan.endPortId],
      orderingVector,
    )

    return (startProjection + endProjection) / 2
  }

  private solveBusGroup(busGroup: BusGroup) {
    for (const routePlan of busGroup.routePlans) {
      routePlan.regionPath = this.findRegionPathForRoute(routePlan, busGroup)
      this.reserveRegionPath(routePlan.regionPath)
    }

    const boundaryPortAssignments =
      this.assignBoundaryPortsForBusGroup(busGroup)

    for (const routePlan of busGroup.routePlans) {
      const boundaryPortIds = routePlan.regionPath
        .slice(0, -1)
        .map((_, stepIndex) => {
          const portId = boundaryPortAssignments.get(
            getRouteBoundaryPortKey(routePlan.routeId, stepIndex),
          )

          if (portId === undefined) {
            throw new Error(
              `Route ${routePlan.routeId} is missing an assigned boundary port for step ${stepIndex}`,
            )
          }

          return portId
        })

      this.commitSolvedRoute(routePlan, boundaryPortIds)
    }
  }

  private findRegionPathForRoute(routePlan: BusRoutePlan, busGroup: BusGroup) {
    if (!this.hasRemainingRegionCapacity(routePlan.startTransitRegionId)) {
      throw new Error(
        `Route ${routePlan.routeId} cannot enter region ${routePlan.startTransitRegionId} because region capacity is exhausted`,
      )
    }

    if (
      routePlan.endTransitRegionId !== routePlan.startTransitRegionId &&
      !this.hasRemainingRegionCapacity(routePlan.endTransitRegionId)
    ) {
      throw new Error(
        `Route ${routePlan.routeId} cannot reach region ${routePlan.endTransitRegionId} because region capacity is exhausted`,
      )
    }

    if (routePlan.startTransitRegionId === routePlan.endTransitRegionId) {
      return [routePlan.startTransitRegionId]
    }

    const bestCostByRegionId = new Float64Array(this.topology.regionCount).fill(
      Number.POSITIVE_INFINITY,
    )
    const previousRegionId = new Int32Array(this.topology.regionCount).fill(-1)
    const candidateQueue = new MinHeap<RegionPathCandidate>(
      [],
      compareRegionPathCandidates,
    )

    bestCostByRegionId[routePlan.startTransitRegionId] = 0
    candidateQueue.queue({
      regionId: routePlan.startTransitRegionId,
      cost: 0,
    })

    while (candidateQueue.length > 0) {
      const currentCandidate = candidateQueue.dequeue()

      if (!currentCandidate) {
        break
      }

      if (
        currentCandidate.cost > bestCostByRegionId[currentCandidate.regionId]!
      ) {
        continue
      }

      if (currentCandidate.regionId === routePlan.endTransitRegionId) {
        break
      }

      for (const edge of this.abstractEdgesByRegion[
        currentCandidate.regionId
      ] ?? []) {
        const nextRegionId =
          edge.regionAId === currentCandidate.regionId
            ? edge.regionBId
            : edge.regionAId

        if (
          nextRegionId === routePlan.startOuterRegionId ||
          nextRegionId === routePlan.endOuterRegionId
        ) {
          continue
        }

        if (
          this.isRegionReservedForDifferentNetOnRoute(routePlan, nextRegionId)
        ) {
          continue
        }

        if (!this.hasRemainingEdgeCapacity(edge.key)) {
          continue
        }

        if (!this.hasRemainingRegionCapacity(nextRegionId)) {
          continue
        }

        const nextCost =
          currentCandidate.cost +
          this.getRegionTransitionCost(routePlan, busGroup, edge, nextRegionId)

        if (nextCost >= bestCostByRegionId[nextRegionId]!) {
          continue
        }

        bestCostByRegionId[nextRegionId] = nextCost
        previousRegionId[nextRegionId] = currentCandidate.regionId
        candidateQueue.queue({
          regionId: nextRegionId,
          cost: nextCost,
        })
      }
    }

    if (!Number.isFinite(bestCostByRegionId[routePlan.endTransitRegionId]!)) {
      throw new Error(
        `Route ${routePlan.routeId} could not find a region path for bus "${busGroup.busId}"`,
      )
    }

    const regionPath: RegionId[] = []
    let cursorRegionId = routePlan.endTransitRegionId

    while (cursorRegionId !== -1) {
      regionPath.unshift(cursorRegionId)

      if (cursorRegionId === routePlan.startTransitRegionId) {
        break
      }

      cursorRegionId = previousRegionId[cursorRegionId]!
    }

    if (regionPath[0] !== routePlan.startTransitRegionId) {
      throw new Error(
        `Route ${routePlan.routeId} produced a disconnected region path`,
      )
    }

    return regionPath
  }

  private reserveRegionPath(regionPath: RegionId[]) {
    for (const regionId of regionPath) {
      this.regionUsageCount[regionId] += 1
    }

    for (let stepIndex = 0; stepIndex < regionPath.length - 1; stepIndex++) {
      const edgeKey = getRegionPairKey(
        regionPath[stepIndex]!,
        regionPath[stepIndex + 1]!,
      )
      this.abstractEdgeUsageCount.set(
        edgeKey,
        (this.abstractEdgeUsageCount.get(edgeKey) ?? 0) + 1,
      )
    }
  }

  private assignBoundaryPortsForBusGroup(busGroup: BusGroup) {
    const occurrencesByEdgeKey = new Map<string, EdgePortOccurrence[]>()

    for (const routePlan of busGroup.routePlans) {
      for (
        let stepIndex = 0;
        stepIndex < routePlan.regionPath.length - 1;
        stepIndex++
      ) {
        const edgeKey = getRegionPairKey(
          routePlan.regionPath[stepIndex]!,
          routePlan.regionPath[stepIndex + 1]!,
        )
        const occurrences = occurrencesByEdgeKey.get(edgeKey) ?? []
        occurrences.push({
          routePlan,
          stepIndex,
        })
        occurrencesByEdgeKey.set(edgeKey, occurrences)
      }
    }

    const assignedBoundaryPortIds = new Map<string, PortId>()

    for (const [edgeKey, occurrences] of occurrencesByEdgeKey) {
      const edge = this.abstractEdgeByKey.get(edgeKey)

      if (!edge) {
        throw new Error(
          `Missing abstract edge "${edgeKey}" during port assignment`,
        )
      }

      const availablePortSlots = this.getAvailablePortSlotsForEdge(
        edge,
        busGroup.orderingVector,
      )

      if (occurrences.length > availablePortSlots.length) {
        throw new Error(
          `Abstract edge "${edgeKey}" needs ${occurrences.length} port slots but only ${availablePortSlots.length} are available`,
        )
      }

      const sortedOccurrences = [...occurrences].sort((left, right) => {
        if (left.routePlan.orderNorm !== right.routePlan.orderNorm) {
          return left.routePlan.orderNorm - right.routePlan.orderNorm
        }

        if (left.routePlan.orderKey !== right.routePlan.orderKey) {
          return left.routePlan.orderKey - right.routePlan.orderKey
        }

        return left.routePlan.routeId - right.routePlan.routeId
      })

      let minSlotIndex = 0
      for (
        let occurrenceIndex = 0;
        occurrenceIndex < sortedOccurrences.length;
        occurrenceIndex++
      ) {
        const occurrence = sortedOccurrences[occurrenceIndex]!
        const remainingOccurrences =
          sortedOccurrences.length - occurrenceIndex - 1
        let targetSlotIndex =
          availablePortSlots.length <= 1
            ? 0
            : Math.round(
                occurrence.routePlan.orderNorm *
                  (availablePortSlots.length - 1),
              )

        targetSlotIndex = Math.max(targetSlotIndex, minSlotIndex)
        targetSlotIndex = Math.min(
          targetSlotIndex,
          availablePortSlots.length - 1 - remainingOccurrences,
        )

        const assignedPortId = availablePortSlots[targetSlotIndex]

        if (assignedPortId === undefined) {
          throw new Error(
            `Failed to assign a port slot on abstract edge "${edgeKey}"`,
          )
        }

        assignedBoundaryPortIds.set(
          getRouteBoundaryPortKey(
            occurrence.routePlan.routeId,
            occurrence.stepIndex,
          ),
          assignedPortId,
        )
        minSlotIndex = targetSlotIndex + 1
      }
    }

    return assignedBoundaryPortIds
  }

  private getAvailablePortSlotsForEdge(
    edge: BusRegionEdge,
    orderingVector: Vector2,
  ) {
    return edge.portIds
      .map((portId) => ({
        portId,
        projection: projectOntoVector(
          this.topology.portX[portId],
          this.topology.portY[portId],
          orderingVector,
        ),
        remainingCapacity:
          this.getPortCapacity(portId) - this.portUsageCount[portId]!,
      }))
      .sort((left, right) => {
        if (left.projection !== right.projection) {
          return left.projection - right.projection
        }

        return left.portId - right.portId
      })
      .flatMap(({ portId, remainingCapacity }) =>
        Array.from({ length: Math.max(0, remainingCapacity) }, () => portId),
      )
  }

  private commitSolvedRoute(
    routePlan: BusRoutePlan,
    boundaryPortIds: PortId[],
  ) {
    if (boundaryPortIds.length !== routePlan.regionPath.length - 1) {
      throw new Error(
        `Route ${routePlan.routeId} has ${boundaryPortIds.length} boundary ports for ${routePlan.regionPath.length} routed regions`,
      )
    }

    const uniquePortIds = new Set<PortId>([
      routePlan.startPortId,
      routePlan.endPortId,
      ...boundaryPortIds,
    ])

    for (const portId of uniquePortIds) {
      if (this.portUsageCount[portId]! + 1 > this.getPortCapacity(portId)) {
        throw new Error(
          `Port ${portId} exceeded its bus-routing capacity while committing route ${routePlan.routeId}`,
        )
      }
    }

    for (const portId of uniquePortIds) {
      this.portUsageCount[portId] += 1
    }

    this.state.currentRouteId = routePlan.routeId
    this.state.currentRouteNetId = routePlan.routeNetId

    for (
      let pathIndex = 0;
      pathIndex < routePlan.regionPath.length;
      pathIndex++
    ) {
      const regionId = routePlan.regionPath[pathIndex]!
      const fromPortId =
        pathIndex === 0
          ? routePlan.startPortId
          : boundaryPortIds[pathIndex - 1]!
      const toPortId =
        pathIndex === routePlan.regionPath.length - 1
          ? routePlan.endPortId
          : boundaryPortIds[pathIndex]!

      this.state.regionSegments[regionId]!.push([
        routePlan.routeId,
        fromPortId,
        toPortId,
      ])
      this.assignPortToCurrentRouteNet(fromPortId, routePlan.routeNetId)
      this.assignPortToCurrentRouteNet(toPortId, routePlan.routeNetId)
      this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
    }

    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
  }

  private assignPortToCurrentRouteNet(portId: PortId, routeNetId: number) {
    const assignedNetId = this.state.portAssignment[portId]

    if (assignedNetId === -1 || assignedNetId === routeNetId) {
      this.state.portAssignment[portId] = routeNetId
      return
    }

    this.state.portAssignment[portId] = -2
  }

  private isRegionReservedForDifferentNetOnRoute(
    routePlan: BusRoutePlan,
    regionId: RegionId,
  ) {
    const reservedNetId = this.problem.regionNetId[regionId]
    return reservedNetId !== -1 && reservedNetId !== routePlan.routeNetId
  }

  private hasRemainingRegionCapacity(regionId: RegionId) {
    const capacity = this.getRegionCapacity(regionId)

    return (
      !Number.isFinite(capacity) ||
      this.regionUsageCount[regionId]! + 1 <= capacity
    )
  }

  private hasRemainingEdgeCapacity(edgeKey: string) {
    const edge = this.abstractEdgeByKey.get(edgeKey)

    if (!edge) {
      return false
    }

    return (
      edge.capacity > 0 &&
      (this.abstractEdgeUsageCount.get(edgeKey) ?? 0) + 1 <= edge.capacity
    )
  }

  private getRegionTransitionCost(
    routePlan: BusRoutePlan,
    busGroup: BusGroup,
    edge: BusRegionEdge,
    nextRegionId: RegionId,
  ) {
    const regionCapacity = this.getRegionCapacity(nextRegionId)
    const sidePenalty =
      Math.abs(
        busGroup.regionProjectionNorm[nextRegionId]! - routePlan.orderNorm,
      ) * this.BUS_SIDE_BIAS_FACTOR
    const regionCapacityCost =
      Number.isFinite(regionCapacity) && regionCapacity > 0
        ? this.REGION_CAPACITY_COST_FACTOR / regionCapacity
        : 0
    const edgeCapacityCost =
      edge.capacity > 0 ? this.EDGE_CAPACITY_COST_FACTOR / edge.capacity : 0

    return (
      sidePenalty + regionCapacityCost + edgeCapacityCost + this.REGION_HOP_COST
    )
  }

  private getRegionCapacity(regionId: RegionId) {
    const metadata = this.topology.regionMetadata?.[regionId]

    if (!isRecord(metadata)) {
      return Number.POSITIVE_INFINITY
    }

    return (
      getNonNegativeFiniteNumber(metadata.busCapacity) ??
      getNonNegativeFiniteNumber(metadata.busRegionCapacity) ??
      getNonNegativeFiniteNumber(metadata.capacity) ??
      Number.POSITIVE_INFINITY
    )
  }

  private getPortCapacity(portId: PortId) {
    const metadata = this.topology.portMetadata?.[portId]

    if (!isRecord(metadata)) {
      return 1
    }

    return (
      getNonNegativeFiniteNumber(metadata.busCapacity) ??
      getNonNegativeFiniteNumber(metadata.busEdgeCapacity) ??
      getNonNegativeFiniteNumber(metadata.edgeCapacity) ??
      getNonNegativeFiniteNumber(metadata.capacity) ??
      1
    )
  }
}
