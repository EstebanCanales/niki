export class HermesProbeCache<T> {
  private value: { signature: string; expiresAt: number; result: T } | null = null;
  private pending: { signature: string; promise: Promise<T> } | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  clear() {
    this.value = null;
    this.pending = null;
  }

  async get(signature: string, loader: () => Promise<T>): Promise<T> {
    const current = this.value;
    if (current && current.signature === signature && current.expiresAt > this.now()) {
      return current.result;
    }

    if (this.pending && this.pending.signature === signature) {
      return this.pending.promise;
    }

    const promise = loader()
      .then((result) => {
        this.value = {
          signature,
          expiresAt: this.now() + this.ttlMs,
          result,
        };
        return result;
      })
      .finally(() => {
        if (this.pending?.signature === signature) {
          this.pending = null;
        }
      });

    this.pending = { signature, promise };
    return promise;
  }
}
