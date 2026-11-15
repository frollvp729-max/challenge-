import { config } from "../config.js";

/**
 * Небольшой клиент Bot API мессенджера Max (https://dev.max.ru/docs-api).
 * Токен передаётся в заголовке Authorization, тела запросов и ответов в JSON.
 */

export interface MaxUser {
  user_id: number;
  first_name?: string;
  last_name?: string | null;
  username?: string | null;
  name?: string;
  is_bot?: boolean;
}

export type MaxButton =
  | { type: "callback"; text: string; payload: string }
  | { type: "link"; text: string; url: string }
  | { type: "open_app"; text: string; web_app?: string; payload?: string };

export interface MaxMessageBody {
  text: string;
  format?: "html" | "markdown";
  attachments?: Array<{ type: "inline_keyboard"; payload: { buttons: MaxButton[][] } }>;
  notify?: boolean;
}

export interface MaxUpdate {
  update_type: string;
  timestamp: number;
  chat_id?: number;
  user?: MaxUser;
  payload?: string | null;
  message?: {
    sender?: MaxUser | null;
    recipient?: { chat_id: number | null; user_id: number | null };
    body?: { mid: string; text: string | null };
  };
  callback?: { callback_id: string; payload?: string; user: MaxUser };
}

export class MaxError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function maxCall<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  opts: { query?: Record<string, string | number | undefined>; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const url = new URL(`${config.maxApiUrl}/${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: config.maxBotToken,
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new MaxError(res.status, String(data.code ?? ""), String(data.message ?? `HTTP ${res.status}`));
  }
  return data as T;
}

export const maxApi = {
  me: () => maxCall<{ user_id: number; username?: string | null; first_name?: string; name?: string }>("GET", "me"),
  sendToUser: (userId: number | bigint, body: MaxMessageBody) =>
    maxCall("POST", "messages", { query: { user_id: String(userId) }, body }),
  answerCallback: (callbackId: string, answer: { notification?: string; message?: MaxMessageBody }) =>
    maxCall("POST", "answers", { query: { callback_id: callbackId }, body: answer }),
  getUpdates: (marker: number | undefined, signal?: AbortSignal) =>
    maxCall<{ updates: MaxUpdate[]; marker?: number | null }>("GET", "updates", {
      query: { marker, timeout: 30, limit: 100, types: "bot_started,message_created,message_callback" },
      signal,
    }),
  setCommands: (commands: Array<{ name: string; description: string }>) => maxCall("PATCH", "me/commands", { body: { commands } }),
};
