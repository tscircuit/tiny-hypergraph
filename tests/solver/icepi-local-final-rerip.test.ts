import "bun-match-svg"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject } from "graphics-debug"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
} from "lib/core"
import { PreparedPortPointRoutingSolver } from "lib/prepared/PreparedPortPointRoutingSolver"

type IcepiGraph = {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  options: TinyHyperGraphSolverOptions
}

const numericArrays = { Int8Array, Uint8Array, Int32Array, Float64Array }

function restoreNumericArray(_key: string, encoded: unknown): unknown {
  if (
    typeof encoded !== "object" ||
    encoded === null ||
    !("typedArray" in encoded) ||
    !("values" in encoded)
  )
    return encoded
  const constructor =
    numericArrays[encoded.typedArray as keyof typeof numericArrays]
  if (!constructor || !Array.isArray(encoded.values)) {
    throw new Error("Invalid captured numeric array")
  }
  return constructor.from(encoded.values)
}

test("IcePi local preserves final routing progress for recovery", async () => {
  // Exact constructor input from IcePi local's other_signals Pipeline9 stage.
  const fixture = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL("../fixtures/icepi-local-graph.json.gz", import.meta.url),
      ),
    ).toString("utf8"),
    restoreNumericArray,
  ) as IcepiGraph
  const solver = new PreparedPortPointRoutingSolver(
    fixture.topology,
    fixture.problem,
    fixture.options,
  )
  expect(solver.problem.routeCount).toBe(355)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    solver.state.unroutedRoutes.length +
      Number(solver.state.currentRouteId !== undefined),
  ).toBe(0)
  expect(solver.getOutput().solvedRoutes).toHaveLength(355)
  await expect(
    getSvgFromGraphicsObject(solver.preview(), { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
