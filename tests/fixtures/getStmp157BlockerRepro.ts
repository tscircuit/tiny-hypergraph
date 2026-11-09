import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { GraphicsObject } from "graphics-debug"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

type ArrayName = "Int8Array" | "Uint8Array" | "Int32Array" | "Float64Array"
type Stmp157BlockerRepro = {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  currentRouteId: number
  graphics: GraphicsObject
}

const arrayConstructorByName = {
  Int8Array,
  Uint8Array,
  Int32Array,
  Float64Array,
}

function restoreNumericArray(_key: string, encodedArray: unknown): unknown {
  if (
    typeof encodedArray !== "object" ||
    encodedArray === null ||
    !("typedArray" in encodedArray) ||
    !("values" in encodedArray)
  ) {
    return encodedArray
  }
  const arrayName = encodedArray.typedArray as ArrayName
  const arrayConstructor = arrayConstructorByName[arrayName]
  if (!arrayConstructor || !Array.isArray(encodedArray.values)) {
    throw new Error("Invalid captured numeric array")
  }
  return arrayConstructor.from(encodedArray.values)
}

export function getStmp157BlockerRepro(): {
  solver: SelectiveReripTinyHyperGraphSolver
  graphics: GraphicsObject
} {
  const compressed = readFileSync(
    new URL("./stmp157-ddr-blocker-search.json.gz", import.meta.url),
  )
  const fixture = JSON.parse(
    gunzipSync(new Uint8Array(compressed)).toString("utf8"),
    restoreNumericArray,
  ) as Stmp157BlockerRepro
  const solver = new SelectiveReripTinyHyperGraphSolver(
    fixture.topology,
    fixture.problem,
  )
  const routeId = fixture.currentRouteId
  solver.state.currentRouteId = routeId
  solver.state.currentRouteNetId = fixture.problem.routeNet[routeId]
  return { solver, graphics: fixture.graphics }
}
