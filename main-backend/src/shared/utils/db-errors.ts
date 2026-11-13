/** Postgres unique_violation, raised e.g. on duplicate email/slug under concurrency. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/** Postgres foreign_key_violation: referenced row missing, or row still referenced (RESTRICT). */
export function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23503';
}

/** Postgres check_violation. */
export function isCheckViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23514';
}
