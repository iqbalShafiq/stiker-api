import { prisma } from '../prisma/client';
import { NotFoundError, ValidationError } from '../errors';

export interface PromptPresetResponse {
  id: string;
  title: string;
  category: string;
  prompt: string;
  referenceHint: string | null;
  sortOrder: number;
}

function mapPreset(row: {
  slug: string;
  title: string;
  category: string;
  prompt: string;
  referenceHint: string | null;
  sortOrder: number;
}): PromptPresetResponse {
  return {
    id: row.slug,
    title: row.title,
    category: row.category,
    prompt: row.prompt,
    referenceHint: row.referenceHint,
    sortOrder: row.sortOrder,
  };
}

export class PromptPresetService {
  async listActive(category?: string): Promise<PromptPresetResponse[]> {
    const rows = await prisma.promptPreset.findMany({
      where: {
        isActive: true,
        ...(category?.trim() ? { category: { equals: category.trim(), mode: 'insensitive' } } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    });
    return rows.map(mapPreset);
  }

  async listAll(): Promise<PromptPresetResponse[]> {
    const rows = await prisma.promptPreset.findMany({
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    });
    return rows.map(mapPreset);
  }

  async create(input: {
    slug: string;
    title: string;
    category: string;
    prompt: string;
    referenceHint?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  }): Promise<PromptPresetResponse> {
    const slug = input.slug.trim().toLowerCase();
    if (!slug || !input.title.trim() || !input.category.trim() || !input.prompt.trim()) {
      throw new ValidationError('slug, title, category, and prompt are required');
    }
    const row = await prisma.promptPreset.create({
      data: {
        slug,
        title: input.title.trim(),
        category: input.category.trim(),
        prompt: input.prompt.trim(),
        referenceHint: input.referenceHint?.trim() ? input.referenceHint.trim() : null,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      },
    });
    return mapPreset(row);
  }

  async update(
    slug: string,
    input: {
      title?: string;
      category?: string;
      prompt?: string;
      referenceHint?: string | null;
      sortOrder?: number;
      isActive?: boolean;
    }
  ): Promise<PromptPresetResponse> {
    const existing = await prisma.promptPreset.findUnique({ where: { slug } });
    if (!existing) {
      throw new NotFoundError('Prompt preset not found');
    }
    const row = await prisma.promptPreset.update({
      where: { slug },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.category !== undefined ? { category: input.category.trim() } : {}),
        ...(input.prompt !== undefined ? { prompt: input.prompt.trim() } : {}),
        ...(input.referenceHint !== undefined
          ? {
              referenceHint: input.referenceHint?.trim()
                ? input.referenceHint.trim()
                : null,
            }
          : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    return mapPreset(row);
  }

  async delete(slug: string): Promise<void> {
    const existing = await prisma.promptPreset.findUnique({ where: { slug } });
    if (!existing) {
      throw new NotFoundError('Prompt preset not found');
    }
    await prisma.promptPreset.delete({ where: { slug } });
  }
}

export const promptPresetService = new PromptPresetService();
