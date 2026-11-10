import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { GraphicsObject } from "graphics-debug"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "lib/core"

const arrayConstructorByName = { Int8Array, Int32Array, Float64Array }
type ArrayName = keyof typeof arrayConstructorByName

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

export function getH3SoloRepro(): {
  solver: TinyHyperGraphSolver
  graphics: GraphicsObject
} {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(new URL("./h3-sdqs1-n-solo.json.gz", import.meta.url)),
      ),
    ).toString("utf8"),
    restoreNumericArray,
  ) as {
    topology: TinyHyperGraphTopology
    problem: TinyHyperGraphProblem
    options: TinyHyperGraphSolverOptions
    graphics: GraphicsObject
  }
  return {
    solver: new TinyHyperGraphSolver(
      fixture.topology,
      fixture.problem,
      fixture.options,
    ),
    graphics: fixture.graphics,
  }
}
