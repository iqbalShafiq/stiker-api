import logger from '../utils/logger';
import { GridDetectionError } from '../errors';
import type { GridBoundary, GridDetectionResult } from '../types';
import { gridDetectionOutputSchema } from '../utils/grid-detection';
import {
  cellTextAnalysisOutputSchema,
  type CellTextAnalysisResult,
} from '../utils/text-asset-decoration';
import {
  improvementGridPlanOutputSchema,
  improvementPlanOutputSchema,
  normalizeImprovementPromptPlan,
  type ImageGenerationInput,
  type ImprovementPromptPlan,
} from '../utils/improvement';
import { generateStructuredCompletion } from '../ai/completion';

export class VisionAnalysisService {
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
      instructions: VisionAnalysisService.CELL_TEXT_INSTRUCTIONS,
      prompt: VisionAnalysisService.CELL_TEXT_PRIMARY_PROMPT,
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
      instructions: VisionAnalysisService.CELL_TEXT_INSTRUCTIONS,
      prompt: VisionAnalysisService.CELL_TEXT_FALLBACK_PROMPT,
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
   * Detect grid boundaries dari image menggunakan AI vision.
   * Tidak ada fallback deterministik: kegagalan = GridDetectionError.
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
      logger.warn({ error: aiError }, 'AI grid detection failed');
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
