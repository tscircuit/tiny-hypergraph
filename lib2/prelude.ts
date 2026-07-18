/** A typed success or expected-failure result. */
export type Result<T, E extends Error> =
  | { readonly _tag: "ok"; readonly value: T }
  | { readonly _tag: "err"; readonly error: E }

/**
 * Create a successful result.
 *
 * @template T - Success value type.
 * @param value - The successful value.
 * @returns A tagged success result.
 */
export function ok<T>(value: T): Result<T, never> {
  return { _tag: "ok", value }
}

/**
 * Create a failed result.
 *
 * @template E - Expected error type.
 * @param error - The expected error value.
 * @returns A tagged error result.
 */
export function err<E extends Error>(error: E): Result<never, E> {
  return { _tag: "err", error }
}

/**
 * Run a function and classify thrown values as an expected error.
 *
 * @template T - Success value type.
 * @template E - Expected error type.
 * @param run - Work that may throw at a legacy boundary.
 * @param mapError - Converts the thrown value into a typed error.
 * @returns A success result or a typed error result.
 */
export function capture<T, E extends Error>(
  run: () => T,
  mapError: (cause: unknown) => E,
): Result<T, E> {
  try {
    return ok(run())
  } catch (cause) {
    return err(mapError(cause))
  }
}

/**
 * Convert an unknown thrown value to a readable message.
 *
 * @param cause - Unknown thrown value.
 * @returns A message safe to expose in test and benchmark output.
 */
export function getErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
