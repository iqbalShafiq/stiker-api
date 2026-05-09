/** Caption-like text detected outside the sticker subject for one cell image (grid split / generate grid). */
export interface TextOutsideForeground {
  text: string;
  style: {
    fontFamily: string;
    color: string;
    weight: string;
  };
}

export interface ImageResult {
  id: string;
  url: string;
  width: number;
  height: number;
  /** Present when analysis found caption-style text outside the sticker foreground for this cell. */
  textOutsideForeground?: TextOutsideForeground;
}

export interface GenerationMetadata {
  model: string;
  tokensPrompt?: number;
  tokensCompletion?: number;
  cost?: number;
  latencyMs?: number;
  gridLayout?: string;
  cellCount?: number;
  normalizedImageUrl?: string;
  outputSize?: string;
  normalized?: boolean;
  /** Server-side removal; /generate uses prompt-only transparency (typically false). */
  backgroundRemoved?: boolean;
  backgroundRemovalMethod?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    timestamp: string;
    requestId: string;
  };
}

export interface GridBoundary {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridDetectionResult {
  gridLayout: string;
  boundaries: GridBoundary[];
}
