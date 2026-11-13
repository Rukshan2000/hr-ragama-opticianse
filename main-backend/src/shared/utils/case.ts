/** Flat row <-> DTO key mapping. Inputs are always Zod-parsed allow-lists, so keys are trusted. */
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export function toCamel<T extends object>(row: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v]));
}

/** Drops undefined so PATCH bodies only touch provided fields. */
export function toSnake(input: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [snake(k), v]),
  );
}
