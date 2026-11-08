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

function restoreNumericArray(_key: string, value: unknown): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    !("typedArray" in value) ||
    !("values" in value)
  ) {
    return value
  }
  const constructor = arrayConstructorByName[value.typedArray as ArrayName]
  if (!constructor || !Array.isArray(value.values)) {
    throw new Error("Invalid captured numeric array")
  }
  return constructor.from(value.values)
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
