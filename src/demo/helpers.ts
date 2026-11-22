import type { Obligation, ParsedImportRow } from "./types";

export function parseDelimitedTable(raw: string): ParsedImportRow[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const splitLine = (line: string): string[] => {
    if (delimiter === "\t") return line.split("\t").map((c) => c.trim());
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const headers = splitLine(lines[0]).map((h) =>
    h.toLowerCase().replace(/[^a-z0-9]+/g, "_")
  );
  const rows: ParsedImportRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line);
    const get = (...keys: string[]) => {
      for (const k of keys) {
        const idx = headers.indexOf(k);
        if (idx !== -1 && cells[idx]) return cells[idx];
      }
      return "";
    };
    const title = get("title", "obligation", "finding", "care_gap");
    const rationale = get("rationale", "description", "notes", "clinical_rationale");
    if (!title || !rationale) continue;
    rows.push({
      title,
      rationale,
      priority: (get("priority", "severity") || "MEDIUM").toUpperCase(),
      life_stage: get("life_stage", "stage") || "Preconception",
      owner: get("owner", "specialty") || "OB-GYN / Primary Care",
      evidence_source: get("evidence_source", "source", "fhir_source") || "CSV Table Import",
      incoming_evidence_result:
        get("incoming_evidence_result", "evidence_result", "lab_result", "result") || undefined,
    });
  }
  return rows;
}

export function formatExecutionLabel(execution?: string): { label: string; className: string } {
  if (execution === "agentic") {
    return {
      label: "Agentic",
      className: "border-purple-200 bg-purple-50 text-purple-800",
    };
  }
  if (execution === "deterministic_fallback") {
    return {
      label: "Fallback",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }
  return {
    label: "Deterministic",
    className: "border-slate-200 bg-slate-100 text-slate-700",
  };
}

export function getUrgentDueChip(obl: Obligation): string | null {
  if (obl.status === "VERIFIED_CLOSED") return null;
  if (obl.due_label && obl.status === "ESCALATED_FOR_REVIEW") {
    return obl.due_label;
  }
  if (obl.status !== "ESCALATED_FOR_REVIEW") return null;
  if (obl.life_stage === "Postpartum") return "Pre-discharge ≤ 48h";
  return "Due ≤ 72h";
}

export function formatClosurePolicyLabel(policy?: string | null): string | null {
  switch ((policy ?? "").toUpperCase()) {
    case "COMPLETED_TEST_NOT_BOOKING":
      return "Guard: Completed test required (booking alone blocked)";
    case "RESULT_REVIEW_SIGNOFF":
      return "Guard: Separate clinician result review sign-off";
    case "POSTPARTUM_BP_ASSESSMENT":
      return "Guard: Verified BP reading required (≥160/110 escalates)";
    case "MENTAL_HEALTH_ASSESSMENT":
      return "Guard: Clinical assessment required (score alone blocked)";
    case "CERVICAL_ALGORITHM_RECONCILIATION":
      return "Guard: DoH/ASCCP algorithm reconciliation (ECC/LEEP blocked in pregnancy)";
    case "ENDOMETRIOSIS_PATHWAY_REVIEW":
      return "Guard: Normal scan cannot close · Specialist pathway review required";
    case "DEFERRED_UNTIL_POSTPARTUM":
      return "Guard: Locked until Postpartum transition";
    default:
      return null;
  }
}

export function parseStreamedSections(raw: string): { summary: string; handoff: string } {
  let trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  }
  const markerRe = /(?:^|\n)[ \t]*[*#_]*[ \t]*(SUMMARY|HANDOFF)[ \t]*[*_]*[ \t]*:[ \t]*[*_]*/gi;
  const matches: Array<{ name: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = markerRe.exec(trimmed)) !== null) {
    matches.push({
      name: match[1].toUpperCase(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  if (matches.length === 0) {
    return {
      summary: trimmed.replace(/^SUMMARY:\s*/i, "").trim(),
      handoff: "",
    };
  }
  const sections: Record<string, string> = {};
  const preamble = trimmed.slice(0, matches[0].start).trim();
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const nextStart = i + 1 < matches.length ? matches[i + 1].start : trimmed.length;
    if (!(cur.name in sections)) {
      sections[cur.name] = trimmed.slice(cur.end, nextStart).trim();
    }
  }
  return {
    summary: sections.SUMMARY || preamble,
    handoff: sections.HANDOFF ?? "",
  };
}

export function parseStreamedExplanation(raw: string): {
  headline: string;
  explanation: string;
  key_points: string[];
} {
  let cleaned = raw.trim();
  if (!cleaned) {
    return { headline: "", explanation: "", key_points: [] };
  }
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  }

  const markerRe = /(?:^|\n)\s*(HEADLINE|EXPLANATION|KEY_POINTS)\s*:\s*/gi;
  const matches: Array<{ name: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = markerRe.exec(cleaned)) !== null) {
    matches.push({
      name: match[1].toUpperCase(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  if (matches.length === 0) {
    return {
      headline: cleaned.replace(/^HEADLINE:\s*/i, "").trim(),
      explanation: "",
      key_points: [],
    };
  }

  const sections: Record<string, string> = {};
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const nextStart = i + 1 < matches.length ? matches[i + 1].start : cleaned.length;
    sections[cur.name] = cleaned.slice(cur.end, nextStart).trim();
  }

  const headline = (sections.HEADLINE ?? "").replace(/\s*\n+\s*/g, " ").trim();
  const explanation = (sections.EXPLANATION ?? "").replace(/\s*\n+\s*/g, " ").trim();
  const key_points = (sections.KEY_POINTS ?? "")
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[•*-]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 4);

  return { headline, explanation, key_points };
}

export function parseStreamedQuestionnaire(raw: string): {
  context_note: string;
  questions: Array<{ question: string; options: string[] }>;
} {
  let cleaned = raw.trim();
  if (!cleaned) {
    return { context_note: "", questions: [] };
  }
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  }

  const markerRe =
    /(?:^|\n)\s*(CONTEXT_NOTE|Q1_QUESTION|Q1_OPTIONS|Q2_QUESTION|Q2_OPTIONS|Q3_QUESTION|Q3_OPTIONS)\s*:\s*/gi;
  const matches: Array<{ name: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = markerRe.exec(cleaned)) !== null) {
    matches.push({
      name: match[1].toUpperCase(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  if (matches.length === 0) {
    return {
      context_note: cleaned.replace(/^CONTEXT_NOTE:\s*/i, "").trim(),
      questions: [],
    };
  }

  const sections: Record<string, string> = {};
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const nextStart = i + 1 < matches.length ? matches[i + 1].start : cleaned.length;
    sections[cur.name] = cleaned.slice(cur.end, nextStart).replace(/\s*\n+\s*/g, " ").trim();
  }

  const questions: Array<{ question: string; options: string[] }> = [];
  for (let idx = 1; idx <= 3; idx++) {
    const qText = sections[`Q${idx}_QUESTION`] ?? "";
    const opts = (sections[`Q${idx}_OPTIONS`] ?? "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4);
    questions.push({ question: qText, options: opts });
  }

  return {
    context_note: sections.CONTEXT_NOTE ?? "",
    questions,
  };
}

export function parseHandoffItems(text: string): string[] {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[•*-]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
  if (lines.length > 1) return lines;
  // Handle single-line numbered lists like "1) ... 2) ..." without matching "(OBL-101) "
  const numbered = text
    .split(/(?:^|\s+)(?=\d+[.)]\s+)/)
    .map((part) => part.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
  return numbered.length > 0 ? numbered : lines;
}

export function detectObligationId(text: string): string | null {
  const match = text.match(/\bOBL-[A-Z0-9-]+\b/i);
  if (match) return match[0].toUpperCase();
  if (/dysglycemia|gdm|ogtt|hba1c|RB-METABOLIC/i.test(text)) return "OBL-201";
  if (/varicella|vzv/i.test(text)) return "OBL-202";
  if (/preeclampsia|hypertension|postpartum\s+bp|aspirin|RB-PREECLAMPSIA/i.test(text)) return "OBL-301";
  if (/hpv\s+9-?valent|hpv\s+series|RB-HPV/i.test(text)) return "OBL-302";
  if (/epds|gad-?7|depression|anxiety|perinatal\s+mental|RB-PERINATAL-MH/i.test(text)) return "OBL-401";
  if (/cervical|colposcopy|cytology|hsil|hpv16|RB-CERVICAL/i.test(text)) return "OBL-402";
  if (/endometriosis|pelvic\s+pain|dysmenorrhea|RB-ENDO/i.test(text)) return "OBL-501";
  if (/thyroid|tsh|RB-THYROID/i.test(text)) return "OBL-101";
  if (/rubella|mmr|vaccin|RB-IMMUNE/i.test(text)) return "OBL-102";
  return null;
}

export function buildOutboundFhirBundle(
  obligations: Obligation[],
  currentLifeStage: string,
  agentSummary: string | null,
  handoffText: string | null
): Record<string, unknown> {
  const patient = obligations[0];
  const patientId = patient?.patient_id ?? "PAT-AE-4092";
  const patientName = patient?.patient_name ?? "Amira Al-Mansoori (Synthetic)";
  const timestamp = new Date().toISOString();
  const handoffItems = handoffText ? parseHandoffItems(handoffText) : [];

  const carePlanEntry = {
    fullUrl: `urn:uuid:reprobridge-careplan-${patientId.toLowerCase()}`,
    resource: {
      resourceType: "CarePlan",
      id: `rb-careplan-${patientId.toLowerCase()}`,
      status: "active",
      intent: "plan",
      title: `ReproBridge Longitudinal Care Plan · ${currentLifeStage}`,
      description:
        agentSummary ??
        `Coordinated reproductive & preventive care plan across life-stage transitions (${currentLifeStage}).`,
      subject: {
        reference: `Patient/${patientId}`,
        display: patientName,
      },
      created: timestamp,
      author: {
        display: "ReproBridge Deterministic Rules + Clinician-Reviewed Handoff",
      },
      activity: obligations.map((obl) => ({
        detail: {
          status:
            obl.status === "VERIFIED_CLOSED"
              ? "completed"
              : obl.status === "DEFERRED_TO_POSTPARTUM"
                ? "on-hold"
                : "in-progress",
          description: `${obl.id}: ${obl.title} [${obl.rule_version}]`,
        },
      })),
    },
    request: {
      method: "PUT",
      url: `CarePlan/rb-careplan-${patientId.toLowerCase()}`,
    },
  };

  const taskEntries = obligations.map((obl) => ({
    fullUrl: `urn:uuid:reprobridge-task-${obl.id.toLowerCase()}`,
    resource: {
      resourceType: "Task",
      id: `rb-task-${obl.id.toLowerCase()}`,
      status:
        obl.status === "VERIFIED_CLOSED"
          ? "completed"
          : obl.status === "DEFERRED_TO_POSTPARTUM"
            ? "on-hold"
            : "requested",
      intent: "order",
      priority:
        obl.priority === "URGENT"
          ? "stat"
          : obl.priority === "HIGH"
            ? "urgent"
            : "routine",
      description: obl.title,
      focus: {
        display: obl.evidence_source,
      },
      for: {
        reference: `Patient/${patientId}`,
        display: patientName,
      },
      authoredOn: timestamp,
      owner: {
        display: obl.owner,
      },
      reasonCode: {
        text: `${obl.rule_version} · ${obl.life_stage}`,
      },
      note: [
        { text: obl.rationale },
        ...(obl.verified_by
          ? [{ text: `Evidence-verified closure by ${obl.verified_by}: ${obl.closure_evidence ?? ""}` }]
          : []),
      ],
    },
    request: {
      method: "PUT",
      url: `Task/rb-task-${obl.id.toLowerCase()}`,
    },
  }));

  return {
    resourceType: "Bundle",
    id: `reprobridge-emr-push-${timestamp.slice(0, 10)}`,
    type: "transaction",
    timestamp,
    meta: {
      profile: ["http://hl7.org/fhir/StructureDefinition/Bundle"],
      source: "urn:reprobridge:malaffi-hie:smart-on-fhir-layer",
      tag: [
        {
          system: "urn:reprobridge:governance",
          code: "UAE_PHI_LOCAL_ONLY",
          display: "Generated locally inside UAE boundary for EMR write-back",
        },
      ],
    },
    extension:
      handoffItems.length > 0
        ? [
            {
              url: "urn:reprobridge:extension:clinician-handoff-checklist",
              valueString: handoffItems.map((item, idx) => `${idx + 1}. ${item}`).join(" | "),
            },
          ]
        : undefined,
    entry: [carePlanEntry, ...taskEntries],
  };
}
