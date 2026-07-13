export function getParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function getQuery<T>(query: unknown): T {
  return query as T;
}
