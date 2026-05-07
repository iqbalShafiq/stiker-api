import OpenAI from 'openai';
import sharp from 'sharp';
import { config } from '../config';
import {
  AIGenerationError,
  GridDetectionError,
  ProviderError,
  TimeoutError,
} from '../errors';
import type { GridBoundary, GridDetectionResult } from '../types';

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
          messages: options.messages as any,
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
    imageMimeType: string = 'image/png'
  ): Promise<GenerationResult> {
    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> =
      [{ type: 'text', text: prompt }];

    if (base64Image) {
      const mime =
        imageMimeType && /^image\/[a-z0-9.+-]+$/i.test(imageMimeType)
          ? imageMimeType
          : 'image/png';
      content.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${base64Image}` },
      });
    }

    const startTime = Date.now();

    try {
      const response = await Promise.race([
        this.client.chat.completions.create({
          model: config.models.imageGeneration,
          messages: [{ role: 'user', content: content as any }],
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

      /** OpenRouter adds `images[]` — not on upstream ChatCompletionMessage typings. */
      const assistantMsg = message as {
        images?: Array<{ image_url?: { url?: string } }>;
        content?: unknown;
      };

      // Extract image dari message.images[] (OpenRouter image generation format)
      let imageBuffer: Buffer | undefined;

      if (
        assistantMsg.images &&
        Array.isArray(assistantMsg.images) &&
        assistantMsg.images.length > 0
      ) {
        const imageData = assistantMsg.images[0];
        if (imageData.image_url?.url) {
          imageBuffer = this.decodeImageUrl(imageData.image_url.url);
        }
      }

      // Fallback: cek content array
      if (!imageBuffer && Array.isArray(assistantMsg.content)) {
        for (const part of assistantMsg.content) {
          if (typeof part === 'object' && part !== null && 'image_url' in part && part.image_url?.url) {
            imageBuffer = this.decodeImageUrl(part.image_url.url);
            break;
          }
        }
      }

      // Fallback: cek content string
      if (!imageBuffer && typeof assistantMsg.content === 'string') {
        const match = assistantMsg.content.match(/data:image\/[^;]+;base64,([^"\s]+)/);
        if (match?.[1]) {
          imageBuffer = Buffer.from(match[1], 'base64');
        }
      }

      if (!imageBuffer) {
        throw new AIGenerationError('No image data in response');
      }

      const metadata = {
        tokensPrompt: response.usage?.prompt_tokens,
        tokensCompletion: response.usage?.completion_tokens,
        cost: this.extractCost(response),
        latencyMs,
      };

      return { imageBuffer, generationId, metadata };
    } catch (error) {
      if (error instanceof TimeoutError || error instanceof AIGenerationError) {
        throw error;
      }
      if (this.isProviderError(error) && base64Image) {
        // Fallback: jika image input tidak didukung, coba text-only
        console.warn('Image input not supported, falling back to text-only');
        return this.generateImage(prompt, undefined, imageMimeType);
      }
      if (this.isProviderError(error)) {
        throw new ProviderError(this.extractProviderErrorMessage(error));
      }
      throw new AIGenerationError(
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
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
      console.log(`Using user-specified grid layout: ${forceRows}x${forceCols}`);
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
            ] as any,
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
      console.warn('AI grid detection failed, falling back to auto-detection:', aiError);

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
  private decodeImageUrl(url: string): Buffer {
    if (url.startsWith('data:image')) {
      const match = url.match(/data:image\/[^;]+;base64,([^"\s]+)/);
      if (match?.[1]) {
        return Buffer.from(match[1], 'base64');
      }
      throw new AIGenerationError('Invalid base64 image data');
    }

    // Remote URL - fetch
    throw new AIGenerationError('Remote image URLs not yet supported');
  }

  /**
   * Cek apakah error berasal dari provider
   */
  private isProviderError(error: unknown): boolean {
    if (error instanceof Error) {
      return (
        error.message.includes('Provider returned error') ||
        error.message.includes('502') ||
        (error as any).status === 502
      );
    }
    return false;
  }

  /**
   * Extract error message dari provider error
   */
  private extractProviderErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      const anyError = error as any;
      if (anyError.error?.metadata?.raw) {
        return `${anyError.message}: ${anyError.error.metadata.raw}`;
      }
      return error.message;
    }
    return 'Provider error';
  }

  /**
   * Extract cost dari response
   */
  private extractCost(response: any): number | undefined {
    return response.usage?.cost ?? response.cost ?? undefined;
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
