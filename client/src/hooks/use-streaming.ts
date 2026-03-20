import { useState, useCallback, useRef, useEffect } from "react";

interface StreamingState {
  text: string;
  isStreaming: boolean;
  error: string | null;
  done: boolean;
}

interface StepUpdate {
  stepId: string;
  status: string;
  label: string;
  detail?: string;
}

interface ProgressUpdate {
  message: string;
  percent?: number;
}

interface StreamingOptions {
  method?: "GET" | "POST";
  onChunk?: (chunk: string, fullText: string) => void;
  onDone?: (fullText: string, rawData?: any) => void;
  onError?: (error: string) => void;
  onStep?: (step: StepUpdate) => void;
  onProgress?: (progress: ProgressUpdate) => void;
  onResult?: (data: any) => void;
  onAction?: (action: any) => void;
  onGrounding?: (grounding: any) => void;
}

export function useStreamingResponse() {
  const [state, setState] = useState<StreamingState>({
    text: "",
    isStreaming: false,
    error: null,
    done: false,
  });

  const abortRef = useRef<AbortController | null>(null);

  const stopStreaming = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setState(prev => ({ ...prev, isStreaming: false }));
  }, []);

  const startStream = useCallback(async (
    url: string,
    body: any,
    options: StreamingOptions = {}
  ) => {
    stopStreaming();

    const controller = new AbortController();
    abortRef.current = controller;

    setState({ text: "", isStreaming: true, error: null, done: false });

    try {
      const isGet = options.method === "GET";
      const response = await fetch(url, {
        method: isGet ? "GET" : "POST",
        ...(isGet ? {} : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Request failed" }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith(":")) continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6);
          try {
            const data = JSON.parse(jsonStr);

            if (data.error) {
              if (abortRef.current) {
                abortRef.current.abort();
                abortRef.current = null;
              }
              setState(prev => ({ ...prev, error: data.error, isStreaming: false }));
              options.onError?.(data.error);
              return;
            }

            if (data.done) {
              abortRef.current = null;
              const finalText = data.fullText || accumulated;
              setState(prev => ({ ...prev, text: finalText, isStreaming: false, done: true }));
              options.onDone?.(finalText, data);
              return;
            }

            if (data.type === "step") {
              options.onStep?.({
                stepId: data.stepId,
                status: data.status,
                label: data.label,
                detail: data.detail,
              });
              continue;
            }

            if (data.type === "progress") {
              options.onProgress?.({
                message: data.message,
                percent: data.percent,
              });
              continue;
            }

            if (data.type === "result") {
              const { type, ...rest } = data;
              options.onResult?.(rest);
              continue;
            }

            if (data.type === "action" || data.type === "navigation" || data.type === "session" || data.type === "approval_required") {
              options.onAction?.(data);
              continue;
            }

            if (data.type === "grounding") {
              options.onGrounding?.(data.grounding);
              continue;
            }

            if (data.content) {
              accumulated += data.content;
              setState(prev => ({ ...prev, text: accumulated }));
              options.onChunk?.(data.content, accumulated);
            }
          } catch {}
        }
      }

      setState(prev => ({ ...prev, isStreaming: false, done: true }));
      options.onDone?.(accumulated);
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setState(prev => ({ ...prev, error: err.message, isStreaming: false }));
      options.onError?.(err.message);
    }
  }, [stopStreaming]);

  const reset = useCallback(() => {
    stopStreaming();
    setState({ text: "", isStreaming: false, error: null, done: false });
  }, [stopStreaming]);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  return {
    ...state,
    startStream,
    stopStreaming,
    reset,
  };
}
