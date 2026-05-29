import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { BaseSolver } from "@tscircuit/solver-utils"
import { loadSerializedHyperGraph } from "./compat/loadSerializedHyperGraph"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "./core"
import type { PortId, RouteId } from "./types"

type SerializedPort = SerializedHyperGraph["ports"][number]
type SerializedRegion = SerializedHyperGraph["regions"][number]

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

const getPortPoint = (port: SerializedPort): Point => ({
  x: getNumber(port.d?.x),
  y: getNumber(port.d?.y),
})

const getBoundaryKey = (
  port: Pick<SerializedPort, "region1Id" | "region2Id">,
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
  region: SerializedRegion | undefined,
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

const getRegionCenter = (region: SerializedRegion | undefined): Point => {
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
  sourcePort: SerializedPort,
  ports: SerializedPort[],
): SerializedPort | undefined => {
  const sourceBoundaryKey = getBoundaryKey(sourcePort)
  const sourcePoint = getPortPoint(sourcePort)
  let nearestPort: SerializedPort | undefined
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
  sourcePort: SerializedPort,
  regionById: Map<string, SerializedRegion>,
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
  sourcePort: SerializedPort,
  nearestBoundaryPort: SerializedPort | undefined,
  regionById: Map<string, SerializedRegion>,
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

  private getPortUseCounts(): Map<string, number> {
    const { topology, problem } = loadSerializedHyperGraph(
      this.serializedHyperGraph,
    )
    const portUseCounts = new Map<string, number>()

    for (let routeId = 0; routeId < problem.routeCount; routeId++) {
      const routeProblem = createSingleRouteProblem(problem, routeId)
      const routeSolver = new TinyHyperGraphSolver(
        topology,
        routeProblem,
        this.getIndividualRouteSolveOptions(),
      )
      routeSolver.solve()

      if (!routeSolver.solved || routeSolver.failed) {
        throw new Error(
          `Route ${routeId} could not be solved independently: ${
            routeSolver.error ?? "unknown error"
          }`,
        )
      }

      for (const portId of getUsedPortIdsForSolvedRoute(routeSolver)) {
        const serializedPortId = getSerializedPortId(topology, portId)
        portUseCounts.set(
          serializedPortId,
          (portUseCounts.get(serializedPortId) ?? 0) + 1,
        )
      }
    }

    return portUseCounts
  }

  private duplicateCongestedPorts(
    portUseCounts: Map<string, number>,
  ): SerializedHyperGraph {
    const duplicatePortProximity = this.getDuplicatePortProximity()
    if (!(duplicatePortProximity > 0)) {
      throw new Error("duplicatePortProximity must be greater than zero")
    }

    const regions: SerializedRegion[] = this.serializedHyperGraph.regions.map(
      (region) => ({
        ...region,
        pointIds: [...region.pointIds],
        d: cloneSerializableValue(region.d),
      }),
    )
    const ports: SerializedPort[] = this.serializedHyperGraph.ports.map(
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
      ...this.serializedHyperGraph,
      regions,
      ports,
      connections:
        this.serializedHyperGraph.connections === undefined
          ? undefined
          : cloneSerializableValue(this.serializedHyperGraph.connections),
      solvedRoutes:
        this.serializedHyperGraph.solvedRoutes === undefined
          ? undefined
          : cloneSerializableValue(this.serializedHyperGraph.solvedRoutes),
    }
  }

  override _setup() {
    try {
      const portUseCounts = this.getPortUseCounts()
      this.revisedSerializedHyperGraph =
        this.duplicateCongestedPorts(portUseCounts)
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

  override _step() {
    if (!this.failed) {
      this.solved = true
    }
  }

  override getOutput(): SerializedHyperGraph {
    if (!this.revisedSerializedHyperGraph || this.failed) {
      throw new Error(
        "DuplicateCongestedPortSolver does not have a repaired topology output",
      )
    }

    return this.revisedSerializedHyperGraph
  }
}
