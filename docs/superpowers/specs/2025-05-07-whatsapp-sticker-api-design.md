# WhatsApp Sticker API - Design Specification

> **Date:** 2025-05-07
> **Status:** Approved
> **Author:** AI Assistant

## Overview

Express TypeScript API untuk generate WhatsApp stickers menggunakan OpenRouter AI. API menerima input text dan/atau image, menggenerate sticker images, dan menyimpannya ke local storage.

## Goals

1. Generate WhatsApp sticker images dari text prompt (dengan optional image context)
2. Split grid images menjadi individual sticker images
3. Remove background dari sticker images
4. Menyediakan OpenAPI documentation via Scalar
5. Secure, testable, dan type-safe codebase

## Non-Goals

1. Authentication/authorization (scalable interface tapi tidak diimplementasikan)
2. Database persistence (local storage only)
3. Cloud storage integration
4. Real-time streaming responses

## Architecture

Monolithic Express service dengan layered architecture:
- **Routes** → HTTP endpoint definitions
- **Controllers** → Request/response handling
- **Services** → Business logic & external integrations
- **Middleware** → Cross-cutting concerns (validation, error handling, upload)
- **Utils** → Shared helpers & response builders

## Tech Stack

- **Runtime:** Node.js 20+, Express 4, TypeScript 5.4
- **AI:** OpenRouter SDK (`@openrouter/sdk`) v1.x
- **Image Processing:** Sharp v0.33
- **Validation:** Zod v3
- **Upload:** Multer v1
- **API Docs:** Scalar (`@scalar/express-api-reference`)
- **Testing:** Vitest v1, Supertest v6
- **Lint:** ESLint 9 (`typescript-eslint`)
- **TypeCheck:** TypeScript compiler (`tsc --noEmit`)

## File Structure

```
stiker-api/
├── src/
│   ├── config/
│   │   └── index.ts
│   ├── controllers/
│   │   ├── generate.controller.ts
│   │   ├── grid.controller.ts
│   │   └── background.controller.ts
│   ├── services/
│   │   ├── openrouter.service.ts
│   │   ├── image.service.ts
│   │   └── storage.service.ts
│   ├── middleware/
│   │   ├── error-handler.ts
│   │   ├── validate-request.ts
│   │   └── upload-handler.ts
│   ├── utils/
│   │   ├── response-builder.ts
│   │   └── validators.ts
│   ├── types/
│   │   └── index.ts
│   ├── app.ts
│   └── server.ts
├── tests/
│   ├── unit/
│   │   ├── services/
│   │   └── utils/
│   └── integration/
│       └── routes/
├── uploads/
├── docs/
│   └── openapi.yaml
├── .env.example
├── eslint.config.mjs
├── tsconfig.json
└── package.json
```

## API Endpoints

### 1. POST /api/v1/generate
Generate WhatsApp sticker image dari text prompt.

**Input:**
- `text` (string, required) - Prompt untuk generate sticker
- `image` (file, optional) - Reference image sebagai context
- `grid` (boolean, optional, default false) - Output grid layout

**Flow:**
1. Validasi input dengan Zod
2. Jika ada image, convert ke base64 untuk multimodal input
3. Kirim request ke OpenRouter dengan model `sourceful/riverflow-v2-standard-preview`
4. Simpan generated image ke `uploads/` dengan UUID filename
5. Jika `grid=true`, gunakan AI agent (`google/gemma-4-31b-it`) dengan tool `markGridBoundaries` untuk detect grid boundaries
6. Split image menggunakan Sharp berdasarkan koordinat dari AI
7. Simpan hasil split ke `uploads/`
8. Return JSON dengan array image URLs

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "images": [
      {
        "id": "uuid-1",
        "url": "/uploads/uuid-1.png",
        "width": 512,
        "height": 512
      }
    ],
    "metadata": {
      "model": "sourceful/riverflow-v2-standard-preview",
      "tokensPrompt": 120,
      "tokensCompletion": 450,
      "cost": 0.0032
    }
  },
  "meta": {
    "timestamp": "2025-05-07T10:00:00.000Z",
    "requestId": "req-uuid"
  }
}
```

### 2. POST /api/v1/grid/split
Split grid image menjadi individual images.

**Input:**
- `image` (file, required) - Grid image

**Flow:**
1. Validasi input
2. AI agent (`google/gemma-4-31b-it`) diberikan tool `markGridBoundaries`
3. AI menganalisis image dan return koordinat grid
4. Validasi koordinat (non-overlapping, within bounds)
5. Split image menggunakan Sharp secara deterministik
6. Simpan hasil ke `uploads/`
7. Return JSON array URLs

**Response:** Sama format dengan endpoint generate

### 3. POST /api/v1/background/remove
Remove background dari image.

**Input:**
- `image` (file, required) - Image untuk dihapus background-nya

**Flow:**
1. Validasi input
2. Gunakan Sharp dengan threshold-based alpha masking untuk menghapus background
3. Simpan hasil PNG dengan transparency ke `uploads/`
4. Return JSON URL

**Response:**
```json
{
  "success": true,
  "data": {
    "image": {
      "id": "uuid-1",
      "url": "/uploads/uuid-1.png",
      "width": 512,
      "height": 512
    },
    "metadata": { ... }
  }
}
```

## OpenRouter Integration

### SDK Setup
```typescript
import { OpenRouter, tool } from "@openrouter/sdk";

const client = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  httpReferer: process.env.APP_URL,
  xTitle: "WhatsApp Sticker API",
});
```

### Image Generation
```typescript
const response = await client.responses.create({
  model: "sourceful/riverflow-v2-standard-preview",
  input: [{ type: "text", text: prompt }],
  modalities: ["text", "image"],
  imageConfig: {
    "sourceful/riverflow-v2-standard-preview": {
      quality: "high",
      size: "1024x1024"
    }
  }
});
```

### Tool Definition (Grid Boundaries)
```typescript
const markGridBoundaries = tool({
  name: "markGridBoundaries",
  description: "Mark the boundaries of individual images within a grid layout",
  inputSchema: z.object({
    gridLayout: z.enum(["2x2", "3x3", "4x4", "2x3", "3x2"]),
    boundaries: z.array(z.object({
      x: z.number().min(0),
      y: z.number().min(0),
      width: z.number().positive(),
      height: z.number().positive()
    })).min(2)
  }),
  execute: async (params) => params
});
```

### Metadata Retrieval
Setelah generate, gunakan `client.generations.getGeneration({ id })` untuk mendapatkan token usage dan cost.

## Data Models

### Image Result
```typescript
interface ImageResult {
  id: string;
  url: string;
  width: number;
  height: number;
}
```

### Generation Metadata
```typescript
interface GenerationMetadata {
  model: string;
  tokensPrompt?: number;
  tokensCompletion?: number;
  cost?: number;
  latencyMs?: number;
}
```

### API Response Wrapper
```typescript
interface ApiResponse<T> {
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
```

## Error Handling

### HTTP Status Codes
- `200` - Success
- `400` - Bad Request (validation error)
- `413` - Payload Too Large
- `415` - Unsupported Media Type
- `422` - Unprocessable Entity (AI parse failure)
- `500` - Internal Server Error
- `502` - Bad Gateway (OpenRouter error)
- `503` - Service Unavailable (rate limited)

### Error Codes
- `VALIDATION_ERROR`
- `FILE_TOO_LARGE` (max 10MB)
- `INVALID_FILE_TYPE` (png, jpg, jpeg, webp only)
- `AI_GENERATION_FAILED`
- `GRID_DETECTION_FAILED`
- `BACKGROUND_REMOVAL_FAILED`
- `INTERNAL_ERROR`

## Security

1. **File Upload:** Max 10MB, whitelist MIME types, UUID filenames
2. **Path Traversal:** Sanitize semua file paths
3. **Input Validation:** Zod schemas untuk semua inputs
4. **Rate Limiting:** Interface ready (middleware placeholder)
5. **CORS:** Configurable via env var
6. **Helmet:** Security headers enabled

## Testing Strategy

### Unit Tests
- `openrouter.service.test.ts` - Mock SDK, test chat & tool calling
- `image.service.test.ts` - Test Sharp operations, grid splitting
- `storage.service.test.ts` - Test file I/O operations
- `response-builder.test.ts` - Test response wrapper
- `validators.test.ts` - Test Zod schemas

### Integration Tests
- `generate.route.test.ts` - Full flow dengan mock OpenRouter
- `grid.route.test.ts` - Grid split endpoint
- `background.route.test.ts` - Background removal endpoint
- Error handling scenarios

**Target Coverage:** >80% line coverage

## Environment Variables

```
PORT=3000
NODE_ENV=development
OPENROUTER_API_KEY=your_api_key_here
APP_URL=http://localhost:3000
MAX_FILE_SIZE=10485760
UPLOAD_DIR=uploads
CORS_ORIGIN=*
```

## Future Considerations

1. **Authentication:** JWT middleware siap ditambahkan
2. **Database:** PostgreSQL/MongoDB untuk tracking generation history
3. **Cloud Storage:** S3/GCS integration untuk scalable file storage
4. **Queue:** Bull/Redis untuk async processing pada high load
5. **Monitoring:** Prometheus metrics & structured logging
6. **Background Removal AI:** Upgrade ke model AI khusus jika tersedia di OpenRouter
