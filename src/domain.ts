export type ResponseMode = "mock" | "openai-synthetic" | "codex-synthetic";
export interface Message { role: "user" | "assistant"; text: string; sequence: number }
export type RoomId = "main" | "side" | "group";
export interface ConversationMessage extends Message {
  eventId: string; roomId: string; speakerId: string; speakerLabel: string; sentAtMs: number; groupId: string;
}
export interface ContextReport {
  roomId: string; targetSequence: number; selectedMessages: number; selectedGroups: number;
  serializedBytes: number; maxBytes: number; maxMessages: number; windowMs: number;
  dropped: { time: number; gap: number; count: number; bytes: number; afterTarget: number };
  dateBoundary: boolean; longGap: boolean; multipleSpeakers: boolean; requiresReview: boolean;
}
export interface ReplyInput {
  relationshipDescription: string; sessionMessages: readonly Message[];
  conversation?: { roomId: string; targetSpeakerId: string; report: ContextReport };
}
export interface ProviderInfo { mode: ResponseMode; ready: boolean; model: string | null; notice: string; remainingRequests: number | null }
export interface Responder { readonly info: ProviderInfo; respond(input: ReplyInput): string | Promise<string> }
export class ServiceError extends Error {
  constructor(public readonly status: number, message: string, public readonly code = "request_error") { super(message); }
}
