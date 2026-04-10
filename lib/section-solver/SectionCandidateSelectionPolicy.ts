import type { RegionId } from "../types"

export interface SectionCandidateSelectionInput {
  bestFinalMaxRegionCost: number
  nextFinalMaxRegionCost: number
  baselineMaxRegionCost: number
  bestRegionIds: RegionId[]
  nextRegionIds: RegionId[]
  epsilon: number
}

export class SimpleOverlapSectionPolicy {
  shouldReplace(input: SectionCandidateSelectionInput) {
    if (
      input.nextFinalMaxRegionCost <
      input.bestFinalMaxRegionCost - input.epsilon
    ) {
      return true
    }

    const almostEqual =
      Math.abs(input.nextFinalMaxRegionCost - input.bestFinalMaxRegionCost) <=
      input.epsilon

    if (!almostEqual) {
      return false
    }

    const sharedRegion = input.nextRegionIds.some((regionId) =>
      input.bestRegionIds.includes(regionId),
    )

    if (!sharedRegion) {
      return false
    }

    const nextDrop = input.baselineMaxRegionCost - input.nextFinalMaxRegionCost
    const bestDrop = input.baselineMaxRegionCost - input.bestFinalMaxRegionCost

    return nextDrop > bestDrop + input.epsilon
  }
}
