import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type {
  Candidate,
  TinyHyperGraphProblem,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
} from "../core"
import type { RegionIntersectionCache } from "../types"

export interface RoutingSnapshot {
  portAssignment: Int32Array
  regionUpdates: Array<{ regionId: number; cache: RegionIntersectionCache }>
  resetRegions: boolean
  regionCongestionCost: Float64Array
}

export type FlatCandidate = Omit<Candidate, "prevCandidate">
export interface RouteSearchResult {
  path?: FlatCandidate[]
  exhausted: boolean
  steps: number
  readPorts: number[]
  readRegions: number[]
}

export type WorkerRequest =
  | {
      kind: "init"
      topology: TinyHyperGraphTopology
      problem: TinyHyperGraphProblem
      options: TinyHyperGraphSolverOptions
    }
  | {
      kind: "route"
      routeId: number
      snapshot: RoutingSnapshot
      maxSteps: number
    }
  | {
      kind: "solve"
      graph: SerializedHyperGraph
      options?: TinyHyperGraphSolverOptions
    }

export interface SolveResult {
  solved: boolean
  failed: boolean
  error: string | null
  iterations: number
  output: SerializedHyperGraph | null
  stats: Record<string, unknown>
}
