import type { TinyHyperGraphTopology } from "../core"
import type { RegionId } from "../types"

export type TinyHyperGraphSectionCandidateFamily =
  | "self-all"
  | "self-touch"
  | "onehop-all"
  | "onehop-touch"
  | "twohop-all"
  | "twohop-touch"
  | "threehop-all"
  | "threehop-touch"
  | "fourhop-all"
  | "fourhop-touch"

export type TinyHyperGraphSectionPortSelectionRule =
  | "touches-selected-region"
  | "all-incident-regions-selected"

export type TinyHyperGraphSectionMaskCandidate = {
  label: string
  family: TinyHyperGraphSectionCandidateFamily
  regionIds: RegionId[]
  portSelectionRule: TinyHyperGraphSectionPortSelectionRule
}

/**
 * Default automatic search families. Deliberately excludes the deeper
 * three-hop and four-hop families so callers must opt into them explicitly.
 */
export const DEFAULT_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES = [
  "self-touch",
  "onehop-all",
  "onehop-touch",
  "twohop-all",
  "twohop-touch",
] as const satisfies readonly TinyHyperGraphSectionCandidateFamily[]

export const OPT_IN_DEEP_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES = [
  "threehop-all",
  "threehop-touch",
  "fourhop-all",
  "fourhop-touch",
] as const satisfies readonly TinyHyperGraphSectionCandidateFamily[]

export const ALL_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES = [
  "self-all",
  ...DEFAULT_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
  ...OPT_IN_DEEP_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
] as const satisfies readonly TinyHyperGraphSectionCandidateFamily[]

const CANDIDATE_FAMILY_HOP_COUNT: Record<
  TinyHyperGraphSectionCandidateFamily,
  number
> = {
  "self-all": 0,
  "self-touch": 0,
  "onehop-all": 1,
  "onehop-touch": 1,
  "twohop-all": 2,
  "twohop-touch": 2,
  "threehop-all": 3,
  "threehop-touch": 3,
  "fourhop-all": 4,
  "fourhop-touch": 4,
}

const getAdjacentRegionIds = (
  topology: TinyHyperGraphTopology,
  seedRegionIds: RegionId[],
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

const getRegionIdsWithinHopCount = (
  topology: TinyHyperGraphTopology,
  seedRegionIds: RegionId[],
  hopCount: number,
) => {
  let expandedRegionIds = [...new Set(seedRegionIds)]

  for (let hopIndex = 0; hopIndex < hopCount; hopIndex += 1) {
    expandedRegionIds = getAdjacentRegionIds(topology, expandedRegionIds)
  }

  return expandedRegionIds
}

export const createSectionMaskCandidate = (
  topology: TinyHyperGraphTopology,
  hotRegionId: RegionId,
  family: TinyHyperGraphSectionCandidateFamily,
): TinyHyperGraphSectionMaskCandidate => ({
  label: `hot-${hotRegionId}-${family}`,
  family,
  regionIds: getRegionIdsWithinHopCount(
    topology,
    [hotRegionId],
    CANDIDATE_FAMILY_HOP_COUNT[family],
  ),
  portSelectionRule: family.endsWith("-all")
    ? "all-incident-regions-selected"
    : "touches-selected-region",
})

export const createSectionMaskCandidatesForHotRegions = (
  topology: TinyHyperGraphTopology,
  hotRegionIds: RegionId[],
  candidateFamilies: TinyHyperGraphSectionCandidateFamily[],
): TinyHyperGraphSectionMaskCandidate[] =>
  hotRegionIds.flatMap((hotRegionId) =>
    candidateFamilies.map((family) =>
      createSectionMaskCandidate(topology, hotRegionId, family),
    ),
  )
