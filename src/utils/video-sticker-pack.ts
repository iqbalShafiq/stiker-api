export const VIDEO_STICKER_PACK_INPUT_LAYOUT = '4x4';
export const VIDEO_STICKER_PACK_OUTPUT_LAYOUT = '4x4';
export const VIDEO_STICKER_PACK_MAX_GRIDS = 2;
export const VIDEO_STICKER_PACK_MAX_CANDIDATES = 32;
export const VIDEO_STICKER_PACK_MAX_SEGMENT_MS = 60_000;
const VIDEO_STICKER_PACK_GRID_CELL_COUNT = 16;
const VALID_SELECTED_CELL_ID = /^[A-D][1-4]$/;

export interface VideoStickerPackRequestShape {
  candidateGridCount: number;
  candidateCount: number;
  selectedStartMs: number;
  selectedEndMs: number;
}

export interface VideoStickerPackAgentPlan {
  generationPrompt: string;
  selectedCells: string[];
  selectionReasoning?: string;
}

export function validateVideoStickerPackRequestShape(input: VideoStickerPackRequestShape): void {
  assertFiniteNonNegativeInteger(input.candidateGridCount, 'candidateGridCount');
  assertFiniteNonNegativeInteger(input.candidateCount, 'candidateCount');
  assertFiniteNonNegativeInteger(input.selectedStartMs, 'selectedStartMs');
  assertFiniteNonNegativeInteger(input.selectedEndMs, 'selectedEndMs');

  if (input.candidateGridCount < 1) {
    throw new Error('At least one candidate grid image is required');
  }
  if (input.candidateGridCount > VIDEO_STICKER_PACK_MAX_GRIDS) {
    throw new Error('At most 2 candidate grid images are allowed');
  }

  const maxCandidateCountForGrids = input.candidateGridCount * VIDEO_STICKER_PACK_GRID_CELL_COUNT;

  if (input.candidateCount < 1 || input.candidateCount > VIDEO_STICKER_PACK_MAX_CANDIDATES) {
    throw new Error('candidateCount must be between 1 and 32');
  }
  if (input.candidateCount > maxCandidateCountForGrids) {
    throw new Error(
      `candidateCount exceeds candidate grid capacity: ${input.candidateCount} requested, ${maxCandidateCountForGrids} available (${input.candidateGridCount} grid${input.candidateGridCount === 1 ? '' : 's'} x 16 cells)`
    );
  }

  const segmentMs = input.selectedEndMs - input.selectedStartMs;
  if (segmentMs <= 0) {
    throw new Error('Selected video segment must be greater than 0 ms');
  }
  if (segmentMs > VIDEO_STICKER_PACK_MAX_SEGMENT_MS) {
    throw new Error('Selected video segment must be at most 60000 ms');
  }
}

export function normalizeVideoStickerPackAgentPlan(content: string): VideoStickerPackAgentPlan {
  const parsed = parseJsonObject(content);
  const generationPrompt =
    typeof parsed.generationPrompt === 'string' ? parsed.generationPrompt.trim() : '';
  if (!generationPrompt) {
    throw new Error('Video sticker pack agent did not return generationPrompt');
  }

  const selectedCells = Array.isArray(parsed.selectedCells)
    ? parsed.selectedCells
        .filter((value): value is string => typeof value === 'string')
        .map(value => value.trim().toUpperCase())
        .filter(value => VALID_SELECTED_CELL_ID.test(value))
        .filter((value, index, arr) => arr.indexOf(value) === index)
    : [];

  const selectionReasoning =
    typeof parsed.selectionReasoning === 'string' ? parsed.selectionReasoning.trim() : undefined;

  return {
    generationPrompt,
    selectedCells,
    ...(selectionReasoning ? { selectionReasoning } : {}),
  };
}

function parseJsonObject(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(withoutFence) as Record<string, unknown>;
  } catch {
    throw new Error('Video sticker pack agent returned invalid JSON payload');
  }
}

function assertFiniteNonNegativeInteger(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a finite non-negative integer`);
  }
}
