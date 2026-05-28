import OpenAI from 'openai';
import sharp from 'sharp';
import { config } from '../config';
import logger from '../utils/logger';
import {
  AIGenerationError,
  GridDetectionError,
  ProviderError,
  TimeoutError,
} from '../errors';
import type { GridBoundary, GridDetectionResult } from '../types';
import {
  normalizeImprovementPromptPlan,
  type ImageGenerationInput,
  type ImprovementPromptPlan,
} from '../utils/improvement';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

interface ChatCompletionOptions {
  model?: string;
  messages: ChatMessage[];
  responseFormat?: { type: 'json_object' | 'text' };
  timeoutMs?: number;
}

interface GenerationResult {
  imageBuffer: Buffer;
  generationId: string;
  metadata: {
    tokensPrompt?: number;
    tokensCompletion?: number;
    cost?: number;
    latencyMs?: number;
  };
}

interface ExtractedImage {
  imageBuffer: Buffer;
}

interface ProviderErrorResponse {
  status?: number;
  error?: {
    metadata?: {
      raw?: string;
    };
  };
}

export interface TextStyleMetadata {
  fontFamily: string;
  color: string;
  weight: string;
}

export interface OutsideForegroundTextDetection {
  text: string;
  style: TextStyleMetadata;
}

export interface CellTextAnalysisResult {
  hasTextOutsideForeground: boolean;
  textOutsideForeground: OutsideForegroundTextDetection[];
}

export class OpenRouterService {
  private client: OpenAI;
  private defaultTimeout: number;

  constructor(timeoutMs: number = 60000) {
    this.client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: config.openRouterApiKey,
      defaultHeaders: {
        'HTTP-Referer': config.appUrl,
        'X-Title': 'WhatsApp Sticker API',
      },
      timeout: timeoutMs,
    });
    this.defaultTimeout = timeoutMs;
  }

  /**
   * Generic chat completion - reusable untuk semua endpoint
   */
  async chatCompletion<T = string>(options: ChatCompletionOptions): Promise<{
    content: T;
    generationId: string;
    metadata: {
      tokensPrompt?: number;
      tokensCompletion?: number;
      cost?: number;
      latencyMs?: number;
    };
  }> {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeout;

    try {
      const response = await Promise.race([
        this.client.chat.completions.create({
          model: options.model ?? config.models.imageGeneration,
          messages: options.messages as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
          response_format: options.responseFormat,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new TimeoutError()), timeoutMs)
        ),
      ]);

      const latencyMs = Date.now() - startTime;
      const generationId = response.id;
      const message = response.choices[0]?.message;

      if (!message) {
        throw new AIGenerationError('No message in response');
      }

      let content: T;
      if (typeof message.content === 'string') {
        content = message.content as T;
      } else if (message.content) {
        content = JSON.stringify(message.content) as T;
      } else {
        content = '' as T;
      }

      const metadata = {
        tokensPrompt: response.usage?.prompt_tokens,
        tokensCompletion: response.usage?.completion_tokens,
        cost: this.extractCost(response),
        latencyMs,
      };

      return { content, generationId, metadata };
    } catch (error) {
      if (error instanceof TimeoutError) {
        throw error;
      }
      if (error instanceof AIGenerationError) {
        throw error;
      }
      if (this.isProviderError(error)) {
        throw new ProviderError(this.extractProviderErrorMessage(error));
      }
      throw new AIGenerationError(
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Generate image dengan prompt text (dan opsional image input)
   * Direct API call untuk bisa akses message.images[]
   */
  async generateImage(
    prompt: string,
    base64Image?: string,
    imageMimeType: string = 'image/png',
    model: string = config.models.imageGeneration,
    allowTextOnlyFallback: boolean = true
  ): Promise<GenerationResult> {
    const images = base64Image
      ? [{ base64: base64Image, mimeType: imageMimeType }]
      : [];

    return this.generateImageWithInputs(
      prompt,
      images,
      model,
      allowTextOnlyFallback
    );
  }

  async generateImageWithInputs(
    prompt: string,
    images: Array<{ base64: string; mimeType: string }> = [],
    model: string = config.models.imageGeneration,
    allowTextOnlyFallback: boolean = true
  ): Promise<GenerationResult> {
    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> =
      [{ type: 'text', text: prompt }];

    for (const image of images) {
      const mime =
        image.mimeType && /^image\/[a-z0-9.+-]+$/i.test(image.mimeType)
          ? image.mimeType
          : 'image/png';
      content.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${image.base64}` },
      });
    }

    const startTime = Date.now();

    try {
      const response = await Promise.race([
        this.client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: content as unknown as OpenAI.Chat.Completions.ChatCompletionContentPart[] }],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new TimeoutError()), this.defaultTimeout)
        ),
      ]);

      const latencyMs = Date.now() - startTime;
      const generationId = response.id;
      const message = response.choices[0]?.message;

      if (!message) {
        throw new AIGenerationError('No message in response');
      }

      const extractedImage = await this.extractImageFromMessage(message);

      const metadata = {
        tokensPrompt: response.usage?.prompt_tokens,
        tokensCompletion: response.usage?.completion_tokens,
        cost: this.extractCost(response),
        latencyMs,
      };

      return { imageBuffer: extractedImage.imageBuffer, generationId, metadata };
    } catch (error) {
      if (error instanceof TimeoutError || error instanceof AIGenerationError) {
        throw error;
      }
      if (allowTextOnlyFallback && this.isProviderError(error) && images.length > 0) {
        // Fallback: jika image input tidak didukung, coba text-only
        logger.warn('Image input not supported, falling back to text-only');
        return this.generateImageWithInputs(prompt, [], model, allowTextOnlyFallback);
      }
      if (this.isProviderError(error)) {
        throw new ProviderError(this.extractProviderErrorMessage(error));
      }
      throw new AIGenerationError(
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  async buildImprovementPrompt(
    images: ImageGenerationInput[],
    mode: 'single' | 'grid'
  ): Promise<{
    plan: ImprovementPromptPlan;
    generationId: string;
    metadata: {
      tokensPrompt?: number;
      tokensCompletion?: number;
      cost?: number;
      latencyMs?: number;
    };
  }> {
    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      {
        type: 'text',
        text:
          mode === 'single'
            ? this.buildSingleImprovementAgentPrompt()
            : this.buildGridImprovementAgentPrompt(images.length),
      },
    ];

    for (const image of images) {
      const mime =
        image.mimeType && /^image\/[a-z0-9.+-]+$/i.test(image.mimeType)
          ? image.mimeType
          : 'image/png';
      content.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${image.buffer.toString('base64')}` },
      });
    }

    const { content: rawContent, generationId, metadata } = await this.chatCompletion({
      model: config.models.improvementAgent,
      messages: [
        {
          role: 'system',
          content:
            'You are a senior sticker art director and prompt engineer. Return ONLY JSON. Do not include markdown.',
        },
        {
          role: 'user',
          content,
        },
      ],
      responseFormat: { type: 'json_object' },
      timeoutMs: 45000,
    });

    return {
      plan: normalizeImprovementPromptPlan(rawContent, {
        allowTextAssetDecoration: mode === 'single',
      }),
      generationId,
      metadata,
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

  async analyzeCellTextOutsideForeground(imageBuffer: Buffer): Promise<CellTextAnalysisResult> {
    const imageDataUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;
    const baseMessages = [
      {
        role: 'system' as const,
        content:
          'You are a visual text extraction assistant for sticker cells. Return ONLY JSON. Do not include markdown.',
      },
    ];

    const { content: primaryContent } = await this.chatCompletion({
      model: config.models.agent,
      messages: [
        ...baseMessages,
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this single sticker-grid cell image.

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
- No additional keys.`,
            },
            {
              type: 'image_url',
              image_url: { url: imageDataUrl },
            },
          ],
        },
      ],
      responseFormat: { type: 'json_object' },
      timeoutMs: 20000,
    });

    const primaryResult = this.normalizeCellTextAnalysis(primaryContent);
    if (primaryResult.textOutsideForeground.length > 0) {
      return primaryResult;
    }

    const { content: fallbackContent } = await this.chatCompletion({
      model: config.models.agent,
      messages: [
        ...baseMessages,
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Second pass OCR check for this sticker cell.

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
}`,
            },
            {
              type: 'image_url',
              image_url: { url: imageDataUrl },
            },
          ],
        },
      ],
      responseFormat: { type: 'json_object' },
      timeoutMs: 20000,
    });

    return this.normalizeCellTextAnalysis(fallbackContent);
  }

  private normalizeCellTextAnalysis(content: string): CellTextAnalysisResult {
    const parsed = JSON.parse(content) as Partial<CellTextAnalysisResult>;
    const normalizedItems = Array.isArray(parsed.textOutsideForeground)
      ? parsed.textOutsideForeground
          .map((item) => {
            const text = typeof item?.text === 'string' ? item.text.trim() : '';
            const style = item?.style;
            const fontFamily =
              typeof style?.fontFamily === 'string' ? style.fontFamily.trim() : '';
            const color = typeof style?.color === 'string' ? style.color.trim() : '';
            const weight = typeof style?.weight === 'string' ? style.weight.trim() : '';
            if (!text || !fontFamily || !color || !weight) {
              return null;
            }
            return {
              text,
              style: {
                fontFamily,
                color,
                weight,
              },
            } satisfies OutsideForegroundTextDetection;
          })
          .filter((item): item is OutsideForegroundTextDetection => Boolean(item))
      : [];

    return {
      hasTextOutsideForeground:
        typeof parsed.hasTextOutsideForeground === 'boolean'
          ? parsed.hasTextOutsideForeground || normalizedItems.length > 0
          : normalizedItems.length > 0,
      textOutsideForeground: normalizedItems,
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
      const { content } = await this.chatCompletion({
        model: config.models.agent,
        messages: [
          {
            role: 'system',
            content:
              'You are an image analysis assistant. Analyze grid images and identify cell boundaries. You must detect ALL cells including those with stickers/images and text overlays. Account for padding and gaps between cells. Return ONLY a JSON object.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyze this grid image carefully. The image contains a grid layout with multiple cells arranged in rows and columns.

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
              },
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${imageBase64}` },
              },
            ] as unknown as OpenAI.Chat.Completions.ChatCompletionContentPart[],
          },
        ],
        responseFormat: { type: 'json_object' },
        timeoutMs: 30000,
      });

      const parsed = JSON.parse(content) as GridDetectionResult;
      this.validateBoundaries(parsed.boundaries);

      // Validasi: cek apakah boundaries cover gambar dengan baik
      if (imageWidth && imageHeight) {
        const isValid = this.validateGridCoverage(parsed.boundaries, imageWidth, imageHeight);
        if (!isValid) {
          throw new Error('Grid coverage invalid');
        }
      }

      return parsed;
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
   * Decode image dari data URL atau remote URL
   */
  private async extractImageFromMessage(message: unknown): Promise<ExtractedImage> {
    const assistantMsg = message as {
      images?: Array<
        { image_url?: { url?: string } | string; b64_json?: string; image_base64?: string }
      >;
      content?: unknown;
    };

    const decodeCandidates = async (value: unknown): Promise<Buffer | null> => {
      if (!value) {
        return null;
      }

      if (typeof value === 'string') {
        return this.tryDecodeFromString(value);
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          const fromItem = await decodeCandidates(item);
          if (fromItem) {
            return fromItem;
          }
        }
        return null;
      }

      if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const directFields = [
          obj.image_url,
          obj.url,
          obj.b64_json,
          obj.image_base64,
          obj.base64,
          obj.data,
        ];

        for (const field of directFields) {
          const fromField = await decodeCandidates(field);
          if (fromField) {
            return fromField;
          }
        }
      }

      return null;
    };

    const fromImages = await decodeCandidates(assistantMsg.images);
    if (fromImages) {
      return { imageBuffer: fromImages };
    }

    const fromContent = await decodeCandidates(assistantMsg.content);
    if (fromContent) {
      return { imageBuffer: fromContent };
    }

    throw new AIGenerationError('No image data in response');
  }

  private async tryDecodeFromString(value: string): Promise<Buffer | null> {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (trimmed.startsWith('data:image')) {
      return this.decodeImageUrl(trimmed);
    }

    if (/^https?:\/\//i.test(trimmed)) {
      return this.decodeImageUrl(trimmed);
    }

    const dataUriMatch = trimmed.match(/data:image\/[^;]+;base64,([^"\s)]+)/i);
    if (dataUriMatch?.[1]) {
      return Buffer.from(dataUriMatch[1], 'base64');
    }

    const markdownUrlMatch = trimmed.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/i);
    if (markdownUrlMatch?.[1]) {
      return this.decodeImageUrl(markdownUrlMatch[1]);
    }

    if (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length > 128) {
      try {
        return Buffer.from(trimmed, 'base64');
      } catch {
        return null;
      }
    }

    return null;
  }

  private async decodeImageUrl(url: string): Promise<Buffer> {
    if (url.startsWith('data:image')) {
      const match = url.match(/data:image\/[^;]+;base64,([^"\s]+)/);
      if (match?.[1]) {
        return Buffer.from(match[1], 'base64');
      }
      throw new AIGenerationError('Invalid base64 image data');
    }

    if (/^https?:\/\//i.test(url)) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new AIGenerationError(`Failed to fetch generated image URL: ${response.status}`);
      }
      const bytes = await response.arrayBuffer();
      return Buffer.from(bytes);
    }

    throw new AIGenerationError('Unsupported image URL format');
  }

  /**
   * Cek apakah error berasal dari provider
   */
  private isProviderError(error: unknown): boolean {
    if (error instanceof Error) {
      const providerError = error as ProviderErrorResponse;
      return (
        error.message.includes('Provider returned error') ||
        error.message.includes('502') ||
        providerError.status === 502
      );
    }
    return false;
  }

  /**
   * Extract error message dari provider error
   */
  private extractProviderErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      const providerError = error as ProviderErrorResponse;
      if (providerError.error?.metadata?.raw) {
        return `${error.message}: ${providerError.error.metadata.raw}`;
      }
      return error.message;
    }
    return 'Provider error';
  }

  /**
   * Extract cost dari response
   */
  private extractCost(response: unknown): number | undefined {
    const r = response as { usage?: { cost?: number }; cost?: number };
    return r.usage?.cost ?? r.cost ?? undefined;
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
