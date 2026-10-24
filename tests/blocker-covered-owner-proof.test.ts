import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

type PortId = number
type RegionId = number
type StateId = number
type OwnerId = number
type Hop = { state: StateId; distance: number; owners: OwnerId[] }

test("two arrivals preserve owner-free classifications, directed states and every budget", (): void => {
  const regionPairs: RegionId[][] = [[0, 1], [0, 2], [1, 2]]
  for (let topologyCode = 0; topologyCode < 81; topologyCode++) {
    let remainingCode = topologyCode
    const incidentRegions: RegionId[][] = []
    for (let portId = 0; portId < 4; portId++) {
      incidentRegions.push(regionPairs[remainingCode % 3]!)
      remainingCode = Math.floor(remainingCode / 3)
    }
    const singleLayerRegions = new Set<RegionId>([topologyCode % 3])
    for (let ownerMask = 0; ownerMask < 16; ownerMask++) {
      for (const forbiddenOwner of [-1, 0, 1]) {
        for (let startRegion = 0; startRegion < 3; startRegion++) {
          for (const proofMode of ["general", "owner_free", "both"]) {
            const options = {
              start: startRegion * 4,
              getStateKey: (state: StateId): StateId => state,
              isGoal: (state: StateId): boolean => state % 4 === 3,
              getHops(state: StateId): Hop[] {
                const from = state % 4
                const region = Math.floor(state / 4)
                const hops: Hop[] = []
                for (let port: PortId = 0; port < 4; port++) {
                  if (port === from || !incidentRegions[port]!.includes(region)) continue
                  const owner = singleLayerRegions.has(region)
                    ? (from + port) % 2
                    : port % 2
                  const owners = ownerMask & (1 << port) ? [owner] : []
                  if (owners.includes(forbiddenOwner)) continue
                  const nextRegion = port === 3
                    ? region
                    : incidentRegions[port]!.find((next): boolean => next !== region)!
                  hops.push({ state: nextRegion * 4 + port, distance: 1 + port / 4, owners })
                }
                return hops
              },
              checkReachability: proofMode !== "owner_free",
              checkOwnerFreeReachability: proofMode !== "general",
            }
            for (let maxExpandedLabels = 0; maxExpandedLabels <= 10; maxExpandedLabels++) {
              const expandedByRegion = new Map<RegionId, 1 | 2>()
              const original = findDistinctOwnerBlockerPath({ ...options, maxExpandedLabels })
              const coveredOptions = {
                ...options,
                maxExpandedLabels,
                expandedByRegion,
                shouldExpandReachabilityState(state: StateId): boolean {
                  const region = Math.floor(state / 4)
                  if (singleLayerRegions.has(region)) return true
                  const count = this.expandedByRegion.get(region)
                  if (count === 2) return false
                  this.expandedByRegion.set(region, count === undefined ? 1 : 2)
                  return true
                },
              }
              const covered = findDistinctOwnerBlockerPath(coveredOptions)
              expect(covered).toEqual(original)
            }
          }
        }
      }
    }
  }
})
