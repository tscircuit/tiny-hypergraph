import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolution,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
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
 * Clockwise input is accepted by the loader, but normalized topology vertices
 * are stored counter-clockwise.
 */
export type ConvexPolygon = readonly [
  PolyPoint,
  PolyPoint,
  PolyPoint,
  ...PolyPoint[],
]

export interface PolyHyperGraphTopology extends TinyHyperGraphTopology {
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
  regionBoundsMinX: Float64Array
  regionBoundsMaxX: Float64Array
  regionBoundsMinY: Float64Array
  regionBoundsMaxY: Float64Array

  /**
   * Boundary coordinates replace rect edge angles. Values are normalized to
   * [0, 36000) around the polygon perimeter so the existing cyclic interval
   * intersection model can be reused.
   */
  portBoundaryPositionForRegion1: Int32Array
  portBoundaryPositionForRegion2: Int32Array

  /**
   * Exact projected boundary location for geometry-aware adapters/debuggers.
   * Edge indexes are local to the incident region's vertex list.
   */
  portEdgeIndexForRegion1: Int32Array
  portEdgeIndexForRegion2: Int32Array
  portEdgeTForRegion1: Float64Array
  portEdgeTForRegion2: Float64Array
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
  polygon?: ConvexPolygon
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
   * Defaults to 36000 to match the rect solver's angle scale.
   */
  boundaryCoordinateScale?: number
}

export interface PolyHyperGraphSolverOptions
  extends TinyHyperGraphSolverOptions {}
