export type ApiCall = (
  action: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
  onDelta?: (text: string) => void,
) => Promise<any>;
export function makeApi(getToken: () => Promise<string | null>): ApiCall {
  return async (action, body = {}, signal, onDelta) => {
    const token = await getToken();
    const response = await fetch("/api/workspace", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        ...body,
        action,
        ...(onDelta ? { stream: true } : {}),
      }),
      signal: signal
        ? AbortSignal.any([
            signal,
            AbortSignal.timeout(action === "chat" ? 58000 : 55000),
          ])
        : AbortSignal.timeout(action === "chat" ? 58000 : 55000),
    });
    if (
      onDelta &&
      response.ok &&
      response.headers.get("content-type")?.includes("text/event-stream")
    ) {
      const reader = response.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = "",
        result: any;
      const consume = (part: string) => {
        let event = "",
          raw = "";
        for (const line of part.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) raw += line.slice(5).trim();
        }
        if (!raw) return;
        const data = JSON.parse(raw);
        if (event === "delta") onDelta(data.text);
        if (event === "done") result = data;
        if (event === "error") throw new Error(data.error);
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split(/\r?\n\r?\n/);
          buffer = parts.pop() || "";
          for (const part of parts) consume(part);
        }
        if (buffer.trim()) consume(buffer);
        if (!result)
          throw new Error(
            "Connection interrupted. Reopen the conversation to check the saved answer.",
          );
        return result;
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new Error(
        "Workspace API did not return JSON. Check the API deployment.",
      );
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Object.assign(new Error(data.error || `Request failed (${response.status}).`), { status: response.status });
    return data;
  };
}
export interface Conversation {
  id: string;
  title: string;
  thinking: boolean;
  updated_at: string;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  created_at?: string;
  model?: string;
  metadata?: any;
}
