import { useEffect, useState } from "react";
import PrototypeDemo from "./PrototypeDemo";
import TutorialHome from "./TutorialHome";
import PatientSearchOnboarding from "./demo/PatientSearchOnboarding";
import type {
  ReconciledClinicalContext,
  ReconciliationOnboardingResult,
  ReconciliationTransitionSeed,
} from "./demo/types";

type AppView = "tutorial" | "search" | "demo";

function resolveHashView(): AppView {
  if (window.location.hash === "#demo") return "demo";
  if (window.location.hash === "#search") return "search";
  return "tutorial";
}

export default function App() {
  const [view, setView] = useState<AppView>(resolveHashView);
  const [searchStep, setSearchStep] = useState<"search" | "questionnaire">("search");
  const [activePatientId, setActivePatientId] = useState<string>("PAT-AE-4092");
  const [reconciliation, setReconciliation] = useState<ReconciledClinicalContext | null>(null);
  const [transitionSeed, setTransitionSeed] = useState<ReconciliationTransitionSeed | null>(null);

  useEffect(() => {
    const onHashChange = () => {
      setView(resolveHashView());
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function openSearch(step: "search" | "questionnaire" = "search") {
    setSearchStep(step);
    window.location.hash = "search";
    setView("search");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openDemoDirect(patientId?: string) {
    if (patientId) {
      setActivePatientId(patientId);
    }
    setReconciliation(null);
    setTransitionSeed(null);
    window.location.hash = "demo";
    setView("demo");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleCompleteOnboarding(result: ReconciliationOnboardingResult) {
    setActivePatientId(result.patientId);
    setReconciliation(result.reconciliation);
    setTransitionSeed(result.transitionResult ?? null);
    window.location.hash = "demo";
    setView("demo");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openTutorial() {
    window.location.hash = "";
    setView("tutorial");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (view === "demo") {
    return (
      <PrototypeDemo
        onBackToTutorial={openTutorial}
        initialPatientId={activePatientId}
        initialReconciliation={reconciliation}
        initialTransitionResult={transitionSeed}
        onOpenPatientSearch={() => openSearch("search")}
      />
    );
  }

  if (view === "search") {
    return (
      <PatientSearchOnboarding
        initialPatientId={activePatientId}
        initialStep={searchStep}
        onBackToTutorial={openTutorial}
        onCompleteOnboarding={handleCompleteOnboarding}
        onSkipToWorkbench={(pid) => openDemoDirect(pid)}
      />
    );
  }

  return <TutorialHome onLaunchDemo={() => openSearch("search")} />;
}
