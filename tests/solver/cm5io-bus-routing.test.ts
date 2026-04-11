import { expect, test } from "bun:test"
import { convertPortPointPathingSolverInputToSerializedHyperGraph } from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { type TinyHyperGraphProblem, TinyHyperGraphSolver } from "lib/index"

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

const cloneProblem = (
  problem: TinyHyperGraphProblem,
): TinyHyperGraphProblem => ({
  routeCount: problem.routeCount,
  portSectionMask: new Int8Array(problem.portSectionMask),
  routeMetadata: problem.routeMetadata,
  routeStartPort: new Int32Array(problem.routeStartPort),
  routeEndPort: new Int32Array(problem.routeEndPort),
  routeStartPortCandidates: problem.routeStartPortCandidates?.map(
    (candidatePortIds) =>
      candidatePortIds ? [...candidatePortIds] : undefined,
  ),
  routeEndPortCandidates: problem.routeEndPortCandidates?.map(
    (candidatePortIds) =>
      candidatePortIds ? [...candidatePortIds] : undefined,
  ),
  routeNet: new Int32Array(problem.routeNet),
  regionNetId: new Int32Array(problem.regionNetId),
  suggestedSolverOptions: problem.suggestedSolverOptions,
})

test("CM5IO uses snapped endpoints to materially reduce max region cost", async () => {
  const input = await Bun.file(
    new URL("../fixtures/CM5IO_HyperGraph.json", import.meta.url),
  ).json()
  const serializedHyperGraph =
    convertPortPointPathingSolverInputToSerializedHyperGraph(input)
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  const regionIndexBySerializedId = new Map(
    topology.regionMetadata?.map((metadata, regionId) => [
      metadata?.serializedRegionId,
      regionId,
    ]),
  )
  const legacyProblem = cloneProblem(problem)
  const improvedProblem = cloneProblem(problem)

  legacyProblem.suggestedSolverOptions = undefined
  improvedProblem.suggestedSolverOptions = undefined
  legacyProblem.routeStartPortCandidates = undefined
  legacyProblem.routeEndPortCandidates = undefined
  improvedProblem.routeStartPortCandidates = undefined
  improvedProblem.routeEndPortCandidates = undefined

  for (let routeId = 0; routeId < legacyProblem.routeCount; routeId++) {
    const routeMetadata = legacyProblem.routeMetadata?.[routeId]
    const startRegionId = routeMetadata?.startRegionId
    const endRegionId = routeMetadata?.endRegionId

    const getLegacyCentermostPortId = (
      serializedRegionId: string | undefined,
    ) => {
      const regionId =
        serializedRegionId !== undefined
          ? regionIndexBySerializedId.get(serializedRegionId)
          : undefined

      if (regionId === undefined) {
        return undefined
      }

      return [...(topology.regionIncidentPorts[regionId] ?? [])].sort(
        (leftPortId, rightPortId) => {
          const leftMetadata = topology.portMetadata?.[leftPortId]
          const rightMetadata = topology.portMetadata?.[rightPortId]
          const leftDistToCenter = Number(
            leftMetadata?.distToCentermostPortOnZ ?? Number.POSITIVE_INFINITY,
          )
          const rightDistToCenter = Number(
            rightMetadata?.distToCentermostPortOnZ ?? Number.POSITIVE_INFINITY,
          )

          if (leftDistToCenter !== rightDistToCenter) {
            return leftDistToCenter - rightDistToCenter
          }

          if (topology.portZ[leftPortId] !== topology.portZ[rightPortId]) {
            return topology.portZ[leftPortId] - topology.portZ[rightPortId]
          }

          return String(
            leftMetadata?.serializedPortId ??
              leftMetadata?.portId ??
              leftPortId,
          ).localeCompare(
            String(
              rightMetadata?.serializedPortId ??
                rightMetadata?.portId ??
                rightPortId,
            ),
          )
        },
      )[0]
    }

    const legacyStartPortId = getLegacyCentermostPortId(startRegionId)
    const legacyEndPortId = getLegacyCentermostPortId(endRegionId)

    if (legacyStartPortId !== undefined) {
      legacyProblem.routeStartPort[routeId] = legacyStartPortId
    }
    if (legacyEndPortId !== undefined) {
      legacyProblem.routeEndPort[routeId] = legacyEndPortId
    }
  }

  const legacySolver = new TinyHyperGraphSolver(topology, legacyProblem, {
    MAX_ITERATIONS: 50_000,
    TRAVEL_DISTANCE_TO_COST: 0,
  })
  const improvedSolver = new TinyHyperGraphSolver(topology, improvedProblem, {
    MAX_ITERATIONS: 50_000,
  })

  legacySolver.solve()
  improvedSolver.solve()

  const legacyMaxRegionCost = getMaxRegionCost(legacySolver)
  const improvedMaxRegionCost = getMaxRegionCost(improvedSolver)

  expect(improvedMaxRegionCost).toBeLessThan(legacyMaxRegionCost)
  expect(legacyMaxRegionCost - improvedMaxRegionCost).toBeGreaterThan(0.5)
  expect(improvedMaxRegionCost).toBeLessThan(0.2)
})
