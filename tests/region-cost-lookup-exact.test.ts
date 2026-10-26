import { expect, test } from "bun:test"
import { computeRegionCost } from "../lib/computeRegionCost"
import {
  createRegionCostProbeGraph,
  RegionCostProbe,
} from "./fixtures/region-cost-lookup"

test("region cost tables retain the original scalar for valid weighted counts", (): void => {
  const graph = createRegionCostProbeGraph()
  const solver = new RegionCostProbe(graph.topology, graph.problem, {
    USE_REGION_COST_LOOKUP: true,
  })
  const occupancy = solver.state.regionIntersectionCaches[0]
  for (const mask of [0, 1, 2, 3, 7, 15]) {
    graph.topology.regionAvailableZMask![0] = mask
    for (const width of [0, -0, 0.03, 1, 13.37]) {
      graph.topology.regionWidth[0] = width
      for (const density of [0, 0.25, 7]) {
        solver.TRACE_DENSITY_COST_FACTOR = density
        for (let count = 0; count <= 8; count++) {
          occupancy.existingSegmentCount = count
          occupancy.existingSameLayerIntersections = (count * (count - 1)) / 2
          occupancy.existingCrossingLayerIntersections = count % 3
          occupancy.existingEntryExitLayerChanges = count % 2
          for (let same = 0; same <= count; same++) {
            for (let cross = 0; cross + same <= count; cross++) {
              for (const entry of [0, 1]) {
                const expected = computeRegionCost(
                  width,
                  graph.topology.regionHeight[0],
                  occupancy.existingSameLayerIntersections + same,
                  occupancy.existingCrossingLayerIntersections + cross,
                  occupancy.existingEntryExitLayerChanges + entry,
                  count + 1,
                  mask,
                  solver.minViaPadDiameter,
                  density,
                )
                expect(
                  Object.is(solver.score(same, cross, entry), expected),
                ).toBe(true)
              }
            }
          }
        }
      }
    }
  }
})
