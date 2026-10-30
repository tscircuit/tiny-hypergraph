import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { TinyHyperGraphSolver } from "../../lib/core"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"

test("through-hole plans honor blocked layers and physical via capacity", (): void => {
  for (const Solver of [TinyHyperGraphSolver, PreparedPortPointRoutingSolver]) {
    for (const scenario of [
      "tiny-foreign",
      "tiny-shared",
      "roomy",
      "blocked-layer",
      "tiny-crossing",
    ]) {
      const size = scenario === "roomy" ? 2 : 0.01
      const graph: SerializedHyperGraph = {
        regions: [
          {
            regionId: "center",
            pointIds: ["a0", "a2", "b0", "b2"],
            d: {
              center: { x: 0, y: 0 },
              width: size,
              height: size,
              availableZ: scenario === "blocked-layer" ? [0, 2] : [0, 1, 2],
            },
          },
          ...["a0", "a2", "b0", "b2"].map((id): SerializedHyperGraph["regions"][number] => ({
            regionId: id,
            pointIds: [id],
            d: {
              center: { x: 0, y: 0 },
              width: size,
              height: size,
              availableZ: [scenario === "tiny-crossing" ? 0 : Number(id[1])],
            },
          })),
        ],
        ports: ["a0", "a2", "b0", "b2"].map((id): SerializedHyperGraph["ports"][number] => ({
          portId: id,
          region1Id: id,
          region2Id: "center",
          d: scenario === "tiny-crossing"
            ? {
                x: id[0] === "a" ? (id[1] === "0" ? -size / 2 : size / 2) : 0,
                y: id[0] === "b" ? (id[1] === "0" ? -size / 2 : size / 2) : 0,
                z: 0,
              }
            : {
                x: id[1] === "0" ? -size / 2 : size / 2,
                y: id[0] === "a" ? -size / 4 : size / 4,
                z: Number(id[1]),
              },
        })),
        connections: ["a", "b"].map((net): NonNullable<SerializedHyperGraph["connections"]>[number] => ({
          connectionId: net,
          mutuallyConnectedNetworkId: scenario === "tiny-shared" ? "shared" : net,
          startRegionId: `${net}0`,
          endRegionId: `${net}2`,
        })),
      }
      for (const enabled of [false, true]) {
        const { topology, problem } = loadSerializedHyperGraph(graph)
        const solver = new Solver(topology, problem, {
          MAX_ITERATIONS: 3000,
          RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
          throughHoleLayerCount: enabled ? 3 : undefined,
          throughHoleViaClearance: 0.1,
          minViaPadDiameter: 0.3,
          OWNED_REGIONAL_HOP_FRONTIER: true,
          USE_SPARSE_CANDIDATE_STORAGE: false,
        })
        solver.solve()
        const expected =
          !enabled || scenario === "tiny-shared" || scenario === "roomy"
        expect({ solver: Solver.name, scenario, enabled, solved: solver.solved }).toEqual({
          solver: Solver.name,
          scenario,
          enabled,
          solved: expected,
        })
      }
    }
  }
})
