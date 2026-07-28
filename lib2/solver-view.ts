import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
  TinyHyperGraphWorkingState,
} from "./domain"
import type { RegionId } from "./types"

export type TinyHyperGraphSolver2View = {
  readonly topology: TinyHyperGraphTopology
  readonly problem: TinyHyperGraphProblem
  readonly state: TinyHyperGraphWorkingState
  readonly solved: boolean
  readonly failed: boolean
  readonly iterations: number
  getAdditionalRegionLabel(regionId: RegionId): string | undefined
  getNeverSuccessfullyRoutedRoutes(): unknown[]
  getStaticallyUnroutableRoutes(): unknown[]
}
