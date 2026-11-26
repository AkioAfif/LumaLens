import { z } from 'zod';

export const Severity = z.enum(['low', 'medium', 'high', 'crash']);
export const Status = z.enum(['open', 'in_progress', 'fixed', 'wontfix']);
export const Source = z.enum(['manual', 'auto']);
export const Engine = z.enum(['unity', 'godot', 'unreal', 'web']);
export const RunContext = z.enum(['editor', 'build']);
export const Platform = z.enum(['windows', 'webgl', 'android', 'linux', 'mac']);
export const CoordSpace = z.enum(['2d', '3d']);

const description = z.string().max(2000);
const buildVersion = z.string().min(1).max(32);

/** POST /bugs body. Strict: unknown keys (including id/createdAt/updatedAt) are rejected. */
export const BugReportCreate = z.strictObject({
  title: z.string().min(1).max(120),
  description: description.optional(),
  severity: Severity,
  status: Status.default('open'),
  source: Source.default('manual'),
  engine: Engine,
  runContext: RunContext,
  buildVersion,
  platform: Platform,
  scene: z.string().max(120).optional(),
  posX: z.number().optional(),
  posY: z.number().optional(),
  posZ: z.number().optional(),
  coordSpace: CoordSpace.optional(),
  envSnapshot: z.record(z.string(), z.unknown()).optional(),
  logKey: z.string().optional(),
  screenshotKey: z.string().optional(),
});
export type BugReportCreate = z.infer<typeof BugReportCreate>;

/** S3 object keys as returned by POST /uploads. */
const screenshotKey = z.string().max(200).startsWith('screenshots/');
const logKey = z.string().max(200).startsWith('logs/');

/**
 * PUT /bugs/{id} body. status, severity, description, and the S3 keys from POST /uploads
 * (screenshotKey, logKey); at least one required.
 */
export const BugReportUpdate = z
  .strictObject({
    status: Status.optional(),
    severity: Severity.optional(),
    description: description.optional(),
    screenshotKey: screenshotKey.optional(),
    logKey: logKey.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one of status, severity, description, screenshotKey, logKey is required',
  });
export type BugReportUpdate = z.infer<typeof BugReportUpdate>;

/** What POST /uploads can presign a PUT for. */
export const UploadKind = z.enum(['screenshot', 'log']);
export type UploadKind = z.infer<typeof UploadKind>;

/** POST /uploads body. Strict. */
export const UploadRequest = z.strictObject({
  bugId: z.uuid(),
  kind: UploadKind,
});
export type UploadRequest = z.infer<typeof UploadRequest>;

/** GET /bugs query string filters. */
export const ListQuery = z.object({
  status: Status.optional(),
  buildVersion: buildVersion.optional(),
});
export type ListQuery = z.infer<typeof ListQuery>;

export type BugReport = BugReportCreate & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
