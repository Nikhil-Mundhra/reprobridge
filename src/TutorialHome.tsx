import { ArrowRight } from "lucide-react";

interface TutorialHomeProps {
  onLaunchDemo: () => void;
}

interface TutorialStep {
  number: string;
  tag: string;
  title: string;
  summary: string;
  actionHint: string;
  imageUrl: string;
  imageAlt: string;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    number: "01",
    tag: "EMR / Malaffi HIE Intake",
    title: "Surface adolescent & prior-loss history before it repeats",
    summary:
      "Amira was diagnosed with Hashimoto's hypothyroidism at age 16, lost to follow-up across fragmented clinics, and suffered an early miscarriage at age 31 from unmanaged TSH. Now age 32 and pregnant again, her HL7 FHIR R4 feed carries elevated TSH (4.8 mIU/L) and Rubella IgG non-immune status.",
    actionHint: "In the prototype, inspect Amira's age 16 → 31 → 32 history and FHIR records.",
    imageUrl:
      "https://images.unsplash.com/photo-1579154204601-01588f351e67?auto=format&fit=crop&w=1000&q=80",
    imageAlt: "Clinical laboratory diagnostic vials and bloodwork testing",
  },
  {
    number: "02",
    tag: "Clinical Obligation Passport",
    title: "Turn findings into auditable, rule-versioned obligations",
    summary:
      "ReproBridge logs each care gap onto a longitudinal Clinical Obligation Passport in Neon PostgreSQL—binding every obligation to its source FHIR record, deterministic rule version (RB-THYROID-v1.4.0, RB-IMMUNE-v1.2.1), and clinical owner.",
    actionHint: "Review OBL-101 (HIGH) and OBL-102 (MEDIUM) as Amira enters her new pregnancy at 32.",
    imageUrl:
      "https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=1000&q=80",
    imageAlt: "Clinician reviewing longitudinal digital medical records on a tablet",
  },
  {
    number: "03",
    tag: "Life-Stage Transition (Deterministic)",
    title: "Trigger a pregnancy event and watch clinical rules fire",
    summary:
      "When pregnancy is confirmed, deterministic rules run with zero LLM guesswork: elevated TSH escalates immediately to URGENT for OB-GYN review, while live MMR vaccination is locked and safely deferred to postpartum because it is contraindicated during pregnancy.",
    actionHint: "Click “Trigger Pregnancy Transition” in the patient header.",
    imageUrl:
      "https://images.unsplash.com/photo-1584515933487-779824d29309?auto=format&fit=crop&w=1000&q=80",
    imageAlt: "OB-GYN clinician consulting with an expectant mother",
  },
  {
    number: "04",
    tag: "UAE Data Residency Firewall + OpenRouter AI",
    title: "Draft specialist handoffs without sending PHI outside the UAE",
    summary:
      "Only after deterministic rules finish does ReproBridge invoke OpenRouter to draft a concise specialist handoff. Before any byte leaves, the UAE Privacy Firewall strips patient names, MRNs, and HIE identifiers—replacing them with an ephemeral case token.",
    actionHint: "Click “Inspect Exact AI Payload” to verify zero PHI was transmitted.",
    imageUrl:
      "https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=1000&q=80",
    imageAlt: "Data security and privacy protection boundary illustration",
  },
  {
    number: "05",
    tag: "Human-in-the-Loop Governance",
    title: "Require clinical evidence and clinician sign-off to close care",
    summary:
      "Reminders and bookings never close an obligation. An authorized OB-GYN verifies repeat lab evidence (TSH 2.1 mIU/L) and signs off on OBL-101, writing an immutable event to the governance audit log.",
    actionHint: "Click “Clinician Verify & Close” on OBL-101 and approve the evidence.",
    imageUrl:
      "https://images.unsplash.com/photo-1551076805-e1869033e561?auto=format&fit=crop&w=1000&q=80",
    imageAlt: "Physician reviewing and signing off on clinical evidence",
  },
  {
    number: "06",
    tag: "Postpartum Continuity",
    title: "Wake up deferred obligations automatically after delivery",
    summary:
      "Nine months later, a postpartum delivery event lifts the pregnancy contraindication. ReproBridge automatically reactivates OBL-102 as URGENT for pre-discharge MMR vaccination so nothing is ever dropped across life stages.",
    actionHint: "Click “Trigger Postpartum Transition”, then verify & close OBL-102.",
    imageUrl:
      "https://images.unsplash.com/photo-1555252333-9f8e92e65df9?auto=format&fit=crop&w=1000&q=80",
    imageAlt: "Mother and newborn baby representing postpartum care continuity",
  },
];

export default function TutorialHome({ onLaunchDemo }: TutorialHomeProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <img
              src="/reprobridge-logo-full.png"
              alt="ReproBridge — Connected care for women"
              width={320}
              height={100}
              className="h-20 w-auto object-contain"
            />
            <span className="hidden border-l border-slate-200 pl-3 text-xs font-medium text-slate-500 sm:inline">
              6-Step Interactive Walkthrough
            </span>
          </div>

          <button
            type="button"
            onClick={onLaunchDemo}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition hover:bg-teal-700"
          >
            Launch Live Prototype
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        <div className="mb-10 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">
            How ReproBridge Works
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Step-by-Step Care Continuity Tutorial
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Follow these six steps to see how ReproBridge carries critical findings safely
            from preconception through pregnancy and postpartum—with deterministic clinical
            rules, UAE PHI privacy boundaries, and clinician-verified closure.
          </p>
        </div>

        <ol className="space-y-8">
          {TUTORIAL_STEPS.map((step, index) => {
            const reverse = index % 2 === 1;
            return (
              <li
                key={step.number}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs"
              >
                <div
                  className={`grid items-stretch md:grid-cols-2 ${
                    reverse ? "md:[&>*:first-child]:order-2" : ""
                  }`}
                >
                  <div className="relative min-h-60 bg-slate-200">
                    <img
                      src={step.imageUrl}
                      alt={step.imageAlt}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute left-4 top-4 rounded-full bg-slate-900/80 px-3 py-1 font-mono text-xs font-semibold text-white backdrop-blur-xs">
                      STEP {step.number}
                    </span>
                  </div>

                  <div className="flex flex-col justify-center p-6 sm:p-8">
                    <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">
                      {step.tag}
                    </p>
                    <h2 className="mt-2 text-xl font-semibold text-slate-900">
                      {step.title}
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-slate-600">
                      {step.summary}
                    </p>
                    <div className="mt-5 rounded-lg border border-slate-100 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700">
                      <span className="font-semibold text-slate-900">Try it: </span>
                      {step.actionHint}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 rounded-2xl border border-teal-200 bg-teal-50 p-6 sm:flex-row sm:p-8">
          <div className="flex items-center gap-4">
            <img
              src="/reprobridge-mark.png"
              alt=""
              width={48}
              height={48}
              className="hidden h-12 w-12 shrink-0 object-contain sm:block"
            />
            <div>
              <p className="text-base font-semibold text-teal-950">
                Ready to run the 6 steps live?
              </p>
              <p className="mt-1 text-sm text-teal-800">
                Connected to Neon PostgreSQL and OpenRouter with the UAE Privacy Firewall active.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onLaunchDemo}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white shadow-xs transition hover:bg-teal-700"
          >
            Launch Live Prototype
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </main>
    </div>
  );
}
