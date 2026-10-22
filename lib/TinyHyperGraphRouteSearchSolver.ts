import { SolverRuntime } from "@tscircuit/solver-utils"
import { TinyHyperGraphSolver, type Candidate } from "./core"
import { DistanceAwareTinyHyperGraphSolver } from "./distance-aware-tiny-hypergraph-solver"
import {
  unpackRouteSearchTopology,
  unpackRouteSearchCaches,
  type SharedRouteSearchGraph,
  type SharedRouteSearchSnapshot,
} from "./parallelRouteSearchData"

export interface TinyHyperGraphRouteSearchInput {
  graph: SharedRouteSearchGraph
  snapshot: SharedRouteSearchSnapshot
  routeId: number
  maxIterations: number
}

export interface TinyHyperGraphRouteSearchOutput {
  candidate?: Candidate
  iterations: number
  portReads: Array<[number, number]>
  regionReads: Array<[number, number]>
}

// Keep one class identity across jobs so the worker can optimize the hot search
// methods after warmup instead of constructing a new subclass for every route.
class RouteSearch extends DistanceAwareTinyHyperGraphSolver {
  readonly portReads = new Map<number, number>()
  readonly regionReads = new Map<number, number>()
  candidate?: Candidate

  constructor(private readonly graph: SharedRouteSearchGraph) {
    super(unpackRouteSearchTopology(graph.topology), graph.problem, {
      ...graph.options,
      STATIC_REACHABILITY_PRECHECK: false,
    })
    this.ADD_SEGMENT_DISTANCE_TO_G = graph.distanceAware
  }

  prepare(input: TinyHyperGraphRouteSearchInput): void {
    this.portReads.clear()
    this.regionReads.clear()
    this.candidate = undefined
    this.solved = false
    this.failed = false
    this.error = null
    this.iterations = 0
    this.MAX_ITERATIONS = input.maxIterations
    this.state.portAssignment = input.snapshot.portAssignment
    this.state.regionIntersectionCaches = unpackRouteSearchCaches(
      input.snapshot,
      this.topology.regionCount,
    )
    this.state.regionCongestionCost = input.snapshot.regionCongestionCost
    this.state.unroutedRoutes = [input.routeId]
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.goalPortId = -1
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
  }

  override _setup(): void {
    if (this.graph.distanceAware) super._setup()
    else TinyHyperGraphSolver.prototype._setup.call(this)
  }

  override isPortReservedForDifferentNet(portId: number): boolean {
    this.portReads.set(portId, this.state.portAssignment[portId])
    return super.isPortReservedForDifferentNet(portId)
  }

  override computeG(
    current: Candidate,
    portId: number,
    maximumCost = Infinity,
    distance?: number,
  ): number {
    this.regionReads.set(
      current.nextRegionId,
      this.state.regionIntersectionCaches[current.nextRegionId]
        .existingSegmentCount,
    )
    return super.computeG(current, portId, maximumCost, distance)
  }

  override onPathFound(finalCandidate: Candidate): void {
    if (
      this.graph.distanceAware &&
      finalCandidate.portId !== this.state.goalPortId
    ) {
      super.onPathFound(finalCandidate)
    } else {
      this.candidate = finalCandidate
      this.solved = true
    }
  }

  override onOutOfCandidates(): void {
    this.failed = true
  }

  override tryFinalAcceptance(): void {}
}

const searchWorkspaces = new Map<number, RouteSearch>()

/** One isolated path search. The host owns route commits, rerips, and acceptance. */
export class TinyHyperGraphRouteSearchSolver {
  static readonly solverName = "TinyHyperGraphRouteSearchSolver"
  private output?: TinyHyperGraphRouteSearchOutput

  constructor(private readonly input: TinyHyperGraphRouteSearchInput) {}

  solve(): void {
    let solver = searchWorkspaces.get(this.input.graph.id)
    if (!solver) {
      solver = new RouteSearch(this.input.graph)
      // Bound retained topology memory when a host reuses its pool across boards.
      if (searchWorkspaces.size >= 4)
        searchWorkspaces.delete(searchWorkspaces.keys().next().value!)
      searchWorkspaces.set(this.input.graph.id, solver)
    }
    solver.prepare(this.input)
    solver.solve()
    this.output = {
      candidate: solver.candidate,
      iterations: solver.iterations,
      portReads: [...solver.portReads],
      regionReads: [...solver.regionReads],
    }
  }

  getOutput(): TinyHyperGraphRouteSearchOutput {
    if (!this.output) throw new Error("Route search has not run")
    return this.output
  }
}

SolverRuntime.registerSolver(TinyHyperGraphRouteSearchSolver)
