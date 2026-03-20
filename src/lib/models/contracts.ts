import { z } from "zod";

export const MODEL_TASK_TYPES = [
  "script_question_generate",
  "script_finalize",
  "storyboard_split",
  "image_generate",
  "image_edit",
  "video_generate",
] as const;

export const ModelTaskTypeSchema = z.enum(MODEL_TASK_TYPES);

export type ModelTaskType = z.infer<typeof ModelTaskTypeSchema>;

export const ModelRequestSchema = z.object({
  taskType: ModelTaskTypeSchema,
  providerKey: z.string(),
  model: z.string(),
  inputText: z.string().optional(),
  inputFiles: z.array(z.string()).default([]),
  options: z.record(z.string(), z.unknown()).default({}),
  traceId: z.string(),
});

export type ModelRequest = z.infer<typeof ModelRequestSchema>;

export const ProviderConfigSchema = z
  .object({
    defaultForTasks: z.array(ModelTaskTypeSchema).default([]),
  })
  .catchall(z.unknown())
  .transform((value) => ({
    ...value,
    defaultForTasks: [...new Set(value.defaultForTasks)],
  }));

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

const RequiredStringSchema = z.string().trim().min(1);

const CreateNullableStringSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

const UpdateNullableStringSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

const CreateProviderBaseSchema = z.object({
  label: RequiredStringSchema,
  providerName: RequiredStringSchema,
  modelName: CreateNullableStringSchema,
  baseUrl: CreateNullableStringSchema,
  apiKey: CreateNullableStringSchema,
  timeoutMs: z.coerce.number().int().min(1000).max(300000).default(30000),
  maxRetries: z.coerce.number().int().min(0).max(10).default(2),
  enabled: z.boolean().default(true),
  configJson: ProviderConfigSchema.default({ defaultForTasks: [] }),
});

export const CreateProviderInputSchema = CreateProviderBaseSchema.extend({
  key: RequiredStringSchema,
});

export type CreateProviderInput = z.infer<typeof CreateProviderInputSchema>;

const UpdateProviderBaseSchema = z.object({
  label: RequiredStringSchema.optional(),
  providerName: RequiredStringSchema.optional(),
  modelName: UpdateNullableStringSchema,
  baseUrl: UpdateNullableStringSchema,
  apiKey: UpdateNullableStringSchema,
  timeoutMs: z.coerce.number().int().min(1000).max(300000).optional(),
  maxRetries: z.coerce.number().int().min(0).max(10).optional(),
  enabled: z.boolean().optional(),
  configJson: ProviderConfigSchema.optional(),
});

export const UpdateProviderInputSchema = UpdateProviderBaseSchema.extend({
  key: RequiredStringSchema,
}).refine(
  (value) =>
    Object.keys(value).some((key) => key !== "key" && value[key as keyof typeof value] !== undefined),
  {
    message: "At least one field must be updated",
    path: ["key"],
  },
);

export type UpdateProviderInput = z.infer<typeof UpdateProviderInputSchema>;

export type ProxyModelResult = {
  status: "ok" | "error";
  textOutput?: string;
  fileOutputs?: string[];
  rawResponse: unknown;
  errorCode?: string;
  errorMessage?: string;
};
