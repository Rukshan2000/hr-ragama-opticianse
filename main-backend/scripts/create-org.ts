import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

// Interactive: creates an organization and its Admin user (replaces self sign-up).
async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const target = (await rl.question('Target — (l)ocal or (s)erver? [l]: ')).trim().toLowerCase();
  // Config reads ENV_FILE at import time, so pick it before loading app modules.
  process.env.ENV_FILE = target.startsWith('s') ? '.env.production' : '.env';
  if (!existsSync(process.env.ENV_FILE)) {
    rl.close();
    throw new Error(`${process.env.ENV_FILE} not found in ${process.cwd()}`);
  }
  console.log(`Using ${process.env.ENV_FILE}`);
  const { appConfig } = await import('../src/config/app.config');
  const { registerBody } = await import('../src/modules/auth/auth.schema');
  const { authService } = await import('../src/modules/auth/auth.service');
  const organizationName = appConfig.tenancy.single
    ? undefined
    : await rl.question('Organization name: ');
  const name = await rl.question('Admin full name: ');
  const email = await rl.question('Admin email: ');
  const password = await rl.question('Admin password: ');
  rl.close();

  const parsed = registerBody.safeParse({ organizationName, name, email, password });
  if (!parsed.success) {
    for (const i of parsed.error.issues) console.error(`✗ ${i.path.join('.')}: ${i.message}`);
    process.exitCode = 1;
    return;
  }
  const res = await authService.register(parsed.data, { userAgent: 'create-org-cli' });
  console.log(`✓ Created "${res.tenant?.name}" (${res.tenant?.slug}) with admin ${parsed.data.email}`);
}

main()
  .catch((err) => {
    console.error('✗', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (process.env.ENV_FILE && existsSync(process.env.ENV_FILE)) await (await import('../src/database/knex')).db.destroy();
  });
