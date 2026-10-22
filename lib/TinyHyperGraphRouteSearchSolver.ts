import { SolverRuntime } from "@tscircuit/solver-utils"
import {
  TinyHyperGraphSolver,
  type Candidate,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "./core"
import { DistanceAwareTinyHyperGraphSolver } from "./distance-aware-tiny-hypergraph-solver"
import type { RegionIntersectionCache } from "./types"

export interface TinyHyperGraphRouteSearchInput {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  options: TinyHyperGraphSolverOptions
  portAssignment: Int32Array
  regionIntersectionCaches: RegionIntersectionCache[]
  regionCongestionCost: Float64Array
  routeId: number
  distanceAware: boolean
  maxIterations: number
}

export interface TinyHyperGraphRouteSearchOutput {
  candidate?: Candidate
  iterations: number
  portReads: Array<[number, number]>
  regionReads: Array<[number, number]>
}

/** One isolated path search. The host owns route commits, rerips, and acceptance. */
export class TinyHyperGraphRouteSearchSolver {
  static readonly solverName = "TinyHyperGraphRouteSearchSolver"
  private output?: TinyHyperGraphRouteSearchOutput

  constructor(private readonly input: TinyHyperGraphRouteSearchInput) {}

  solve(): void {
    const input = this.input
    const portReads = new Map<number, number>()
    const regionReads = new Map<number, number>()
    let candidate: Candidate | undefined

    // Defined at execution time so core can import the registered task without
    // creating an eager circular subclass dependency.
    const SearchBase = input.distanceAware
      ? DistanceAwareTinyHyperGraphSolver
      : TinyHyperGraphSolver
    class RouteSearch extends SearchBase {
      override isPortReservedForDifferentNet(portId: number): boolean {
        portReads.set(portId, this.state.portAssignment[portId])
        return super.isPortReservedForDifferentNet(portId)
      }

      override computeG(
        current: Candidate,
        portId: number,
        maximumCost = Infinity,
        distance?: number,
      ): number {
        regionReads.set(
          current.nextRegionId,
          this.state.regionIntersectionCaches[current.nextRegionId]
            .existingSegmentCount,
        )
        return super.computeG(current, portId, maximumCost, distance)
      }

      override onPathFound(finalCandidate: Candidate): void {
        if (
          input.distanceAware &&
          finalCandidate.portId !== this.state.goalPortId
        ) {
          super.onPathFound(finalCandidate)
        } else {
          candidate = finalCandidate
          this.solved = true
        }
      }

      override onOutOfCandidates(): void {
        this.failed = true
      }

      override tryFinalAcceptance(): void {}
    }

    const solver = new RouteSearch(input.topology, input.problem, {
      ...input.options,
      STATIC_REACHABILITY_PRECHECK: false,
    })
    solver.MAX_ITERATIONS = input.maxIterations
    solver.state.portAssignment = input.portAssignment
    solver.state.regionIntersectionCaches = input.regionIntersectionCaches
    solver.state.regionCongestionCost = input.regionCongestionCost
    solver.state.unroutedRoutes = [input.routeId]
    solver.solve()
    this.output = {
      candidate,
      iterations: solver.iterations,
      portReads: [...portReads],
      regionReads: [...regionReads],
    }
  }

  getOutput(): TinyHyperGraphRouteSearchOutput {
    if (!this.output) throw new Error("Route search has not run")
    return this.output
  }
}

SolverRuntime.registerSolver(TinyHyperGraphRouteSearchSolver)
