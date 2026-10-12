const PUBLIC_RETENTION_MS = 30 * 60_000;
const PUBLIC_AVAILABILITY_FRESH_MS = 60_000;
const PERSONAL_RETENTION_MS = 5 * 60_000;

interface StoredValue<T> {
  data: T;
  storedAt: number;
}

export interface PublicCacheValue<T> {
  data: T;
  retained: true;
  structureLive: true;
  availabilityLive: boolean;
}

export interface PersonalCacheValue<T> {
  data: T;
  retained: true;
}

export class ScheduleCache {
  private readonly publicValues = new Map<string, StoredValue<unknown>>();
  private readonly personalValues = new Map<string, Map<string, StoredValue<unknown>>>();

  constructor(private readonly now: () => number = Date.now) {}

  putPublic<T>(key: string, data: T): void {
    this.publicValues.set(key, { data, storedAt: this.now() });
  }

  getPublic<T>(key: string): PublicCacheValue<T> | undefined {
    const stored = this.publicValues.get(key);
    if (!stored) return undefined;

    const age = this.now() - stored.storedAt;
    if (age > PUBLIC_RETENTION_MS) {
      this.publicValues.delete(key);
      return undefined;
    }

    return {
      data: stored.data as T,
      retained: true,
      structureLive: true,
      availabilityLive: age <= PUBLIC_AVAILABILITY_FRESH_MS,
    };
  }

  putPersonal<T>(sessionId: string, key: string, data: T): void {
    let session = this.personalValues.get(sessionId);
    if (!session) {
      session = new Map<string, StoredValue<unknown>>();
      this.personalValues.set(sessionId, session);
    }
    session.set(key, { data, storedAt: this.now() });
  }

  getPersonal<T>(sessionId: string, key: string): PersonalCacheValue<T> | undefined {
    const session = this.personalValues.get(sessionId);
    const stored = session?.get(key);
    if (!stored) return undefined;

    if (this.now() - stored.storedAt > PERSONAL_RETENTION_MS) {
      session?.delete(key);
      if (session?.size === 0) this.personalValues.delete(sessionId);
      return undefined;
    }

    return { data: stored.data as T, retained: true };
  }

  clearPersonal(sessionId: string): void {
    this.personalValues.delete(sessionId);
  }
}
