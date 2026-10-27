const leases = new WeakMap<object, Promise<void>>()

/** A persistent job group must reserve enough slots to reach its barriers. */
export async function acquireWorkerRuntime(executor: object): Promise<() => void> {
  const previous = leases.get(executor)
  let release!: () => void
  const lease = new Promise<void>((resolve) => { release = resolve })
  leases.set(executor, lease)
  await previous
  return (): void => {
    release()
    if (leases.get(executor) === lease) leases.delete(executor)
  }
}
