import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import { enableRegionCostWorker } from "../../lib/index"
enableRegionCostWorker()
SolverRuntime.listen()
