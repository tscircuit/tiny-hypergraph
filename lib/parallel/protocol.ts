import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type {
  Candidate,
  TinyHyperGraphProblem,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
} from "../core"
import type { RegionIntersectionCache } from "../types"

export interface RoutingSnapshot {
  portPenalty?: Float64Array
  portAssignment: Int32Array
  regionUpdates: Array<{ regionId: number; cache: RegionIntersectionCache }>
  resetRegions: boolean
  regionCongestionCost: Float64Array
}

export type FlatCandidate = Omit<Candidate, "prevCandidate">
export interface RouteSearchResult {
  failed?: boolean
  error?: string | null
  path?: FlatCandidate[]
  exhausted: boolean
  steps: number
  readPorts: number[]
  readRegions: number[]
}
export interface RoundTaskResult {
  index: number
  search: RouteSearchResult
}

export type WorkerRequest =
  | {
      kind: "portfolioInit"
      topology: TinyHyperGraphTopology
      problem: TinyHyperGraphProblem
      options: TinyHyperGraphSolverOptions
    }
  | { kind: "portfolioCandidate"; index: number }
  | { kind: "portfolioOutput"; index: number }
  | {
      kind: "init"
      topology: TinyHyperGraphTopology
      problem: TinyHyperGraphProblem
      options: TinyHyperGraphSolverOptions
      cacheScores?: boolean
    }
  | {
      kind: "route"
      routeId: number
      snapshot: RoutingSnapshot
      maxSteps: number
    }
  | {
      kind: "round"
      routeIds: number[]
      taskCounter: Int32Array
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

export interface PortfolioRoutingState {
  portAssignment: Int32Array
  regionSegments: Array<Array<[number, number, number]>>
}
