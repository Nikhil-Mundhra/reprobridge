import { useEffect, useState } from "react";
import PrototypeDemo from "./PrototypeDemo";
import TutorialHome from "./TutorialHome";

export default function App() {
  const [view, setView] = useState<"tutorial" | "demo">(() =>
    window.location.hash === "#demo" ? "demo" : "tutorial"
  );

  useEffect(() => {
    const onHashChange = () => {
      setView(window.location.hash === "#demo" ? "demo" : "tutorial");
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function openDemo() {
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
    return <PrototypeDemo onBackToTutorial={openTutorial} />;
  }

  return <TutorialHome onLaunchDemo={openDemo} />;
}
