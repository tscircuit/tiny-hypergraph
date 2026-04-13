import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { visualizeTinyGraph } from "../visualizeTinyGraph"
import {
  createBusReplaySolver,
  createBusTracePolyline,
  sampleBusTracePolylineAtProgress,
  type TinyHyperGraphBusBaselineStageOutput,
  type TinyHyperGraphBusCenterlinePoint,
  type TinyHyperGraphBusRouterPipelineOutput,
  type TinyHyperGraphBusTracePolyline,
} from "./common"

const CENTERLINE_STROKE = "rgba(17, 24, 39, 0.95)"
const CENTERLINE_POINT_COLOR = "rgba(245, 158, 11, 0.95)"

const getBaselinePathColor = (
  connectionId: string,
  routeIndex: number,
  alpha = 0.9,
) => {
  const hashSource = `${routeIndex}:${connectionId}`
  let hash = 0

  for (let i = 0; i < hashSource.length; i++) {
    hash = hashSource.charCodeAt(i) * 17777 + ((hash << 5) - hash)
  }

  const hue = Math.abs(hash) % 360
  return `hsla(${hue}, 72%, 48%, ${alpha})`
}

export class TinyHyperGraphBusCenterlineSolver extends BaseSolver {
  tracePolylines: TinyHyperGraphBusTracePolyline[] = []
  centerlinePath: TinyHyperGraphBusCenterlinePoint[] = []
  replaySolver?: ReturnType<typeof createBusReplaySolver>
  computedSegmentCount = 0

  constructor(
    readonly baselineStageOutput: TinyHyperGraphBusBaselineStageOutput,
    readonly centerlineSegmentCount = 20,
  ) {
    super()
  }

  computeCenterlinePoint(progress: number): TinyHyperGraphBusCenterlinePoint {
    let sumX = 0
    let sumY = 0

    for (const tracePolyline of this.tracePolylines) {
      const sampledPoint = sampleBusTracePolylineAtProgress(
        tracePolyline,
        progress,
      )
      sumX += sampledPoint.x
      sumY += sampledPoint.y
    }

    return {
      x: sumX / this.tracePolylines.length,
      y: sumY / this.tracePolylines.length,
    }
  }

  getReplaySolver() {
    if (!this.replaySolver) {
      this.replaySolver = createBusReplaySolver(
        this.baselineStageOutput.serializedHyperGraph,
      )
    }

    return this.replaySolver
  }

  override _setup() {
    if (this.centerlineSegmentCount <= 0) {
      this.failed = true
      this.error = "Bus centerline segment count must be greater than zero"
      return
    }

    if (this.baselineStageOutput.baselineNoIntersectionCostPaths.length === 0) {
      this.failed = true
      this.error = "Bus baseline stage did not produce any routed paths"
      return
    }

    this.tracePolylines =
      this.baselineStageOutput.baselineNoIntersectionCostPaths.map(
        createBusTracePolyline,
      )
    void this.getReplaySolver()
    this.centerlinePath = [this.computeCenterlinePoint(0)]
    this.stats = {
      ...this.stats,
      centerlineSegmentCountTarget: this.centerlineSegmentCount,
      routedTraceCount: this.tracePolylines.length,
      centerlineSegmentsComplete: 0,
    }
  }

  override _step() {
    if (this.failed) {
      return
    }

    if (this.computedSegmentCount >= this.centerlineSegmentCount) {
      this.solved = true
      return
    }

    this.computedSegmentCount += 1
    this.centerlinePath.push(
      this.computeCenterlinePoint(
        this.computedSegmentCount / this.centerlineSegmentCount,
      ),
    )
    this.stats = {
      ...this.stats,
      centerlineSegmentsComplete: this.computedSegmentCount,
    }

    if (this.computedSegmentCount >= this.centerlineSegmentCount) {
      this.solved = true
    }
  }

  override visualize(): GraphicsObject {
    const graphics = visualizeTinyGraph(this.getReplaySolver(), {
      showInitialRouteHints: false,
    })
    const lines = graphics.lines ?? (graphics.lines = [])
    const points = graphics.points ?? (graphics.points = [])

    for (const tracePath of this.baselineStageOutput
      .baselineNoIntersectionCostPaths) {
      lines.push({
        points: tracePath.points.map((point) => ({
          x: point.x,
          y: point.y,
        })),
        strokeColor: getBaselinePathColor(
          tracePath.connectionId,
          tracePath.routeIndex,
        ),
        strokeDash: "3 2",
        label: [
          "baseline no intersection path",
          `connection=${tracePath.connectionId}`,
          `routeIndex=${tracePath.routeIndex}`,
          `points=${tracePath.points.length}`,
        ].join(" | "),
      })
    }

    if (this.centerlinePath.length >= 2) {
      lines.push({
        points: this.centerlinePath,
        strokeColor: CENTERLINE_STROKE,
        strokeDash: "6 3",
        label: `bus centerline (${this.baselineStageOutput.busId})`,
      })
    }

    this.centerlinePath.forEach((point, pointIndex) => {
      points.push({
        x: point.x,
        y: point.y,
        color: CENTERLINE_POINT_COLOR,
        label: `centerline sample ${pointIndex}/${this.centerlineSegmentCount}`,
      })
    })

    graphics.title = [
      "Bus Centerline",
      `bus=${this.baselineStageOutput.busId}`,
      `segments=${Math.max(this.centerlinePath.length - 1, 0)}/${this.centerlineSegmentCount}`,
      this.failed ? "failed" : this.solved ? "solved" : "running",
    ].join(" | ")

    return graphics
  }

  override getOutput(): TinyHyperGraphBusRouterPipelineOutput | null {
    if (this.centerlinePath.length === 0) {
      return null
    }

    return {
      ...this.baselineStageOutput,
      centerlinePath: [...this.centerlinePath],
      centerlineSegmentCount: this.centerlineSegmentCount,
    }
  }
}
