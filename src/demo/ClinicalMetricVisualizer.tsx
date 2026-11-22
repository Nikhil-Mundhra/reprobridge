import { useId } from "react";
import type { Obligation } from "./types";

export type RangeZoneTone = "emerald" | "amber" | "rose";

export type MetricStatus =
  | "HIGH"
  | "BORDERLINE"
  | "LOW"
  | "NON-IMMUNE"
  | "INCOMPLETE"
  | "NORMAL"
  | "NORMALIZED";

export interface RangeZone {
  start: number;
  end: number;
  tone: RangeZoneTone;
}

export interface ClinicalMetricSpec {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  value: number;
  verifiedValue?: number;
  decimals?: number;
  status: MetricStatus;
  referenceLabel: string;
  targetLine?: { value: number; label: string };
  zones: RangeZone[];
}

const ZONE_FILL: Record<RangeZoneTone, string> = {
  emerald: "#d1fae5",
  amber: "#fef3c7",
  rose: "#ffe4e6",
};

const STATUS_BADGE_CLASS: Record<MetricStatus, string> = {
  HIGH: "border-rose-200 bg-rose-100 text-rose-800",
  LOW: "border-rose-200 bg-rose-100 text-rose-800",
  "NON-IMMUNE": "border-rose-200 bg-rose-100 text-rose-800",
  BORDERLINE: "border-amber-200 bg-amber-100 text-amber-800",
  INCOMPLETE: "border-amber-200 bg-amber-100 text-amber-800",
  NORMAL: "border-emerald-200 bg-emerald-100 text-emerald-800",
  NORMALIZED: "border-emerald-200 bg-emerald-100 text-emerald-800",
};

const STATUS_PIN_CLASS: Record<MetricStatus, string> = {
  HIGH: "bg-rose-600",
  LOW: "bg-rose-600",
  "NON-IMMUNE": "bg-rose-600",
  BORDERLINE: "bg-amber-500",
  INCOMPLETE: "bg-amber-500",
  NORMAL: "bg-emerald-600",
  NORMALIZED: "bg-emerald-600",
};

const STATUS_VALUE_CLASS: Record<MetricStatus, string> = {
  HIGH: "text-rose-700",
  LOW: "text-rose-700",
  "NON-IMMUNE": "text-rose-700",
  BORDERLINE: "text-amber-700",
  INCOMPLETE: "text-amber-700",
  NORMAL: "text-emerald-700",
  NORMALIZED: "text-emerald-700",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toPercent(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

function formatMetricValue(value: number, decimals = 1): string {
  return Number.isInteger(value) && decimals === 0 ? String(value) : value.toFixed(decimals);
}

export function extractClinicalMetrics(obl: Obligation): ClinicalMetricSpec[] {
  const text = `${obl.title} ${obl.rationale}`;
  const closure = obl.closure_evidence ?? "";
  const isClosed = obl.status === "VERIFIED_CLOSED";
  const isAntenatal = obl.life_stage.startsWith("Antenatal");
  const metrics: ClinicalMetricSpec[] = [];

  // 1. Thyroid / TSH
  const tshMatch = text.match(/TSH\s*[:=(]?\s*(\d+(?:\.\d+)?)/i);
  if (obl.rule_version.startsWith("RB-THYROID-") || tshMatch) {
    const baseline = tshMatch ? Number(tshMatch[1]) : 4.8;
    const closureTshMatch = closure.match(/TSH\s*[:=(]?\s*(\d+(?:\.\d+)?)/i);
    const verifiedValue = isClosed && closureTshMatch ? Number(closureTshMatch[1]) : undefined;
    const activeVal = verifiedValue ?? baseline;

    let status: MetricStatus;
    if (verifiedValue !== undefined && verifiedValue <= (isAntenatal ? 2.5 : 4.0) && verifiedValue >= (isAntenatal ? 0.1 : 0.4)) {
      status = "NORMALIZED";
    } else if (activeVal > 4.0) {
      status = "HIGH";
    } else if (isAntenatal && activeVal > 2.5) {
      status = "BORDERLINE";
    } else if (activeVal < (isAntenatal ? 0.1 : 0.4)) {
      status = "LOW";
    } else {
      status = "NORMAL";
    }

    metrics.push({
      id: `${obl.id}-tsh`,
      label: "Serum TSH",
      unit: "mIU/L",
      min: 0,
      max: 6.0,
      value: baseline,
      verifiedValue,
      decimals: 1,
      status,
      referenceLabel: isAntenatal ? "T1 Target: 0.1–2.5 mIU/L" : "Ref: 0.4–4.0 mIU/L",
      targetLine: isAntenatal
        ? { value: 2.5, label: "T1 target <2.5" }
        : { value: 2.5, label: "Pregnancy target <2.5" },
      zones: isAntenatal
        ? [
            { start: 0, end: 0.1, tone: "amber" },
            { start: 0.1, end: 2.5, tone: "emerald" },
            { start: 2.5, end: 4.0, tone: "amber" },
            { start: 4.0, end: 6.0, tone: "rose" },
          ]
        : [
            { start: 0, end: 0.4, tone: "amber" },
            { start: 0.4, end: 4.0, tone: "emerald" },
            { start: 4.0, end: 6.0, tone: "rose" },
          ],
    });
  }

  // 2. Metabolic / Dysglycemia & OGTT
  const fastingGlucoseMatch = text.match(/fasting\s+glucose\s*[:=(]?\s*(\d+(?:\.\d+)?)/i);
  if (fastingGlucoseMatch) {
    const baseline = Number(fastingGlucoseMatch[1]);
    const closureFgMatch = closure.match(
      /(?:fasting(?:\s+glucose)?|glucose)\s*[:=(]?\s*(\d+(?:\.\d+)?)/i
    );
    const verifiedValue = isClosed && closureFgMatch ? Number(closureFgMatch[1]) : undefined;
    const activeVal = verifiedValue ?? baseline;
    const cutoff = isAntenatal ? 95 : 100;

    let status: MetricStatus;
    if (verifiedValue !== undefined && verifiedValue < cutoff) {
      status = "NORMALIZED";
    } else if (activeVal >= 126) {
      status = "HIGH";
    } else if (activeVal >= cutoff) {
      status = "BORDERLINE";
    } else if (activeVal < 70) {
      status = "LOW";
    } else {
      status = "NORMAL";
    }

    metrics.push({
      id: `${obl.id}-glucose`,
      label: "Fasting Glucose",
      unit: "mg/dL",
      min: 60,
      max: 140,
      value: baseline,
      verifiedValue,
      decimals: 0,
      status,
      referenceLabel: isAntenatal ? "Pregnancy Target: <95 mg/dL" : "Ref: 70–99 mg/dL",
      targetLine: isAntenatal
        ? { value: 95, label: "Pregnancy target <95" }
        : { value: 100, label: "Normal <100" },
      zones: [
        { start: 60, end: 70, tone: "amber" },
        { start: 70, end: cutoff, tone: "emerald" },
        { start: cutoff, end: 126, tone: "amber" },
        { start: 126, end: 140, tone: "rose" },
      ],
    });
  }

  const a1cMatch = text.match(/HbA1c\s*[:=(]?\s*(\d+(?:\.\d+)?)/i);
  if (a1cMatch) {
    const baseline = Number(a1cMatch[1]);
    const closureA1cMatch = closure.match(/HbA1c\s*[:=(]?\s*(\d+(?:\.\d+)?)/i);
    const verifiedValue = isClosed && closureA1cMatch ? Number(closureA1cMatch[1]) : undefined;
    const activeVal = verifiedValue ?? baseline;

    let status: MetricStatus;
    if (verifiedValue !== undefined && verifiedValue < 5.7) {
      status = "NORMALIZED";
    } else if (activeVal >= 6.5) {
      status = "HIGH";
    } else if (activeVal >= 5.7) {
      status = "BORDERLINE";
    } else {
      status = "NORMAL";
    }

    metrics.push({
      id: `${obl.id}-hba1c`,
      label: "HbA1c",
      unit: "%",
      min: 4.0,
      max: 8.0,
      value: baseline,
      verifiedValue,
      decimals: 1,
      status,
      referenceLabel: "Ref: <5.7%",
      targetLine: { value: 5.7, label: "Normal <5.7%" },
      zones: [
        { start: 4.0, end: 5.7, tone: "emerald" },
        { start: 5.7, end: 6.5, tone: "amber" },
        { start: 6.5, end: 8.0, tone: "rose" },
      ],
    });
  }

  const ogttMatch = text.match(/1-hour\s+glucose(?:\s+challenge)?\s*[:=(]?\s*(\d+(?:\.\d+)?)/i);
  if (ogttMatch) {
    const baseline = Number(ogttMatch[1]);
    const closureOgttMatch = closure.match(/(?:fasting|1-hour|glucose)\s*[:=(]?\s*(\d+(?:\.\d+)?)/i);
    const verifiedValue = isClosed && closureOgttMatch ? Number(closureOgttMatch[1]) : undefined;
    const activeVal = verifiedValue ?? baseline;

    let status: MetricStatus;
    if (verifiedValue !== undefined && verifiedValue < 140) {
      status = "NORMALIZED";
    } else if (activeVal >= 140) {
      status = "HIGH";
    } else {
      status = "NORMAL";
    }

    metrics.push({
      id: `${obl.id}-ogtt-1h`,
      label: "1h Glucose Challenge",
      unit: "mg/dL",
      min: 70,
      max: 200,
      value: baseline,
      verifiedValue,
      decimals: 0,
      status,
      referenceLabel: "Ref: <140 mg/dL",
      targetLine: { value: 140, label: "Cutoff <140" },
      zones: [
        { start: 70, end: 140, tone: "emerald" },
        { start: 140, end: 200, tone: "rose" },
      ],
    });
  }

  // 3. Preeclampsia / Blood Pressure
  const bpMatch = text.match(/\bBP\s*[:=(]?\s*(\d{2,3})\/(\d{2,3})/i);
  if (obl.rule_version.startsWith("RB-PREECLAMPSIA-") || bpMatch) {
    const systolic = bpMatch ? Number(bpMatch[1]) : 138;
    const diastolic = bpMatch ? Number(bpMatch[2]) : 88;
    const closureBpMatch = closure.match(/(\d{2,3})\/(\d{2,3})/);
    const verifiedSys = isClosed && closureBpMatch ? Number(closureBpMatch[1]) : undefined;
    const verifiedDia = isClosed && closureBpMatch ? Number(closureBpMatch[2]) : undefined;

    const activeSys = verifiedSys ?? systolic;
    const sysStatus: MetricStatus =
      verifiedSys !== undefined && verifiedSys < 120
        ? "NORMALIZED"
        : activeSys >= 140
          ? "HIGH"
          : activeSys >= 120
            ? "BORDERLINE"
            : "NORMAL";

    const activeDia = verifiedDia ?? diastolic;
    const diaStatus: MetricStatus =
      verifiedDia !== undefined && verifiedDia < 80
        ? "NORMALIZED"
        : activeDia >= 90
          ? "HIGH"
          : activeDia >= 80
            ? "BORDERLINE"
            : "NORMAL";

    metrics.push({
      id: `${obl.id}-sbp`,
      label: "Systolic BP",
      unit: "mmHg",
      min: 90,
      max: 160,
      value: systolic,
      verifiedValue: verifiedSys,
      decimals: 0,
      status: sysStatus,
      referenceLabel: "Normal: <120 mmHg",
      targetLine: { value: 140, label: "Preeclampsia ≥140" },
      zones: [
        { start: 90, end: 120, tone: "emerald" },
        { start: 120, end: 140, tone: "amber" },
        { start: 140, end: 160, tone: "rose" },
      ],
    });

    metrics.push({
      id: `${obl.id}-dbp`,
      label: "Diastolic BP",
      unit: "mmHg",
      min: 50,
      max: 110,
      value: diastolic,
      verifiedValue: verifiedDia,
      decimals: 0,
      status: diaStatus,
      referenceLabel: "Normal: <80 mmHg",
      targetLine: { value: 90, label: "HTN ≥90" },
      zones: [
        { start: 50, end: 80, tone: "emerald" },
        { start: 80, end: 90, tone: "amber" },
        { start: 90, end: 110, tone: "rose" },
      ],
    });
  }

  // 4. Immunity Serology (Rubella IgG / VZV IgG)
  if (obl.rule_version.startsWith("RB-IMMUNE-") || /\b(Rubella|VZV|Varicella)\b/i.test(text)) {
    const isVzv = /\b(VZV|Varicella)\b/i.test(text);
    if (isVzv) {
      const vzvNumMatch = text.match(/VZV[^0-9]*?(\d+(?:\.\d+)?)\s*mIU\/mL/i);
      const baseline = vzvNumMatch && !text.includes("<100") ? Number(vzvNumMatch[1]) : 62;
      const verifiedValue = isClosed ? 180 : undefined;
      metrics.push({
        id: `${obl.id}-vzv`,
        label: "Varicella (VZV) IgG",
        unit: "mIU/mL",
        min: 0,
        max: 200,
        value: baseline,
        verifiedValue,
        decimals: 0,
        status: verifiedValue !== undefined ? "NORMALIZED" : "NON-IMMUNE",
        referenceLabel: "Protective: ≥150 mIU/mL",
        targetLine: { value: 150, label: "Protective ≥150" },
        zones: [
          { start: 0, end: 100, tone: "rose" },
          { start: 100, end: 150, tone: "amber" },
          { start: 150, end: 200, tone: "emerald" },
        ],
      });
    } else if (/Rubella/i.test(text)) {
      const rubellaNumMatch = text.match(/Rubella[^0-9]*?(\d+(?:\.\d+)?)\s*IU\/mL/i);
      const baseline = rubellaNumMatch ? Number(rubellaNumMatch[1]) : 4.2;
      const verifiedValue = isClosed ? 16.0 : undefined;
      metrics.push({
        id: `${obl.id}-rubella`,
        label: "Rubella IgG Titer",
        unit: "IU/mL",
        min: 0,
        max: 20,
        value: baseline,
        verifiedValue,
        decimals: 1,
        status: verifiedValue !== undefined ? "NORMALIZED" : "NON-IMMUNE",
        referenceLabel: "Protective: ≥10 IU/mL",
        targetLine: { value: 10, label: "Immune ≥10" },
        zones: [
          { start: 0, end: 10, tone: "rose" },
          { start: 10, end: 20, tone: "emerald" },
        ],
      });
    }
  }

  // 5. HPV Immunization Series
  const hpvDosesMatch =
    text.match(/(\d+)\s+of\s+(\d+)\s+doses/i) ??
    text.match(/Dose\s+(\d+)\s+of\s+(\d+)/i);
  if (obl.rule_version.startsWith("RB-HPV-") || (hpvDosesMatch && /HPV/i.test(text))) {
    const baseline = hpvDosesMatch ? Number(hpvDosesMatch[1]) : 1;
    const totalDoses = hpvDosesMatch ? Number(hpvDosesMatch[2]) : 3;
    const verifiedValue = isClosed ? totalDoses : undefined;
    const activeVal = verifiedValue ?? baseline;
    metrics.push({
      id: `${obl.id}-hpv`,
      label: "HPV Series Completion",
      unit: "doses",
      min: 0,
      max: totalDoses,
      value: baseline,
      verifiedValue,
      decimals: 0,
      status:
        verifiedValue !== undefined
          ? "NORMALIZED"
          : activeVal < totalDoses
            ? "INCOMPLETE"
            : "NORMAL",
      referenceLabel: `Target: ${totalDoses} of ${totalDoses} doses`,
      targetLine: { value: totalDoses, label: `${totalDoses}-dose series` },
      zones: [
        { start: 0, end: Math.max(0.1, totalDoses - 0.35), tone: "amber" },
        { start: Math.max(0.1, totalDoses - 0.35), end: totalDoses, tone: "emerald" },
      ],
    });
  }

  // 6. Generic Imported Labs: Ferritin & Vitamin D
  const ferritinMatch = text.match(/ferritin\s*[:=(]?\s*(\d+(?:\.\d+)?)/i);
  if (ferritinMatch) {
    const baseline = Number(ferritinMatch[1]);
    const closureFerritin = closure.match(/ferritin\s*[:=(]?\s*(\d+(?:\.\d+)?)/i);
    const verifiedValue = isClosed && closureFerritin ? Number(closureFerritin[1]) : undefined;
    const activeVal = verifiedValue ?? baseline;
    const status: MetricStatus =
      verifiedValue !== undefined && verifiedValue >= 30
        ? "NORMALIZED"
        : activeVal < 15
          ? "LOW"
          : activeVal < 30
            ? "BORDERLINE"
            : "NORMAL";

    metrics.push({
      id: `${obl.id}-ferritin`,
      label: "Serum Ferritin",
      unit: "ng/mL",
      min: 0,
      max: 60,
      value: baseline,
      verifiedValue,
      decimals: 0,
      status,
      referenceLabel: "Ref: 30–60 ng/mL",
      targetLine: { value: 30, label: "Target ≥30" },
      zones: [
        { start: 0, end: 15, tone: "rose" },
        { start: 15, end: 30, tone: "amber" },
        { start: 30, end: 60, tone: "emerald" },
      ],
    });
  }

  const vitDMatch = text.match(/vitamin\s*d\s*[:=(]?\s*(\d+(?:\.\d+)?)/i);
  if (vitDMatch) {
    const baseline = Number(vitDMatch[1]);
    const closureVitD = closure.match(/vitamin\s*d\s*[:=(]?\s*(\d+(?:\.\d+)?)/i);
    const verifiedValue = isClosed && closureVitD ? Number(closureVitD[1]) : undefined;
    const activeVal = verifiedValue ?? baseline;
    const status: MetricStatus =
      verifiedValue !== undefined && verifiedValue >= 30
        ? "NORMALIZED"
        : activeVal < 20
          ? "LOW"
          : activeVal < 30
            ? "BORDERLINE"
            : "NORMAL";

    metrics.push({
      id: `${obl.id}-vitd`,
      label: "25-OH Vitamin D",
      unit: "ng/mL",
      min: 0,
      max: 60,
      value: baseline,
      verifiedValue,
      decimals: 0,
      status,
      referenceLabel: "Ref: ≥30 ng/mL",
      targetLine: { value: 30, label: "Sufficient ≥30" },
      zones: [
        { start: 0, end: 20, tone: "rose" },
        { start: 20, end: 30, tone: "amber" },
        { start: 30, end: 60, tone: "emerald" },
      ],
    });
  }

  // 8. Perinatal Depression & Anxiety Screening (EPDS / GAD-7)
  const epdsMatch = text.match(/EPDS\s*[:=(]?\s*(\d{1,2})/i);
  if (obl.rule_version.startsWith("RB-PERINATAL-MH-") && epdsMatch) {
    const baseline = Number(epdsMatch[1]);
    const closureEpds = closure.match(/EPDS\s*[:=(]?\s*(\d{1,2})/i);
    const verifiedValue = isClosed && closureEpds ? Number(closureEpds[1]) : undefined;
    const activeVal = verifiedValue ?? baseline;
    const status: MetricStatus =
      verifiedValue !== undefined && verifiedValue < 10
        ? "NORMALIZED"
        : activeVal >= 13
          ? "HIGH"
          : activeVal >= 10
            ? "BORDERLINE"
            : "NORMAL";
    metrics.push({
      id: `${obl.id}-epds`,
      label: "EPDS Screen (Signal Only)",
      unit: "/ 30",
      min: 0,
      max: 30,
      value: baseline,
      verifiedValue,
      decimals: 0,
      status,
      referenceLabel: "ACOG Positive Cutoff: ≥13",
      targetLine: { value: 13, label: "Screen ≥13" },
      zones: [
        { start: 0, end: 10, tone: "emerald" },
        { start: 10, end: 13, tone: "amber" },
        { start: 13, end: 30, tone: "rose" },
      ],
    });
  }

  const gadMatch = text.match(/GAD-?7\s*[:=(]?\s*(\d{1,2})/i);
  if (obl.rule_version.startsWith("RB-PERINATAL-MH-") && gadMatch) {
    const baseline = Number(gadMatch[1]);
    const status: MetricStatus =
      isClosed ? "NORMALIZED" : baseline >= 10 ? "HIGH" : baseline >= 5 ? "BORDERLINE" : "NORMAL";
    metrics.push({
      id: `${obl.id}-gad7`,
      label: "GAD-7 Anxiety Screen",
      unit: "/ 21",
      min: 0,
      max: 21,
      value: baseline,
      decimals: 0,
      status,
      referenceLabel: "Moderate Cutoff: ≥10",
      targetLine: { value: 10, label: "Moderate ≥10" },
      zones: [
        { start: 0, end: 5, tone: "emerald" },
        { start: 5, end: 10, tone: "amber" },
        { start: 10, end: 21, tone: "rose" },
      ],
    });
  }

  return metrics;
}

function MetricRangeCard({ spec }: { spec: ClinicalMetricSpec }) {
  const clipId = useId();
  const decimals = spec.decimals ?? 1;
  const displayValue = spec.verifiedValue ?? spec.value;
  const basePct = toPercent(spec.value, spec.min, spec.max);
  const verifiedPct =
    spec.verifiedValue !== undefined ? toPercent(spec.verifiedValue, spec.min, spec.max) : null;
  const pinPct = clamp(verifiedPct ?? basePct, 2, 98);
  const ghostPinPct = clamp(basePct, 2, 98);
  const targetPct = spec.targetLine ? toPercent(spec.targetLine.value, spec.min, spec.max) : null;

  const ariaLabel = `${spec.label}: ${formatMetricValue(displayValue, decimals)} ${spec.unit} (${spec.status}), ${spec.referenceLabel}`;

  return (
    <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-3.5 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xs font-semibold text-slate-800">{spec.label}</span>
          <span className="text-[11px] text-slate-500">{spec.referenceLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold tabular-nums">
            {spec.verifiedValue !== undefined ? (
              <>
                <span className="text-slate-400 line-through">
                  {formatMetricValue(spec.value, decimals)}
                </span>{" "}
                <span className="text-slate-400">→</span>{" "}
                <span className="text-emerald-700">
                  {formatMetricValue(spec.verifiedValue, decimals)}
                </span>
              </>
            ) : (
              <span className={STATUS_VALUE_CLASS[spec.status]}>
                {formatMetricValue(spec.value, decimals)}
              </span>
            )}{" "}
            <span className="text-[11px] font-normal text-slate-500">{spec.unit}</span>
          </span>
          <span
            className={`rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${STATUS_BADGE_CLASS[spec.status]}`}
          >
            {spec.status}
          </span>
        </div>
      </div>

      {/* Accessible Color-Coded SVG Zone Track + Crisp Circular Pin(s) */}
      <div className="relative mt-2 h-6 w-full">
        <svg
          role="meter"
          aria-valuenow={displayValue}
          aria-valuemin={spec.min}
          aria-valuemax={spec.max}
          aria-label={ariaLabel}
          viewBox="0 0 100 24"
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
        >
          <defs>
            <clipPath id={clipId}>
              <rect x="0" y="7" width="100" height="10" rx="5" />
            </clipPath>
          </defs>

          <g clipPath={`url(#${clipId})`}>
            {spec.zones.map((zone, idx) => {
              const x1 = toPercent(zone.start, spec.min, spec.max);
              const x2 = toPercent(zone.end, spec.min, spec.max);
              return (
                <rect
                  key={`${spec.id}-zone-${idx}`}
                  x={x1}
                  y="7"
                  width={Math.max(0, x2 - x1)}
                  height="10"
                  fill={ZONE_FILL[zone.tone]}
                />
              );
            })}
          </g>

          {/* Subtle zone divider ticks */}
          {spec.zones.slice(1).map((zone, idx) => {
            const x = toPercent(zone.start, spec.min, spec.max);
            return (
              <line
                key={`${spec.id}-tick-${idx}`}
                x1={x}
                y1="7"
                x2={x}
                y2="17"
                stroke="#ffffff"
                strokeWidth="0.6"
              />
            );
          })}

          {/* Optional life-stage or safety threshold line */}
          {targetPct !== null && (
            <line
              x1={targetPct}
              y1="2"
              x2={targetPct}
              y2="22"
              stroke="#0f766e"
              strokeWidth="0.8"
              strokeDasharray="1.8 1.5"
            />
          )}

          {/* Baseline -> verified trajectory connector */}
          {verifiedPct !== null && (
            <line
              x1={ghostPinPct}
              y1="12"
              x2={pinPct}
              y2="12"
              stroke="#059669"
              strokeWidth="1.2"
              strokeDasharray="2 1.2"
            />
          )}
        </svg>

        {verifiedPct !== null && (
          <span
            aria-hidden="true"
            style={{ left: `${ghostPinPct}%` }}
            className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-400 bg-white/90"
          />
        )}
        <span
          aria-hidden="true"
          style={{ left: `${pinPct}%` }}
          className={`pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-xs ${STATUS_PIN_CLASS[spec.status]}`}
        />
      </div>

      <div className="mt-0.5 flex items-center justify-between font-mono text-[10px] tabular-nums text-slate-400">
        <span>{spec.min}</span>
        {spec.targetLine ? (
          <span className="font-sans text-[10px] font-medium text-teal-700">
            {spec.targetLine.label}
          </span>
        ) : (
          <span />
        )}
        <span>{spec.max}</span>
      </div>
    </div>
  );
}

export default function ClinicalMetricVisualizer({ obligation }: { obligation: Obligation }) {
  const metrics = extractClinicalMetrics(obligation);
  if (metrics.length === 0) return null;

  return (
    <div
      className={`mt-3 grid gap-2.5 ${metrics.length > 1 ? "sm:grid-cols-2" : ""}`}
      aria-label={`Clinical metric range visualization for ${obligation.id}`}
    >
      {metrics.map((spec) => (
        <MetricRangeCard key={spec.id} spec={spec} />
      ))}
    </div>
  );
}
