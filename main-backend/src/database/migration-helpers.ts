import type { Knex } from 'knex';

/** Conventions shared by every migration. Changing these never alters applied migrations' history. */
export function primaryUuid(knex: Knex, table: Knex.CreateTableBuilder): void {
  table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
}

export function timestamps(knex: Knex, table: Knex.CreateTableBuilder): void {
  table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
}

export function softDelete(table: Knex.CreateTableBuilder): void {
  table.timestamp('deleted_at', { useTz: true }).nullable();
}

/** Keeps updated_at correct even for writes that bypass the application. */
export function updatedAtTrigger(knex: Knex, tableName: string): Knex.Raw {
  return knex.raw(
    `CREATE TRIGGER ?? BEFORE UPDATE ON ?? FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
    [`trg_${tableName}_updated_at`, tableName],
  );
}

/**
 * Standard tenant-owned table: uuid id, tenant_id (cascade), timestamps, updated_at trigger,
 * and UNIQUE(tenant_id, id) so children can use composite FKs that cannot cross tenants.
 */
export async function tenantTable(
  knex: Knex,
  name: string,
  build: (t: Knex.CreateTableBuilder) => void,
  opts: { soft?: boolean; updatedAt?: boolean } = {},
): Promise<void> {
  const withUpdated = opts.updatedAt !== false;
  await knex.schema.createTable(name, (t) => {
    primaryUuid(knex, t);
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.unique(['tenant_id', 'id']); // before build() so self-references can target it
    build(t);
    if (withUpdated) timestamps(knex, t);
    else t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    if (opts.soft) softDelete(t);
  });
  if (withUpdated) await updatedAtTrigger(knex, name);
}

/** Tenant-safe reference: (tenant_id, column) → (tenant_id, id) of `table`. */
export function tenantRef(
  t: Knex.CreateTableBuilder,
  column: string,
  table: string,
  onDelete: 'CASCADE' | 'RESTRICT' | 'SET NULL' = 'RESTRICT',
  nullable = false,
): void {
  const c = t.uuid(column);
  if (nullable) c.nullable();
  else c.notNullable();
  // SET NULL on a composite key would also null tenant_id, so only the column is cleared.
  t.foreign(['tenant_id', column])
    .references(['tenant_id', 'id'])
    .inTable(table)
    .onDelete((onDelete === 'SET NULL' ? `SET NULL (${column})` : onDelete) as 'CASCADE');
  t.index(['tenant_id', column]);
}

export const sqlList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(',');
