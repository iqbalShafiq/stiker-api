import sharp from 'sharp';
import type { ImageGenerationResult } from '@anvia/core';
import logger from '../utils/logger';
import {
  AIGenerationError,
  GridDetectionError,
  ProviderError,
  TimeoutError,
} from '../errors';
import type { GridBoundary, GridDetectionResult } from '../types';
import {
  improvementGridPlanOutputSchema,
  improvementPlanOutputSchema,
  normalizeImprovementPromptPlan,
  type ImageGenerationInput,
  type ImprovementPromptPlan,
} from '../utils/improvement';
import { gridDetectionOutputSchema } from '../utils/grid-detection';
import {
  cellTextAnalysisOutputSchema,
  type CellTextAnalysisResult,
} from '../utils/text-asset-decoration';
import { generateStructuredCompletion } from '../ai/completion';
import { anviaCore } from '../ai/core';
import { loadAiModel } from '../ai/models/catalog';
import {
  buildReferenceImagesProviderOptions,
  getOpenRouterImageModel,
} from '../ai/openrouter-image';
import { isProviderError } from '../ai/errors';

export type {
  TextStyleMetadata,
  OutsideForegroundTextDetection,
  CellTextAnalysisResult,
} from '../utils/text-asset-decoration';

interface GenerationResult {
  imageBuffer: Buffer;
  generationId: string;
  metadata: {
    model: string;
    tokensPrompt?: number;
    tokensCompletion?: number;
    cost?: number;
    latencyMs?: number;
  };
}

export class OpenRouterService {
  private defaultTimeout: number;

  constructor(timeoutMs: number = 60000) {
    this.defaultTimeout = timeoutMs;
  }

  /**
   * Generate image dengan prompt text (dan opsional image input)
   * Direct API call untuk bisa akses message.images[]
   */
  async generateImage(
    prompt: string,
    base64Image?: string,
    imageMimeType: string = 'image/png',
    allowTextOnlyFallback: boolean = true
  ): Promise<GenerationResult> {
    const images = base64Image
      ? [{ base64: base64Image, mimeType: imageMimeType }]
      : [];

    return this.generateImageWithInputs(prompt, images, allowTextOnlyFallback);
  }

  async generateImageWithInputs(
    prompt: string,
    images: Array<{ base64: string; mimeType: string }> = [],
    allowTextOnlyFallback: boolean = true
  ): Promise<GenerationResult> {
    const startedAt = Date.now();
    const { modelId } = await loadAiModel('image');

    const run = async (
      referenceImages: Array<{ base64: string; mimeType: string }>
    ): Promise<ImageGenerationResult<unknown>> => {
      const { generateImage } = await anviaCore();
      return generateImage({
        model: getOpenRouterImageModel(modelId),
        prompt,
        width: 1024,
        height: 1024,
        ...(referenceImages.length > 0
          ? { providerOptions: buildReferenceImagesProviderOptions(referenceImages) }
          : {}),
        abortSignal: AbortSignal.timeout(this.defaultTimeout),
      });
    };

    try {
      const result = await run(images);
      return this.toGenerationResult(modelId, result.rawResponse, result.images[0], startedAt);
    } catch (error) {
      if (allowTextOnlyFallback && images.length > 0 && isProviderError(error)) {
        // Fallback: jika image input tidak didukung, coba text-only
        logger.warn('Image input not supported, falling back to text-only');
        const result = await run([]);
        return this.toGenerationResult(modelId, result.rawResponse, result.images[0], startedAt);
      }
      if (error instanceof TimeoutError || error instanceof AIGenerationError) {
        throw error;
      }
      if (isProviderError(error)) {
        throw new ProviderError(error instanceof Error ? error.message : 'Provider error');
      }
      throw new AIGenerationError(
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  private toGenerationResult(
    model: string,
    rawResponse: unknown,
    image: { data: Uint8Array; mediaType?: string | undefined },
    startedAt: number
  ): GenerationResult {
    const response = rawResponse as {
      id?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    };
    return {
      imageBuffer: Buffer.from(image.data),
      generationId: response.id ?? '',
      metadata: {
        model,
        tokensPrompt: response.usage?.prompt_tokens,
        tokensCompletion: response.usage?.completion_tokens,
        cost: response.usage?.cost,
        latencyMs: Date.now() - startedAt,
      },
    };
  }

  async buildImprovementPrompt(
    images: ImageGenerationInput[],
    mode: 'single' | 'grid'
  ): Promise<{
    plan: ImprovementPromptPlan;
    metadata: {
      model: string;
      tokensPrompt?: number;
      tokensCompletion?: number;
      cost?: number;
      latencyMs?: number;
    };
  }> {
    const { output, usage, cost, latencyMs, model } = await generateStructuredCompletion({
      role: 'improvement',
      instructions:
        'You are a senior sticker art director and prompt engineer. Return ONLY JSON. Do not include markdown.',
      prompt:
        mode === 'single'
          ? this.buildSingleImprovementAgentPrompt()
          : this.buildGridImprovementAgentPrompt(images.length),
      images,
      outputSchema: mode === 'single' ? improvementPlanOutputSchema : improvementGridPlanOutputSchema,
      timeoutMs: 45000,
    });

    return {
      plan: normalizeImprovementPromptPlan(output, {
        allowTextAssetDecoration: mode === 'single',
      }),
      metadata: {
        model,
        tokensPrompt: usage.inputTokens,
        tokensCompletion: usage.outputTokens,
        cost,
        latencyMs,
      },
    };
  }

  private buildSingleImprovementAgentPrompt(): string {
    return `Analyze this one sticker image and write a precise prompt for an image-generation model to improve it.

Return exact JSON:
{
  "improvementPrompt": "string",
  "textAssetDecoration": {
    "text": "string",
    "style": {
      "fontFamily": "string",
      "color": "string",
      "weight": "string"
    }
  }
}

Rules:
- The user gave no prompt. Infer what should be improved: clarity, crop, composition, lighting, subject separation, sticker readiness, and overall polish.
- Preserve the same subject/character/object identity and visual intent.
- ALWAYS return textAssetDecoration.
- If readable decorative caption text exists, extract it into textAssetDecoration and instruct the image generator to produce a clean sticker WITHOUT embedded text.
- If no decorative caption text exists, synthesize one short caption that matches the subject and set it in textAssetDecoration.
- The improvementPrompt must ask for one WhatsApp-ready sticker with transparent background, clean silhouette, safe padding, and no rectangular backdrop.
- Caption text in textAssetDecoration must be short and readable.`;
  }

  private buildGridImprovementAgentPrompt(inputCount: number): string {
    return `Analyze these ${inputCount} sticker images and write one prompt for an image-generation model to improve them as a single 4x4 grid sheet.

Return exact JSON:
{
  "improvementPrompt": "string"
}

Rules:
- The user gave no prompt. Infer what should be improved across the set: clarity, crop, composition, subject separation, consistency, sticker readiness, and overall polish.
- Preserve each input image as one distinct sticker concept.
- Arrange ONLY the ${inputCount} provided stickers. Do not invent extra stickers for unused grid cells.
- Output one square 4x4 grid image with clear gutters/separators and safe margins in every used cell.
- Keep each used cell readable at small size.
- Ensure each used cell includes one short readable caption text.
- Improve contrast between each sticker subject, any existing caption text, and the cell background.
- Use backgrounds that contrast with both the image subject and text; avoid text blending into backgrounds.
- Keep all text fully inside its cell with no clipping.
- Do not output textAssetDecoration for grid mode.`;
  }

  async normalizeGridImage(
    imageBase64: string,
    gridLayout: string,
    targetWidth: number,
    targetHeight: number
  ): Promise<Buffer> {
    const prompt = `You are normalizing a sticker grid image for precise automated splitting.

Task:
- Recreate this grid image as a clean, normalized grid while preserving every original sticker and text.
- Keep the SAME layout: ${gridLayout}.
- Preserve all text labels fully, with complete ascenders/descenders and no clipped edges.
- Make each cell fully visible with safe inner padding so text and faces are never cut.
- Keep each sticker in its own cell only; no overlap between cells.
- Preserve overall style and visual content from the input image.
- Keep clear and consistent gutters between cells.
- Do not crop, zoom-in, or trim any part of any sticker or text.
- Output exactly one complete grid image.
`;

    const { imageBuffer } = await this.generateImage(prompt, imageBase64);

    return sharp(imageBuffer)
      .resize(targetWidth, targetHeight, {
        fit: 'fill',
      })
      .png()
      .toBuffer();
  }

  private static readonly CELL_TEXT_INSTRUCTIONS =
    'You are a visual text extraction assistant for sticker cells. Return ONLY JSON. Do not include markdown.';

  private static readonly CELL_TEXT_PRIMARY_PROMPT = `Analyze this single sticker-grid cell image.

Task:
- Detect every caption/word that is visually outside the main foreground subject (usually the person/object cutout).
- Text around the subject on empty/background area counts as outside foreground and must be included.
- Text drawn on top of the subject itself (face/body/object) must NOT be included.

Return exact JSON:
{
  "hasTextOutsideForeground": boolean,
  "textOutsideForeground": [
    {
      "text": "string",
      "style": {
        "fontFamily": "string",
        "color": "string",
        "weight": "string"
      }
    }
  ]
}

Style metadata:
- fontFamily: best estimate such as "sans-serif", "serif", "script", "display", "monospace".
- color: dominant text color in hex when possible (e.g. "#FFAA00"), otherwise color name.
- weight: one of "light", "regular", "medium", "semibold", "bold", "heavy".

Rules:
- Prioritize recall for outside-foreground captions.
- Keep textOutsideForeground empty only when truly no outside text exists.
- No additional keys.`;

  private static readonly CELL_TEXT_FALLBACK_PROMPT = `Second pass OCR check for this sticker cell.

If there is ANY readable caption text around (not covering the face/body main subject), return it.
If no such text exists, return an empty list.

Return exact JSON only:
{
  "hasTextOutsideForeground": boolean,
  "textOutsideForeground": [
    {
      "text": "string",
      "style": {
        "fontFamily": "string",
        "color": "string",
        "weight": "string"
      }
    }
  ]
}`;

  async analyzeCellTextOutsideForeground(imageBuffer: Buffer): Promise<CellTextAnalysisResult> {
    const images = [{ buffer: imageBuffer, mimeType: 'image/png' }];

    const primary = await generateStructuredCompletion({
      role: 'vision',
      instructions: OpenRouterService.CELL_TEXT_INSTRUCTIONS,
      prompt: OpenRouterService.CELL_TEXT_PRIMARY_PROMPT,
      images,
      outputSchema: cellTextAnalysisOutputSchema,
      timeoutMs: 20000,
    });

    const primaryResult = this.reconcileCellTextAnalysis(primary.output);
    if (primaryResult.textOutsideForeground.length > 0) {
      return primaryResult;
    }

    const fallback = await generateStructuredCompletion({
      role: 'vision',
      instructions: OpenRouterService.CELL_TEXT_INSTRUCTIONS,
      prompt: OpenRouterService.CELL_TEXT_FALLBACK_PROMPT,
      images,
      outputSchema: cellTextAnalysisOutputSchema,
      timeoutMs: 20000,
    });

    return this.reconcileCellTextAnalysis(fallback.output);
  }

  private reconcileCellTextAnalysis(output: CellTextAnalysisResult): CellTextAnalysisResult {
    const items = output.textOutsideForeground
      .map((item) => ({
        text: item.text.trim(),
        style: {
          fontFamily: item.style.fontFamily.trim(),
          color: item.style.color.trim(),
          weight: item.style.weight.trim(),
        },
      }))
      .filter(
        (item) =>
          Boolean(item.text) &&
          Boolean(item.style.fontFamily) &&
          Boolean(item.style.color) &&
          Boolean(item.style.weight)
      );

    return {
      hasTextOutsideForeground: output.hasTextOutsideForeground || items.length > 0,
      textOutsideForeground: items,
    };
  }

  /**
   * Detect grid boundaries dari image
   * Menggunakan AI vision untuk deteksi, dengan fallback ke auto-detection
   */
  async detectGridBoundaries(
    imageBase64: string,
    imageWidth?: number,
    imageHeight?: number,
    forceRows?: number,
    forceCols?: number
  ): Promise<GridDetectionResult> {
    // Jika user spesifikkan rows dan cols, gunakan langsung tanpa AI
    if (forceRows && forceCols && imageWidth && imageHeight) {
      logger.info(`Using user-specified grid layout: ${forceRows}x${forceCols}`);
      return this.generateGridBoundaries(imageWidth, imageHeight, forceRows, forceCols);
    }

    // Coba AI detection dulu
    try {
      const { output } = await generateStructuredCompletion({
        role: 'vision',
        instructions:
          'You are an image analysis assistant. Analyze grid images and identify cell boundaries. You must detect ALL cells including those with stickers/images and text overlays. Account for padding and gaps between cells. Return ONLY a JSON object.',
        prompt: `Analyze this grid image carefully. The image contains a grid layout with multiple cells arranged in rows and columns.

IMPORTANT INSTRUCTIONS:
1. Count the total number of rows and columns
2. Identify the boundaries of EACH individual cell
3. Include the FULL cell area including any white space, borders, or gaps between cells
4. Do NOT crop too tightly - include some margin around each cell content
5. Return exact pixel coordinates based on the image dimensions

Return a JSON object with this exact format:
{
  "gridLayout": "ROWSxCOLS",
  "boundaries": [
    { "x": 0, "y": 0, "width": 100, "height": 100 },
    ...
  ]
}

Make sure boundaries cover the ENTIRE image without gaps or overlaps.`,
        images: [{ buffer: Buffer.from(imageBase64, 'base64'), mimeType: 'image/png' }],
        outputSchema: gridDetectionOutputSchema,
        timeoutMs: 30000,
      });

      this.validateBoundaries(output.boundaries);

      // Validasi: cek apakah boundaries cover gambar dengan baik
      if (imageWidth && imageHeight) {
        const isValid = this.validateGridCoverage(output.boundaries, imageWidth, imageHeight);
        if (!isValid) {
          throw new Error('Grid coverage invalid');
        }
      }

      return output;
    } catch (aiError) {
      logger.warn({ error: aiError }, 'AI grid detection failed, falling back to auto-detection');

      // Fallback ke auto-detection jika AI gagal atau hasil tidak valid
      if (imageWidth && imageHeight) {
        return this.autoDetectGrid(imageWidth, imageHeight);
      }

      throw new GridDetectionError(
        aiError instanceof Error ? aiError.message : 'Grid detection failed'
      );
    }
  }

  /**
   * Generate grid boundaries dengan layout spesifik (tanpa margin)
   */
  private generateGridBoundaries(
    width: number,
    height: number,
    rows: number,
    cols: number
  ): GridDetectionResult {
    const cellWidth = Math.floor(width / cols);
    const cellHeight = Math.floor(height / rows);

    const boundaries: GridBoundary[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        boundaries.push({
          x: col * cellWidth,
          y: row * cellHeight,
          width: cellWidth,
          height: cellHeight,
        });
      }
    }

    return {
      gridLayout: `${rows}x${cols}`,
      boundaries,
    };
  }

  /**
   * Auto-detect grid dengan equal spacing (fallback)
   * Mencoba beberapa kemungkinan layout dan memilih yang paling masuk akal
   */
  private autoDetectGrid(width: number, height: number): GridDetectionResult {
    const ratio = width / height;
    const minCellSize = 120; // Minimum ukuran cell yang masuk akal untuk stiker
    const maxCellSize = 600; // Maximum ukuran cell

    // Generate kemungkinan layout berdasarkan ukuran gambar
    const possibleLayouts: Array<{ rows: number; cols: number }> = [];
    const maxCols = Math.floor(width / minCellSize);
    const maxRows = Math.floor(height / minCellSize);

    for (let rows = 1; rows <= Math.min(maxRows, 8); rows++) {
      for (let cols = 1; cols <= Math.min(maxCols, 8); cols++) {
        const cellW = width / cols;
        const cellH = height / rows;
        if (cellW >= minCellSize && cellW <= maxCellSize &&
            cellH >= minCellSize && cellH <= maxCellSize) {
          possibleLayouts.push({ rows, cols });
        }
      }
    }

    // Pilih layout terbaik berdasarkan aspect ratio dan jumlah cell
    let bestLayout = { rows: 2, cols: 2 };
    let bestScore = -1;

    for (const layout of possibleLayouts) {
      const cellW = width / layout.cols;
      const cellH = height / layout.rows;
      const cellRatio = cellW / cellH;
      const ratioDiff = Math.abs(cellRatio - 1); // Prefer square cells
      const cellCount = layout.rows * layout.cols;
      
      // Score: prefer square cells, common sticker counts (4,6,8,9,12,16,20,24), dan ukuran yang pas
      let countScore = 0;
      if ([4, 6, 8, 9, 12, 16, 20, 24].includes(cellCount)) countScore = 10;
      else if ([2, 3, 15, 18, 25].includes(cellCount)) countScore = 5;
      
      const score = countScore - ratioDiff * 5 + (cellCount > 4 ? 2 : 0);
      
      if (score > bestScore) {
        bestScore = score;
        bestLayout = layout;
      }
    }

    // Override untuk kasus umum berdasarkan ukuran gambar
    const minDim = Math.min(width, height);
    if (minDim >= 1000) {
      // Gambar besar: biasanya 4x4 atau 3x4
      if (ratio >= 0.9 && ratio <= 1.1) {
        bestLayout = { rows: 4, cols: 4 };
      }
    } else if (minDim >= 700) {
      // Gambar medium: 3x3 atau 2x3
      if (ratio >= 0.9 && ratio <= 1.1) {
        bestLayout = { rows: 3, cols: 3 };
      }
    }

    const rows = bestLayout.rows;
    const cols = bestLayout.cols;

    // Hitung cell size dengan margin (2% dari ukuran gambar)
    const marginX = Math.round(width * 0.02);
    const marginY = Math.round(height * 0.02);
    const cellWidth = Math.floor((width - marginX * (cols - 1)) / cols);
    const cellHeight = Math.floor((height - marginY * (rows - 1)) / rows);

    const boundaries: GridBoundary[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        boundaries.push({
          x: col * (cellWidth + marginX),
          y: row * (cellHeight + marginY),
          width: Math.min(cellWidth, width - col * (cellWidth + marginX)),
          height: Math.min(cellHeight, height - row * (cellHeight + marginY)),
        });
      }
    }

    return {
      gridLayout: `${rows}x${cols}`,
      boundaries,
    };
  }

  /**
   * Validasi apakah grid boundaries cover gambar dengan baik
   */
  private validateGridCoverage(
    boundaries: GridBoundary[],
    imageWidth: number,
    imageHeight: number
  ): boolean {
    if (boundaries.length === 0) return false;

    // Hitung total area boundaries
    const totalBoundaryArea = boundaries.reduce(
      (sum, b) => sum + b.width * b.height,
      0
    );
    const imageArea = imageWidth * imageHeight;

    // Boundaries harus cover minimal 60% area gambar
    const coverage = totalBoundaryArea / imageArea;
    if (coverage < 0.6 || coverage > 1.1) {
      return false;
    }

    // Cek apakah ada boundaries yang keluar dari gambar
    for (const b of boundaries) {
      if (b.x + b.width > imageWidth + 10 || b.y + b.height > imageHeight + 10) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validasi grid boundaries
   */
  private validateBoundaries(boundaries: GridBoundary[]): void {
    for (const boundary of boundaries) {
      if (boundary.x < 0 || boundary.y < 0) {
        throw new GridDetectionError('Invalid boundary coordinates');
      }
      if (boundary.width <= 0 || boundary.height <= 0) {
        throw new GridDetectionError('Invalid boundary dimensions');
      }
    }
  }
}
