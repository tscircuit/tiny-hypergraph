import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { loadSerializedHyperGraph } from "../compat/loadSerializedHyperGraph"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolution,
  TinyHyperGraphSolver,
  TinyHyperGraphTopology,
} from "../core"
import { MinHeap } from "../MinHeap"
import {
  getActiveSectionRouteIds,
  TinyHyperGraphSectionSolver,
  type TinyHyperGraphSectionSolverOptions,
} from "../section-solver"
import type { TinyHyperGraphSectionCandidateFamily } from "../section-solver/TinyHyperGraphSectionPipelineSolver"

type SectionMaskCandidate = {
  label: string
  family: TinyHyperGraphSectionCandidateFamily
  regionIds: number[]
  portSelectionRule:
    | "touches-selected-region"
    | "all-incident-regions-selected"
}

type UnravelMutation = {
  label: string
  family: TinyHyperGraphSectionCandidateFamily
  activeRouteCount: number
  fromMaxRegionCost: number
  toMaxRegionCost: number
}

type UnravelSearchState = {
  serializedHyperGraph: SerializedHyperGraph
  maxRegionCost: number
  depth: number
  priority: number
  mutationPath: UnravelMutation[]
}

type CandidateEvaluation = {
  outputGraph: SerializedHyperGraph
  finalMaxRegionCost: number
  priority: number
  mutation: UnravelMutation
}

const DEFAULT_SECTION_SOLVER_OPTIONS: TinyHyperGraphSectionSolverOptions = {
  DISTANCE_TO_COST: 0.05,
  RIP_THRESHOLD_RAMP_ATTEMPTS: 16,
  RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
  MAX_ITERATIONS: 1e6,
  MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT: 6,
  EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST: Number.POSITIVE_INFINITY,
}

const DEFAULT_CANDIDATE_FAMILIES: TinyHyperGraphSectionCandidateFamily[] = [
  "self-touch",
  "onehop-all",
  "onehop-touch",
  "twohop-all",
  "twohop-touch",
]

const DEFAULT_MAX_HOT_REGIONS = 2

const compareSearchStates = (
  left: UnravelSearchState,
  right: UnravelSearchState,
) => {
  if (left.priority !== right.priority) {
    return left.priority - right.priority
  }

  if (left.maxRegionCost !== right.maxRegionCost) {
    return left.maxRegionCost - right.maxRegionCost
  }

  return left.depth - right.depth
}

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

const getSerializedOutputMaxRegionCost = (
  serializedHyperGraph: SerializedHyperGraph,
) => {
  const replay = loadSerializedHyperGraph(serializedHyperGraph)
  const replayedSolver = new TinyHyperGraphSectionSolver(
    replay.topology,
    replay.problem,
    replay.solution,
  )

  return getMaxRegionCost(replayedSolver.baselineSolver)
}

const getAdjacentRegionIds = (
  topology: TinyHyperGraphTopology,
  seedRegionIds: number[],
) => {
  const adjacentRegionIds = new Set(seedRegionIds)

  for (const seedRegionId of seedRegionIds) {
    for (const portId of topology.regionIncidentPorts[seedRegionId] ?? []) {
      for (const regionId of topology.incidentPortRegion[portId] ?? []) {
        adjacentRegionIds.add(regionId)
      }
    }
  }

  return [...adjacentRegionIds]
}

const createPortSectionMaskForRegionIds = (
  topology: TinyHyperGraphTopology,
  regionIds: number[],
  portSelectionRule:
    | "touches-selected-region"
    | "all-incident-regions-selected",
) => {
  const selectedRegionIds = new Set(regionIds)

  return Int8Array.from({ length: topology.portCount }, (_, portId) => {
    const incidentRegionIds = topology.incidentPortRegion[portId] ?? []

    if (portSelectionRule === "touches-selected-region") {
      return incidentRegionIds.some((regionId) => selectedRegionIds.has(regionId))
        ? 1
        : 0
    }

    return incidentRegionIds.length > 0 &&
      incidentRegionIds.every((regionId) => selectedRegionIds.has(regionId))
      ? 1
      : 0
  })
}

const createProblemWithPortSectionMask = (
  problem: TinyHyperGraphProblem,
  portSectionMask: Int8Array,
): TinyHyperGraphProblem => ({
  routeCount: problem.routeCount,
  portSectionMask,
  routeMetadata: problem.routeMetadata,
  routeStartPort: new Int32Array(problem.routeStartPort),
  routeEndPort: new Int32Array(problem.routeEndPort),
  routeNet: new Int32Array(problem.routeNet),
  regionNetId: new Int32Array(problem.regionNetId),
})

const getSectionMaskCandidates = (
  solvedSolver: TinyHyperGraphSolver,
  topology: TinyHyperGraphTopology,
  maxHotRegions: number,
  candidateFamilies: TinyHyperGraphSectionCandidateFamily[],
): SectionMaskCandidate[] => {
  const hotRegionIds = solvedSolver.state.regionIntersectionCaches
    .map((regionIntersectionCache, regionId) => ({
      regionId,
      regionCost: regionIntersectionCache.existingRegionCost,
    }))
    .filter(({ regionCost }) => regionCost > 0)
    .sort((left, right) => right.regionCost - left.regionCost)
    .slice(0, maxHotRegions)
    .map(({ regionId }) => regionId)

  const candidates: SectionMaskCandidate[] = []

  for (const hotRegionId of hotRegionIds) {
    const oneHopRegionIds = getAdjacentRegionIds(topology, [hotRegionId])
    const twoHopRegionIds = getAdjacentRegionIds(topology, oneHopRegionIds)

    const candidateByFamily: Record<
      TinyHyperGraphSectionCandidateFamily,
      SectionMaskCandidate
    > = {
      "self-touch": {
        label: `hot-${hotRegionId}-self-touch`,
        family: "self-touch",
        regionIds: [hotRegionId],
        portSelectionRule: "touches-selected-region",
      },
      "onehop-all": {
        label: `hot-${hotRegionId}-onehop-all`,
        family: "onehop-all",
        regionIds: oneHopRegionIds,
        portSelectionRule: "all-incident-regions-selected",
      },
      "onehop-touch": {
        label: `hot-${hotRegionId}-onehop-touch`,
        family: "onehop-touch",
        regionIds: oneHopRegionIds,
        portSelectionRule: "touches-selected-region",
      },
      "twohop-all": {
        label: `hot-${hotRegionId}-twohop-all`,
        family: "twohop-all",
        regionIds: twoHopRegionIds,
        portSelectionRule: "all-incident-regions-selected",
      },
      "twohop-touch": {
        label: `hot-${hotRegionId}-twohop-touch`,
        family: "twohop-touch",
        regionIds: twoHopRegionIds,
        portSelectionRule: "touches-selected-region",
      },
    }

    for (const family of candidateFamilies) {
      candidates.push(candidateByFamily[family])
    }
  }

  return candidates
}

const createGraphFingerprint = (serializedHyperGraph: SerializedHyperGraph) =>
  (serializedHyperGraph.solvedRoutes ?? [])
    .map((solvedRoute) =>
      [
        solvedRoute.connection.connectionId,
        solvedRoute.path
          .map((candidate) => `${candidate.portId}:${candidate.nextRegionId}`)
          .join(">"),
      ].join("="),
    )
    .join("||")

const roundMutationCost = (value: number) => Number(value.toFixed(12))

export interface TinyHyperGraphUnravelSolverOptions
  extends TinyHyperGraphSectionSolverOptions {
  MAX_MUTATION_DEPTH?: number
  MAX_SEARCH_STATES?: number
  MAX_ENQUEUED_MUTATIONS_PER_STATE?: number
  MUTATION_DEPTH_PENALTY?: number
  IMPROVEMENT_EPSILON?: number
  CANDIDATE_FAMILIES?: TinyHyperGraphSectionCandidateFamily[]
}

export class TinyHyperGraphUnravelSolver extends BaseSolver {
  baselineSolver: TinyHyperGraphSolver
  baselineSerializedHyperGraph: SerializedHyperGraph
  bestSerializedHyperGraph: SerializedHyperGraph
  bestReplaySolver?: TinyHyperGraphSolver
  bestMutationPath: UnravelMutation[] = []
  searchQueue = new MinHeap<UnravelSearchState>([], compareSearchStates)
  bestCostByFingerprint = new Map<string, number>()

  MAX_HOT_REGIONS = DEFAULT_MAX_HOT_REGIONS
  MAX_MUTATION_DEPTH = 2
  MAX_SEARCH_STATES = 12
  MAX_ENQUEUED_MUTATIONS_PER_STATE = 3
  MUTATION_DEPTH_PENALTY = 1e-3
  IMPROVEMENT_EPSILON = 1e-9
  CANDIDATE_FAMILIES = [...DEFAULT_CANDIDATE_FAMILIES]

  baselineMaxRegionCost: number
  bestMaxRegionCost: number
  searchStartTime = 0
  expandedStateCount = 0
  enqueuedStateCount = 0
  cacheHitCount = 0
  generatedCandidateCount = 0
  attemptedCandidateCount = 0
  successfulMutationCount = 0
  totalReplayScoreMs = 0
  totalCandidateEligibilityMs = 0
  totalCandidateInitMs = 0
  totalCandidateSolveMs = 0

  sectionSolverOptions: TinyHyperGraphSectionSolverOptions

  constructor(
    public topology: TinyHyperGraphTopology,
    public problem: TinyHyperGraphProblem,
    public initialSolution: TinyHyperGraphSolution,
    options?: TinyHyperGraphUnravelSolverOptions,
  ) {
    super()

    this.sectionSolverOptions = {
      ...DEFAULT_SECTION_SOLVER_OPTIONS,
      ...options,
    }
    if (options?.MAX_HOT_REGIONS !== undefined) {
      this.MAX_HOT_REGIONS = options.MAX_HOT_REGIONS
    }
    if (options?.MAX_MUTATION_DEPTH !== undefined) {
      this.MAX_MUTATION_DEPTH = options.MAX_MUTATION_DEPTH
    }
    if (options?.MAX_SEARCH_STATES !== undefined) {
      this.MAX_SEARCH_STATES = options.MAX_SEARCH_STATES
    }
    if (options?.MAX_ENQUEUED_MUTATIONS_PER_STATE !== undefined) {
      this.MAX_ENQUEUED_MUTATIONS_PER_STATE =
        options.MAX_ENQUEUED_MUTATIONS_PER_STATE
    }
    if (options?.MUTATION_DEPTH_PENALTY !== undefined) {
      this.MUTATION_DEPTH_PENALTY = options.MUTATION_DEPTH_PENALTY
    }
    if (options?.IMPROVEMENT_EPSILON !== undefined) {
      this.IMPROVEMENT_EPSILON = options.IMPROVEMENT_EPSILON
    }
    if (options?.CANDIDATE_FAMILIES) {
      this.CANDIDATE_FAMILIES = [...options.CANDIDATE_FAMILIES]
    }

    const baselineSectionSolver = new TinyHyperGraphSectionSolver(
      topology,
      problem,
      initialSolution,
      this.sectionSolverOptions,
    )
    this.baselineSolver = baselineSectionSolver.baselineSolver
    this.baselineSerializedHyperGraph = this.baselineSolver.getOutput()
    this.bestSerializedHyperGraph = this.baselineSerializedHyperGraph
    this.baselineMaxRegionCost = getMaxRegionCost(this.baselineSolver)
    this.bestMaxRegionCost = this.baselineMaxRegionCost
  }

  override _setup() {
    this.searchStartTime = performance.now()

    const initialState: UnravelSearchState = {
      serializedHyperGraph: this.baselineSerializedHyperGraph,
      maxRegionCost: this.baselineMaxRegionCost,
      depth: 0,
      priority: this.baselineMaxRegionCost,
      mutationPath: [],
    }

    this.bestCostByFingerprint.set(
      createGraphFingerprint(this.baselineSerializedHyperGraph),
      roundMutationCost(this.baselineMaxRegionCost),
    )
    this.searchQueue.queue(initialState)
    this.enqueuedStateCount = 1

    this.stats = {
      ...this.stats,
      baselineMaxRegionCost: this.baselineMaxRegionCost,
      finalMaxRegionCost: this.bestMaxRegionCost,
      delta: 0,
      optimized: false,
      mutationDepth: 0,
      mutationPathLabels: [],
    }
  }

  expandState(searchState: UnravelSearchState) {
    if (searchState.depth >= this.MAX_MUTATION_DEPTH) {
      return
    }

    const { topology, problem, solution } = loadSerializedHyperGraph(
      searchState.serializedHyperGraph,
    )
    const stateSectionSolver = new TinyHyperGraphSectionSolver(
      topology,
      problem,
      solution,
      this.sectionSolverOptions,
    )
    const solvedSolver = stateSectionSolver.baselineSolver
    const seenPortSectionMasks = new Set<string>()
    const candidateEvaluations: CandidateEvaluation[] = []

    for (const candidate of getSectionMaskCandidates(
      solvedSolver,
      topology,
      this.MAX_HOT_REGIONS,
      this.CANDIDATE_FAMILIES,
    )) {
      this.generatedCandidateCount += 1

      const portSectionMask = createPortSectionMaskForRegionIds(
        topology,
        candidate.regionIds,
        candidate.portSelectionRule,
      )
      const candidateProblem = createProblemWithPortSectionMask(
        problem,
        portSectionMask,
      )
      const portSectionMaskKey = candidateProblem.portSectionMask.join(",")

      if (seenPortSectionMasks.has(portSectionMaskKey)) {
        this.cacheHitCount += 1
        continue
      }
      seenPortSectionMasks.add(portSectionMaskKey)

      try {
        const eligibilityStartTime = performance.now()
        const activeRouteIds = getActiveSectionRouteIds(
          topology,
          candidateProblem,
          solution,
        )
        this.totalCandidateEligibilityMs +=
          performance.now() - eligibilityStartTime

        if (activeRouteIds.length === 0) {
          continue
        }

        this.attemptedCandidateCount += 1

        const candidateInitStartTime = performance.now()
        const sectionSolver = new TinyHyperGraphSectionSolver(
          topology,
          candidateProblem,
          solution,
          this.sectionSolverOptions,
        )
        this.totalCandidateInitMs +=
          performance.now() - candidateInitStartTime

        const candidateSolveStartTime = performance.now()
        sectionSolver.solve()
        this.totalCandidateSolveMs += performance.now() - candidateSolveStartTime

        if (sectionSolver.failed || !sectionSolver.solved) {
          continue
        }

        const finalMaxRegionCost = Number(
          sectionSolver.stats.finalMaxRegionCost ??
            getMaxRegionCost(sectionSolver.getSolvedSolver()),
        )

        if (
          finalMaxRegionCost >=
          searchState.maxRegionCost - this.IMPROVEMENT_EPSILON
        ) {
          continue
        }

        const replayScoreStartTime = performance.now()
        const outputGraph = sectionSolver.getOutput()
        const replayedFinalMaxRegionCost =
          getSerializedOutputMaxRegionCost(outputGraph)
        this.totalReplayScoreMs += performance.now() - replayScoreStartTime

        if (
          replayedFinalMaxRegionCost >=
          searchState.maxRegionCost - this.IMPROVEMENT_EPSILON
        ) {
          continue
        }

        candidateEvaluations.push({
          outputGraph,
          finalMaxRegionCost: replayedFinalMaxRegionCost,
          priority:
            replayedFinalMaxRegionCost +
            (searchState.depth + 1) * this.MUTATION_DEPTH_PENALTY,
          mutation: {
            label: candidate.label,
            family: candidate.family,
            activeRouteCount: activeRouteIds.length,
            fromMaxRegionCost: searchState.maxRegionCost,
            toMaxRegionCost: replayedFinalMaxRegionCost,
          },
        })
      } catch {
        // Skip invalid section masks that split a route into multiple spans.
      }
    }

    candidateEvaluations
      .sort((left, right) => {
        if (left.finalMaxRegionCost !== right.finalMaxRegionCost) {
          return left.finalMaxRegionCost - right.finalMaxRegionCost
        }

        return left.mutation.label.localeCompare(right.mutation.label)
      })
      .slice(0, this.MAX_ENQUEUED_MUTATIONS_PER_STATE)
      .forEach((candidateEvaluation) => {
        const mutationPath = [
          ...searchState.mutationPath,
          candidateEvaluation.mutation,
        ]
        const graphFingerprint = createGraphFingerprint(
          candidateEvaluation.outputGraph,
        )
        const roundedCandidateCost = roundMutationCost(
          candidateEvaluation.finalMaxRegionCost,
        )
        const seenBestCost = this.bestCostByFingerprint.get(graphFingerprint)

        if (
          seenBestCost !== undefined &&
          seenBestCost <=
            roundedCandidateCost + this.IMPROVEMENT_EPSILON
        ) {
          this.cacheHitCount += 1
          return
        }

        this.bestCostByFingerprint.set(graphFingerprint, roundedCandidateCost)
        this.searchQueue.queue({
          serializedHyperGraph: candidateEvaluation.outputGraph,
          maxRegionCost: candidateEvaluation.finalMaxRegionCost,
          depth: mutationPath.length,
          priority: candidateEvaluation.priority,
          mutationPath,
        })
        this.enqueuedStateCount += 1
        this.successfulMutationCount += 1

        const shouldPromoteBest =
          candidateEvaluation.finalMaxRegionCost <
            this.bestMaxRegionCost - this.IMPROVEMENT_EPSILON ||
          (Math.abs(candidateEvaluation.finalMaxRegionCost - this.bestMaxRegionCost) <=
            this.IMPROVEMENT_EPSILON &&
            mutationPath.length < this.bestMutationPath.length)

        if (shouldPromoteBest) {
          this.bestSerializedHyperGraph = candidateEvaluation.outputGraph
          this.bestReplaySolver = undefined
          this.bestMaxRegionCost = candidateEvaluation.finalMaxRegionCost
          this.bestMutationPath = mutationPath
        }
      })
  }

  finalizeSearch() {
    this.stats = {
      ...this.stats,
      baselineMaxRegionCost: this.baselineMaxRegionCost,
      finalMaxRegionCost: this.bestMaxRegionCost,
      delta: this.baselineMaxRegionCost - this.bestMaxRegionCost,
      optimized:
        this.bestMaxRegionCost <
        this.baselineMaxRegionCost - this.IMPROVEMENT_EPSILON,
      mutationDepth: this.bestMutationPath.length,
      mutationPathLabels: this.bestMutationPath.map((mutation) => mutation.label),
      mutationPathFamilies: this.bestMutationPath.map(
        (mutation) => mutation.family,
      ),
      searchStatesExpanded: this.expandedStateCount,
      searchStatesQueued: this.enqueuedStateCount,
      searchStatesRemaining: this.searchQueue.length,
      searchGraphCacheSize: this.bestCostByFingerprint.size,
      searchCacheHits: this.cacheHitCount,
      generatedCandidateCount: this.generatedCandidateCount,
      attemptedCandidateCount: this.attemptedCandidateCount,
      successfulMutationCount: this.successfulMutationCount,
      candidateEligibilityMs: this.totalCandidateEligibilityMs,
      candidateInitMs: this.totalCandidateInitMs,
      candidateSolveMs: this.totalCandidateSolveMs,
      candidateReplayScoreMs: this.totalReplayScoreMs,
      searchMs: performance.now() - this.searchStartTime,
    }
    this.solved = true
  }

  override _step() {
    if (
      this.searchQueue.length === 0 ||
      this.expandedStateCount >= this.MAX_SEARCH_STATES
    ) {
      this.finalizeSearch()
      return
    }

    const nextState = this.searchQueue.dequeue()

    if (!nextState) {
      this.finalizeSearch()
      return
    }

    this.expandedStateCount += 1
    this.expandState(nextState)

    this.stats = {
      ...this.stats,
      currentMaxRegionCost: nextState.maxRegionCost,
      currentMutationDepth: nextState.depth,
      currentMutationPathLabels: nextState.mutationPath.map(
        (mutation) => mutation.label,
      ),
      searchStatesExpanded: this.expandedStateCount,
      searchStatesQueued: this.enqueuedStateCount,
      searchStatesRemaining: this.searchQueue.length,
      finalMaxRegionCost: this.bestMaxRegionCost,
      delta: this.baselineMaxRegionCost - this.bestMaxRegionCost,
    }

    if (
      this.searchQueue.length === 0 ||
      this.expandedStateCount >= this.MAX_SEARCH_STATES
    ) {
      this.finalizeSearch()
    }
  }

  getSolvedSolver(): TinyHyperGraphSolver {
    if (!this.solved || this.failed) {
      throw new Error(
        "TinyHyperGraphUnravelSolver does not have a solved output yet",
      )
    }

    if (!this.bestReplaySolver) {
      const replay = loadSerializedHyperGraph(this.bestSerializedHyperGraph)
      const replayedSectionSolver = new TinyHyperGraphSectionSolver(
        replay.topology,
        replay.problem,
        replay.solution,
      )

      this.bestReplaySolver = replayedSectionSolver.baselineSolver
    }

    return this.bestReplaySolver
  }

  override visualize(): GraphicsObject {
    if (!this.solved || this.failed) {
      return this.baselineSolver.visualize()
    }

    return this.getSolvedSolver().visualize()
  }

  override getOutput() {
    if (!this.solved || this.failed) {
      throw new Error(
        "TinyHyperGraphUnravelSolver does not have a solved output yet",
      )
    }

    return this.bestSerializedHyperGraph
  }
}
