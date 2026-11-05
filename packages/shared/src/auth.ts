import { z } from 'zod';
import { ROLES } from './roles';

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_PATTERN, 'Use 3-32 lowercase letters, digits, dot, dash or underscore.');

export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`);

export const LoginRequestSchema = z.object({
  username: UsernameSchema,
  password: z.string().min(1).max(PASSWORD_MAX),
});

export const SetupRequestSchema = z.object({
  setupToken: z.string().min(1).max(256),
  username: UsernameSchema,
  password: PasswordSchema,
});

export const CreateUserRequestSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
  role: z.enum(ROLES),
});

export const UpdateUserRequestSchema = z
  .object({ role: z.enum(ROLES).optional(), disabled: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.disabled !== undefined, 'Nothing to update.');

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX),
  newPassword: PasswordSchema,
});

export const UserSummarySchema = z.object({
  id: z.string(),
  username: z.string(),
  role: z.enum(ROLES),
  disabled: z.boolean(),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
});

export const FeatureFlagsSchema = z.object({
  containerActionsEnabled: z.boolean(),
  dockerConfigured: z.boolean(),
  sampleData: z.boolean(),
  rawRetentionDays: z.number(),
  rollupRetentionDays: z.number(),
  scrapeIntervalSeconds: z.number(),
  logTailMax: z.number(),
});

export const SessionInfoSchema = z.object({
  setupRequired: z.boolean(),
  user: UserSummarySchema.nullable(),
  csrfToken: z.string().nullable(),
  features: FeatureFlagsSchema.nullable(),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type SetupRequest = z.infer<typeof SetupRequestSchema>;
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;
export type UserSummary = z.infer<typeof UserSummarySchema>;
export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>;
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
