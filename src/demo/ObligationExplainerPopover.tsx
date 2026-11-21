import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import { parseStreamedExplanation } from "./helpers";
import type { Obligation, ObligationExplanationResponse } from "./types";

interface ObligationExplainerPopoverProps {
  obligation: Obligation | null;
  data: ObligationExplanationResponse | null;
  loading: boolean;
  isStreaming?: boolean;
  streamRawText?: string;
  streamModel?: string | null;
  streamTokenCount?: number;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}

type AudioState = "idle" | "loading" | "playing" | "paused";

const RATE_OPTIONS = [1.0, 0.95, 1.15] as const;

function ensureSentencePeriod(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function buildSpokenScript(data: ObligationExplanationResponse): string {
  return [
    data.headline,
    data.explanation,
    ...(data.key_points.length > 0 ? ["Key takeaways.", ...data.key_points] : []),
  ]
    .map(ensureSentencePeriod)
    .filter(Boolean)
    .join(" ");
}

export default function ObligationExplainerPopover({
  obligation,
  data,
  loading,
  isStreaming = false,
  streamRawText = "",
  streamModel = null,
  streamTokenCount = 0,
  error,
  onRetry,
  onClose,
}: ObligationExplainerPopoverProps) {
  const [audioState, setAudioState] = useState<AudioState>("idle");
  const [audioError, setAudioError] = useState<string | null>(null);
  const [rateIndex, setRateIndex] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioAbortRef = useRef<AbortController | null>(null);
  const audioUrlCacheRef = useRef<Map<string, string>>(new Map());

  const rate = RATE_OPTIONS[rateIndex];

  const stopAudio = useCallback(() => {
    audioAbortRef.current?.abort();
    audioAbortRef.current = null;
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      } catch {
        // Ignore media reset errors in non-browser test runners
      }
      audioRef.current = null;
    }
    setAudioState("idle");
  }, []);

  useEffect(() => {
    stopAudio();
    setAudioError(null);
    return () => {
      stopAudio();
    };
  }, [obligation?.id, data?.explanation, stopAudio]);

  useEffect(() => {
    const cache = audioUrlCacheRef.current;
    return () => {
      for (const url of cache.values()) {
        try {
          URL.revokeObjectURL?.(url);
        } catch {
          // Ignore URL revocation errors
        }
      }
      cache.clear();
    };
  }, []);

  const playFromObjectUrl = useCallback(async (objectUrl: string, targetRate: number) => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch {
        // Ignore pause errors
      }
    }

    const audio = new Audio(objectUrl);
    audio.playbackRate = targetRate;
    audio.onplay = () => setAudioState("playing");
    audio.onpause = () => {
      if (!audio.ended) {
        setAudioState("paused");
      }
    };
    audio.onended = () => {
      setAudioState("idle");
    };
    audio.onerror = () => {
      setAudioState("idle");
      setAudioError("Unable to play ElevenLabs neural audio stream.");
    };

    audioRef.current = audio;
    setAudioState("playing");
    await audio.play();
  }, []);

  const startPlayback = useCallback(async () => {
    if (!obligation || !data) return;
    setAudioError(null);

    const script = buildSpokenScript(data);
    const cacheKey = `${obligation.id}:${script}`;
    const cachedUrl = audioUrlCacheRef.current.get(cacheKey);
    if (cachedUrl) {
      try {
        await playFromObjectUrl(cachedUrl, rate);
      } catch (err) {
        setAudioState("idle");
        setAudioError(
          err instanceof Error ? err.message : "Unable to start ElevenLabs audio playback."
        );
      }
      return;
    }

    audioAbortRef.current?.abort();
    const controller = new AbortController();
    audioAbortRef.current = controller;
    setAudioState("loading");

    try {
      const res = await fetch(
        `/api/obligations/${encodeURIComponent(obligation.id)}/explain/audio`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: script }),
          signal: controller.signal,
        }
      );

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(
          errBody.detail || `ElevenLabs neural voice request failed (HTTP ${res.status})`
        );
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      audioUrlCacheRef.current.set(cacheKey, objectUrl);
      await playFromObjectUrl(objectUrl, rate);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      setAudioState("idle");
      setAudioError(
        err instanceof Error ? err.message : "Unable to synthesize ElevenLabs neural audio."
      );
    } finally {
      if (audioAbortRef.current === controller) {
        audioAbortRef.current = null;
      }
    }
  }, [obligation, data, playFromObjectUrl, rate]);

  function handlePlayPause() {
    if (!data || audioState === "loading") return;
    if (audioState === "playing") {
      try {
        audioRef.current?.pause();
        setAudioState("paused");
      } catch {
        stopAudio();
      }
      return;
    }
    if (audioState === "paused" && audioRef.current) {
      try {
        audioRef.current.playbackRate = rate;
        setAudioState("playing");
        void audioRef.current.play();
      } catch {
        void startPlayback();
      }
      return;
    }
    void startPlayback();
  }

  function handleReplay() {
    if (audioRef.current) {
      try {
        audioRef.current.currentTime = 0;
        audioRef.current.playbackRate = rate;
        setAudioState("playing");
        void audioRef.current.play();
        return;
      } catch {
        // Fall through to fresh playback
      }
    }
    void startPlayback();
  }

  function handleCycleRate() {
    const nextIdx = (rateIndex + 1) % RATE_OPTIONS.length;
    const nextRate = RATE_OPTIONS[nextIdx];
    setRateIndex(nextIdx);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  }

  function handleClose() {
    stopAudio();
    onClose();
  }

  if (!obligation) return null;

  const isOpenRouter = data?.ai_metadata?.mode === "openrouter";
  const parsedStream = isStreaming && !data ? parseStreamedExplanation(streamRawText) : null;
  const hasStreamContent = Boolean(
    parsedStream &&
      (parsedStream.headline ||
        parsedStream.explanation ||
        parsedStream.key_points.length > 0)
  );
  const streamCaret = (
    <span
      aria-hidden="true"
      className="ml-0.5 inline-block h-3.5 w-1.5 align-middle bg-teal-600 animate-[rb-caret-blink_0.9s_steps(1)_infinite] motion-reduce:animate-none"
    />
  );

  return (
    <aside
      role="dialog"
      aria-label="AI Clinical Explainer"
      className="fixed bottom-5 right-5 z-40 w-[min(430px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-teal-200/90 bg-white/95 shadow-2xl backdrop-blur-md"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 bg-gradient-to-r from-teal-50/90 via-white to-indigo-50/70 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white shadow-2xs">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="text-xs font-semibold text-slate-900">AI Clinical Explainer</h3>
              <span className="font-mono text-[11px] font-medium text-slate-500">
                {obligation.id}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                <ShieldCheck className="h-2.5 w-2.5" aria-hidden="true" />
                UAE Firewall · 0 PHI
              </span>
              {isStreaming && !data ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-teal-800">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-600 motion-reduce:animate-none"
                  />
                  Streaming{streamModel ? ` · ${streamModel}` : ""}
                  {streamTokenCount > 0 ? ` (${streamTokenCount})` : ""}
                </span>
              ) : data ? (
                <span className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                  {isOpenRouter ? data.ai_metadata.model : "Local Fallback"}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleClose}
          aria-label="Close AI explainer"
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Body */}
      <div className="max-h-[60vh] overflow-y-auto px-4 py-3.5 text-xs">
        {isStreaming && !data && hasStreamContent && parsedStream && (
          <div className="space-y-3" aria-live="polite">
            <div className="flex items-center justify-between gap-2 rounded-xl border border-teal-200/70 bg-teal-50/40 px-3 py-2">
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600/60 px-2.5 py-1 text-[11px] font-semibold text-white opacity-80"
              >
                <Volume2 className="h-3 w-3" aria-hidden="true" />
                Streaming…
              </button>
              <span className="font-mono text-[10px] text-teal-700">
                {streamTokenCount > 0 ? `${streamTokenCount} chunks` : "Live tokens"}
              </span>
            </div>

            <div>
              {parsedStream.headline && (
                <h4 className="text-sm font-semibold text-slate-900">
                  {parsedStream.headline}
                  {!parsedStream.explanation && parsedStream.key_points.length === 0 && streamCaret}
                </h4>
              )}
              {parsedStream.explanation && (
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-700">
                  {parsedStream.explanation}
                  {parsedStream.key_points.length === 0 && streamCaret}
                </p>
              )}
            </div>

            {parsedStream.key_points.length > 0 && (
              <ul className="space-y-1.5 rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-xs text-slate-700">
                {parsedStream.key_points.map((pt, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600"
                    />
                    <span className="leading-relaxed">
                      {pt}
                      {idx === parsedStream.key_points.length - 1 && streamCaret}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {(loading || isStreaming) && !data && !hasStreamContent && (
          <div className="space-y-2.5 py-1" aria-label="Generating explanation">
            <p className="font-medium text-teal-800">
              UAE Firewall verified (0 PHI) · Streaming OpenRouter analysis…
            </p>
            <div className="rb-shimmer h-4 w-3/4 rounded" />
            <div className="rb-shimmer h-3.5 w-full rounded" />
            <div className="rb-shimmer h-3.5 w-5/6 rounded" />
          </div>
        )}

        {error && !loading && (
          <div
            role="alert"
            className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-rose-900"
          >
            <p className="leading-relaxed">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="shrink-0 rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-800 hover:bg-rose-100"
            >
              Retry
            </button>
          </div>
        )}

        {data && (
          <div className="space-y-3">
            {/* ElevenLabs Neural Audio Controls Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handlePlayPause}
                  disabled={audioState === "loading"}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-2xs transition hover:bg-teal-700 disabled:opacity-60"
                >
                  {audioState === "loading" ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      Generating…
                    </>
                  ) : audioState === "playing" ? (
                    <>
                      <Pause className="h-3 w-3" aria-hidden="true" />
                      Pause
                    </>
                  ) : audioState === "paused" ? (
                    <>
                      <Play className="h-3 w-3" aria-hidden="true" />
                      Resume
                    </>
                  ) : (
                    <>
                      <Volume2 className="h-3 w-3" aria-hidden="true" />
                      Listen
                    </>
                  )}
                </button>

                {(audioState === "playing" || audioState === "paused") && (
                  <button
                    type="button"
                    onClick={handleReplay}
                    aria-label="Replay audio explanation"
                    title="Replay from start"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition hover:bg-slate-100"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                    Replay
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {audioState === "playing" && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-700"
                    aria-live="polite"
                  >
                    <span className="inline-flex items-end gap-0.5" aria-hidden="true">
                      <span className="h-2 w-0.5 animate-pulse rounded-full bg-teal-600 motion-reduce:animate-none" />
                      <span className="h-3 w-0.5 animate-pulse rounded-full bg-teal-600 delay-75 motion-reduce:animate-none" />
                      <span className="h-2.5 w-0.5 animate-pulse rounded-full bg-teal-600 delay-150 motion-reduce:animate-none" />
                    </span>
                    Speaking
                  </span>
                )}
                <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-500">
                  ElevenLabs
                </span>
                <button
                  type="button"
                  onClick={handleCycleRate}
                  aria-label={`Change playback speed (currently ${rate}x)`}
                  className="rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-600 transition hover:border-teal-300 hover:text-teal-800"
                >
                  {rate}x
                </button>
              </div>
            </div>

            {audioError && (
              <p
                role="alert"
                className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-800"
              >
                {audioError}
              </p>
            )}

            <div>
              <h4 className="text-sm font-semibold text-slate-900">{data.headline}</h4>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-700">{data.explanation}</p>
            </div>

            {data.key_points.length > 0 && (
              <ul className="space-y-1.5 rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-xs text-slate-700">
                {data.key_points.map((pt, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600"
                    />
                    <span className="leading-relaxed">{pt}</span>
                  </li>
                ))}
              </ul>
            )}

            <p className="border-t border-slate-100 pt-2.5 text-[11px] leading-relaxed text-slate-500">
              {data.disclaimer}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
