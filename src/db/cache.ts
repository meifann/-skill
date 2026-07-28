/**
 * Simple TTL cache for read queries.
 * Prevents identical queries from hitting the DB when multiple agents
 * ask for the same category/product intelligence within a short window.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

const DEFAULT_TTL_MS = 2 * 60 * 1000; // 2 minutes
const MAX_ENTRIES = 1000;

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.data as T;
}

export function cacheSet<T>(key: string, data: T, ttlMs = DEFAULT_TTL_MS): void {
  // Evict expired entries if we're at capacity
  if (store.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of store) {
      if (now > v.expiresAt) store.delete(k);
    }
    // If still at capacity, evict oldest
    if (store.size >= MAX_ENTRIES) {
      const firstKey = store.keys().next().value;
      if (firstKey) store.delete(firstKey);
    }
  }

  store.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

export function cacheClear(): void {
  store.clear();
}

/**
 * Helper: wrap an async function with caching.
 * Usage: const cachedFn = cached("prefix", originalFn, 60000);
 */
export function cached<TArgs extends unknown[], TResult>(
  prefix: string,
  fn: (...args: TArgs) => Promise<TResult>,
  ttlMs = DEFAULT_TTL_MS
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const key = `${prefix}:${JSON.stringify(args)}`;
    const hit = cacheGet<TResult>(key);
    if (hit !== undefined) return hit;
    const result = await fn(...args);
    cacheSet(key, result, ttlMs);
    return result;
  };
}
