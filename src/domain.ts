export type ResponseMode = "mock" | "openai-synthetic";
export interface Message { role: "user" | "assistant"; text: string; sequence: number }
export interface ReplyInput { relationshipDescription: string; sessionMessages: readonly Message[] }
export interface ProviderInfo { mode: ResponseMode; ready: boolean; model: string | null; notice: string; remainingRequests: number | null }
export interface Responder { readonly info: ProviderInfo; respond(input: ReplyInput): string | Promise<string> }
export class ServiceError extends Error {
  constructor(public readonly status: number, message: string, public readonly code = "request_error") { super(message); }
}
