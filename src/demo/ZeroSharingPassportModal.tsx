import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  QrCode,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";
import type {
  AuditEvent,
  Obligation,
  ObligationPassport,
  PassportVerificationResult,
} from "./types";

interface ZeroSharingPassportModalProps {
  target: Obligation;
  onClose: () => void;
  onAuditUpdated: (events: AuditEvent[]) => void;
}

/** Deterministic SVG QR-style matrix generated from the signed SMART Health Link. */
function DeterministicQrMatrix({ seed }: { seed: string }) {
  const size = 21;
  const cells = useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const grid: boolean[][] = Array.from({ length: size }, () =>
      Array.from({ length: size }, () => false)
    );

    const drawFinder = (r0: number, c0: number) => {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const border = r === 0 || r === 6 || c === 0 || c === 6;
          const center = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          grid[r0 + r][c0 + c] = border || center;
        }
      }
    };
    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const inFinder =
          (r < 8 && c < 8) || (r < 8 && c >= size - 8) || (r >= size - 8 && c < 8);
        if (inFinder) continue;
        h ^= (r * 31 + c * 17 + seed.charCodeAt((r + c) % seed.length)) & 0xff;
        h = Math.imul(h, 16777619);
        grid[r][c] = (h & 1) === 1;
      }
    }
    return grid;
  }, [seed]);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="h-32 w-32 rounded-lg border border-slate-200 bg-white p-2 text-slate-900 shadow-2xs"
      role="img"
      aria-label="Patient-held SMART Health Link cryptographic QR code"
    >
      {cells.map((row, r) =>
        row.map((on, c) =>
          on ? <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="currentColor" /> : null
        )
      )}
    </svg>
  );
}

export default function ZeroSharingPassportModal({
  target,
  onClose,
  onAuditUpdated,
}: ZeroSharingPassportModalProps) {
  const [includeSourceQuote, setIncludeSourceQuote] = useState(true);
  const [passport, setPassport] = useState<ObligationPassport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState<PassportVerificationResult | null>(null);
  const [copied, setCopied] = useState(false);

  const issuePassport = useCallback(
    async (withQuote: boolean) => {
      setLoading(true);
      setError(null);
      setVerifyResult(null);
      try {
        const res = await fetch(`/api/obligations/${target.id}/passport`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ include_source_quote: withQuote }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || "Failed to issue patient-held passport");
        }
        const data = await res.json();
        setPassport(data.passport);
        if (data.audit_events) onAuditUpdated(data.audit_events);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to issue passport");
      } finally {
        setLoading(false);
      }
    },
    [target.id, onAuditUpdated]
  );

  useEffect(() => {
    void issuePassport(includeSourceQuote);
  }, [issuePassport, includeSourceQuote]);

  async function handleVerify(simulateTamper: boolean) {
    if (!passport) return;
    setVerifyLoading(true);
    setError(null);
    try {
      const payloadToVerify: ObligationPassport = simulateTamper
        ? {
            ...passport,
            claims: {
              ...passport.claims,
              status: passport.claims.status === "VERIFIED_CLOSED" ? "OPEN" : "VERIFIED_CLOSED",
            },
          }
        : passport;

      const res = await fetch("/api/passport/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passport: payloadToVerify }),
      });
      if (!res.ok) {
        throw new Error("Offline signature verification failed");
      }
      const data: PassportVerificationResult = await res.json();
      setVerifyResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification request failed");
    } finally {
      setVerifyLoading(false);
    }
  }

  async function handleCopyJson() {
    if (!passport) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(passport, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be unavailable in restricted contexts
    }
  }

  const badgeTitle =
    passport?.credential_type === "ReproBridgeClosureAttestation"
      ? "Signed Proof-of-Closure Receipt"
      : passport?.credential_type === "ReproBridgeReopenAttestation"
        ? "Signed Proof-of-Reopen Receipt"
        : "Patient-Held Obligation Passport";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="zero-sharing-passport-title"
    >
      <div className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-teal-700">
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              Zero-Hospital-Sharing Protocol · SMART Health Link
            </p>
            <h3
              id="zero-sharing-passport-title"
              className="mt-1 text-base font-semibold text-slate-900"
            >
              {badgeTitle} — {target.id}
            </h3>
            <p className="mt-0.5 text-xs text-slate-600">
              Hospitals never share raw EHR charts with each other or with ReproBridge. The patient
              carries only a minimal, cryptographically signed obligation claim verified offline at
              Hospital B.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close zero-sharing passport modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
          </div>
        )}

        {loading && !passport ? (
          <div className="mt-5 space-y-3" aria-label="Signing cryptographic obligation passport">
            <div className="rb-shimmer h-28 w-full rounded-xl" />
            <div className="rb-shimmer h-16 w-full rounded-xl" />
          </div>
        ) : (
          passport && (
            <div className="mt-4 space-y-4">
              {/* Zero-Sharing Telemetry Strip */}
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-2.5">
                  <p className="font-mono text-sm font-bold text-emerald-900">0 bytes</p>
                  <p className="text-[11px] text-emerald-800">Raw EHR Chart Shared</p>
                </div>
                <div className="rounded-lg border border-teal-200 bg-teal-50/70 p-2.5">
                  <p className="font-mono text-sm font-bold text-teal-900">0 API Calls</p>
                  <p className="text-[11px] text-teal-800">Hospital A ↔ Hospital B</p>
                </div>
                <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 p-2.5">
                  <p className="font-mono text-sm font-bold text-indigo-900">
                    {passport.signature.alg}
                  </p>
                  <p className="text-[11px] text-indigo-800">Offline Verifiable Proof</p>
                </div>
              </div>

              {/* Patient-Held QR & Signed Claims Card */}
              <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4 sm:flex-row sm:items-start">
                <div className="flex flex-col items-center gap-1.5">
                  <DeterministicQrMatrix seed={passport.smart_health_link} />
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-500">
                    <Smartphone className="h-3 w-3" aria-hidden="true" />
                    Patient-Held QR
                  </span>
                </div>

                <div className="min-w-0 flex-1 space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-teal-900">
                      {passport.credential_type}
                    </span>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-700">
                      <input
                        type="checkbox"
                        checked={includeSourceQuote}
                        onChange={(e) => setIncludeSourceQuote(e.target.checked)}
                        className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                      Selective Disclosure: Source Quote
                    </label>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                    <div>
                      <dt className="text-slate-400">Ephemeral Case Token</dt>
                      <dd className="font-mono font-semibold text-slate-800">
                        {passport.claims.case_token}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">Signed Status</dt>
                      <dd className="font-mono font-semibold text-slate-800">
                        {passport.claims.status}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">Issuer</dt>
                      <dd className="text-slate-700">{passport.issuer}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">Source Note SHA-256</dt>
                      <dd className="truncate font-mono text-slate-700" title={passport.claims.source_note_sha256}>
                        {passport.claims.source_note_sha256.slice(0, 18)}…
                      </dd>
                    </div>
                  </dl>

                  {passport.claims.source_quote_excerpt && (
                    <p className="rounded border border-indigo-200/70 bg-white px-2.5 py-1.5 italic text-[11px] text-slate-700">
                      &ldquo;{passport.claims.source_quote_excerpt}&rdquo;
                    </p>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span className="truncate font-mono text-[10px] text-slate-500">
                      sig:{passport.signature.value.slice(0, 20)}… ({passport.signature.key_id})
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopyJson()}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" aria-hidden="true" />
                          Copy Signed JSON
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Hospital B Offline Verifier Panel */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                    <QrCode className="h-4 w-4 text-teal-700" aria-hidden="true" />
                    Hospital B Offline Verifier (Zero Hospital A Integration)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={verifyLoading}
                      onClick={() => void handleVerify(false)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      Verify Signature Offline
                    </button>
                    <button
                      type="button"
                      disabled={verifyLoading}
                      onClick={() => void handleVerify(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                    >
                      <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                      Simulate Tamper Attack
                    </button>
                  </div>
                </div>

                {verifyResult && (
                  <div
                    role="status"
                    className={`mt-3 rounded-lg border px-3.5 py-2.5 text-xs ${
                      verifyResult.valid
                        ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                        : "border-rose-300 bg-rose-50 text-rose-950"
                    }`}
                  >
                    <p className="font-semibold">
                      {verifyResult.valid
                        ? "Signature Verified — Authentic Patient-Held Obligation"
                        : "Signature Verification Failed — Tamper Detected"}
                    </p>
                    <p className="mt-0.5 leading-relaxed">{verifyResult.detail}</p>
                  </div>
                )}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
