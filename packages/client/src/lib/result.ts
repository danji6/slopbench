import { extractErrorMessage } from './errors'
import { toast } from './notifications'
import { isClient } from './utils'

export class AsyncResult<T, E> implements PromiseLike<Result<T, E>> {
  constructor(private readonly _promise: Promise<Result<T, E>>) {}

  // biome-ignore lint/suspicious/noThenProperty: override
  then<Fullfilled = Result<T, E>, Rejected = never>(
    onfulfilled?:
      | ((value: Result<T, E>) => Fullfilled | PromiseLike<Fullfilled>)
      | null,
    onrejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null,
  ): PromiseLike<Fullfilled | Rejected> {
    return this._promise.then(onfulfilled, onrejected)
  }

  async catch(callback?: (error: E | null) => unknown): Promise<Result<T, E>> {
    const result = await this._promise
    return result.catch(callback)
  }

  async catchOr(callback: (error: E | null) => T): Promise<T> {
    const result = await this._promise
    return result.catchOr(callback)
  }
}

export class Result<T, E = unknown> {
  private constructor(
    private readonly _value: T | null,
    private readonly _error: E | null,
    private readonly _isOk: boolean,
  ) {}

  static ok<T>(value: T): Result<T, never> {
    return new Result(value, null, true) as unknown as Result<T, never>
  }

  static err<E>(error: E): Result<never, E> {
    return new Result(null, error, false) as unknown as Result<never, E>
  }

  static from<T>(promise: Promise<T>): AsyncResult<T, unknown>
  static from<T>(fn: () => Promise<T>): AsyncResult<T, unknown>
  static from<T>(fn: () => T): Result<T, unknown>
  static from<T>(
    operation: Promise<T> | (() => T | Promise<T>),
  ): Result<T, unknown> | AsyncResult<T, unknown> {
    if (operation instanceof Promise) {
      return new AsyncResult(
        operation.then(Result.ok).catch((error) => Result.err(error)),
      )
    }

    try {
      const value = operation()
      if (value instanceof Promise) {
        return new AsyncResult(
          value.then(Result.ok).catch((error) => Result.err(error)),
        )
      }
      return Result.ok(value as T)
    } catch (error) {
      return Result.err(error)
    }
  }

  isOk(): this is Result<T, never> {
    return this._isOk
  }

  isErr(): this is Result<never, E> {
    return !this._isOk
  }

  unwrap(): T {
    if (this.isErr()) {
      throw this._error
    }
    return this._value as T
  }

  unwrapOr(callback: (error: E | null) => T): T {
    return this.isOk() ? (this._value as T) : callback(this._error)
  }

  catch(callback?: (error: E | null) => unknown): Result<T, E> {
    if (this.isErr()) {
      if (callback) {
        callback(this._error)
      } else {
        this.notifyError()
      }
    }
    return this
  }

  catchOr(callback: (error: E | null) => T): T {
    if (this.isOk()) {
      return callback(this._error)
    }

    this.notifyError()
    return this._value as T
  }

  errorMessage() {
    return extractErrorMessage(this._error)
  }

  notifyError() {
    console.error(this._error)

    if (isClient) {
      toast.error(this.errorMessage())
    }
  }
}
