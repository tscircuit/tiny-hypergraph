import { availableParallelism } from "node:os"
import { Worker } from "node:worker_threads"
import type { WorkerRequest } from "./protocol"

export const validateWorkerCount = (count: number) => {
  if (!Number.isSafeInteger(count) || count < 1)
    throw new Error("workers must be a positive integer")
  return count
}

export const defaultWorkerCount = () => availableParallelism()

class WorkerSlot {
  worker = new Worker(new URL("./solver-worker.ts", import.meta.url))
  pending?: { resolve: (value: any) => void; reject: (error: Error) => void }
  failure?: Error

  constructor() {
    this.worker.on("message", (message) => {
      const pending = this.pending
      this.pending = undefined
      if (message.error) pending?.reject(new Error(message.error))
      else pending?.resolve(message.value)
    })
    this.worker.on("error", (error) =>
      this.fail(error instanceof Error ? error : new Error(String(error))),
    )
    this.worker.on("exit", (code) =>
      this.fail(new Error(`Solver worker exited (${code})`)),
    )
  }

  fail(error: Error) {
    this.failure = error
    this.pending?.reject(error)
    this.pending = undefined
  }

  run<T>(request: WorkerRequest): Promise<T> {
    if (this.failure) return Promise.reject(this.failure)
    if (this.pending)
      return Promise.reject(new Error("Solver worker is already busy"))
    return new Promise<T>((resolve, reject) => {
      this.pending = { resolve, reject }
      try {
        this.worker.postMessage(request)
      } catch (error) {
        this.pending = undefined
        reject(error)
      }
    })
  }
}

export class WorkerPool {
  slots: WorkerSlot[]
  constructor(count: number) {
    this.slots = []
    try {
      for (let index = 0; index < validateWorkerCount(count); index++) {
        this.slots.push(new WorkerSlot())
      }
    } catch (error) {
      for (const slot of this.slots) void slot.worker.terminate()
      throw error
    }
  }
  async close() {
    await Promise.all(
      this.slots.map((slot) => {
        slot.fail(new Error("Solver worker pool closed"))
        return slot.worker.terminate()
      }),
    )
  }
}
