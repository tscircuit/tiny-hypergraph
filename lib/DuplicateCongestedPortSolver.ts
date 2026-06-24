import type {
  SerializedGraphPort,
  SerializedGraphRegion,
  SerializedHyperGraph,
} from "@tscircuit/hypergraph"
import { BaseSolver } from "@tscircuit/solver-utils"
import { type GraphicsObject, setStepOfAllObjects } from "graphics-debug"
import { loadSerializedHyperGraph } from "./compat/loadSerializedHyperGraph"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "./core"
import type { PortId, RouteId } from "./types"

export const DUPLICATE_PORT_PROXIMITY = 0.05

export interface DuplicateCongestedPortSolverOptions {
  duplicatePortProximity?: number
  routeSolveOptions?: TinyHyperGraphSolverOptions
}

export interface DuplicatedPortSummary {
  sourcePortId: string
  duplicatePortIds: string[]
  useCount: number
}

export interface DuplicateCongestedPortSolverReport {
  portUseCounts: Record<string, number>
  duplicatedPorts: DuplicatedPortSummary[]
}

interface Point {
  x: number
  y: number
}

type LoadedSerializedHyperGraph = {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
}

const EPSILON = 1e-9

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const cloneSerializableValue = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => cloneSerializableValue(item)) as T
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        cloneSerializableValue(item),
      ]),
    ) as T
  }

  return value
}

const toObjectRecord = (value: unknown): Record<string, unknown> => {
  if (isRecord(value)) return { ...value }
  if (value === undefined) return {}
  return { value }
}

const getNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

const getPortPoint = (port: SerializedGraphPort): Point => ({
  x: getNumber(port.d?.x),
  y: getNumber(port.d?.y),
})

const getBoundaryKey = (
  port: Pick<SerializedGraphPort, "region1Id" | "region2Id">,
) => [port.region1Id, port.region2Id].sort().join("\u0000")

const getDistance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

const normalize = (point: Point): Point | undefined => {
  const length = Math.hypot(point.x, point.y)
  if (length <= EPSILON) return undefined
  return {
    x: point.x / length,
    y: point.y / length,
  }
}

const getRegionBounds = (
  region: SerializedGraphRegion | undefined,
): {
  minX: number
  maxX: number
  minY: number
  maxY: number
} => {
  const bounds = region?.d?.bounds
  if (
    isRecord(bounds) &&
    typeof bounds.minX === "number" &&
    typeof bounds.maxX === "number" &&
    typeof bounds.minY === "number" &&
    typeof bounds.maxY === "number"
  ) {
    return {
      minX: bounds.minX,
      maxX: bounds.maxX,
      minY: bounds.minY,
      maxY: bounds.maxY,
    }
  }

  const center = region?.d?.center
  const width = getNumber(region?.d?.width)
  const height = getNumber(region?.d?.height)
  if (isRecord(center)) {
    const x = getNumber(center.x)
    const y = getNumber(center.y)
    return {
      minX: x - width / 2,
      maxX: x + width / 2,
      minY: y - height / 2,
      maxY: y + height / 2,
    }
  }

  return {
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
  }
}

const getRegionCenter = (region: SerializedGraphRegion | undefined): Point => {
  const center = region?.d?.center
  if (isRecord(center)) {
    return {
      x: getNumber(center.x),
      y: getNumber(center.y),
    }
  }

  const bounds = getRegionBounds(region)
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }
}

const findNearestPortOnSameBoundary = (
  sourcePort: SerializedGraphPort,
  ports: SerializedGraphPort[],
): SerializedGraphPort | undefined => {
  const sourceBoundaryKey = getBoundaryKey(sourcePort)
  const sourcePoint = getPortPoint(sourcePort)
  let nearestPort: SerializedGraphPort | undefined
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const port of ports) {
    if (port.portId === sourcePort.portId) continue
    if (getBoundaryKey(port) !== sourceBoundaryKey) continue

    const distance = getDistance(sourcePoint, getPortPoint(port))
    if (distance <= EPSILON || distance >= nearestDistance) continue

    nearestPort = port
    nearestDistance = distance
  }

  return nearestPort
}

const getFallbackBoundaryDirection = (
  sourcePort: SerializedGraphPort,
  regionById: Map<string, SerializedGraphRegion>,
): Point => {
  const region1Center = getRegionCenter(regionById.get(sourcePort.region1Id))
  const region2Center = getRegionCenter(regionById.get(sourcePort.region2Id))
  const perpendicular = normalize({
    x: -(region2Center.y - region1Center.y),
    y: region2Center.x - region1Center.x,
  })

  return perpendicular ?? { x: 1, y: 0 }
}

const getDuplicateDirection = (
  sourcePort: SerializedGraphPort,
  nearestBoundaryPort: SerializedGraphPort | undefined,
  regionById: Map<string, SerializedGraphRegion>,
): Point => {
  const sourcePoint = getPortPoint(sourcePort)

  if (nearestBoundaryPort) {
    const nearestPoint = getPortPoint(nearestBoundaryPort)
    const awayFromNearest = normalize({
      x: sourcePoint.x - nearestPoint.x,
      y: sourcePoint.y - nearestPoint.y,
    })
    if (awayFromNearest) return awayFromNearest
  }

  return getFallbackBoundaryDirection(sourcePort, regionById)
}

const createDuplicatePortId = (
  sourcePortId: string,
  duplicateIndex: number,
  usedPortIds: Set<string>,
): string => {
  const basePortId = `${sourcePortId}::dup${duplicateIndex}`
  if (!usedPortIds.has(basePortId)) {
    usedPortIds.add(basePortId)
    return basePortId
  }

  for (let collisionIndex = 2; ; collisionIndex++) {
    const portId = `${basePortId}-${collisionIndex}`
    if (!usedPortIds.has(portId)) {
      usedPortIds.add(portId)
      return portId
    }
  }
}

const insertDuplicatePortIdsAfterSource = (
  pointIds: string[],
  sourcePortId: string,
  duplicatePortIds: string[],
) => {
  const insertionIndex = pointIds.indexOf(sourcePortId)
  if (insertionIndex === -1) {
    pointIds.push(...duplicatePortIds)
    return
  }

  pointIds.splice(insertionIndex + 1, 0, ...duplicatePortIds)
}

const getSerializedPortId = (
  topology: TinyHyperGraphTopology,
  portId: PortId,
): string => {
  const metadata = topology.portMetadata?.[portId]
  if (isRecord(metadata)) {
    if (typeof metadata.serializedPortId === "string") {
      return metadata.serializedPortId
    }

    if (typeof metadata.portId === "string") {
      return metadata.portId
    }
  }

  return `port-${portId}`
}

const createSingleRouteProblem = (
  problem: TinyHyperGraphProblem,
  routeId: RouteId,
): TinyHyperGraphProblem => ({
  routeCount: 1,
  portSectionMask: new Int8Array(problem.portSectionMask),
  routeMetadata:
    problem.routeMetadata === undefined
      ? undefined
      : [problem.routeMetadata[routeId]],
  routeStartPort: Int32Array.from([problem.routeStartPort[routeId]]),
  routeEndPort: Int32Array.from([problem.routeEndPort[routeId]]),
  routeNet: Int32Array.from([problem.routeNet[routeId]]),
  regionNetId: new Int32Array(problem.regionNetId),
  portPenalty:
    problem.portPenalty === undefined
      ? undefined
      : new Float64Array(problem.portPenalty),
})

const getUsedPortIdsForSolvedRoute = (
  solver: TinyHyperGraphSolver,
): Set<PortId> => {
  const usedPortIds = new Set<PortId>()

  for (const regionSegments of solver.state.regionSegments) {
    for (const [, fromPortId, toPortId] of regionSegments) {
      usedPortIds.add(fromPortId)
      usedPortIds.add(toPortId)
    }
  }

  if (usedPortIds.size === 0 && solver.problem.routeCount === 1) {
    usedPortIds.add(solver.problem.routeStartPort[0])
    usedPortIds.add(solver.problem.routeEndPort[0])
  }

  return usedPortIds
}

export class DuplicateCongestedPortSolver extends BaseSolver {
  revisedSerializedHyperGraph?: SerializedHyperGraph
  report: DuplicateCongestedPortSolverReport = {
    portUseCounts: {},
    duplicatedPorts: [],
  }
  private loadedGraph?: LoadedSerializedHyperGraph
  private portUseCounts = new Map<string, number>()
  private nextRouteId = 0
  override activeSubSolver: TinyHyperGraphSolver | null = null

  constructor(
    public serializedHyperGraph: SerializedHyperGraph,
    public options: DuplicateCongestedPortSolverOptions = {},
  ) {
    super()
  }

  private getDuplicatePortProximity() {
    return this.options.duplicatePortProximity ?? DUPLICATE_PORT_PROXIMITY
  }

  private getIndividualRouteSolveOptions(): TinyHyperGraphSolverOptions {
    return {
      RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
      STATIC_REACHABILITY_PRECHECK: false,
      ...this.options.routeSolveOptions,
    }
  }

  private duplicateCongestedPorts(
    portUseCounts: Map<string, number>,
  ): SerializedHyperGraph {
    const duplicatePortProximity = this.getDuplicatePortProximity()
    if (!(duplicatePortProximity > 0)) {
      throw new Error("duplicatePortProximity must be greater than zero")
    }

    const { solvedRoutes: _solvedRoutes, ...restHyperGraph } =
      this.serializedHyperGraph
    const regions: SerializedGraphRegion[] =
      this.serializedHyperGraph.regions.map((region) => ({
        ...region,
        pointIds: [...region.pointIds],
        d: cloneSerializableValue(region.d),
      }))
    const ports: SerializedGraphPort[] = this.serializedHyperGraph.ports.map(
      (port) => ({
        ...port,
        d: cloneSerializableValue(port.d),
      }),
    )
    const regionById = new Map(
      regions.map((region) => [region.regionId, region]),
    )
    const sourcePortById = new Map(
      ports.map((port) => [port.portId, port] as const),
    )
    const usedPortIds = new Set(ports.map((port) => port.portId))
    const duplicatedPorts: DuplicatedPortSummary[] = []

    for (const [sourcePortId, useCount] of [...portUseCounts.entries()].sort(
      ([leftPortId], [rightPortId]) => leftPortId.localeCompare(rightPortId),
    )) {
      if (useCount <= 1) continue

      const sourcePort = sourcePortById.get(sourcePortId)
      if (!sourcePort) continue

      const duplicateCount = useCount - 1
      const nearestBoundaryPort = findNearestPortOnSameBoundary(
        sourcePort,
        this.serializedHyperGraph.ports,
      )
      const duplicateDirection = getDuplicateDirection(
        sourcePort,
        nearestBoundaryPort,
        regionById,
      )
      const sourcePoint = getPortPoint(sourcePort)
      const duplicatePortIds: string[] = []

      for (
        let duplicateIndex = 1;
        duplicateIndex <= duplicateCount;
        duplicateIndex++
      ) {
        const duplicatePortId = createDuplicatePortId(
          sourcePortId,
          duplicateIndex,
          usedPortIds,
        )
        const offset =
          (duplicatePortProximity * duplicateIndex) / (duplicateCount + 1)
        const duplicatedPortData = toObjectRecord(
          cloneSerializableValue(sourcePort.d),
        )
        duplicatedPortData.x = sourcePoint.x + duplicateDirection.x * offset
        duplicatedPortData.y = sourcePoint.y + duplicateDirection.y * offset
        duplicatedPortData.duplicatedFromPortId = sourcePortId
        duplicatedPortData.duplicateIndex = duplicateIndex
        duplicatedPortData.duplicatePortUseCount = useCount
        duplicatedPortData.duplicatePortProximity = duplicatePortProximity
        duplicatedPortData.repairReason = "congested-port"

        ports.push({
          ...sourcePort,
          portId: duplicatePortId,
          d: duplicatedPortData,
        })
        duplicatePortIds.push(duplicatePortId)
      }

      for (const regionId of [sourcePort.region1Id, sourcePort.region2Id]) {
        const region = regionById.get(regionId)
        if (!region) continue
        insertDuplicatePortIdsAfterSource(
          region.pointIds,
          sourcePortId,
          duplicatePortIds,
        )
      }

      duplicatedPorts.push({
        sourcePortId,
        duplicatePortIds,
        useCount,
      })
    }

    this.report = {
      portUseCounts: Object.fromEntries([...portUseCounts.entries()].sort()),
      duplicatedPorts,
    }

    return {
      ...restHyperGraph,
      regions,
      ports,
      connections:
        this.serializedHyperGraph.connections === undefined
          ? undefined
          : cloneSerializableValue(this.serializedHyperGraph.connections),
    }
  }

  override _setup() {
    let loaded: ReturnType<typeof loadSerializedHyperGraph>
    try {
      loaded = loadSerializedHyperGraph(this.serializedHyperGraph)
    } catch (error) {
      this.failed = true
      this.error = error instanceof Error ? error.message : String(error)
      return
    }

    this.loadedGraph = {
      topology: loaded.topology,
      problem: loaded.problem,
    }

    const routeMaxIterations =
      this.getIndividualRouteSolveOptions().MAX_ITERATIONS ?? 1_000_000
    this.MAX_ITERATIONS =
      this.loadedGraph.problem.routeCount * routeMaxIterations +
      this.loadedGraph.problem.routeCount +
      1
  }

  override _step() {
    const loadedGraph = this.loadedGraph
    if (!loadedGraph) {
      this.failed = true
      this.error = "DuplicateCongestedPortSolver was not initialized"
      return
    }

    if (this.activeSubSolver) {
      this.stepActiveRouteSolver(loadedGraph)
      return
    }

    if (this.nextRouteId < loadedGraph.problem.routeCount) {
      this.activeSubSolver = new TinyHyperGraphSolver(
        loadedGraph.topology,
        createSingleRouteProblem(loadedGraph.problem, this.nextRouteId),
        this.getIndividualRouteSolveOptions(),
      )
      this.updateRouteProgress(loadedGraph)
      return
    }

    this.finishDuplicatingPorts()
  }

  override visualize(): GraphicsObject {
    const activeRouteGraphics = this.activeSubSolver?.visualize()
    if (activeRouteGraphics && !this.solved) {
      return setStepOfAllObjects(activeRouteGraphics, 0)
    }

    return this.visualizeDuplicatedPorts()
  }

  override getOutput(): SerializedHyperGraph {
    if (!this.revisedSerializedHyperGraph || this.failed) {
      throw new Error(
        "DuplicateCongestedPortSolver does not have a repaired topology output",
      )
    }

    return this.revisedSerializedHyperGraph
  }

  private stepActiveRouteSolver(loadedGraph: LoadedSerializedHyperGraph): void {
    const routeSolver = this.activeSubSolver
    if (!routeSolver) return

    try {
      routeSolver.step()
    } catch (error) {
      this.failed = true
      this.error =
        routeSolver.error ??
        `Route ${this.nextRouteId} could not be solved independently: ${
          error instanceof Error ? error.message : String(error)
        }`
      this.failedSubSolvers = [...(this.failedSubSolvers ?? []), routeSolver]
      return
    }

    if (!routeSolver.solved && !routeSolver.failed) {
      this.updateRouteProgress(loadedGraph)
      return
    }

    if (routeSolver.failed || !routeSolver.solved) {
      this.failed = true
      this.error = `Route ${this.nextRouteId} could not be solved independently: ${
        routeSolver.error ?? "unknown error"
      }`
      this.failedSubSolvers = [...(this.failedSubSolvers ?? []), routeSolver]
      return
    }

    for (const portId of getUsedPortIdsForSolvedRoute(routeSolver)) {
      const serializedPortId = getSerializedPortId(loadedGraph.topology, portId)
      this.portUseCounts.set(
        serializedPortId,
        (this.portUseCounts.get(serializedPortId) ?? 0) + 1,
      )
    }

    this.nextRouteId++
    this.activeSubSolver = null
    this.updateRouteProgress(loadedGraph)
  }

  private finishDuplicatingPorts(): void {
    try {
      this.revisedSerializedHyperGraph = this.duplicateCongestedPorts(
        this.portUseCounts,
      )
      this.stats = {
        ...this.stats,
        duplicateSourcePortCount: this.report.duplicatedPorts.length,
        duplicatedPortCount: this.report.duplicatedPorts.reduce(
          (sum, duplicatedPort) => sum + duplicatedPort.duplicatePortIds.length,
          0,
        ),
      }
      this.solved = true
    } catch (error) {
      this.failed = true
      this.error = error instanceof Error ? error.message : String(error)
    }
  }

  private updateRouteProgress(loadedGraph: LoadedSerializedHyperGraph): void {
    const routeCount = Math.max(loadedGraph.problem.routeCount, 1)
    const activeRouteProgress = this.activeSubSolver?.progress ?? 0
    this.progress = Math.min(
      1,
      (this.nextRouteId + activeRouteProgress) / routeCount,
    )
    this.stats = {
      ...this.stats,
      duplicateCongestedPortRouteCount: loadedGraph.problem.routeCount,
      duplicateCongestedPortRoutesSolved: this.nextRouteId,
      duplicateCongestedPortActiveRouteId:
        this.activeSubSolver === null ? undefined : this.nextRouteId,
    }
  }

  private visualizeDuplicatedPorts(): GraphicsObject {
    const graph = this.revisedSerializedHyperGraph ?? this.serializedHyperGraph
    const portById = new Map(graph.ports.map((port) => [port.portId, port]))
    const regionById = new Map(
      graph.regions.map((region) => [region.regionId, region]),
    )
    const shownRegionIds = new Set<string>()
    const points: NonNullable<GraphicsObject["points"]> = []
    const lines: NonNullable<GraphicsObject["lines"]> = []
    const circles: NonNullable<GraphicsObject["circles"]> = []
    const rects: NonNullable<GraphicsObject["rects"]> = []

    for (const duplicatedPort of this.report.duplicatedPorts) {
      const sourcePort = portById.get(duplicatedPort.sourcePortId)
      if (!sourcePort) continue
      const sourcePoint = getPortPoint(sourcePort)

      for (const regionId of [sourcePort.region1Id, sourcePort.region2Id]) {
        if (shownRegionIds.has(regionId)) continue
        const regionRect = this.getRegionRect(regionById.get(regionId))
        if (!regionRect) continue
        shownRegionIds.add(regionId)
        rects.push(regionRect)
      }

      points.push({
        ...sourcePoint,
        color: "rgba(220, 120, 0, 0.95)",
        label: `source ${duplicatedPort.sourcePortId}\nuses ${duplicatedPort.useCount}`,
        layer: this.getPortLayer(sourcePort),
        step: 0,
      })
      circles.push({
        center: sourcePoint,
        radius: 0.14,
        fill: "rgba(220, 120, 0, 0.24)",
        stroke: "rgba(220, 120, 0, 0.95)",
        label: `source ${duplicatedPort.sourcePortId}\nuses ${duplicatedPort.useCount}`,
        layer: this.getPortLayer(sourcePort),
        step: 0,
      })

      for (const duplicatePortId of duplicatedPort.duplicatePortIds) {
        const duplicatePort = portById.get(duplicatePortId)
        if (!duplicatePort) continue
        const duplicatePoint = getPortPoint(duplicatePort)

        points.push({
          ...duplicatePoint,
          color: "rgba(0, 110, 220, 0.95)",
          label: `duplicate ${duplicatePortId}`,
          layer: this.getPortLayer(duplicatePort),
          step: 0,
        })
        circles.push({
          center: duplicatePoint,
          radius: 0.08,
          fill: "rgba(0, 110, 220, 0.20)",
          stroke: "rgba(0, 110, 220, 0.85)",
          label: `duplicate ${duplicatePortId}`,
          layer: this.getPortLayer(duplicatePort),
          step: 0,
        })
        lines.push({
          points: [sourcePoint, duplicatePoint],
          strokeWidth: 0.05,
          strokeColor: "rgba(0, 110, 220, 0.55)",
          layer: this.getPortLayer(duplicatePort),
          step: 0,
        })
      }
    }

    return {
      title: "Duplicate Congested Port Solver",
      points,
      lines,
      circles,
      rects,
    }
  }

  private getPortLayer(port: SerializedGraphPort): string | undefined {
    const z = port.d?.z
    if (typeof z !== "number" || !Number.isFinite(z)) {
      return undefined
    }

    return `z${z}`
  }

  private getRegionRect(
    region: SerializedGraphRegion | undefined,
  ): NonNullable<GraphicsObject["rects"]>[number] | null {
    if (!region) return null

    const bounds = getRegionBounds(region)
    const width = bounds.maxX - bounds.minX
    const height = bounds.maxY - bounds.minY
    if (!(width > 0) || !(height > 0)) {
      return null
    }

    return {
      center: getRegionCenter(region),
      width,
      height,
      fill: "rgba(255, 170, 0, 0.10)",
      stroke: "rgba(255, 140, 0, 0.45)",
      label: `incident ${region.regionId}`,
      step: 0,
    }
  }
}
