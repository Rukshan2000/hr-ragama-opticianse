import { randomUUID } from 'node:crypto';
import { db, withTransaction, type DbExecutor } from '../../database/knex';
import { PERMISSIONS as P, type Permission } from '../../shared/constants/permissions';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors/app-error';
import type { AuthContext } from '../../shared/types/auth';
import { detectFileType, storage } from '../../shared/utils/storage';
import { requireTenantId, tenantScope } from '../../shared/utils/tenant-scope';
import { audit } from '../hr-common/audit';
import { canAccessEmployee, findMyEmployee } from '../hr-common/me';

/** What a file is for decides who may upload and read it. */
export const FILE_PURPOSES = {
  document: { read: P.DOCUMENTS_READ, write: P.DOCUMENTS_MANAGE },
  photo: { read: P.EMPLOYEES_READ, write: P.DOCUMENTS_MANAGE },
  contract: { read: P.CONTRACTS_READ, write: P.CONTRACTS_MANAGE },
  cv: { read: P.RECRUITMENT_READ, write: P.RECRUITMENT_MANAGE },
  receipt: { read: P.EXPENSES_READ, write: P.EXPENSES_MANAGE },
  certificate: { read: P.TRAINING_READ, write: P.TRAINING_MANAGE },
} as const satisfies Record<string, { read: Permission; write: Permission }>;
export type FilePurpose = keyof typeof FILE_PURPOSES;
/** Purposes an employee may upload for themselves through self-service. */
const SELF_UPLOAD: FilePurpose[] = ['document', 'photo', 'receipt', 'certificate'];

export interface FileRow {
  id: string;
  tenant_id: string;
  object_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  purpose: FilePurpose;
  uploaded_by: string | null;
  employee_id: string | null;
  created_at: Date;
}

export const toFileDto = (f: FileRow) => ({
  id: f.id,
  name: f.original_name,
  mimeType: f.mime_type,
  size: f.size_bytes,
  purpose: f.purpose,
  createdAt: f.created_at,
});

const safeName = (n: string) => n.replace(/[^\w.\- ()]/g, '_').slice(0, 200) || 'file';

export const filesService = {
  /**
   * Validates extension + magic bytes + size, stores the object privately, records metadata.
   * Self-service uploads are always attributed to the uploader's own employee record.
   */
  async upload(
    auth: AuthContext,
    input: { filename: string; purpose: FilePurpose; employeeId?: string; data: Buffer },
  ) {
    const tenantId = requireTenantId(auth);
    const spec = FILE_PURPOSES[input.purpose];
    let employeeId = input.employeeId ?? null;
    if (!auth.permissions.has(spec.write)) {
      const me = await findMyEmployee(auth);
      if (!me || !SELF_UPLOAD.includes(input.purpose) || !auth.permissions.has(P.SELF_SERVICE))
        throw new ForbiddenError();
      if (employeeId && employeeId !== me.id) throw new ForbiddenError();
      employeeId = me.id;
    } else if (
      employeeId &&
      !(await tenantScope(db, 'employees', tenantId).where({ id: employeeId }).first('id'))
    ) {
      throw new BadRequestError('Unknown employee');
    }
    const mime = detectFileType(input.filename, input.data);
    if (!mime)
      throw new BadRequestError(
        'Unsupported file type. Allowed: PDF, PNG, JPG, WEBP, DOC, DOCX, XLSX, TXT, CSV',
      );
    if (input.purpose === 'photo' && !mime.startsWith('image/'))
      throw new BadRequestError('A profile photo must be an image');

    const id = randomUUID();
    const key = `${tenantId}/${input.purpose}/${id}`;
    await storage.put(key, input.data, mime);
    try {
      const [row] = await db('files')
        .insert({
          id,
          tenant_id: tenantId,
          object_key: key,
          original_name: safeName(input.filename),
          mime_type: mime,
          size_bytes: input.data.length,
          purpose: input.purpose,
          uploaded_by: auth.userId,
          employee_id: employeeId,
        })
        .returning<FileRow[]>('*');
      return toFileDto(row!);
    } catch (e) {
      await storage.remove(key).catch(() => undefined);
      throw e;
    }
  },

  /** Read authorization: purpose permission, own/managed employee's file, or the uploader. */
  async authorize(auth: AuthContext, id: string, ex: DbExecutor = db) {
    const f = (await tenantScope(ex, 'files', requireTenantId(auth)).where({ id }).first()) as
      FileRow | undefined;
    if (!f) throw new NotFoundError('File');
    const perm = FILE_PURPOSES[f.purpose]?.read;
    const ok =
      f.uploaded_by === auth.userId ||
      (perm && auth.permissions.has(perm)) ||
      (f.employee_id &&
        (await canAccessEmployee(auth, f.employee_id, perm ?? P.DOCUMENTS_READ, {
          allowManager: f.purpose === 'photo',
        })));
    if (!ok) throw new NotFoundError('File'); // 404, never reveal existence
    return f;
  },

  async download(auth: AuthContext, id: string) {
    const f = await filesService.authorize(auth, id);
    return { file: f, data: await storage.get(f.object_key) };
  },

  /** Asserts a file id is usable as an attachment for this purpose (uploaded in this tenant). */
  async assertAttachable(auth: AuthContext, id: string, purpose: FilePurpose, ex: DbExecutor = db) {
    const f = await filesService.authorize(auth, id, ex);
    if (f.purpose !== purpose)
      throw new BadRequestError(`The file was not uploaded as a ${purpose}`);
    return f;
  },

  async remove(trx: DbExecutor, auth: AuthContext, id: string) {
    const f = (await tenantScope(trx, 'files', requireTenantId(auth)).where({ id }).first()) as
      FileRow | undefined;
    if (!f) return;
    await tenantScope(trx, 'files', requireTenantId(auth)).where({ id }).delete();
    await audit(trx, auth, 'file.delete', 'files', id, { name: f.original_name });
    await storage.remove(f.object_key).catch(() => undefined);
  },
};

/* ── Employee documents & photo ─────────────────────────────── */

const docQuery = (tenantId: string) =>
  tenantScope(db, 'employee_documents as d', tenantId)
    .join('files as f', 'f.id', 'd.file_id')
    .join('employees as e', 'e.id', 'd.employee_id')
    .whereNull('e.deleted_at')
    .select(
      'd.id',
      'd.employee_id as employeeId',
      db.raw(`e.first_name || ' ' || e.last_name as "employeeName"`),
      'e.employee_number as employeeNumber',
      'd.category',
      'd.title',
      'd.expiry_date as expiryDate',
      'd.notes',
      'd.created_at as createdAt',
      'f.id as fileId',
      'f.original_name as fileName',
      'f.mime_type as mimeType',
      'f.size_bytes as size',
    );

export const documentsService = {
  async listAll(
    auth: AuthContext,
    q: { search?: string; category?: string; expiringWithinDays?: number },
  ) {
    const tenantId = requireTenantId(auth);
    return docQuery(tenantId)
      .modify((b) => {
        if (q.category) b.where('d.category', q.category);
        if (q.search)
          b.where((w) =>
            w
              .whereILike('d.title', `%${q.search}%`)
              .orWhereRaw(`(e.first_name || ' ' || e.last_name) ILIKE ?`, [`%${q.search}%`])
              .orWhereILike('e.employee_number', `%${q.search}%`),
          );
        if (q.expiringWithinDays !== undefined)
          b.whereNotNull('d.expiry_date').whereRaw(`d.expiry_date <= CURRENT_DATE + ?::int`, [
            q.expiringWithinDays,
          ]);
      })
      .orderBy('d.created_at', 'desc')
      .limit(500);
  },

  async list(auth: AuthContext, employeeId: string) {
    if (!(await canAccessEmployee(auth, employeeId, P.DOCUMENTS_READ, { allowManager: false })))
      throw new NotFoundError('Employee');
    return docQuery(requireTenantId(auth))
      .where('d.employee_id', employeeId)
      .orderBy('d.created_at', 'desc');
  },

  async create(
    auth: AuthContext,
    employeeId: string,
    input: {
      fileId: string;
      category: string;
      title: string;
      expiryDate?: string | null;
      notes?: string | null;
    },
  ) {
    const tenantId = requireTenantId(auth);
    const self = !auth.permissions.has(P.DOCUMENTS_MANAGE);
    if (self && (await findMyEmployee(auth))?.id !== employeeId) throw new ForbiddenError();
    if (
      !(await tenantScope(db, 'employees', tenantId)
        .whereNull('deleted_at')
        .where({ id: employeeId })
        .first('id'))
    )
      throw new NotFoundError('Employee');
    const id = await withTransaction(async (trx) => {
      const f = await filesService.assertAttachable(auth, input.fileId, 'document', trx);
      if (f.employee_id && f.employee_id !== employeeId)
        throw new BadRequestError('The file belongs to another employee');
      await trx('files').where({ id: f.id }).update({ employee_id: employeeId });
      const [d] = await trx('employee_documents')
        .insert({
          tenant_id: tenantId,
          employee_id: employeeId,
          file_id: input.fileId,
          category: input.category,
          title: input.title,
          expiry_date: input.expiryDate ?? null,
          notes: input.notes ?? null,
          created_by: auth.userId,
        })
        .returning('id');
      await audit(trx, auth, 'document.upload', 'employee_documents', d.id, {
        employeeId,
        title: input.title,
      });
      return d.id as string;
    });
    return docQuery(tenantId).where('d.id', id).first();
  },

  async remove(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const d = await tenantScope(trx, 'employee_documents', tenantId)
        .where({ id })
        .forUpdate()
        .first();
      if (!d) throw new NotFoundError('Document');
      await tenantScope(trx, 'employee_documents', tenantId).where({ id }).delete();
      await filesService.remove(trx, auth, d.file_id);
      await audit(trx, auth, 'document.delete', 'employee_documents', id, {
        employeeId: d.employee_id,
        title: d.title,
      });
    });
  },

  /** Sets or clears the profile photo; the previous photo object is deleted. */
  async setPhoto(auth: AuthContext, employeeId: string, fileId: string | null) {
    const tenantId = requireTenantId(auth);
    const self = !auth.permissions.has(P.DOCUMENTS_MANAGE);
    if (self && (await findMyEmployee(auth))?.id !== employeeId) throw new ForbiddenError();
    await withTransaction(async (trx) => {
      const e = await tenantScope(trx, 'employees', tenantId)
        .whereNull('deleted_at')
        .where({ id: employeeId })
        .forUpdate()
        .first('photo_file_id');
      if (!e) throw new NotFoundError('Employee');
      if (fileId) {
        await filesService.assertAttachable(auth, fileId, 'photo', trx);
        await trx('files').where({ id: fileId }).update({ employee_id: employeeId });
      }
      await tenantScope(trx, 'employees', tenantId)
        .where({ id: employeeId })
        .update({ photo_file_id: fileId });
      if (e.photo_file_id && e.photo_file_id !== fileId)
        await filesService.remove(trx, auth, e.photo_file_id);
    });
    return { photoFileId: fileId };
  },
};
