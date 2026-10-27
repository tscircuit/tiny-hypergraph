import {
  createOwnerSearchSession,
  type OwnerSearchMailbox,
} from "./OwnerSearchMailbox"
import { kernelFields } from "./wasm/layout"
import { routeKernelBytes } from "./wasm/kernelBytes"
export type WasmRouteInput = {
  memory: WebAssembly.Memory
  config: number
  owner: number
  stack: number
  ownerMailbox?: OwnerSearchMailbox
}
export type KernelExports = WebAssembly.Exports & {
  __heap_base: WebAssembly.Global
  __stack_pointer: WebAssembly.Global
  run(owner: number, config: number): void
  single(config: number): void
  advance(config: number, chunk: number): number
  finishRoute(config: number): void
  requestConnectivity(config: number): number
  applyConnectivity(config: number): void
  prepare(config: number, route: number, budget: number, delta: number): void
}
let compiled: WebAssembly.Module | undefined
export class WasmRouteTask {
  static readonly solverName = "WasmRouteTask"
  constructor(private readonly input: WasmRouteInput) {}
  solve(): void {
    try {
      this.run()
    } catch (error) {
      const config = new Int32Array(
        this.input.memory.buffer,
        this.input.config,
        kernelFields.length,
      )
      const control = new Int32Array(
        this.input.memory.buffer,
        config[kernelFields.indexOf("CONTROL")],
        16,
      )
      Atomics.store(control, 1, -1)
      Atomics.notify(control, 8)
      Atomics.notify(control, 2)
      const work = new Int32Array(
        this.input.memory.buffer,
        config[kernelFields.indexOf("WORK")],
        8,
      )
      Atomics.notify(work, 1)
      Atomics.notify(work, 3)
      throw error
    }
  }
  private run(): void {
    compiled ??= new WebAssembly.Module(routeKernelBytes)
    const config = new Int32Array(
      this.input.memory.buffer,
      this.input.config,
      kernelFields.length,
    )
    const ownerJob = this.input.ownerMailbox
      ? createOwnerSearchSession(this.input.ownerMailbox, this.input.owner)
      : () => {
          throw new Error("Missing owner search mailbox")
        }
    const exports = new WebAssembly.Instance(compiled, {
      env: { memory: this.input.memory, owner_job: ownerJob },
    }).exports as KernelExports
    exports.__stack_pointer.value = this.input.stack
    exports.run(this.input.owner, this.input.config)
  }
  getOutput(): Record<string, never> {
    return {}
  }
}

/** Allow native pool startup to overlap the caller's graph preparation. */
export class WasmRouteReadyTask {
  static readonly solverName = "WasmRouteReadyTask"
  constructor(_input: Record<string, never>) {}
  solve(): void {}
  getOutput(): Record<string, never> {
    return {}
  }
}
