import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolution,
  TinyHyperGraphSolverOptions,
} from "./core"
import type { NetId, PortId, RegionId, RouteId } from "./types"

export interface PolyPoint {
  x: number
  y: number
}

export interface PolyBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * Convex polygon vertices are expected to be ordered around the perimeter.
 * Clockwise and counter-clockwise order are both representable, but loaders
 * should normalize all regions consistently before constructing a topology.
 */
export type ConvexPolygon = readonly [
  PolyPoint,
  PolyPoint,
  PolyPoint,
  ...PolyPoint[],
]

export interface PolyHyperGraphTopology {
  portCount: number
  regionCount: number

  /** regionIncidentPorts[regionId] = list of port ids incident to the region */
  regionIncidentPorts: PortId[][]

  /** incidentPortRegion[portId] = list of region ids incident to the port */
  incidentPortRegion: RegionId[][]

  /**
   * Flat vertex storage for all convex regions.
   *
   * Vertices for region r occupy:
   *   [regionVertexStart[r], regionVertexStart[r] + regionVertexCount[r])
   */
  regionVertexStart: Int32Array
  regionVertexCount: Int32Array
  regionVertexX: Float64Array
  regionVertexY: Float64Array

  regionArea: Float64Array
  regionPerimeter: Float64Array
  regionCenterX: Float64Array
  regionCenterY: Float64Array
  regionBoundsMinX: Float64Array
  regionBoundsMaxX: Float64Array
  regionBoundsMinY: Float64Array
  regionBoundsMaxY: Float64Array

  /**
   * regionAvailableZMask[regionId] is a bitmask of the routed layers available
   * within the region. A zero mask means "unknown", matching the rect solver.
   */
  regionAvailableZMask?: Int32Array

  /** regionMetadata[regionId] = metadata for the region */
  regionMetadata?: any[]

  /**
   * Boundary coordinates replace the rect solver's per-region port angles.
   * Values are normalized to [0, 36000) around the polygon perimeter, so the
   * existing cyclic interval intersection model can be reused by the solver.
   */
  portBoundaryPositionForRegion1: Int32Array
  portBoundaryPositionForRegion2: Int32Array

  /**
   * Optional exact boundary location for geometry-aware adapters/debuggers.
   * portEdgeIndexForRegionN[portId] is local to that incident region's vertex
   * list, and portEdgeTForRegionN[portId] is the interpolation factor along it.
   */
  portEdgeIndexForRegion1?: Int32Array
  portEdgeIndexForRegion2?: Int32Array
  portEdgeTForRegion1?: Float64Array
  portEdgeTForRegion2?: Float64Array

  portX: Float64Array
  portY: Float64Array
  portZ: Int32Array

  portMetadata?: any[]
}

export type PolyHyperGraphProblem = TinyHyperGraphProblem

export type PolyHyperGraphSolution = TinyHyperGraphSolution

export interface PolyHyperGraph {
  topology: PolyHyperGraphTopology
  problem: PolyHyperGraphProblem
  solution?: PolyHyperGraphSolution
}

export interface PolyHyperGraphLoadResult {
  topology: PolyHyperGraphTopology
  problem: PolyHyperGraphProblem
  solution: PolyHyperGraphSolution
  mapping: PolyHyperGraphSourceMapping
}

export type RectToPolyHyperGraphAdapterResult = PolyHyperGraphLoadResult

export interface PolyHyperGraphSourceMapping {
  serializedRegionIdToRegionId: Map<string, RegionId>
  serializedPortIdToPortId: Map<string, PortId>
  connectionIdToRouteId: Map<string, RouteId>
  netIdToNetIndex: Map<string, NetId>
}

export interface PolyHyperGraphRegionMetadata {
  serializedRegionId?: string
  sourceBounds?: PolyBounds
  sourcePolygon?: ConvexPolygon
  [key: string]: unknown
}

export interface PolyHyperGraphPortMetadata {
  serializedPortId?: string
  [key: string]: unknown
}

export interface RectToPolyHyperGraphAdapterOptions {
  /**
   * Scale used when normalizing boundary distance into integer coordinates.
   * The default implementation should use 36000 to match the rect solver's
   * existing angle scale.
   */
  boundaryCoordinateScale?: number

  /**
   * Mirrors the serialized rect loader's full-obstacle filtering so parity
   * comparisons can choose whether to preserve or filter those regions.
   */
  obstacleRegionMode?: "filter-full-obstacles" | "preserve"
}

export interface PolyHyperGraphSolverOptions
  extends TinyHyperGraphSolverOptions {}
