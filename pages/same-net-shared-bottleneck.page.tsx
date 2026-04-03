import { Debugger } from "./components/Debugger"
import { sameNetSharedBottleneckFixture } from "../tests/fixtures/same-net-shared-bottleneck.fixture"

export default function SameNetSharedBottleneckPage() {
  return (
    <Debugger serializedHyperGraph={sameNetSharedBottleneckFixture} />
  )
}
