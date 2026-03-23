import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolution,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "./index"
import { cloneSolution, getSolvedRouteRegionIds } from "./solution"
import type { PortId, RegionId, RouteId } from "./types"

interface SectionRouteSlice {
  localRouteId: RouteId
  originalRouteId: RouteId
  startPortId: PortId
  endPortId: PortId
  startSegmentIndex: number
  endSegmentIndex: number
}

interface SectionCandidate {
  seedRegionId: RegionId
  regionIds: RegionId[]
  currentMaxRegionCost: number
}

interface SectionSubProblem {
  sectionProblem: TinyHyperGraphProblem
  routeSlices: SectionRouteSlice[]
}

interface SectionReplacement {
  originalRouteId: RouteId
  startSegmentIndex: number
  deleteCount: number
  pathSegments: Array<[PortId, PortId]>
  regionIds: RegionId[]
}

export interface TinyHyperGraphSectionSolverOptions {
  expansionDegrees?: number
  attemptsPerSection?: number
  maxSectionsToTry?: number
  maxIterationsPerSection?: number
  maxSectionOverlapCoverage?: number
}

export interface TinyHyperGraphSectionSolverInput {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  solution: TinyHyperGraphSolution
  regionCosts?: Float64Array
  options?: TinyHyperGraphSectionSolverOptions
}

export interface TinyHyperGraphSectionSolverOutput {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  solution: TinyHyperGraphSolution
}

const getMaxRegionCostForRegionIds = (
  regionIds: RegionId[],
  regionCosts: ArrayLike<number>,
) =>
  regionIds.reduce(
    (maxCost, regionId) => Math.max(maxCost, regionCosts[regionId] ?? 0),
    0,
  )

const getMaxRegionCostFromIntersectionCaches = (
  regionIds: RegionId[],
  regionIntersectionCaches: TinyHyperGraphSolver["state"]["regionIntersectionCaches"],
) => {
  let maxCost = 0

  for (const regionId of regionIds) {
    maxCost = Math.max(
      maxCost,
      regionIntersectionCaches[regionId]?.existingRegionCost ?? 0,
    )
  }

  return maxCost
}

const buildRegionNeighbors = (
  topology: TinyHyperGraphTopology,
): Array<RegionId[]> =>
  Array.from({ length: topology.regionCount }, (_, regionId) => {
    const neighborSet = new Set<RegionId>()

    for (const portId of topology.regionIncidentPorts[regionId] ?? []) {
      for (const neighborRegionId of topology.incidentPortRegion[portId] ??
        []) {
        if (neighborRegionId !== regionId) {
          neighborSet.add(neighborRegionId)
        }
      }
    }

    return [...neighborSet].sort((left, right) => left - right)
  })

const getSectionKey = (regionIds: RegionId[]) => regionIds.join(":")

const getSectionOverlapCoverage = (
  regionIds: RegionId[],
  otherRegionIdSet: Set<RegionId>,
) => {
  let sharedRegionCount = 0

  for (const regionId of regionIds) {
    if (otherRegionIdSet.has(regionId)) {
      sharedRegionCount += 1
    }
  }

  return (
    sharedRegionCount /
    Math.max(1, Math.min(regionIds.length, otherRegionIdSet.size))
  )
}

export class TinyHyperGraphSectionSolver extends BaseSolver {
  EXPANSION_DEGREES: number
  ATTEMPTS_PER_SECTION: number
  MAX_SECTIONS_TO_TRY: number
  MAX_ITERATIONS_PER_SECTION?: number
  MAX_SECTION_OVERLAP_COVERAGE: number

  currentSolution: TinyHyperGraphSolution
  currentSolutionSolver?: TinyHyperGraphSolver
  currentRegionCosts: Float64Array
  regionNeighbors: Array<RegionId[]>
  attemptedSectionKeys = new Set<string>()
  attemptedSectionRegionIdSets: Array<Set<RegionId>> = []
  sectionAttemptCount = 0
  improvementCount = 0
  sectionWaveCount = 0
  skippedOverlappingSectionCount = 0
  buildSectionSubProblemMs = 0
  subsectionSolveMs = 0
  candidateScoreMs = 0
  mergeSectionSolutionMs = 0
  reloadMergedSolutionMs = 0

  constructor(public input: TinyHyperGraphSectionSolverInput) {
    super()

    this.EXPANSION_DEGREES = input.options?.expansionDegrees ?? 3
    this.ATTEMPTS_PER_SECTION = input.options?.attemptsPerSection ?? 3
    this.MAX_SECTIONS_TO_TRY =
      input.options?.maxSectionsToTry ?? input.topology.regionCount
    this.MAX_ITERATIONS_PER_SECTION = input.options?.maxIterationsPerSection
    this.MAX_SECTION_OVERLAP_COVERAGE =
      input.options?.maxSectionOverlapCoverage ?? 0.95

    this.currentSolution = cloneSolution(input.solution)
    this.currentSolutionSolver = input.regionCosts
      ? undefined
      : this.createEvaluationSolver(this.currentSolution)
    this.currentRegionCosts = input.regionCosts
      ? new Float64Array(input.regionCosts)
      : Float64Array.from(
          this.currentSolutionSolver!.state.regionIntersectionCaches.map(
            (regionCache) => regionCache.existingRegionCost,
          ),
        )
    this.regionNeighbors = buildRegionNeighbors(input.topology)
    this.sectionWaveCount = 1
    this.updateStats()
  }

  createEvaluationSolver(solution: TinyHyperGraphSolution) {
    const solver = new TinyHyperGraphSolver(
      this.input.topology,
      this.input.problem,
    )
    solver.loadSolutionIntoState(solution)
    solver.solved = true
    solver.failed = false
    return solver
  }

  getCurrentRegionCosts() {
    return this.currentRegionCosts
  }

  getCurrentMaxRegionCost() {
    return this.currentRegionCosts.reduce(
      (maxCost, regionCost) => Math.max(maxCost, regionCost),
      0,
    )
  }

  getVisualizationSolver() {
    if (!this.currentSolutionSolver) {
      this.currentSolutionSolver = this.createEvaluationSolver(
        this.currentSolution,
      )
    }

    return this.currentSolutionSolver
  }

  getExpandedSectionRegionIds(seedRegionId: RegionId): RegionId[] {
    const visited = new Set<RegionId>([seedRegionId])
    let frontier = [seedRegionId]

    for (let degree = 0; degree < this.EXPANSION_DEGREES; degree++) {
      const nextFrontier: RegionId[] = []

      for (const regionId of frontier) {
        for (const neighborRegionId of this.regionNeighbors[regionId] ?? []) {
          if (visited.has(neighborRegionId)) continue
          visited.add(neighborRegionId)
          nextFrontier.push(neighborRegionId)
        }
      }

      frontier = nextFrontier
      if (frontier.length === 0) break
    }

    return [...visited].sort((left, right) => left - right)
  }

  getNextSectionCandidate(): SectionCandidate | undefined {
    const regionCosts = this.getCurrentRegionCosts()
    const sortedRegionIds = Array.from(regionCosts, (cost, regionId) => ({
      regionId,
      cost,
    }))
      .sort((left, right) => right.cost - left.cost)
      .map(({ regionId }) => regionId)

    for (const seedRegionId of sortedRegionIds) {
      const currentMaxRegionCost = regionCosts[seedRegionId] ?? 0
      if (currentMaxRegionCost <= 0) {
        return undefined
      }

      const regionIds = this.getExpandedSectionRegionIds(seedRegionId)
      const sectionKey = getSectionKey(regionIds)
      if (this.attemptedSectionKeys.has(sectionKey)) {
        continue
      }
      if (
        this.attemptedSectionRegionIdSets.some(
          (previousRegionIdSet) =>
            getSectionOverlapCoverage(regionIds, previousRegionIdSet) >=
            this.MAX_SECTION_OVERLAP_COVERAGE,
        )
      ) {
        this.skippedOverlappingSectionCount += 1
        continue
      }

      this.attemptedSectionKeys.add(sectionKey)
      this.attemptedSectionRegionIdSets.push(new Set(regionIds))
      return {
        seedRegionId,
        regionIds,
        currentMaxRegionCost: getMaxRegionCostForRegionIds(
          regionIds,
          regionCosts,
        ),
      }
    }

    return undefined
  }

  buildSectionSubProblem(regionIds: RegionId[]): SectionSubProblem {
    const { topology, problem } = this.input
    const sectionRegionMask = new Int8Array(topology.regionCount)
    const sectionPortMask = new Int8Array(topology.portCount)

    for (const regionId of regionIds) {
      sectionRegionMask[regionId] = 1
      for (const portId of topology.regionIncidentPorts[regionId] ?? []) {
        sectionPortMask[portId] = 1
      }
    }

    const routeSlices: SectionRouteSlice[] = []
    const routeRegionIds =
      this.currentSolution.solvedRouteRegionIds ??
      getSolvedRouteRegionIds(topology, this.currentSolution)

    this.currentSolution.solvedRouteRegionIds = routeRegionIds

    this.currentSolution.solvedRoutePathSegments.forEach(
      (pathSegments, routeId) => {
        let sectionStartSegmentIndex: number | undefined

        for (
          let segmentIndex = 0;
          segmentIndex <= pathSegments.length;
          segmentIndex++
        ) {
          const isInsideSection =
            segmentIndex < pathSegments.length &&
            sectionRegionMask[routeRegionIds[routeId]?.[segmentIndex] ?? -1] ===
              1

          if (isInsideSection && sectionStartSegmentIndex === undefined) {
            sectionStartSegmentIndex = segmentIndex
            continue
          }

          if (isInsideSection || sectionStartSegmentIndex === undefined) {
            continue
          }

          const startSegmentIndex = sectionStartSegmentIndex
          const endSegmentIndex = segmentIndex - 1
          const startPortId = pathSegments[startSegmentIndex]?.[0]
          const endPortId = pathSegments[endSegmentIndex]?.[1]

          if (startPortId !== undefined && endPortId !== undefined) {
            sectionPortMask[startPortId] = 1
            sectionPortMask[endPortId] = 1
            routeSlices.push({
              localRouteId: routeSlices.length,
              originalRouteId: routeId,
              startPortId,
              endPortId,
              startSegmentIndex,
              endSegmentIndex,
            })
          }

          sectionStartSegmentIndex = undefined
        }
      },
    )

    return {
      sectionProblem: {
        routeCount: routeSlices.length,
        portSectionMask: sectionPortMask,
        regionSectionMask: sectionRegionMask,
        routeMetadata: routeSlices.map((routeSlice) => ({
          originalRouteId: routeSlice.originalRouteId,
          originalRouteMetadata:
            problem.routeMetadata?.[routeSlice.originalRouteId] ?? null,
          startSegmentIndex: routeSlice.startSegmentIndex,
          endSegmentIndex: routeSlice.endSegmentIndex,
        })),
        routeStartPort: Int32Array.from(
          routeSlices.map((routeSlice) => routeSlice.startPortId),
        ),
        routeEndPort: Int32Array.from(
          routeSlices.map((routeSlice) => routeSlice.endPortId),
        ),
        routeNet: Int32Array.from(
          routeSlices.map(
            (routeSlice) => problem.routeNet[routeSlice.originalRouteId] ?? -1,
          ),
        ),
        regionNetId: new Int32Array(problem.regionNetId),
        shuffleSeed: problem.shuffleSeed,
      },
      routeSlices,
    }
  }

  getReplacementsFromSubSolution(
    routeSlices: SectionRouteSlice[],
    solution: TinyHyperGraphSolution,
  ): SectionReplacement[] {
    const routeRegionIds = getSolvedRouteRegionIds(
      this.input.topology,
      solution,
    )

    return routeSlices.map((routeSlice) => ({
      originalRouteId: routeSlice.originalRouteId,
      startSegmentIndex: routeSlice.startSegmentIndex,
      deleteCount:
        routeSlice.endSegmentIndex - routeSlice.startSegmentIndex + 1,
      pathSegments:
        solution.solvedRoutePathSegments[routeSlice.localRouteId]?.map(
          ([fromPortId, toPortId]) => [fromPortId, toPortId],
        ) ?? [],
      regionIds: [...(routeRegionIds[routeSlice.localRouteId] ?? [])],
    }))
  }

  mergeSectionSolution(
    baseSolution: TinyHyperGraphSolution,
    routeSlices: SectionRouteSlice[],
    solution: TinyHyperGraphSolution,
  ): TinyHyperGraphSolution {
    const replacementsByRoute = new Map<RouteId, SectionReplacement[]>()
    const nextSolution: TinyHyperGraphSolution = {
      solvedRoutePathSegments: [...baseSolution.solvedRoutePathSegments],
      solvedRouteRegionIds: [
        ...(baseSolution.solvedRouteRegionIds ??
          getSolvedRouteRegionIds(this.input.topology, baseSolution)),
      ],
    }

    for (const replacement of this.getReplacementsFromSubSolution(
      routeSlices,
      solution,
    )) {
      const replacements =
        replacementsByRoute.get(replacement.originalRouteId) ?? []
      replacements.push(replacement)
      replacementsByRoute.set(replacement.originalRouteId, replacements)
    }

    for (const [routeId, replacements] of replacementsByRoute.entries()) {
      const pathSegments = [
        ...(nextSolution.solvedRoutePathSegments[routeId] ?? []),
      ]
      const regionIds = [
        ...(nextSolution.solvedRouteRegionIds?.[routeId] ?? []),
      ]

      replacements.sort(
        (left, right) => right.startSegmentIndex - left.startSegmentIndex,
      )

      for (const replacement of replacements) {
        pathSegments.splice(
          replacement.startSegmentIndex,
          replacement.deleteCount,
          ...replacement.pathSegments,
        )
        regionIds.splice(
          replacement.startSegmentIndex,
          replacement.deleteCount,
          ...replacement.regionIds,
        )
      }

      nextSolution.solvedRoutePathSegments[routeId] = pathSegments
      nextSolution.solvedRouteRegionIds![routeId] = regionIds
    }

    return nextSolution
  }

  tryOptimizeSection(sectionCandidate: SectionCandidate) {
    const { regionIds, seedRegionId, currentMaxRegionCost } = sectionCandidate
    const buildStart = performance.now()
    const { sectionProblem, routeSlices } =
      this.buildSectionSubProblem(regionIds)
    this.buildSectionSubProblemMs += performance.now() - buildStart

    if (routeSlices.length === 0) {
      return
    }

    const attemptProblem: TinyHyperGraphProblem = {
      ...sectionProblem,
      shuffleSeed:
        (sectionProblem.shuffleSeed ?? 7) +
        this.sectionWaveCount * 7919 +
        seedRegionId * 1009,
    }
    const sectionSolver = new TinyHyperGraphSolver(
      this.input.topology,
      attemptProblem,
      {
        maxIterations: this.MAX_ITERATIONS_PER_SECTION,
      },
    )

    let bestSubSolution: TinyHyperGraphSolution | undefined
    let bestMaxRegionCost = currentMaxRegionCost

    for (
      let attemptIndex = 0;
      attemptIndex < this.ATTEMPTS_PER_SECTION;
      attemptIndex++
    ) {
      attemptProblem.shuffleSeed =
        (sectionProblem.shuffleSeed ?? 7) +
        this.sectionWaveCount * 7919 +
        seedRegionId * 1009 +
        attemptIndex

      if (attemptIndex > 0) {
        sectionSolver.resetForFreshSolve()
      }

      const solveStart = performance.now()
      sectionSolver.solve()
      this.subsectionSolveMs += performance.now() - solveStart

      if (!sectionSolver.solved || sectionSolver.failed) {
        continue
      }

      const scoreStart = performance.now()
      const candidateMaxRegionCost = getMaxRegionCostFromIntersectionCaches(
        regionIds,
        sectionSolver.state.regionIntersectionCaches,
      )

      if (candidateMaxRegionCost < bestMaxRegionCost) {
        bestSubSolution = sectionSolver.getSolution()
        bestMaxRegionCost = candidateMaxRegionCost
      }

      this.candidateScoreMs += performance.now() - scoreStart
    }

    if (bestSubSolution) {
      const mergeStart = performance.now()
      this.currentSolution = this.mergeSectionSolution(
        this.currentSolution,
        routeSlices,
        bestSubSolution,
      )
      this.mergeSectionSolutionMs += performance.now() - mergeStart

      const reloadStart = performance.now()
      for (const regionId of regionIds) {
        this.currentRegionCosts[regionId] =
          sectionSolver.state.regionIntersectionCaches[regionId]
            ?.existingRegionCost ?? 0
      }
      this.currentSolutionSolver = undefined
      this.reloadMergedSolutionMs += performance.now() - reloadStart
      this.improvementCount += 1
      this.sectionWaveCount += 1
      this.attemptedSectionKeys.clear()
      this.attemptedSectionRegionIdSets = []
    }
  }

  updateStats() {
    const regionCosts = this.getCurrentRegionCosts()

    this.stats = {
      ...this.stats,
      sectionAttemptCount: this.sectionAttemptCount,
      improvementCount: this.improvementCount,
      sectionWaveCount: this.sectionWaveCount,
      skippedOverlappingSectionCount: this.skippedOverlappingSectionCount,
      maxRegionCost: regionCosts.reduce(
        (maxCost, regionCost) => Math.max(maxCost, regionCost),
        0,
      ),
      buildSectionSubProblemMs: Number(
        this.buildSectionSubProblemMs.toFixed(2),
      ),
      subsectionSolveMs: Number(this.subsectionSolveMs.toFixed(2)),
      candidateScoreMs: Number(this.candidateScoreMs.toFixed(2)),
      mergeSectionSolutionMs: Number(this.mergeSectionSolutionMs.toFixed(2)),
      reloadMergedSolutionMs: Number(this.reloadMergedSolutionMs.toFixed(2)),
    }
  }

  override _step() {
    if (this.sectionAttemptCount >= this.MAX_SECTIONS_TO_TRY) {
      this.solved = true
      return
    }

    const sectionCandidate = this.getNextSectionCandidate()
    if (!sectionCandidate) {
      this.solved = true
      return
    }

    this.tryOptimizeSection(sectionCandidate)
    this.sectionAttemptCount += 1
    this.updateStats()
  }

  computeProgress() {
    return Math.min(1, this.sectionAttemptCount / this.MAX_SECTIONS_TO_TRY)
  }

  override visualize(): GraphicsObject {
    return this.getVisualizationSolver().visualize()
  }

  override getConstructorParams() {
    return [this.input]
  }

  override getOutput(): TinyHyperGraphSectionSolverOutput {
    return {
      topology: this.input.topology,
      problem: this.input.problem,
      solution: cloneSolution(this.currentSolution),
    }
  }
}
