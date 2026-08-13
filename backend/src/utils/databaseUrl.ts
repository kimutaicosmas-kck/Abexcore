/** Append Prisma MySQL pool params when not already present in DATABASE_URL. */
export function applyDatabasePoolParams(
  databaseUrl: string,
  opts: { connectionLimit: number; poolTimeout: number; connectTimeout: number }
): string {
  const [base, query = ''] = databaseUrl.split('?');
  const params = new URLSearchParams(query);

  const set = (key: string, value: number) => {
    if (!params.has(key)) params.set(key, String(value));
  };

  set('connection_limit', opts.connectionLimit);
  set('pool_timeout', opts.poolTimeout);
  set('connect_timeout', opts.connectTimeout);

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
