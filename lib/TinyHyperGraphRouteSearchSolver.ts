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
  routeIds: number[]
  maxIterations: number
}

export interface TinyHyperGraphRouteSearchOutput {
  routeId: number
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
  private readonly portReadMarks: Int32Array
  private readonly regionReadMarks: Int32Array
  private readEpoch = 0

  constructor(private readonly graph: SharedRouteSearchGraph) {
    super(unpackRouteSearchTopology(graph.topology), graph.problem, {
      ...graph.options,
      STATIC_REACHABILITY_PRECHECK: false,
    })
    this.portReadMarks = new Int32Array(this.topology.portCount)
    this.regionReadMarks = new Int32Array(this.topology.regionCount)
    this.ADD_SEGMENT_DISTANCE_TO_G = graph.distanceAware
  }

  prepare(input: TinyHyperGraphRouteSearchInput): void {
    this.clearReadSet()
    this.candidate = undefined
    this.solved = false
    this.failed = false
    this.error = null
    this.iterations = 0
    this.MAX_ITERATIONS = input.maxIterations
    this.state.portAssignment = new Int32Array(input.snapshot.portAssignment)
    this.state.regionIntersectionCaches = unpackRouteSearchCaches(
      input.snapshot,
      this.topology.regionCount,
    )
    this.state.regionCongestionCost = input.snapshot.regionCongestionCost
    this.state.unroutedRoutes = [input.routeIds[0]]
    for (const segments of this.state.regionSegments) segments.length = 0
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.goalPortId = -1
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
  }

  continueWithRoute(routeId: number): void {
    if (!this.candidate)
      throw new Error("Cannot commit an unfinished route search")
    TinyHyperGraphSolver.prototype.onPathFound.call(this, this.candidate)
    this.candidate = undefined
    this.solved = false
    this.failed = false
    this.error = null
    this.iterations = 0
    this.clearReadSet()
    this.state.unroutedRoutes = [routeId]
  }

  private clearReadSet(): void {
    this.portReads.clear()
    this.regionReads.clear()
    if (this.readEpoch === 0x7fffffff) {
      this.portReadMarks.fill(0)
      this.regionReadMarks.fill(0)
      this.readEpoch = 0
    }
    this.readEpoch += 1
  }

  override _setup(): void {
    if (this.graph.distanceAware) super._setup()
    else TinyHyperGraphSolver.prototype._setup.call(this)
  }

  override isPortReservedForDifferentNet(portId: number): boolean {
    if (this.portReadMarks[portId] !== this.readEpoch) {
      this.portReadMarks[portId] = this.readEpoch
      this.portReads.set(portId, this.state.portAssignment[portId])
    }
    return super.isPortReservedForDifferentNet(portId)
  }

  override computeG(
    current: Candidate,
    portId: number,
    maximumCost = Infinity,
    distance?: number,
  ): number {
    if (this.regionReadMarks[current.nextRegionId] !== this.readEpoch) {
      this.regionReadMarks[current.nextRegionId] = this.readEpoch
      this.regionReads.set(
        current.nextRegionId,
        this.state.regionIntersectionCaches[current.nextRegionId]
          .existingSegmentCount,
      )
    }
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
  private output?: TinyHyperGraphRouteSearchOutput[]

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
    const output: TinyHyperGraphRouteSearchOutput[] = []
    for (const routeId of this.input.routeIds) {
      if (output.length > 0) solver.continueWithRoute(routeId)
      solver.solve()
      output.push({
        routeId,
        candidate: solver.candidate,
        iterations: solver.iterations,
        portReads: [...solver.portReads],
        regionReads: [...solver.regionReads],
      })
      if (!solver.candidate) break
    }
    this.output = output
  }

  getOutput(): TinyHyperGraphRouteSearchOutput[] {
    if (!this.output) throw new Error("Route search has not run")
    return this.output
  }
}

SolverRuntime.registerSolver(TinyHyperGraphRouteSearchSolver)
