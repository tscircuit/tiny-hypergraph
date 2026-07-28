import type {
  HopId,
  NetId,
  PortId,
  RegionId,
  RegionIntersectionCache,
  RouteId,
} from "./types"

export type SolverViewCandidate = {
  prevRegionId?: RegionId
  portId: PortId
  nextRegionId: RegionId
  prevCandidate?: SolverViewCandidate
  f: number
  g: number
  h: number
}

export type SolverViewTopology = {
  portCount: number
  regionCount: number
  regionIncidentPorts: PortId[][]
  incidentPortRegion: RegionId[][]
  regionWidth: Float64Array
  regionHeight: Float64Array
  regionCenterX: Float64Array
  regionCenterY: Float64Array
  regionAvailableZMask?: Int32Array
  regionMetadata?: any[]
  portAngleForRegion1: Int32Array
  portAngleForRegion2?: Int32Array
  portX: Float64Array
  portY: Float64Array
  portZ: Int32Array
  portMetadata?: any[]
}

export type SolverViewProblem = {
  routeCount: number
  portSectionMask: Int8Array
  routeMetadata?: any[]
  routeStartPort: Int32Array
  routeEndPort: Int32Array
  routeNet: Int32Array
  regionNetId: Int32Array
  portPenalty?: Float64Array
}

export type SolverViewWorkingState = {
  portAssignment: Int32Array
  regionSegments: Array<[RouteId, PortId, PortId][]>
  regionIntersectionCaches: RegionIntersectionCache[]
  currentRouteNetId: NetId | undefined
  currentRouteId: RouteId | undefined
  unroutedRoutes: RouteId[]
  candidateQueue: {
    toArray(): SolverViewCandidate[]
  }
  candidateBestCostByHopId: Float64Array | Map<HopId, number>
  candidateBestCostGenerationByHopId: Uint32Array | Map<HopId, number>
  candidateBestCostGeneration: number
  goalPortId: PortId
  ripCount: number
  regionCongestionCost: Float64Array
}

export type SolverViewRouteSummary = {
  routeId: RouteId
  connectionId: string
  startPortId: PortId
  endPortId: PortId
  startRegionId?: string
  endRegionId?: string
  pointIds: string[]
}

export type NeverSuccessfullyRoutedSolverViewRouteSummary =
  SolverViewRouteSummary & {
    attempts: number
  }

/** Public read shape required by solver serializers and visualizers. */
export type TinyHyperGraphSolverView = {
  readonly topology: SolverViewTopology
  readonly problem: SolverViewProblem
  readonly state: SolverViewWorkingState
  readonly solved: boolean
  readonly failed: boolean
  readonly iterations: number
  getAdditionalRegionLabel(regionId: RegionId): string | undefined
  getNeverSuccessfullyRoutedRoutes(): NeverSuccessfullyRoutedSolverViewRouteSummary[]
  getStaticallyUnroutableRoutes(): SolverViewRouteSummary[]
}
