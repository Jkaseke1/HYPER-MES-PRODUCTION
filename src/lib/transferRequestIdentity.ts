type RequestIdentity = { fingerprint: string; key: string };

export function transferRequestIdentity(previous: RequestIdentity | null, payload: unknown, createKey: () => string): RequestIdentity {
  const fingerprint = JSON.stringify(payload);
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, key: createKey() };
}
