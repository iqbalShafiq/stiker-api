import { prisma } from '../../prisma/client';
import { AppError } from '../../errors';

export type AiModelRole = 'agent' | 'vision' | 'improvement' | 'image';

export interface AiModelRow {
  role: AiModelRole;
  modelId: string;
  reasoningEfforts: string[];
  defaultReasoningEffort: string | null;
  temperature: number | null;
  maxTokens: number | null;
}

/**
 * AppError so the actionable seed hint survives the error handler on every call
 * path instead of degrading into a generic 500.
 */
export class MissingAiModelError extends AppError {
  constructor(role: AiModelRole) {
    super(
      `AiModel row for role '${role}' is missing — run \`npx prisma db seed\` first.`,
      500,
      'AI_MODEL_NOT_CONFIGURED'
    );
  }
}

const cache = new Map<AiModelRole, AiModelRow>();

/** Clears the per-process catalog cache (tests). */
export function resetAiModelCache(): void {
  cache.clear();
}

/** Reads the catalog row for one role; cached for the process lifetime (restart to apply changes). */
export async function loadAiModel(role: AiModelRole): Promise<AiModelRow> {
  const cached = cache.get(role);
  if (cached) {
    return cached;
  }
  const row = await prisma.aiModel.findUnique({ where: { role } });
  if (!row) {
    throw new MissingAiModelError(role);
  }
  const normalized: AiModelRow = {
    role: row.role as AiModelRole,
    modelId: row.modelId,
    reasoningEfforts: row.reasoningEfforts,
    defaultReasoningEffort: row.defaultReasoningEffort,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
  };
  cache.set(role, normalized);
  return normalized;
}
