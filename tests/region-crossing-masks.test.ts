import { expect, test } from "bun:test"
import { RegionCrossingMasks } from "../lib/prepared/RegionCrossingMasks"
import type { RegionIntersectionCache } from "../lib/types"

test("crossing masks preserve strict endpoints, layer masks and own-net exclusions across word boundaries", () => {
  for (const count of [1, 15, 16, 31, 32, 33, 63, 64, 65, 127, 256]) {
    const cache = {
      netIds: Array.from({ length: count }, (_, i) => i % 5),
      lesserAngles: Array.from({ length: count }, (_, i) => (i * 7) % 17),
      greaterAngles: Array.from({ length: count }, (_, i) => 17 + (i * 11) % 19),
      layerMasks: Array.from({ length: count }, (_, i) => 1 + i % 7),
      existingSameLayerIntersections: 0,
      existingCrossingLayerIntersections: 0,
      existingEntryExitLayerChanges: 0,
      existingRegionCost: 0,
      existingSegmentCount: count,
    } as RegionIntersectionCache
    const masks = new RegionCrossingMasks(cache)
    for (let a = -1; a <= 37; a += 2) {
      for (let b = -1; b <= 37; b += 3) {
        for (const layer of [1, 2, 3, 4, 7]) {
          for (const net of [0, 2, 8]) {
            let same = 0, cross = 0
            const lo = Math.min(a, b), hi = Math.max(a, b)
            for (let i = 0; i < count; i++) {
              if (cache.netIds[i] === net) continue
              if ((lo < cache.lesserAngles[i]! && cache.lesserAngles[i]! < hi) ===
                (lo < cache.greaterAngles[i]! && cache.greaterAngles[i]! < hi)) continue
              if (layer & cache.layerMasks[i]!) same++
              else cross++
            }
            expect(masks.count(a, b, layer, net)).toBe(2 * same + cross)
            expect(masks.hasSameLayerCrossing).toBe(same > 0)
          }
        }
      }
    }
  }
})
