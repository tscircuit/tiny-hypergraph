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
}

export interface TinyHyperGraphSectionSolverInput {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  solution: TinyHyperGraphSolution
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

export class TinyHyperGraphSectionSolver extends BaseSolver {
  EXPANSION_DEGREES: number
  ATTEMPTS_PER_SECTION: number
  MAX_SECTIONS_TO_TRY: number
  MAX_ITERATIONS_PER_SECTION?: number

  currentSolution: TinyHyperGraphSolution
  currentSolutionSolver: TinyHyperGraphSolver
  regionNeighbors: Array<RegionId[]>
  attemptedSectionKeys = new Set<string>()
  sectionAttemptCount = 0
  improvementCount = 0

  constructor(public input: TinyHyperGraphSectionSolverInput) {
    super()

    this.EXPANSION_DEGREES = input.options?.expansionDegrees ?? 3
    this.ATTEMPTS_PER_SECTION = input.options?.attemptsPerSection ?? 3
    this.MAX_SECTIONS_TO_TRY =
      input.options?.maxSectionsToTry ?? input.topology.regionCount
    this.MAX_ITERATIONS_PER_SECTION = input.options?.maxIterationsPerSection

    this.currentSolution = cloneSolution(input.solution)
    this.currentSolutionSolver = this.createEvaluationSolver(
      this.currentSolution,
    )
    this.regionNeighbors = buildRegionNeighbors(input.topology)
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
    return this.currentSolutionSolver.state.regionIntersectionCaches.map(
      (regionCache) => regionCache.existingRegionCost,
    )
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
    const sortedRegionIds = regionCosts
      .map((cost, regionId) => ({ regionId, cost }))
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

      this.attemptedSectionKeys.add(sectionKey)
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
    const routeRegionIds = getSolvedRouteRegionIds(
      topology,
      this.currentSolution,
    )

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
    const nextSolution = cloneSolution(baseSolution)

    for (const replacement of this.getReplacementsFromSubSolution(
      routeSlices,
      solution,
    )) {
      const replacements =
        replacementsByRoute.get(replacement.originalRouteId) ?? []
      replacements.push(replacement)
      replacementsByRoute.set(replacement.originalRouteId, replacements)
    }

    if (!nextSolution.solvedRouteRegionIds) {
      nextSolution.solvedRouteRegionIds = getSolvedRouteRegionIds(
        this.input.topology,
        nextSolution,
      )
    }

    for (const [routeId, replacements] of replacementsByRoute.entries()) {
      const pathSegments = nextSolution.solvedRoutePathSegments[routeId] ?? []
      const regionIds = nextSolution.solvedRouteRegionIds[routeId] ?? []

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
      nextSolution.solvedRouteRegionIds[routeId] = regionIds
    }

    return nextSolution
  }

  tryOptimizeSection(sectionCandidate: SectionCandidate) {
    const { regionIds, seedRegionId, currentMaxRegionCost } = sectionCandidate
    const { sectionProblem, routeSlices } =
      this.buildSectionSubProblem(regionIds)

    if (routeSlices.length === 0) {
      return
    }

    let bestSolution: TinyHyperGraphSolution | undefined
    let bestMaxRegionCost = currentMaxRegionCost

    for (
      let attemptIndex = 0;
      attemptIndex < this.ATTEMPTS_PER_SECTION;
      attemptIndex++
    ) {
      const attemptProblem: TinyHyperGraphProblem = {
        ...sectionProblem,
        shuffleSeed:
          (sectionProblem.shuffleSeed ?? 7) +
          seedRegionId * 1009 +
          attemptIndex,
      }
      const sectionSolver = new TinyHyperGraphSolver(
        this.input.topology,
        attemptProblem,
        {
          maxIterations: this.MAX_ITERATIONS_PER_SECTION,
        },
      )
      sectionSolver.solve()

      if (!sectionSolver.solved || sectionSolver.failed) {
        continue
      }

      const candidateSolution = this.mergeSectionSolution(
        this.currentSolution,
        routeSlices,
        sectionSolver.getSolution(),
      )
      const candidateSolver = this.createEvaluationSolver(candidateSolution)
      const candidateRegionCosts =
        candidateSolver.state.regionIntersectionCaches.map(
          (regionCache) => regionCache.existingRegionCost,
        )
      const candidateMaxRegionCost = getMaxRegionCostForRegionIds(
        regionIds,
        candidateRegionCosts,
      )

      if (candidateMaxRegionCost < bestMaxRegionCost) {
        bestSolution = candidateSolution
        bestMaxRegionCost = candidateMaxRegionCost
      }
    }

    if (bestSolution) {
      this.currentSolution = bestSolution
      this.currentSolutionSolver = this.createEvaluationSolver(
        this.currentSolution,
      )
      this.improvementCount += 1
    }
  }

  updateStats() {
    const regionCosts = this.getCurrentRegionCosts()

    this.stats = {
      ...this.stats,
      sectionAttemptCount: this.sectionAttemptCount,
      improvementCount: this.improvementCount,
      maxRegionCost: regionCosts.reduce(
        (maxCost, regionCost) => Math.max(maxCost, regionCost),
        0,
      ),
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
    return this.currentSolutionSolver.visualize()
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
