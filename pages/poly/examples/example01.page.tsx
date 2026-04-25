import type { BaseSolver } from "@tscircuit/solver-utils"
import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import {
  PolyHyperGraphSolver,
  type PolyHyperGraphProblem,
  type PolyHyperGraphSolverOptions,
  type PolyHyperGraphTopology,
} from "lib/index"
import paramsJson from "./Dataset01PolyHyperGraphSolver_circuit001_params.json"

type JsonRecord = Record<string, unknown>

const [rawTopology, rawProblem, rawOptions] = paramsJson as unknown as [
  JsonRecord,
  JsonRecord,
  JsonRecord,
]

const numericValues = (value: unknown): number[] => {
  if (Array.isArray(value)) {
    return value.map(Number)
  }

  if (!value || typeof value !== "object") {
    return []
  }

  return Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, item]) => Number(item))
}

const toFloat64Array = (value: unknown) =>
  Float64Array.from(numericValues(value))
const toInt32Array = (value: unknown) => Int32Array.from(numericValues(value))
const toInt8Array = (value: unknown) => Int8Array.from(numericValues(value))

const createTopology = (): PolyHyperGraphTopology =>
  ({
    ...rawTopology,
    regionWidth: toFloat64Array(rawTopology.regionWidth),
    regionHeight: toFloat64Array(rawTopology.regionHeight),
    regionCenterX: toFloat64Array(rawTopology.regionCenterX),
    regionCenterY: toFloat64Array(rawTopology.regionCenterY),
    regionAvailableZMask: toInt32Array(rawTopology.regionAvailableZMask),
    portAngleForRegion1: toInt32Array(rawTopology.portAngleForRegion1),
    portAngleForRegion2: toInt32Array(rawTopology.portAngleForRegion2),
    portX: toFloat64Array(rawTopology.portX),
    portY: toFloat64Array(rawTopology.portY),
    portZ: toInt32Array(rawTopology.portZ),
    regionVertexStart: toInt32Array(rawTopology.regionVertexStart),
    regionVertexCount: toInt32Array(rawTopology.regionVertexCount),
    regionVertexX: toFloat64Array(rawTopology.regionVertexX),
    regionVertexY: toFloat64Array(rawTopology.regionVertexY),
    regionArea: toFloat64Array(rawTopology.regionArea),
    regionPerimeter: toFloat64Array(rawTopology.regionPerimeter),
    regionBoundsMinX: toFloat64Array(rawTopology.regionBoundsMinX),
    regionBoundsMaxX: toFloat64Array(rawTopology.regionBoundsMaxX),
    regionBoundsMinY: toFloat64Array(rawTopology.regionBoundsMinY),
    regionBoundsMaxY: toFloat64Array(rawTopology.regionBoundsMaxY),
    portBoundaryPositionForRegion1: toInt32Array(
      rawTopology.portBoundaryPositionForRegion1,
    ),
    portBoundaryPositionForRegion2: toInt32Array(
      rawTopology.portBoundaryPositionForRegion2,
    ),
    portEdgeIndexForRegion1: toInt32Array(rawTopology.portEdgeIndexForRegion1),
    portEdgeIndexForRegion2: toInt32Array(rawTopology.portEdgeIndexForRegion2),
    portEdgeTForRegion1: toFloat64Array(rawTopology.portEdgeTForRegion1),
    portEdgeTForRegion2: toFloat64Array(rawTopology.portEdgeTForRegion2),
  }) as PolyHyperGraphTopology

const createProblem = (): PolyHyperGraphProblem =>
  ({
    ...rawProblem,
    portSectionMask: toInt8Array(rawProblem.portSectionMask),
    routeStartPort: toInt32Array(rawProblem.routeStartPort),
    routeEndPort: toInt32Array(rawProblem.routeEndPort),
    routeNet: toInt32Array(rawProblem.routeNet),
    regionNetId: toInt32Array(rawProblem.regionNetId),
  }) as PolyHyperGraphProblem

const createSolver = (): BaseSolver =>
  new PolyHyperGraphSolver(
    createTopology(),
    createProblem(),
    rawOptions as PolyHyperGraphSolverOptions,
  )

export default function PolyExample01Page() {
  return <GenericSolverDebugger createSolver={createSolver} />
}
