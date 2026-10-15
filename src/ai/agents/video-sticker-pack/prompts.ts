import type { UserMessage } from '@anvia/core';
import { buildUserContent } from '../../completion';
import {
  VIDEO_STICKER_PACK_DEFAULT_ANIMATED_COUNT,
  VIDEO_STICKER_PACK_DEFAULT_STATIC_COUNT,
} from '../../../utils/video-sticker-pack';
import type { VideoStickerPackAgentInput } from './agent';

export function buildVideoStickerPackAgentUserMessage(
  input: VideoStickerPackAgentInput
): UserMessage {
  const stylePrompt = input.prompt?.trim();
  const text = `Create a video sticker pack manifest.

Optional user style prompt: ${stylePrompt && stylePrompt.length > 0 ? stylePrompt : '(none)'}

Selected range: ${input.selectedStartMs}ms to ${input.selectedEndMs}ms.
Source duration: ${input.sourceDurationMs ?? 'unknown'}ms.
Candidate count: ${input.candidates.length}.
Candidate manifest:
${JSON.stringify(input.candidates, null, 2)}`;

  return {
    role: 'user',
    content: buildUserContent({ text, images: input.candidateGrids }),
  };
}

export function buildSystemPrompt(input: VideoStickerPackAgentInput): string {
  const maxStatic = input.maxStaticStickers ?? VIDEO_STICKER_PACK_DEFAULT_STATIC_COUNT;
  const maxAnimated = input.maxAnimatedStickers ?? VIDEO_STICKER_PACK_DEFAULT_ANIMATED_COUNT;

  return `You are Setiker's video-to-WhatsApp-sticker art director.

Goal:
- Analyze labeled candidate grid images and metadata.
- Select the best clear frames for static stickers.
- Select short coherent frame timelines for animated stickers only when motion looks useful.
- Return a JSON manifest only. Do not generate or edit images.

Rules:
- Prefer clear, expressive, non-blurry, non-duplicate frames.
- Use candidateId references from metadata exactly.
- Always include every field of the JSON manifest, even when empty: use empty strings or empty arrays rather than omitting keys.
- Static sticker count target: up to ${maxStatic}.
- Animated sticker count target: up to ${maxAnimated}; use zero animated stickers if no good motion exists.
- Total stickers must be at most 16.
- Animated timelines should be 2-24 frames, ordered by timestamp, and <= 10 seconds total.
- Keep text decorations short and readable. Use bottom-caption placement unless there is a strong reason not to.
- Decoration entries are exactly {"type":"emoji","emoji":"..."} or {"type":"text","text":"...","style":{"fontFamily":"...","color":"...","weight":"..."}}; never add placement or extra fields.
- Keep backend work cheap: use the provided tools and visual reasoning; do not ask for image generation.
- Before final answer, call validate_sticker_pack_plan and fix any validation errors.`;
}
