import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "../core"
import type { PortId, RegionId } from "../types"
import type { BusTraceOrder } from "./deriveBusTraceOrder"
import { getPortDistance, getPortProjection } from "./geometry"
import {
  BUS_CANDIDATE_EPSILON,
  getRegionPairKey,
  type BoundaryStep,
  type BusCenterCandidate,
} from "./busSolverTypes"

interface BusBoundaryPlannerOptions {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  busTraceOrder: BusTraceOrder
  centerTraceIndex: number
  CENTER_PORT_OPTIONS_PER_EDGE: number
  isUsableCenterlineBoundaryPort: (portId: PortId) => boolean
}

interface BoundaryNormal {
  x: number
  y: number
}

export class BusBoundaryPlanner {
  readonly centerlineNeighborRegionIdsByRegion: RegionId[][]

  private readonly sharedZ0PortsByRegionPair = new Map<string, PortId[]>()
  private readonly usableCenterlineSharedZ0PortsByRegionPair = new Map<
    string,
    PortId[]
  >()

  constructor(private readonly options: BusBoundaryPlannerOptions) {
    this.buildSharedZ0PortsByRegionPair()
    this.buildUsableCenterlineSharedZ0PortsByRegionPair()
    this.centerlineNeighborRegionIdsByRegion =
      this.buildCenterlineNeighborRegionIdsByRegion()
  }

  createBoundaryStep(
    fromRegionId: RegionId,
    toRegionId: RegionId,
    centerPortId: PortId,
    referencePortId: PortId,
    previousNormal?: BoundaryNormal,
  ): BoundaryStep {
    const { x, y } = this.computeBoundaryNormal(
      referencePortId,
      centerPortId,
      fromRegionId,
      toRegionId,
      previousNormal,
    )

    return {
      fromRegionId,
      toRegionId,
      centerPortId,
      normalX: x,
      normalY: y,
    }
  }

  getOrderedSharedPortsForBoundaryStep(boundaryStep: BoundaryStep) {
    const regionPairKey = getRegionPairKey(
      boundaryStep.fromRegionId,
      boundaryStep.toRegionId,
    )
    const sharedPortIds = this.sharedZ0PortsByRegionPair.get(regionPairKey)

    if (!sharedPortIds) {
      return undefined
    }

    return [...sharedPortIds].sort((leftPortId, rightPortId) => {
      const leftProjection = getPortProjection(
        this.options.topology,
        leftPortId,
        boundaryStep.normalX,
        boundaryStep.normalY,
      )
      const rightProjection = getPortProjection(
        this.options.topology,
        rightPortId,
        boundaryStep.normalX,
        boundaryStep.normalY,
      )

      return leftProjection - rightProjection || leftPortId - rightPortId
    })
  }

  getPreferredCenterPortOptionsForBoundaryStep(boundaryStep: BoundaryStep) {
    const orderedSharedPortIds =
      this.getOrderedSharedPortsForBoundaryStep(boundaryStep)

    if (!orderedSharedPortIds || orderedSharedPortIds.length === 0) {
      return []
    }

    const midpointIndex = (orderedSharedPortIds.length - 1) / 2

    return orderedSharedPortIds
      .map((portId, index) => ({
        portId,
        index,
      }))
      .sort(
        (left, right) =>
          Math.abs(left.index - midpointIndex) -
            Math.abs(right.index - midpointIndex) || left.portId - right.portId,
      )
      .slice(0, this.options.CENTER_PORT_OPTIONS_PER_EDGE)
      .map(({ portId }) => portId)
  }

  assignBoundaryPortsForPath(boundarySteps: readonly BoundaryStep[]) {
    const boundaryPortIdsByStep: Array<PortId[] | undefined> = []
    let previousPortIds = this.options.busTraceOrder.traces.map(
      (trace) => this.options.problem.routeStartPort[trace.routeId]!,
    )

    for (const boundaryStep of boundarySteps) {
      const assignments = this.assignBoundaryPortsForStep(
        boundaryStep,
        previousPortIds,
      )
      boundaryPortIdsByStep.push(assignments)

      if (!assignments) {
        for (
          let remainingIndex = boundaryPortIdsByStep.length;
          remainingIndex < boundarySteps.length;
          remainingIndex++
        ) {
          boundaryPortIdsByStep.push(undefined)
        }
        break
      }

      previousPortIds = assignments
    }

    return boundaryPortIdsByStep
  }

  assignBoundaryPortsForStep(
    boundaryStep: BoundaryStep,
    previousPortIds?: readonly PortId[],
  ): PortId[] | undefined {
    const sharedPortIds =
      this.getOrderedSharedPortsForBoundaryStep(boundaryStep)

    if (!sharedPortIds) {
      return undefined
    }

    const candidateAssignments = [
      this.buildBoundaryPortAssignmentsFromOrderedPorts(
        sharedPortIds,
        boundaryStep.centerPortId,
      ),
      this.buildBoundaryPortAssignmentsFromOrderedPorts(
        [...sharedPortIds].reverse(),
        boundaryStep.centerPortId,
      ),
    ].filter(
      (
        assignments,
        assignmentIndex,
        assignmentsList,
      ): assignments is PortId[] =>
        assignments !== undefined &&
        assignmentsList.findIndex(
          (candidate) =>
            candidate?.every(
              (portId, traceIndex) => portId === assignments[traceIndex],
            ) ?? false,
        ) === assignmentIndex,
    )

    if (candidateAssignments.length === 0) {
      return undefined
    }

    if (!previousPortIds) {
      return candidateAssignments[0]
    }

    return candidateAssignments
      .map((assignments) => ({
        assignments,
        intersectionCount: this.countLocalBoundaryAssignmentIntersections(
          previousPortIds,
          assignments,
        ),
        totalLength: this.getBoundaryAssignmentLength(
          previousPortIds,
          assignments,
        ),
      }))
      .sort(
        (left, right) =>
          left.intersectionCount - right.intersectionCount ||
          left.totalLength - right.totalLength,
      )[0]?.assignments
  }

  getBoundarySteps(centerPath: BusCenterCandidate[]) {
    const boundarySteps: BoundaryStep[] = []
    let currentRegionId = centerPath[0]?.nextRegionId
    let previousNormal: BoundaryNormal | undefined

    if (currentRegionId === undefined) {
      return boundarySteps
    }

    for (let pathIndex = 1; pathIndex < centerPath.length; pathIndex++) {
      const nextCandidate = centerPath[pathIndex]!

      if (nextCandidate.atGoal) {
        break
      }

      const previousPortId =
        centerPath[pathIndex - 1]?.portId ?? nextCandidate.portId
      const nextPortId =
        centerPath[pathIndex + 1]?.portId ?? nextCandidate.portId
      const boundaryNormal = this.computeBoundaryNormal(
        previousPortId,
        nextPortId,
        currentRegionId,
        nextCandidate.nextRegionId,
        previousNormal,
      )

      boundarySteps.push({
        fromRegionId: currentRegionId,
        toRegionId: nextCandidate.nextRegionId,
        centerPortId: nextCandidate.portId,
        normalX: boundaryNormal.x,
        normalY: boundaryNormal.y,
      })
      previousNormal = boundaryNormal
      currentRegionId = nextCandidate.nextRegionId
    }

    return boundarySteps
  }

  getOrderedUsableCenterlinePortsForBoundaryStep(boundaryStep: BoundaryStep) {
    const orderedSharedPortIds =
      this.getOrderedSharedPortsForBoundaryStep(boundaryStep)
    if (!orderedSharedPortIds) {
      return undefined
    }

    return orderedSharedPortIds.filter((portId) =>
      this.options.isUsableCenterlineBoundaryPort(portId),
    )
  }

  getUsableCenterlinePortIdsBetweenRegions(
    fromRegionId: RegionId,
    toRegionId: RegionId,
  ) {
    const regionPairKey = getRegionPairKey(fromRegionId, toRegionId)
    return this.usableCenterlineSharedZ0PortsByRegionPair.get(regionPairKey)
  }

  getBoundaryCenterMidpointPenalty(boundaryStep: BoundaryStep) {
    const orderedSharedPortIds =
      this.getOrderedUsableCenterlinePortsForBoundaryStep(boundaryStep)

    if (!orderedSharedPortIds || orderedSharedPortIds.length === 0) {
      return Number.POSITIVE_INFINITY
    }

    const centerIndex = orderedSharedPortIds.indexOf(boundaryStep.centerPortId)
    if (centerIndex === -1) {
      return Number.POSITIVE_INFINITY
    }

    return Math.abs(centerIndex - (orderedSharedPortIds.length - 1) / 2)
  }

  getBoundarySupportPenalty(boundaryStep: BoundaryStep) {
    const sharedPortIds =
      this.getOrderedSharedPortsForBoundaryStep(boundaryStep)

    if (!sharedPortIds) {
      return this.options.problem.routeCount * 20
    }

    const centerIndex = sharedPortIds.indexOf(boundaryStep.centerPortId)
    if (centerIndex === -1) {
      return this.options.problem.routeCount * 20
    }

    const supportedBefore = Math.min(centerIndex, this.options.centerTraceIndex)
    const supportedAfter = Math.min(
      sharedPortIds.length - centerIndex - 1,
      this.options.problem.routeCount - this.options.centerTraceIndex - 1,
    )
    const supportedTraceCount = 1 + supportedBefore + supportedAfter
    const unsupportedTraceCount =
      this.options.problem.routeCount - supportedTraceCount

    return unsupportedTraceCount * 20
  }

  private buildSharedZ0PortsByRegionPair() {
    this.sharedZ0PortsByRegionPair.clear()

    for (let portId = 0; portId < this.options.topology.portCount; portId++) {
      if (this.options.topology.portZ[portId] !== 0) {
        continue
      }

      const [regionAId, regionBId] =
        this.options.topology.incidentPortRegion[portId] ?? []
      if (regionAId === undefined || regionBId === undefined) {
        continue
      }

      const regionPairKey = getRegionPairKey(regionAId, regionBId)
      const sharedPortIds =
        this.sharedZ0PortsByRegionPair.get(regionPairKey) ?? []
      sharedPortIds.push(portId)
      this.sharedZ0PortsByRegionPair.set(regionPairKey, sharedPortIds)
    }

    for (const [regionPairKey, sharedPortIds] of this
      .sharedZ0PortsByRegionPair) {
      sharedPortIds.sort((leftPortId, rightPortId) => {
        const leftProjection = getPortProjection(
          this.options.topology,
          leftPortId,
          this.options.busTraceOrder.normalX,
          this.options.busTraceOrder.normalY,
        )
        const rightProjection = getPortProjection(
          this.options.topology,
          rightPortId,
          this.options.busTraceOrder.normalX,
          this.options.busTraceOrder.normalY,
        )

        return leftProjection - rightProjection || leftPortId - rightPortId
      })
      this.sharedZ0PortsByRegionPair.set(regionPairKey, sharedPortIds)
    }
  }

  private buildUsableCenterlineSharedZ0PortsByRegionPair() {
    this.usableCenterlineSharedZ0PortsByRegionPair.clear()

    for (const [regionPairKey, sharedPortIds] of this
      .sharedZ0PortsByRegionPair) {
      const usablePortIds = sharedPortIds.filter((portId) =>
        this.options.isUsableCenterlineBoundaryPort(portId),
      )

      if (usablePortIds.length === 0) {
        continue
      }

      this.usableCenterlineSharedZ0PortsByRegionPair.set(
        regionPairKey,
        usablePortIds,
      )
    }
  }

  private buildCenterlineNeighborRegionIdsByRegion() {
    const neighborRegionIdsByRegion = Array.from(
      { length: this.options.topology.regionCount },
      () => [] as RegionId[],
    )

    for (const regionPairKey of this.usableCenterlineSharedZ0PortsByRegionPair.keys()) {
      const separatorIndex = regionPairKey.indexOf(":")
      const regionAId = Number(regionPairKey.slice(0, separatorIndex))
      const regionBId = Number(regionPairKey.slice(separatorIndex + 1))

      neighborRegionIdsByRegion[regionAId]!.push(regionBId)
      neighborRegionIdsByRegion[regionBId]!.push(regionAId)
    }

    for (const neighborRegionIds of neighborRegionIdsByRegion) {
      neighborRegionIds.sort((left, right) => left - right)
    }

    return neighborRegionIdsByRegion
  }

  private computeBoundaryNormal(
    fromPortId: PortId,
    toPortId: PortId,
    fromRegionId: RegionId,
    toRegionId: RegionId,
    previousNormal?: BoundaryNormal,
  ) {
    let tangentX =
      this.options.topology.portX[toPortId] -
      this.options.topology.portX[fromPortId]
    let tangentY =
      this.options.topology.portY[toPortId] -
      this.options.topology.portY[fromPortId]
    let tangentLength = Math.hypot(tangentX, tangentY)

    if (tangentLength <= BUS_CANDIDATE_EPSILON) {
      tangentX =
        this.options.topology.regionCenterX[toRegionId] -
        this.options.topology.regionCenterX[fromRegionId]
      tangentY =
        this.options.topology.regionCenterY[toRegionId] -
        this.options.topology.regionCenterY[fromRegionId]
      tangentLength = Math.hypot(tangentX, tangentY)
    }

    if (tangentLength <= BUS_CANDIDATE_EPSILON) {
      const fallbackNormal = previousNormal ?? {
        x: this.options.busTraceOrder.normalX,
        y: this.options.busTraceOrder.normalY,
      }
      return {
        x: fallbackNormal.x,
        y: fallbackNormal.y,
      }
    }

    tangentX /= tangentLength
    tangentY /= tangentLength

    let normalX = -tangentY
    let normalY = tangentX
    const referenceNormal = previousNormal ?? {
      x: this.options.busTraceOrder.normalX,
      y: this.options.busTraceOrder.normalY,
    }

    if (
      normalX * referenceNormal.x + normalY * referenceNormal.y <
      -BUS_CANDIDATE_EPSILON
    ) {
      normalX *= -1
      normalY *= -1
    }

    return {
      x: normalX,
      y: normalY,
    }
  }

  private buildBoundaryPortAssignmentsFromOrderedPorts(
    orderedPortIds: readonly PortId[],
    centerPortId: PortId,
  ) {
    if (!orderedPortIds.includes(centerPortId)) {
      return undefined
    }

    const centerIndex = orderedPortIds.indexOf(centerPortId)
    const tracesBeforeCenter = this.options.centerTraceIndex
    const tracesAfterCenter =
      this.options.problem.routeCount - this.options.centerTraceIndex - 1

    if (
      centerIndex < tracesBeforeCenter ||
      orderedPortIds.length - centerIndex - 1 < tracesAfterCenter
    ) {
      return undefined
    }

    const assignments = new Array<PortId>(this.options.problem.routeCount)

    for (
      let traceIndex = 0;
      traceIndex < this.options.problem.routeCount;
      traceIndex++
    ) {
      const offsetFromCenter = traceIndex - this.options.centerTraceIndex
      const assignedPortId = orderedPortIds[centerIndex + offsetFromCenter]

      if (assignedPortId === undefined) {
        return undefined
      }

      assignments[traceIndex] = assignedPortId
    }

    return assignments
  }

  private countLocalBoundaryAssignmentIntersections(
    previousPortIds: readonly PortId[],
    nextPortIds: readonly PortId[],
  ) {
    let intersectionCount = 0

    for (let leftIndex = 0; leftIndex < previousPortIds.length; leftIndex++) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < previousPortIds.length;
        rightIndex++
      ) {
        if (
          this.doPortSegmentsIntersect(
            previousPortIds[leftIndex]!,
            nextPortIds[leftIndex]!,
            previousPortIds[rightIndex]!,
            nextPortIds[rightIndex]!,
          )
        ) {
          intersectionCount += 1
        }
      }
    }

    return intersectionCount
  }

  private doPortSegmentsIntersect(
    aFromPortId: PortId,
    aToPortId: PortId,
    bFromPortId: PortId,
    bToPortId: PortId,
  ) {
    if (
      aFromPortId === bFromPortId ||
      aFromPortId === bToPortId ||
      aToPortId === bFromPortId ||
      aToPortId === bToPortId
    ) {
      return false
    }

    const ax = this.options.topology.portX[aFromPortId]
    const ay = this.options.topology.portY[aFromPortId]
    const bx = this.options.topology.portX[aToPortId]
    const by = this.options.topology.portY[aToPortId]
    const cx = this.options.topology.portX[bFromPortId]
    const cy = this.options.topology.portY[bFromPortId]
    const dx = this.options.topology.portX[bToPortId]
    const dy = this.options.topology.portY[bToPortId]

    const orientation = (
      px: number,
      py: number,
      qx: number,
      qy: number,
      rx: number,
      ry: number,
    ) => (qx - px) * (ry - py) - (qy - py) * (rx - px)

    const aToC = orientation(ax, ay, bx, by, cx, cy)
    const aToD = orientation(ax, ay, bx, by, dx, dy)
    const bToA = orientation(cx, cy, dx, dy, ax, ay)
    const bToB = orientation(cx, cy, dx, dy, bx, by)

    if (
      Math.abs(aToC) <= BUS_CANDIDATE_EPSILON ||
      Math.abs(aToD) <= BUS_CANDIDATE_EPSILON ||
      Math.abs(bToA) <= BUS_CANDIDATE_EPSILON ||
      Math.abs(bToB) <= BUS_CANDIDATE_EPSILON
    ) {
      return false
    }

    return aToC > 0 !== aToD > 0 && bToA > 0 !== bToB > 0
  }

  private getBoundaryAssignmentLength(
    previousPortIds: readonly PortId[],
    nextPortIds: readonly PortId[],
  ) {
    let totalLength = 0

    for (
      let traceIndex = 0;
      traceIndex < previousPortIds.length;
      traceIndex++
    ) {
      totalLength += getPortDistance(
        this.options.topology,
        previousPortIds[traceIndex]!,
        nextPortIds[traceIndex]!,
      )
    }

    return totalLength
  }
}
