import { db, type DbExecutor } from '../../database/knex';
import { NotFoundError } from '../../shared/errors/app-error';
import type { AuthContext } from '../../shared/types/auth';
import { sendNotificationEmail } from '../../shared/utils/mailer';
import { requireTenantId, tenantScope } from '../../shared/utils/tenant-scope';

export const NOTIFICATION_TYPES = [
  'approval_pending',
  'approval_decided',
  'leave',
  'attendance',
  'payroll',
  'contract_expiry',
  'probation_end',
  'onboarding',
  'asset',
  'expense',
  'exit',
  'announcement',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotifyInput {
  tenantId: string;
  userIds: (string | null | undefined)[];
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  /** Same key for the same user = same notification; repeats are ignored. */
  dedupeKey: string;
}

const repo = {
  /** Inserts, skipping duplicates and users who muted the type in-app. Returns inserted user ids. */
  async insert(n: NotifyInput, userIds: string[], ex: DbExecutor) {
    const muted = new Set(
      (
        await ex('notification_preferences')
          .where({ tenant_id: n.tenantId, type: n.type, in_app: false })
          .whereIn('user_id', userIds)
          .select('user_id')
      ).map((r) => r.user_id as string),
    );
    const rows = userIds
      .filter((u) => !muted.has(u))
      .map((user_id) => ({
        tenant_id: n.tenantId,
        user_id,
        type: n.type,
        title: n.title,
        body: n.body ?? null,
        link: n.link ?? null,
        dedupe_key: n.dedupeKey,
      }));
    if (!rows.length) return [];
    return (
      await ex('notifications')
        .insert(rows)
        .onConflict(['tenant_id', 'user_id', 'dedupe_key'])
        .ignore()
        .returning<{ user_id: string }[]>('user_id')
    ).map((r) => r.user_id);
  },
  emailRecipients(tenantId: string, type: string, userIds: string[]) {
    return db('notification_preferences as p')
      .join('users as u', 'u.id', 'p.user_id')
      .where({ 'p.tenant_id': tenantId, 'p.type': type, 'p.email': true })
      .whereIn('p.user_id', userIds)
      .pluck('u.email') as Promise<string[]>;
  },
};

/**
 * Reusable notification fan-out: in-app rows (deduplicated by key) plus email for users who
 * opted in. Email is sent after the insert succeeds and never fails the caller.
 */
export async function notify(n: NotifyInput, ex: DbExecutor = db): Promise<void> {
  const userIds = [...new Set(n.userIds.filter((u): u is string => Boolean(u)))];
  if (!userIds.length) return;
  const inserted = await repo.insert(n, userIds, ex);
  if (!inserted.length) return;
  const send = async () => {
    for (const to of await repo.emailRecipients(n.tenantId, n.type, inserted))
      await sendNotificationEmail(to, n.title, n.body ?? '');
  };
  // Inside a transaction the preference rows are visible already; email is best-effort.
  void send().catch(() => undefined);
}

/** Users of a tenant holding a permission (active memberships only). */
export function usersWithPermission(tenantId: string, permission: string, ex: DbExecutor = db) {
  return ex('user_roles as ur')
    .join('roles as r', 'r.id', 'ur.role_id')
    .join('role_permissions as rp', 'rp.role_id', 'r.id')
    .join('permissions as p', 'p.id', 'rp.permission_id')
    .join('tenant_memberships as m', function () {
      this.on('m.user_id', 'ur.user_id').andOn('m.tenant_id', 'r.tenant_id');
    })
    .where({ 'r.tenant_id': tenantId, 'p.key': permission, 'm.is_active': true })
    .distinct()
    .pluck('ur.user_id') as Promise<string[]>;
}

export const notificationsService = {
  async list(auth: AuthContext, q: { unread?: boolean; limit: number }) {
    const tenantId = requireTenantId(auth);
    const base = tenantScope(db, 'notifications', tenantId).where({ user_id: auth.userId });
    const [items, unread] = await Promise.all([
      base
        .clone()
        .modify((b) => q.unread && b.whereNull('read_at'))
        .orderBy('created_at', 'desc')
        .limit(q.limit)
        .select(
          'id',
          'type',
          'title',
          'body',
          'link',
          'read_at as readAt',
          'created_at as createdAt',
        ),
      base.clone().whereNull('read_at').count<{ count: string }[]>({ count: '*' }).first(),
    ]);
    return { items, unread: Number(unread?.count ?? 0) };
  },
  async markRead(auth: AuthContext, id: string) {
    const n = await tenantScope(db, 'notifications', requireTenantId(auth))
      .where({ id, user_id: auth.userId })
      .update({ read_at: db.raw('COALESCE(read_at, now())') });
    if (!n) throw new NotFoundError('Notification');
  },
  async markAllRead(auth: AuthContext) {
    await tenantScope(db, 'notifications', requireTenantId(auth))
      .where({ user_id: auth.userId })
      .whereNull('read_at')
      .update({ read_at: db.fn.now() });
  },
  async preferences(auth: AuthContext) {
    const rows = await db('notification_preferences')
      .where({ tenant_id: requireTenantId(auth), user_id: auth.userId })
      .select('type', 'in_app', 'email');
    const byType = new Map(rows.map((r) => [r.type as string, r]));
    return NOTIFICATION_TYPES.map((type) => ({
      type,
      inApp: byType.get(type)?.in_app ?? true,
      email: byType.get(type)?.email ?? false,
    }));
  },
  async setPreferences(
    auth: AuthContext,
    prefs: { type: NotificationType; inApp: boolean; email: boolean }[],
  ) {
    const tenant_id = requireTenantId(auth);
    if (prefs.length)
      await db('notification_preferences')
        .insert(
          prefs.map((p) => ({
            tenant_id,
            user_id: auth.userId,
            type: p.type,
            in_app: p.inApp,
            email: p.email,
          })),
        )
        .onConflict(['tenant_id', 'user_id', 'type'])
        .merge(['in_app', 'email']);
    return notificationsService.preferences(auth);
  },
};
