import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { PipelineStep } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { loadSerializedHyperGraph } from "./compat/loadSerializedHyperGraph"
import { computeRegionCostForArea } from "./computeRegionCost"
import { TinyHyperGraphSolver } from "./core"
import { getAvailableZFromMask, getZLayerLabel } from "./layerLabels"
import { TinyHyperGraphSectionSolver } from "./section-solver"
import { TinyHyperGraphSectionPipelineSolver } from "./section-solver/TinyHyperGraphSectionPipelineSolver"
import type {
  Candidate,
  TinyHyperGraphProblem,
  TinyHyperGraphSolution,
  TinyHyperGraphTopology,
} from "./core"
import type {
  ConvexPolygon,
  PolyBounds,
  PolyHyperGraphLoadResult,
  PolyHyperGraphProblem,
  PolyHyperGraphSolverOptions,
  PolyHyperGraphSourceMapping,
  PolyHyperGraphTopology,
  PolyPoint,
  RectToPolyHyperGraphAdapterOptions,
} from "./poly-types"
import type { PortId, RegionId, RouteId } from "./types"

export type * from "./poly-types"

const DEFAULT_BOUNDARY_COORDINATE_SCALE = 36000
const MIN_REGION_DIMENSION = 1e-9
const BOTTOM_LAYER_TRACE_COLOR = "rgba(52, 152, 219, 0.95)"
const BOTTOM_LAYER_TRACE_DASH = "3 2"
const TRANSITION_CROSSING_COLOR = "rgba(22, 160, 133, 0.95)"
const TRANSITION_CROSSING_DASH = "2 4 2"
const ZERO_COST_REGION_FILL = "rgba(128, 128, 128, 0.2)"
const MULTI_LAYER_POLYGON_STROKE = "rgba(128, 128, 128, 0.85)"
const MULTI_LAYER_POLYGON_DASH = "4 3"
const POLY_LAYER_COLORS = [
  {
    fill: "rgba(220, 38, 38, 0.65)",
    stroke: "rgba(220, 38, 38, 0.95)",
  },
  {
    fill: "rgba(37, 99, 235, 0.65)",
    stroke: "rgba(37, 99, 235, 0.95)",
  },
  {
    fill: "rgba(22, 163, 74, 0.65)",
    stroke: "rgba(22, 163, 74, 0.95)",
  },
  {
    fill: "rgba(249, 115, 22, 0.65)",
    stroke: "rgba(249, 115, 22, 0.95)",
  },
]
const FALLBACK_LAYER_COLOR = {
  fill: "rgba(107, 114, 128, 0.55)",
  stroke: "rgba(107, 114, 128, 0.95)",
}

interface SegmentGeometryScratch {
  lesserAngle: number
  greaterAngle: number
  layerMask: number
  entryExitLayerChanges: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const toFiniteNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

const toConvexPolygon = (points: PolyPoint[]): ConvexPolygon => {
  if (points.length < 3) {
    throw new Error("Convex polygon requires at least three points")
  }

  return points as unknown as ConvexPolygon
}

const getSerializedRegionBounds = (
  region: SerializedHyperGraph["regions"][number],
): PolyBounds => {
  const data = region.d
  const bounds = data?.bounds
  if (
    bounds &&
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

  const center = data?.center
  const width = toFiniteNumber(data?.width, 0)
  const height = toFiniteNumber(data?.height, 0)
  if (center && typeof center.x === "number" && typeof center.y === "number") {
    return {
      minX: center.x - width / 2,
      maxX: center.x + width / 2,
      minY: center.y - height / 2,
      maxY: center.y + height / 2,
    }
  }

  return {
    minX: 0,
    maxX: MIN_REGION_DIMENSION,
    minY: 0,
    maxY: MIN_REGION_DIMENSION,
  }
}

const sanitizeBounds = (bounds: PolyBounds): PolyBounds => {
  const minX = Math.min(bounds.minX, bounds.maxX)
  const maxX = Math.max(bounds.minX, bounds.maxX)
  const minY = Math.min(bounds.minY, bounds.maxY)
  const maxY = Math.max(bounds.minY, bounds.maxY)

  return {
    minX,
    maxX: maxX > minX ? maxX : minX + MIN_REGION_DIMENSION,
    minY,
    maxY: maxY > minY ? maxY : minY + MIN_REGION_DIMENSION,
  }
}

const createRectPolygon = (bounds: PolyBounds): ConvexPolygon => {
  const safeBounds = sanitizeBounds(bounds)

  return [
    { x: safeBounds.maxX, y: safeBounds.minY },
    { x: safeBounds.maxX, y: safeBounds.maxY },
    { x: safeBounds.minX, y: safeBounds.maxY },
    { x: safeBounds.minX, y: safeBounds.minY },
  ]
}

const getPointArrayFromRegionData = (
  region: SerializedHyperGraph["regions"][number],
): PolyPoint[] | undefined => {
  const data = region.d as Record<string, unknown> | undefined
  const rawPoints = data?.polygon ?? data?.points ?? data?.vertices
  if (!Array.isArray(rawPoints)) {
    return undefined
  }

  const points = rawPoints
    .map((point): PolyPoint | undefined => {
      if (!isRecord(point)) return undefined
      const x = point.x
      const y = point.y
      return typeof x === "number" && typeof y === "number"
        ? { x, y }
        : undefined
    })
    .filter((point): point is PolyPoint => point !== undefined)

  if (points.length > 1) {
    const first = points[0]!
    const last = points[points.length - 1]!
    if (first.x === last.x && first.y === last.y) {
      points.pop()
    }
  }

  return points.length >= 3 ? points : undefined
}

const getSignedDoubleArea = (points: readonly PolyPoint[]) => {
  let signedDoubleArea = 0

  for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
    const point = points[pointIndex]!
    const nextPoint = points[(pointIndex + 1) % points.length]!
    signedDoubleArea += point.x * nextPoint.y - point.y * nextPoint.x
  }

  return signedDoubleArea
}

const normalizePolygon = (
  points: readonly PolyPoint[],
  fallbackBounds: PolyBounds,
): ConvexPolygon => {
  const finitePoints = points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  )
  const candidatePoints =
    finitePoints.length >= 3 ? finitePoints : createRectPolygon(fallbackBounds)
  const signedDoubleArea = getSignedDoubleArea(candidatePoints)
  if (Math.abs(signedDoubleArea) <= Number.EPSILON) {
    return createRectPolygon(fallbackBounds)
  }

  const normalizedPoints =
    signedDoubleArea < 0 ? [...candidatePoints].reverse() : [...candidatePoints]

  return toConvexPolygon(normalizedPoints)
}

const getSerializedRegionPolygon = (
  region: SerializedHyperGraph["regions"][number],
): ConvexPolygon => {
  const bounds = getSerializedRegionBounds(region)
  return normalizePolygon(
    getPointArrayFromRegionData(region) ?? createRectPolygon(bounds),
    bounds,
  )
}

const computePolygonGeometry = (polygon: ConvexPolygon) => {
  let signedDoubleArea = 0
  let centroidXNumerator = 0
  let centroidYNumerator = 0
  let perimeter = 0
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (let pointIndex = 0; pointIndex < polygon.length; pointIndex++) {
    const point = polygon[pointIndex]!
    const nextPoint = polygon[(pointIndex + 1) % polygon.length]!
    const cross = point.x * nextPoint.y - nextPoint.x * point.y

    signedDoubleArea += cross
    centroidXNumerator += (point.x + nextPoint.x) * cross
    centroidYNumerator += (point.y + nextPoint.y) * cross
    perimeter += Math.hypot(nextPoint.x - point.x, nextPoint.y - point.y)
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  const area = Math.abs(signedDoubleArea) / 2
  const safeCentroidDivisor =
    Math.abs(signedDoubleArea) > Number.EPSILON
      ? 3 * signedDoubleArea
      : Number.NaN
  const averageCenter = polygon.reduce(
    (sum, point) => ({
      x: sum.x + point.x / polygon.length,
      y: sum.y + point.y / polygon.length,
    }),
    { x: 0, y: 0 },
  )

  return {
    area,
    perimeter,
    centerX: Number.isFinite(safeCentroidDivisor)
      ? centroidXNumerator / safeCentroidDivisor
      : averageCenter.x,
    centerY: Number.isFinite(safeCentroidDivisor)
      ? centroidYNumerator / safeCentroidDivisor
      : averageCenter.y,
    bounds: { minX, maxX, minY, maxY },
  }
}

const projectPointToPolygonBoundary = (
  point: PolyPoint,
  polygon: ConvexPolygon,
  perimeter: number,
  boundaryCoordinateScale: number,
) => {
  if (perimeter <= 0) {
    return {
      boundaryPosition: 0,
      edgeIndex: 0,
      edgeT: 0,
    }
  }

  let bestDistanceSq = Number.POSITIVE_INFINITY
  let bestEdgeIndex = 0
  let bestEdgeT = 0
  let bestDistanceAlongPerimeter = 0
  let distanceAlongPerimeter = 0

  for (let edgeIndex = 0; edgeIndex < polygon.length; edgeIndex++) {
    const edgeStart = polygon[edgeIndex]!
    const edgeEnd = polygon[(edgeIndex + 1) % polygon.length]!
    const edgeDx = edgeEnd.x - edgeStart.x
    const edgeDy = edgeEnd.y - edgeStart.y
    const edgeLengthSq = edgeDx * edgeDx + edgeDy * edgeDy
    const edgeLength = Math.sqrt(edgeLengthSq)
    const rawT =
      edgeLengthSq <= Number.EPSILON
        ? 0
        : ((point.x - edgeStart.x) * edgeDx +
            (point.y - edgeStart.y) * edgeDy) /
          edgeLengthSq
    const edgeT = Math.min(1, Math.max(0, rawT))
    const projectionX = edgeStart.x + edgeDx * edgeT
    const projectionY = edgeStart.y + edgeDy * edgeT
    const distanceX = point.x - projectionX
    const distanceY = point.y - projectionY
    const distanceSq = distanceX * distanceX + distanceY * distanceY

    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq
      bestEdgeIndex = edgeIndex
      bestEdgeT = edgeT
      bestDistanceAlongPerimeter = distanceAlongPerimeter + edgeLength * edgeT
    }

    distanceAlongPerimeter += edgeLength
  }

  return {
    boundaryPosition:
      Math.round(
        (bestDistanceAlongPerimeter / perimeter) * boundaryCoordinateScale,
      ) % boundaryCoordinateScale,
    edgeIndex: bestEdgeIndex,
    edgeT: bestEdgeT,
  }
}

const getSerializedRegionId = (
  topology: TinyHyperGraphTopology,
  regionId: RegionId,
) => {
  const metadata = topology.regionMetadata?.[regionId]
  return isRecord(metadata) && typeof metadata.serializedRegionId === "string"
    ? metadata.serializedRegionId
    : `region-${regionId}`
}

const getSerializedPortId = (
  topology: TinyHyperGraphTopology,
  portId: PortId,
) => {
  const metadata = topology.portMetadata?.[portId]
  return isRecord(metadata) && typeof metadata.serializedPortId === "string"
    ? metadata.serializedPortId
    : `port-${portId}`
}

const createRegionMetadata = (
  baseMetadata: unknown,
  serializedRegionId: string,
  polygon: ConvexPolygon,
  sourceBounds: PolyBounds,
) => {
  const metadataBase = isRecord(baseMetadata)
    ? { ...baseMetadata }
    : baseMetadata === undefined
      ? {}
      : { value: baseMetadata }
  const metadata = {
    ...metadataBase,
    polygon,
    sourceBounds,
  }

  Object.defineProperty(metadata, "serializedRegionId", {
    value: serializedRegionId,
    enumerable: false,
    configurable: true,
    writable: true,
  })

  return metadata
}

const createMapping = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
): PolyHyperGraphSourceMapping => {
  const serializedRegionIdToRegionId = new Map<string, RegionId>()
  const serializedPortIdToPortId = new Map<string, PortId>()
  const connectionIdToRouteId = new Map<string, RouteId>()
  const netIdToNetIndex = new Map<string, number>()

  for (let regionId = 0; regionId < topology.regionCount; regionId++) {
    serializedRegionIdToRegionId.set(
      getSerializedRegionId(topology, regionId),
      regionId,
    )
  }

  for (let portId = 0; portId < topology.portCount; portId++) {
    serializedPortIdToPortId.set(getSerializedPortId(topology, portId), portId)
  }

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const routeMetadata = problem.routeMetadata?.[routeId]
    if (!isRecord(routeMetadata)) continue

    if (typeof routeMetadata.connectionId === "string") {
      connectionIdToRouteId.set(routeMetadata.connectionId, routeId)
    }

    const netId =
      typeof routeMetadata.mutuallyConnectedNetworkId === "string"
        ? routeMetadata.mutuallyConnectedNetworkId
        : typeof routeMetadata.connectionId === "string"
          ? routeMetadata.connectionId
          : undefined

    if (netId !== undefined) {
      netIdToNetIndex.set(netId, problem.routeNet[routeId]!)
    }
  }

  return {
    serializedRegionIdToRegionId,
    serializedPortIdToPortId,
    connectionIdToRouteId,
    netIdToNetIndex,
  }
}

export const loadSerializedHyperGraphAsPoly = (
  serializedHyperGraph: SerializedHyperGraph,
  options: RectToPolyHyperGraphAdapterOptions = {},
): PolyHyperGraphLoadResult => {
  const boundaryCoordinateScale =
    options.boundaryCoordinateScale ?? DEFAULT_BOUNDARY_COORDINATE_SCALE
  const coreLoaded = loadSerializedHyperGraph(serializedHyperGraph)
  const { topology, problem, solution } = coreLoaded
  const serializedRegionById = new Map(
    serializedHyperGraph.regions.map((region) => [region.regionId, region]),
  )
  const regionPolygons: ConvexPolygon[] = []

  for (let regionId = 0; regionId < topology.regionCount; regionId++) {
    const serializedRegionId = getSerializedRegionId(topology, regionId)
    const serializedRegion = serializedRegionById.get(serializedRegionId)
    const polygon = serializedRegion
      ? getSerializedRegionPolygon(serializedRegion)
      : createRectPolygon({
          minX:
            topology.regionCenterX[regionId] -
            topology.regionWidth[regionId] / 2,
          maxX:
            topology.regionCenterX[regionId] +
            topology.regionWidth[regionId] / 2,
          minY:
            topology.regionCenterY[regionId] -
            topology.regionHeight[regionId] / 2,
          maxY:
            topology.regionCenterY[regionId] +
            topology.regionHeight[regionId] / 2,
        })

    regionPolygons.push(polygon)
  }

  const totalVertexCount = regionPolygons.reduce(
    (sum, polygon) => sum + polygon.length,
    0,
  )
  const regionVertexStart = new Int32Array(topology.regionCount)
  const regionVertexCount = new Int32Array(topology.regionCount)
  const regionVertexX = new Float64Array(totalVertexCount)
  const regionVertexY = new Float64Array(totalVertexCount)
  const regionArea = new Float64Array(topology.regionCount)
  const regionPerimeter = new Float64Array(topology.regionCount)
  const regionCenterX = new Float64Array(topology.regionCount)
  const regionCenterY = new Float64Array(topology.regionCount)
  const regionBoundsMinX = new Float64Array(topology.regionCount)
  const regionBoundsMaxX = new Float64Array(topology.regionCount)
  const regionBoundsMinY = new Float64Array(topology.regionCount)
  const regionBoundsMaxY = new Float64Array(topology.regionCount)
  const regionWidth = new Float64Array(topology.regionCount)
  const regionHeight = new Float64Array(topology.regionCount)
  const regionMetadata = new Array(topology.regionCount)

  let vertexOffset = 0
  for (let regionId = 0; regionId < topology.regionCount; regionId++) {
    const polygon = regionPolygons[regionId]!
    const geometry = computePolygonGeometry(polygon)
    const areaSide = Math.sqrt(Math.max(geometry.area, MIN_REGION_DIMENSION))

    regionVertexStart[regionId] = vertexOffset
    regionVertexCount[regionId] = polygon.length
    regionArea[regionId] = geometry.area
    regionPerimeter[regionId] = geometry.perimeter
    regionCenterX[regionId] = geometry.centerX
    regionCenterY[regionId] = geometry.centerY
    regionBoundsMinX[regionId] = geometry.bounds.minX
    regionBoundsMaxX[regionId] = geometry.bounds.maxX
    regionBoundsMinY[regionId] = geometry.bounds.minY
    regionBoundsMaxY[regionId] = geometry.bounds.maxY
    regionWidth[regionId] = areaSide
    regionHeight[regionId] = areaSide
    regionMetadata[regionId] = createRegionMetadata(
      topology.regionMetadata?.[regionId],
      getSerializedRegionId(topology, regionId),
      polygon,
      geometry.bounds,
    )

    for (const point of polygon) {
      regionVertexX[vertexOffset] = point.x
      regionVertexY[vertexOffset] = point.y
      vertexOffset += 1
    }
  }

  const portBoundaryPositionForRegion1 = new Int32Array(topology.portCount)
  const portBoundaryPositionForRegion2 = new Int32Array(topology.portCount)
  const portEdgeIndexForRegion1 = new Int32Array(topology.portCount)
  const portEdgeIndexForRegion2 = new Int32Array(topology.portCount)
  const portEdgeTForRegion1 = new Float64Array(topology.portCount)
  const portEdgeTForRegion2 = new Float64Array(topology.portCount)

  for (let portId = 0; portId < topology.portCount; portId++) {
    const portPoint = {
      x: topology.portX[portId],
      y: topology.portY[portId],
    }
    const [region1Id, region2Id] = topology.incidentPortRegion[portId] ?? []

    if (region1Id !== undefined) {
      const projection = projectPointToPolygonBoundary(
        portPoint,
        regionPolygons[region1Id]!,
        regionPerimeter[region1Id],
        boundaryCoordinateScale,
      )
      portBoundaryPositionForRegion1[portId] = projection.boundaryPosition
      portEdgeIndexForRegion1[portId] = projection.edgeIndex
      portEdgeTForRegion1[portId] = projection.edgeT
    }

    if (region2Id !== undefined) {
      const projection = projectPointToPolygonBoundary(
        portPoint,
        regionPolygons[region2Id]!,
        regionPerimeter[region2Id],
        boundaryCoordinateScale,
      )
      portBoundaryPositionForRegion2[portId] = projection.boundaryPosition
      portEdgeIndexForRegion2[portId] = projection.edgeIndex
      portEdgeTForRegion2[portId] = projection.edgeT
    }
  }

  for (let regionId = 0; regionId < topology.regionCount; regionId++) {
    const metadata = regionMetadata[regionId]
    metadata.layer =
      getZLayerLabel(
        getAvailableZFromMask(topology.regionAvailableZMask?.[regionId] ?? 0),
      ) ??
      getZLayerLabel(
        (topology.regionIncidentPorts[regionId] ?? []).map(
          (portId) => topology.portZ[portId],
        ),
      ) ??
      "z0"
  }

  const polyTopology: PolyHyperGraphTopology = {
    ...topology,
    regionWidth,
    regionHeight,
    regionCenterX,
    regionCenterY,
    regionMetadata,
    portAngleForRegion1: portBoundaryPositionForRegion1,
    portAngleForRegion2: portBoundaryPositionForRegion2,
    regionVertexStart,
    regionVertexCount,
    regionVertexX,
    regionVertexY,
    regionArea,
    regionPerimeter,
    regionBoundsMinX,
    regionBoundsMaxX,
    regionBoundsMinY,
    regionBoundsMaxY,
    portBoundaryPositionForRegion1,
    portBoundaryPositionForRegion2,
    portEdgeIndexForRegion1,
    portEdgeIndexForRegion2,
    portEdgeTForRegion1,
    portEdgeTForRegion2,
  }

  return {
    topology: polyTopology,
    problem,
    solution,
    mapping: createMapping(polyTopology, problem),
  }
}

export const loadPolyHyperGraph = loadSerializedHyperGraphAsPoly

const getBoundaryPositionForPortRegion = (
  topology: PolyHyperGraphTopology,
  portId: PortId,
  regionId: RegionId,
) => {
  const incidentRegions = topology.incidentPortRegion[portId]
  return incidentRegions[0] === regionId || incidentRegions[1] !== regionId
    ? topology.portBoundaryPositionForRegion1[portId]
    : topology.portBoundaryPositionForRegion2[portId]
}

export class PolyHyperGraphSolver extends TinyHyperGraphSolver {
  private polySegmentGeometryScratch: SegmentGeometryScratch = {
    lesserAngle: 0,
    greaterAngle: 0,
    layerMask: 0,
    entryExitLayerChanges: 0,
  }

  constructor(
    public override topology: PolyHyperGraphTopology,
    public override problem: PolyHyperGraphProblem,
    options?: PolyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
  }

  override populateSegmentGeometryScratch(
    regionId: RegionId,
    port1Id: PortId,
    port2Id: PortId,
  ): SegmentGeometryScratch {
    const { topology } = this
    const scratch = this.polySegmentGeometryScratch
    const position1 = getBoundaryPositionForPortRegion(
      topology,
      port1Id,
      regionId,
    )
    const position2 = getBoundaryPositionForPortRegion(
      topology,
      port2Id,
      regionId,
    )
    const z1 = topology.portZ[port1Id]
    const z2 = topology.portZ[port2Id]

    scratch.lesserAngle = position1 < position2 ? position1 : position2
    scratch.greaterAngle = position1 < position2 ? position2 : position1
    scratch.layerMask = (1 << z1) | (1 << z2)
    scratch.entryExitLayerChanges = z1 !== z2 ? 1 : 0

    return scratch
  }

  protected override computeRegionCostForRegion(
    regionId: RegionId,
    numSameLayerIntersections: number,
    numCrossLayerIntersections: number,
    numEntryExitChanges: number,
    traceCount: number,
  ): number {
    return computeRegionCostForArea(
      this.topology.regionArea[regionId],
      numSameLayerIntersections,
      numCrossLayerIntersections,
      numEntryExitChanges,
      traceCount,
      this.topology.regionAvailableZMask?.[regionId] ?? 0,
      this.minViaPadDiameter,
    )
  }

  override visualize(): GraphicsObject {
    return visualizePolyHyperGraph(this)
  }
}

const formatLabel = (...lines: Array<string | undefined>) =>
  lines.filter((line): line is string => Boolean(line)).join("\n")

const getRouteLabel = (
  solver: PolyHyperGraphSolver,
  routeId: RouteId,
): string => {
  const routeMetadata = solver.problem.routeMetadata?.[routeId]
  return (
    routeMetadata?.connectionId ??
    routeMetadata?.mutuallyConnectedNetworkId ??
    `route-${routeId}`
  )
}

const getRouteColor = (
  solver: PolyHyperGraphSolver,
  routeId: RouteId,
  alpha = 0.85,
): string => {
  const routeNet = solver.problem.routeNet[routeId]
  const routeLabel = getRouteLabel(solver, routeId)
  const hashSource = `${routeNet}:${routeLabel}`
  let hash = 0

  for (let index = 0; index < hashSource.length; index++) {
    hash = hashSource.charCodeAt(index) * 17777 + ((hash << 5) - hash)
  }

  return `hsla(${Math.abs(hash) % 360}, 70%, 45%, ${alpha})`
}

const getLayerColor = (z: number | undefined) =>
  z !== undefined
    ? (POLY_LAYER_COLORS[z] ?? FALLBACK_LAYER_COLOR)
    : FALLBACK_LAYER_COLOR

const getRegionLayerIds = (
  solver: PolyHyperGraphSolver,
  regionId: RegionId,
): number[] => {
  const maskLayers = getAvailableZFromMask(
    solver.topology.regionAvailableZMask?.[regionId] ?? 0,
  )

  if (maskLayers.length > 0) {
    return maskLayers
  }

  const incidentLayers = [
    ...new Set(
      (solver.topology.regionIncidentPorts[regionId] ?? []).map(
        (portId) => solver.topology.portZ[portId],
      ),
    ),
  ].filter((z) => Number.isInteger(z) && z >= 0)

  if (incidentLayers.length > 0) {
    return incidentLayers.sort((left, right) => left - right)
  }

  return [0]
}

const getRegionPolygon = (
  topology: PolyHyperGraphTopology,
  regionId: RegionId,
): PolyPoint[] => {
  const start = topology.regionVertexStart[regionId]
  const count = topology.regionVertexCount[regionId]
  const points: PolyPoint[] = []

  for (let offset = 0; offset < count; offset++) {
    const vertexIndex = start + offset
    points.push({
      x: topology.regionVertexX[vertexIndex],
      y: topology.regionVertexY[vertexIndex],
    })
  }

  return points
}

const getRegionFill = (solver: PolyHyperGraphSolver, regionId: RegionId) => {
  const regionCost =
    solver.state.regionIntersectionCaches[regionId]?.existingRegionCost ?? 0
  if (regionCost === 0) {
    return ZERO_COST_REGION_FILL
  }

  const hotness = Math.min(1, Math.max(0, Math.pow(regionCost, 0.8)))
  const blue = Math.round(245 - hotness * 105)
  const green = Math.round(248 - hotness * 168)

  return `rgba(245, ${green}, ${blue}, ${0.18 + hotness * 0.48})`
}

const getRegionStroke = (solver: PolyHyperGraphSolver, regionId: RegionId) => {
  const layers = getRegionLayerIds(solver, regionId)
  return layers.length > 1
    ? MULTI_LAYER_POLYGON_STROKE
    : getLayerColor(layers[0]).stroke
}

const isMultiLayerRegion = (solver: PolyHyperGraphSolver, regionId: RegionId) =>
  getRegionLayerIds(solver, regionId).length > 1

const getRegionLabel = (
  solver: PolyHyperGraphSolver,
  regionId: RegionId,
): string => {
  const cache = solver.state.regionIntersectionCaches[regionId]
  const serializedRegionId = getSerializedRegionId(solver.topology, regionId)
  const regionNetId = solver.problem.regionNetId[regionId]

  return formatLabel(
    `region: ${serializedRegionId}`,
    `net: ${regionNetId === -1 ? "free" : regionNetId}`,
    `area: ${solver.topology.regionArea[regionId].toFixed(3)}`,
    `cost: ${(cache?.existingRegionCost ?? 0).toFixed(3)}`,
    `same layer X: ${cache?.existingSameLayerIntersections ?? 0}`,
    `trans X: ${cache?.existingCrossingLayerIntersections ?? 0}`,
    `entry exit X: ${cache?.existingEntryExitLayerChanges ?? 0}`,
  )
}

const getRegionVisualizationLayer = (
  solver: PolyHyperGraphSolver,
  regionId: RegionId,
): string => getZLayerLabel(getRegionLayerIds(solver, regionId)) ?? "z0"

const getPortPoint = (solver: PolyHyperGraphSolver, portId: PortId) => ({
  x: solver.topology.portX[portId],
  y: solver.topology.portY[portId],
})

const getPortVisualizationLayer = (
  solver: PolyHyperGraphSolver,
  portId: PortId,
): string => getZLayerLabel([solver.topology.portZ[portId]]) ?? "z0"

const getPortFill = (solver: PolyHyperGraphSolver, portId: PortId): string =>
  getLayerColor(solver.topology.portZ[portId]).fill

const getPortStroke = (solver: PolyHyperGraphSolver, portId: PortId): string =>
  getLayerColor(solver.topology.portZ[portId]).stroke

const getSegmentStyle = (
  solver: PolyHyperGraphSolver,
  routeId: RouteId,
  port1Id: PortId,
  port2Id: PortId,
): { strokeColor: string; strokeDash?: string } => {
  const z1 = solver.topology.portZ[port1Id]
  const z2 = solver.topology.portZ[port2Id]

  if (z1 !== z2) {
    return {
      strokeColor: TRANSITION_CROSSING_COLOR,
      strokeDash: TRANSITION_CROSSING_DASH,
    }
  }

  if (z1 > 0) {
    return {
      strokeColor: BOTTOM_LAYER_TRACE_COLOR,
      strokeDash: BOTTOM_LAYER_TRACE_DASH,
    }
  }

  return {
    strokeColor: getRouteColor(solver, routeId),
  }
}

const getPortLabel = (solver: PolyHyperGraphSolver, portId: PortId) => {
  const [region1Id, region2Id] =
    solver.topology.incidentPortRegion[portId] ?? []
  return formatLabel(
    `port: ${getSerializedPortId(solver.topology, portId)}`,
    `connects: ${region1Id ?? "?"} <-> ${region2Id ?? "?"}`,
    `z: ${solver.topology.portZ[portId]}`,
  )
}

const pushRouteEndpoints = (
  solver: PolyHyperGraphSolver,
  graphics: Required<GraphicsObject>,
) => {
  for (let routeId = 0; routeId < solver.problem.routeCount; routeId++) {
    const startPortId = solver.problem.routeStartPort[routeId]
    const endPortId = solver.problem.routeEndPort[routeId]
    const routeLabel = getRouteLabel(solver, routeId)
    const routeColor = getRouteColor(solver, routeId)

    graphics.points.push({
      ...getPortPoint(solver, startPortId),
      color: routeColor,
      layer: getPortVisualizationLayer(solver, startPortId),
      label: formatLabel(
        `route: ${routeLabel}`,
        "endpoint: start",
        getPortLabel(solver, startPortId),
      ),
    })
    graphics.points.push({
      ...getPortPoint(solver, endPortId),
      color: routeColor,
      layer: getPortVisualizationLayer(solver, endPortId),
      label: formatLabel(
        `route: ${routeLabel}`,
        "endpoint: end",
        getPortLabel(solver, endPortId),
      ),
    })
  }
}

const pushSolvedSegments = (
  solver: PolyHyperGraphSolver,
  graphics: Required<GraphicsObject>,
) => {
  for (
    let regionId = 0;
    regionId < solver.state.regionSegments.length;
    regionId++
  ) {
    for (const [routeId, port1Id, port2Id] of solver.state.regionSegments[
      regionId
    ] ?? []) {
      graphics.lines.push({
        points: [getPortPoint(solver, port1Id), getPortPoint(solver, port2Id)],
        layer:
          getZLayerLabel([
            solver.topology.portZ[port1Id],
            solver.topology.portZ[port2Id],
          ]) ?? "z0",
        label: formatLabel(
          `route: ${getRouteLabel(solver, routeId)}`,
          `region: ${getSerializedRegionId(solver.topology, regionId)}`,
        ),
        ...getSegmentStyle(solver, routeId, port1Id, port2Id),
      })
    }
  }
}

const pushCandidateFrontier = (
  solver: PolyHyperGraphSolver,
  graphics: Required<GraphicsObject>,
) => {
  if (solver.solved) return

  const candidates = solver.state.candidateQueue
    .toArray()
    .sort((left: Candidate, right: Candidate) => left.f - right.f)
    .slice(0, 10)

  for (
    let candidateIndex = 0;
    candidateIndex < candidates.length;
    candidateIndex++
  ) {
    const candidate = candidates[candidateIndex]!
    graphics.points.push({
      ...getPortPoint(solver, candidate.portId),
      color: candidateIndex === 0 ? "green" : "rgba(128, 128, 128, 0.4)",
      layer: getPortVisualizationLayer(solver, candidate.portId),
      label: formatLabel(
        getPortLabel(solver, candidate.portId),
        `g: ${candidate.g.toFixed(2)}`,
        `h: ${candidate.h.toFixed(2)}`,
        `f: ${candidate.f.toFixed(2)}`,
      ),
    })
  }

  const currentCandidate = candidates[0]
  if (!currentCandidate) return

  const activePath: PolyPoint[] = []
  let cursor: Candidate | undefined = currentCandidate

  while (cursor) {
    activePath.unshift(getPortPoint(solver, cursor.portId))
    cursor = cursor.prevCandidate
  }

  if (activePath.length <= 1) return

  const routeId = solver.state.currentRouteId
  graphics.lines.push({
    points: activePath,
    strokeColor:
      routeId !== undefined
        ? getRouteColor(solver, routeId, 0.95)
        : "rgba(0, 160, 120, 0.95)",
    strokeDash: "4 3",
    layer: getPortVisualizationLayer(solver, currentCandidate.portId),
    label: formatLabel(
      routeId !== undefined
        ? `route: ${getRouteLabel(solver, routeId)}`
        : undefined,
      "active candidate path",
      `candidate port: ${getSerializedPortId(
        solver.topology,
        currentCandidate.portId,
      )}`,
    ),
  })
}

export const visualizePolyHyperGraph = (
  solver: PolyHyperGraphSolver,
): GraphicsObject => {
  const graphics: Required<GraphicsObject> = {
    arrows: [],
    circles: [],
    infiniteLines: [],
    lines: [],
    points: [],
    polygons: [],
    rects: [],
    texts: [],
    title: "Poly HyperGraph",
    coordinateSystem: "cartesian",
  }

  for (let regionId = 0; regionId < solver.topology.regionCount; regionId++) {
    const polygonPoints = getRegionPolygon(solver.topology, regionId)
    const isMultiLayer = isMultiLayerRegion(solver, regionId)

    graphics.polygons.push({
      points: polygonPoints,
      fill: getRegionFill(solver, regionId),
      stroke: getRegionStroke(solver, regionId),
      layer: getRegionVisualizationLayer(solver, regionId),
      label: getRegionLabel(solver, regionId),
    })

    if (isMultiLayer && polygonPoints.length > 0) {
      graphics.lines.push({
        points: [...polygonPoints, polygonPoints[0]!],
        strokeColor: MULTI_LAYER_POLYGON_STROKE,
        strokeDash: MULTI_LAYER_POLYGON_DASH,
        layer: getRegionVisualizationLayer(solver, regionId),
        label: formatLabel(
          `layer outline: ${getSerializedRegionId(solver.topology, regionId)}`,
          getRegionLabel(solver, regionId),
        ),
      })
    }
  }

  for (let portId = 0; portId < solver.topology.portCount; portId++) {
    graphics.circles.push({
      center: getPortPoint(solver, portId),
      radius: 0.05,
      fill: getPortFill(solver, portId),
      stroke: getPortStroke(solver, portId),
      layer: getPortVisualizationLayer(solver, portId),
      label: getPortLabel(solver, portId),
    })
  }

  pushRouteEndpoints(solver, graphics)
  pushSolvedSegments(solver, graphics)
  pushCandidateFrontier(solver, graphics)

  const pendingCount =
    solver.state.unroutedRoutes.length +
    (solver.state.currentRouteId === undefined ? 0 : 1)
  graphics.title = [
    "Poly HyperGraph",
    `iter=${solver.iterations}`,
    `pending=${pendingCount}`,
    solver.failed ? "failed" : solver.solved ? "solved" : "running",
  ].join(" | ")

  return graphics
}

export class PolyHyperGraphSectionPipelineSolver extends TinyHyperGraphSectionPipelineSolver {
  override pipelineDef: PipelineStep<any>[] = [
    {
      solverName: "solveGraph",
      solverClass: PolyHyperGraphSolver,
      getConstructorParams: (instance: PolyHyperGraphSectionPipelineSolver) => {
        const { topology, problem } = loadSerializedHyperGraphAsPoly(
          instance.inputProblem.serializedHyperGraph,
        )

        return [
          topology,
          problem,
          {
            RIP_THRESHOLD_RAMP_ATTEMPTS: 5,
            ...(instance.inputProblem.minViaPadDiameter === undefined
              ? {}
              : { minViaPadDiameter: instance.inputProblem.minViaPadDiameter }),
            ...instance.inputProblem.solveGraphOptions,
          },
        ] as ConstructorParameters<typeof PolyHyperGraphSolver>
      },
    },
    {
      solverName: "optimizeSection",
      solverClass: TinyHyperGraphSectionSolver,
      getConstructorParams: (instance: PolyHyperGraphSectionPipelineSolver) =>
        instance.getSectionStageParams(),
    },
  ]

  override loadHyperGraph(serializedHyperGraph: SerializedHyperGraph): {
    topology: TinyHyperGraphTopology
    problem: TinyHyperGraphProblem
    solution: TinyHyperGraphSolution
  } {
    return loadSerializedHyperGraphAsPoly(serializedHyperGraph)
  }

  override getInitialVisualizationSolver() {
    if (!this.initialVisualizationSolver) {
      const { topology, problem } = loadSerializedHyperGraphAsPoly(
        this.inputProblem.serializedHyperGraph,
      )
      this.initialVisualizationSolver = new PolyHyperGraphSolver(
        topology,
        problem,
        this.getSolveGraphOptions(),
      )
    }

    return this.initialVisualizationSolver
  }
}
