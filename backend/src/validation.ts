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

/** PUT /bugs/{id} body. Only status, severity, description; at least one required. */
export const BugReportUpdate = z
  .strictObject({
    status: Status.optional(),
    severity: Severity.optional(),
    description: description.optional(),
  })
  .refine((v) => v.status !== undefined || v.severity !== undefined || v.description !== undefined, {
    message: 'At least one of status, severity, description is required',
  });
export type BugReportUpdate = z.infer<typeof BugReportUpdate>;

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
