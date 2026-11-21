import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import type { Obligation, ObligationExplanationResponse } from "./types";

interface ObligationExplainerPopoverProps {
  obligation: Obligation | null;
  data: ObligationExplanationResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}

type AudioState = "idle" | "playing" | "paused";

const RATE_OPTIONS = [0.96, 1.0, 1.15] as const;

function isSpeechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

function pickSmoothVoice(): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis.getVoices?.() ?? [];
    if (voices.length === 0) return null;
    const preferred = voices.find(
      (v) =>
        v.lang?.toLowerCase().startsWith("en") &&
        /natural|neural|samantha|karen|daniel|google/i.test(v.name)
    );
    return preferred ?? voices.find((v) => v.lang?.toLowerCase().startsWith("en")) ?? null;
  } catch {
    return null;
  }
}

export default function ObligationExplainerPopover({
  obligation,
  data,
  loading,
  error,
  onRetry,
  onClose,
}: ObligationExplainerPopoverProps) {
  const [audioState, setAudioState] = useState<AudioState>("idle");
  const [rateIndex, setRateIndex] = useState(0);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechAvailable = isSpeechSupported();
  const rate = RATE_OPTIONS[rateIndex];

  const stopSpeech = useCallback(() => {
    utteranceRef.current = null;
    setAudioState("idle");
    if (isSpeechSupported()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore speech cancellation errors in constrained webviews
      }
    }
  }, []);

  useEffect(() => {
    stopSpeech();
    return () => {
      stopSpeech();
    };
  }, [obligation?.id, data?.explanation, stopSpeech]);

  const speakAtRate = useCallback(
    (targetRate: number) => {
      if (!data || !isSpeechSupported()) return;

      try {
        window.speechSynthesis.cancel();
        const spokenParts = [
          data.headline,
          data.explanation,
          ...(data.key_points.length > 0 ? ["Key takeaways.", ...data.key_points] : []),
        ].filter(Boolean);

        const utterance = new SpeechSynthesisUtterance(spokenParts.join(" "));
        utterance.rate = targetRate;
        utterance.pitch = 1.0;

        const voice = pickSmoothVoice();
        if (voice) {
          utterance.voice = voice;
        }

        utterance.onstart = () => setAudioState("playing");
        utterance.onpause = () => setAudioState("paused");
        utterance.onresume = () => setAudioState("playing");
        utterance.onend = () => {
          utteranceRef.current = null;
          setAudioState("idle");
        };
        utterance.onerror = () => {
          utteranceRef.current = null;
          setAudioState("idle");
        };

        utteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);
        setAudioState("playing");
      } catch {
        utteranceRef.current = null;
        setAudioState("idle");
      }
    },
    [data]
  );

  function handlePlayPause() {
    if (!data || !speechAvailable) return;
    if (audioState === "playing") {
      try {
        window.speechSynthesis.pause?.();
        setAudioState("paused");
      } catch {
        stopSpeech();
      }
      return;
    }
    if (audioState === "paused") {
      try {
        window.speechSynthesis.resume?.();
        setAudioState("playing");
      } catch {
        speakAtRate(rate);
      }
      return;
    }
    speakAtRate(rate);
  }

  function handleCycleRate() {
    const nextIdx = (rateIndex + 1) % RATE_OPTIONS.length;
    setRateIndex(nextIdx);
    if (audioState === "playing") {
      speakAtRate(RATE_OPTIONS[nextIdx]);
    }
  }

  function handleClose() {
    stopSpeech();
    onClose();
  }

  if (!obligation) return null;

  const isOpenRouter = data?.ai_metadata?.mode === "openrouter";

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
              {data && (
                <span className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                  {isOpenRouter ? data.ai_metadata.model : "Local Fallback"}
                </span>
              )}
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
        {loading && !data && (
          <div className="space-y-2.5 py-1" aria-label="Generating explanation">
            <p className="font-medium text-teal-800">
              Stripping PHI and synthesizing clear clinical analysis…
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
            {/* Audio Controls Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2">
              <div className="flex items-center gap-1.5">
                {speechAvailable ? (
                  <>
                    <button
                      type="button"
                      onClick={handlePlayPause}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-2xs transition hover:bg-teal-700"
                    >
                      {audioState === "playing" ? (
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

                    {audioState !== "idle" && (
                      <button
                        type="button"
                        onClick={() => speakAtRate(rate)}
                        aria-label="Replay audio explanation"
                        title="Replay from start"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition hover:bg-slate-100"
                      >
                        <RotateCcw className="h-3 w-3" aria-hidden="true" />
                        Replay
                      </button>
                    )}
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
                    <Volume2 className="h-3 w-3" aria-hidden="true" />
                    Audio unavailable
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
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
                {speechAvailable && (
                  <button
                    type="button"
                    onClick={handleCycleRate}
                    aria-label={`Change playback speed (currently ${rate}x)`}
                    className="rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-600 transition hover:border-teal-300 hover:text-teal-800"
                  >
                    {rate}x
                  </button>
                )}
              </div>
            </div>

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
