import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { BaseSolver } from "@tscircuit/solver-utils"
import { loadSerializedHyperGraph } from "./compat/loadSerializedHyperGraph"
import {
  getTinyHyperGraphSolverOptions,
  type TinyHyperGraphInitialAssignment,
  type TinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
} from "./core"
import { CongestionRouteSolver } from "./congestion-solver/CongestionRouteSolver"
import {
  getRouteAssignments,
  replaySerializedSolution,
  getAssignmentInventory,
  getAssignmentKey,
  getOrderedRoutes,
  getRegionCostScore,
  hasWorseRegionCosts,
  type RegionCostScore,
} from "./congestion-solver/validation"
import { TinyHyperGraphSectionSolver } from "./section-solver"

export interface TinyHyperGraphCongestionSolverOptions {
  maxTrials?: number
  maxIterationsPerTrial?: number
  seed?: number
  /** Route indices to leave unchanged. Defaults to route 0, matching section routing. */
  preservedRouteIds?: ReadonlySet<number>
  /** Optional routing mask, independent of the earlier section search mask. */
  portSectionMask?: Int8Array
  solverOptions?: TinyHyperGraphSolverOptions
}

export interface TinyHyperGraphCongestionTrial {
  routeId: number
  regionId: number
  iterations: number
  outcome:
    | "accepted"
    | "worsened"
    | "unchanged"
    | "failed"
    | "invalid"
    | "timeout"
  error?: string
}

export interface TinyHyperGraphCongestionReport {
  initial?: RegionCostScore
  final?: RegionCostScore
  trials: TinyHyperGraphCongestionTrial[]
  accepted: number
  skipReason?: string
}

/**
 * Try rerouting one route around a congested region while retaining every other
 * route. Visit the eight highest-cost regions in order, choosing a route with
 * probability weighted by segment density plus 0.1 times its physical length.
 * Four bounded attempts provided the best measured quality/runtime balance.
 *
 * Accept a replacement only when its serialized output, reloaded in the same
 * order as section routing, improves maximum cost or squared cost sum without
 * increasing either. This replay matters because cache costs depend on segment
 * insertion order. Failed attempts leave the complete solution unchanged.
 *
 * Dictionary:
 * - Trial: one bounded attempt to reroute one route around one region.
 * - Serialized replay: rebuild costs from exported route paths in section-solver order.
 */
export class TinyHyperGraphCongestionSolver extends BaseSolver {
  readonly maxTrials: number
  readonly maxIterationsPerTrial: number
  readonly report: TinyHyperGraphCongestionReport = { trials: [], accepted: 0 }
  private output: SerializedHyperGraph
  private best?: TinyHyperGraphSolver
  private bestInternalScore?: RegionCostScore
  private originalIdentity?: string
  private preserved: Set<number>
  private immutableComplex = new Map<number, string[]>()
  private attempted = new Set<string>()
  private selectionIndex = 0
  private randomSeed: number
  private trial?: CongestionRouteSolver
  private trialLog?: TinyHyperGraphCongestionTrial

  constructor(
    readonly serializedHyperGraph: SerializedHyperGraph,
    readonly options: TinyHyperGraphCongestionSolverOptions = {},
  ) {
    super()
    this.maxTrials = options.maxTrials ?? 4
    this.maxIterationsPerTrial = options.maxIterationsPerTrial ?? 2000
    this.randomSeed = options.seed ?? 17
    for (const [name, value] of [
      ["maxTrials", this.maxTrials],
      ["maxIterationsPerTrial", this.maxIterationsPerTrial],
      ["seed", this.randomSeed],
    ] as const) {
      if (
        !Number.isSafeInteger(value) ||
        value < 0 ||
        (name === "maxIterationsPerTrial" && value === 0)
      ) {
        throw new Error(`Invalid ${name}`)
      }
    }
    this.preserved = new Set(options.preservedRouteIds ?? [0])
    this.output = serializedHyperGraph
    this.MAX_ITERATIONS = this.maxTrials * (this.maxIterationsPerTrial + 2) + 2
  }

  override _setup() {
    if (this.maxTrials === 0) {
      this.solved = true
      return
    }
    try {
      const { topology, problem, solution } = loadSerializedHyperGraph(
        this.serializedHyperGraph,
      )
      // Serialized assignments describe the incumbent. Only explicitly preserved
      // routes are immutable; retaining all of them would disable every attempt.
      problem.initialAssignments = undefined
      if (this.options.portSectionMask) {
        if (this.options.portSectionMask.length !== topology.portCount) {
          throw new Error("Routing mask length does not match port count")
        }
        problem.portSectionMask = new Int8Array(this.options.portSectionMask)
      }
      for (const routeId of this.preserved) {
        if (
          !Number.isInteger(routeId) ||
          routeId < 0 ||
          (routeId >= problem.routeCount && problem.routeCount !== 0)
        ) {
          throw new Error("Invalid preserved route id")
        }
      }
      this.best = new TinyHyperGraphSectionSolver(
        topology,
        problem,
        solution,
        this.options.solverOptions,
      ).baselineSolver
      getOrderedRoutes(this.best, this.immutableComplex, true)
      for (const routeId of this.immutableComplex.keys())
        this.preserved.add(routeId)
      const replay = replaySerializedSolution(
        this.best,
        getTinyHyperGraphSolverOptions(this.best),
        undefined,
        this.serializedHyperGraph,
      )
      this.originalIdentity = replay.identity
      this.bestInternalScore = getRegionCostScore(this.best)
      this.report.initial = replay.score
      this.report.final = replay.score
    } catch (error) {
      this.report.skipReason =
        error instanceof Error ? error.message : String(error)
      this.solved = true
    }
  }

  private random() {
    this.randomSeed = (Math.imul(this.randomSeed, 1664525) + 1013904223) >>> 0
    return (this.randomSeed + 1) / 4294967297
  }

  private routeLength(path: TinyHyperGraphInitialAssignment[]) {
    const topology = this.best!.topology
    return path.reduce(
      (length, segment) =>
        length +
        Math.hypot(
          topology.portX[segment.fromPortId] - topology.portX[segment.toPortId],
          topology.portY[segment.fromPortId] - topology.portY[segment.toPortId],
        ),
      0,
    )
  }

  private startTrial() {
    const best = this.best!
    const hotRegions = best.state.regionIntersectionCaches
      .map((cache, regionId) => ({ regionId, cost: cache.existingRegionCost }))
      .filter(({ cost }) => cost > 0)
      .sort((a, b) => b.cost - a.cost || a.regionId - b.regionId)
      .slice(0, 8)
    if (!hotRegions.length || this.selectionIndex >= this.maxTrials) {
      this.solved = true
      return
    }
    const regionId =
      hotRegions[this.selectionIndex++ % hotRegions.length].regionId
    const paths = getOrderedRoutes(best, this.immutableComplex)
    const candidates = paths
      .flatMap((path, routeId) => {
        if (
          this.preserved.has(routeId) ||
          this.attempted.has(`${regionId}:${routeId}`)
        )
          return []
        const endpoints = [
          best.problem.routeStartPort[routeId],
          best.problem.routeEndPort[routeId],
        ]
        if (
          endpoints.some((portId) =>
            best.topology.incidentPortRegion[portId].includes(regionId),
          )
        )
          return []
        const touched = path.filter((segment) => segment.regionId === regionId)
        if (!touched.length) return []
        const density =
          (touched.length * best.state.regionSegments[regionId].length) /
          Math.max(
            1e-12,
            best.topology.regionWidth[regionId] *
              best.topology.regionHeight[regionId],
          )
        const weight = density + 0.1 * this.routeLength(path)
        return [
          {
            routeId,
            priority: Math.log(this.random()) / Math.max(1e-12, weight),
          },
        ]
      })
      .sort((a, b) => b.priority - a.priority || a.routeId - b.routeId)
    const selected = candidates[0]
    if (!selected) return
    const { routeId } = selected
    this.attempted.add(`${regionId}:${routeId}`)
    this.trialLog = { routeId, regionId, iterations: 0, outcome: "failed" }
    this.report.trials.push(this.trialLog)
    this.trial = new CongestionRouteSolver(
      best,
      getRouteAssignments(best).filter(
        (segment) => segment.routeId !== routeId,
      ),
      regionId,
      this.maxIterationsPerTrial,
    )
    this.trial.state.unroutedRoutes = [routeId]
  }

  private finishTrial() {
    const trial = this.trial!
    const log = this.trialLog!
    const best = this.best!
    if (!trial.solved || trial.failed) {
      log.outcome = trial.failed ? "failed" : "timeout"
      log.error = trial.error ?? undefined
      return
    }
    getOrderedRoutes(trial, this.immutableComplex)
    const nextAssignments = getRouteAssignments(trial)
    const previousAssignments = getRouteAssignments(best)
    const retained = (segments: TinyHyperGraphInitialAssignment[]) =>
      segments.filter((segment) => segment.routeId !== log.routeId)
    if (
      getAssignmentInventory(retained(nextAssignments)) !==
      getAssignmentInventory(retained(previousAssignments))
    ) {
      throw new Error("Retained route assignments changed")
    }
    const previousKeys = new Set(previousAssignments.map(getAssignmentKey))
    for (const segment of nextAssignments) {
      if (previousKeys.has(getAssignmentKey(segment))) continue
      if (segment.regionId === log.regionId)
        throw new Error("Route uses the avoided region")
      if (
        [segment.fromPortId, segment.toPortId].some(
          (portId) =>
            trial.problem.portSectionMask[portId] !== 1 &&
            portId !== trial.problem.routeStartPort[segment.routeId] &&
            portId !== trial.problem.routeEndPort[segment.routeId],
        )
      ) {
        throw new Error("Route uses a masked port")
      }
    }
    const internalScore = getRegionCostScore(trial)
    if (hasWorseRegionCosts(internalScore, this.bestInternalScore!)) {
      log.outcome = "worsened"
      return
    }
    // Temporary retained assignments must not become permanent preload policy.
    trial.problem = structuredClone(best.problem)
    const nextScore = replaySerializedSolution(
      trial,
      getTinyHyperGraphSolverOptions(best),
      this.originalIdentity,
    ).score
    if (hasWorseRegionCosts(nextScore, this.report.final!)) {
      log.outcome = "worsened"
      return
    }
    if (
      nextScore.maxRegionCost === this.report.final!.maxRegionCost &&
      nextScore.squaredRegionCostSum === this.report.final!.squaredRegionCostSum
    ) {
      log.outcome = "unchanged"
      return
    }
    this.best = trial
    this.bestInternalScore = internalScore
    this.report.final = nextScore
    this.report.accepted++
    this.output = { ...this.serializedHyperGraph, ...trial.getOutput() }
    log.outcome = "accepted"
  }

  override _step() {
    try {
      if (!this.trial) {
        this.startTrial()
        return
      }
      this.trial.step()
      this.trialLog!.iterations++
      if (
        this.trial.solved ||
        this.trial.failed ||
        this.trialLog!.iterations >= this.maxIterationsPerTrial
      ) {
        this.finishTrial()
        this.trial = undefined
      }
    } catch (error) {
      if (this.trialLog) {
        this.trialLog.outcome = "invalid"
        this.trialLog.error =
          error instanceof Error ? error.message : String(error)
      }
      this.trial = undefined
    }
    this.progress = this.selectionIndex / Math.max(1, this.maxTrials)
  }

  override getOutput(): SerializedHyperGraph {
    return this.output
  }

  override visualize() {
    return this.best?.visualize() ?? super.visualize()
  }
}
