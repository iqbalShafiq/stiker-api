import OpenAI from 'openai';
import { config } from '../config';
import type { GridBoundary, GridDetectionResult } from '../types';

export class OpenRouterService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: config.openRouterApiKey,
      defaultHeaders: {
        'HTTP-Referer': config.appUrl,
        'X-Title': 'WhatsApp Sticker API',
      },
    });
  }

  async generateImage(prompt: string, base64Image?: string): Promise<{ imageBuffer: Buffer; generationId: string }> {
    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: 'text', text: prompt },
    ];

    if (base64Image) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${base64Image}` },
      });
    }

    const response = await this.client.chat.completions.create({
      model: config.models.imageGeneration,
      messages: [
        {
          role: 'user',
          content: content as unknown as string,
        },
      ],
    });

    const generationId = response.id;

    const message = response.choices[0]?.message;
    let imageBuffer: Buffer;

    if (message?.content) {
      const base64Match = message.content.match(/data:image\/[^;]+;base64,([^"\s]+)/);
      if (base64Match?.[1]) {
        imageBuffer = Buffer.from(base64Match[1], 'base64');
      } else {
        throw new Error('AI_GENERATION_FAILED: No image data in response');
      }
    } else {
      throw new Error('AI_GENERATION_FAILED: No content in response');
    }

    return { imageBuffer, generationId };
  }

  async detectGridBoundaries(imageBase64: string): Promise<GridDetectionResult> {
    const response = await this.client.chat.completions.create({
      model: config.models.agent,
      messages: [
        {
          role: 'system',
          content: 'You are an image analysis assistant. Analyze grid images and identify cell boundaries. Return ONLY a JSON object with gridLayout and boundaries array.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Analyze this grid image and identify the boundaries of each individual cell. Return a JSON object with format: { "gridLayout": "2x2", "boundaries": [{ "x": 0, "y": 0, "width": 100, "height": 100 }] }',
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${imageBase64}` },
            },
          ] as unknown as string,
        },
      ],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('GRID_DETECTION_FAILED: No response from AI');
    }

    try {
      const parsed = JSON.parse(content) as GridDetectionResult;
      this.validateBoundaries(parsed.boundaries);
      return parsed;
    } catch {
      throw new Error('GRID_DETECTION_FAILED: Invalid response format');
    }
  }

  getGenerationMetadata(_generationId: string): {
    tokensPrompt?: number;
    tokensCompletion?: number;
    cost?: number;
    latencyMs?: number;
  } {
    // OpenRouter OpenAI-compatible endpoint doesn't expose generation metadata directly.
    // Use OpenRouter native API or SDK for detailed metadata.
    return {};
  }

  private validateBoundaries(boundaries: GridBoundary[]): void {
    for (const boundary of boundaries) {
      if (boundary.x < 0 || boundary.y < 0) {
        throw new Error('GRID_DETECTION_FAILED: Invalid boundary coordinates');
      }
      if (boundary.width <= 0 || boundary.height <= 0) {
        throw new Error('GRID_DETECTION_FAILED: Invalid boundary dimensions');
      }
    }
  }
}
