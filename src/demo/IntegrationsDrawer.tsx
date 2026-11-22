import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  Building2,
  Check,
  CheckCircle2,
  Globe,
  Loader2,
  Lock,
  Network,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  clampDrawerWidth,
  DEFAULT_DRAWER_WIDTH,
  getMaxDrawerWidth,
  MIN_DRAWER_WIDTH,
  type DocsDockSide,
} from "./docsSessionPrefs";

export interface EmrIntegrationItem {
  id: string;
  name: string;
  vendor: string;
  category: "hie" | "emr" | "lab";
  categoryLabel: string;
  logoUrl: string;
  fallbackMonogram: string;
  fallbackAccent: string;
  facilities: string;
  protocols: string[];
  fhirEndpoint: string;
  scopes: string[];
  description: string;
  connected: boolean;
  lastSync: string;
}

const INITIAL_INTEGRATIONS: EmrIntegrationItem[] = [
  {
    id: "INT-MALAFFI",
    name: "Malaffi (Abu Dhabi HIE)",
    vendor: "Abu Dhabi Department of Health (DoH) · Injazat",
    category: "hie",
    categoryLabel: "UAE National HIE",
    logoUrl: "https://malaffi.ae/wp-content/themes/malaffi/assets/images/logo.svg",
    fallbackMonogram: "M",
    fallbackAccent: "from-teal-600 to-emerald-600",
    facilities: "All Abu Dhabi DoH Licensed Hospitals, Clinics & Laboratories",
    protocols: ["HL7 FHIR R4", "IHE XDS.b", "ADT A01/A04", "ORU^R01"],
    fhirEndpoint: "https://fhir.malaffi.ae/r4/metadata",
    scopes: ["Patient.read", "Observation.read", "DiagnosticReport.read", "CarePlan.write"],
    description:
      "Primary Abu Dhabi health information exchange spine linking preconception primary care, maternity hospitals, and postpartum labs.",
    connected: true,
    lastSync: "Synced 14s ago · 0 PHI Egress",
  },
  {
    id: "INT-ORACLE",
    name: "Oracle Health (Cerner Millennium)",
    vendor: "Oracle Health / Cerner Corporation",
    category: "emr",
    categoryLabel: "Hospital EMR / EHR",
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/5/50/Oracle_logo.svg",
    fallbackMonogram: "OH",
    fallbackAccent: "from-red-600 to-rose-700",
    facilities: "SEHA Public Hospitals · Corniche Maternity & Women's Hospital",
    protocols: ["SMART on FHIR R4", "Cerner Ignite API", "CDS Hooks 2.0"],
    fhirEndpoint: "https://fhir-ehr.cerner.com/r4/ae-seha-prod",
    scopes: ["patient/Observation.read", "patient/CarePlan.write", "patient/Task.write"],
    description:
      "Direct inpatient and antenatal clinic EHR integration for OB-GYN handoffs, fetal-maternal medicine orders, and pre-discharge checklists.",
    connected: true,
    lastSync: "Synced 28s ago · Bidirectional R4",
  },
  {
    id: "INT-EPIC",
    name: "Epic Systems (EpicCare & Stork OB)",
    vendor: "Epic Systems Corporation",
    category: "emr",
    categoryLabel: "Hospital EMR / EHR",
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/2/24/Epic_Systems.svg",
    fallbackMonogram: "EP",
    fallbackAccent: "from-rose-600 to-red-700",
    facilities: "Cleveland Clinic Abu Dhabi · Mubadala Health Network",
    protocols: ["Epic on FHIR R4", "Stork Perinatal", "Care Everywhere"],
    fhirEndpoint: "https://interconnect.ccad.ae/api/FHIR/R4",
    scopes: ["Patient.read", "Observation.read", "Immunization.read", "CarePlan.write"],
    description:
      "Longitudinal ambulatory and Stork perinatal module connector for endocrine consultations, high-risk obstetric triage, and lab write-back.",
    connected: true,
    lastSync: "Synced 42s ago · CarePlan Active",
  },
  {
    id: "INT-INTERSYSTEMS",
    name: "InterSystems TrakCare & HealthShare",
    vendor: "InterSystems Corporation",
    category: "emr",
    categoryLabel: "Hospital EMR / EHR",
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/5/56/InterSystems_logo.svg",
    fallbackMonogram: "IS",
    fallbackAccent: "from-sky-600 to-indigo-700",
    facilities: "Danat Al Emarat Hospital for Women & Children · Burjeel Medical City",
    protocols: ["IRIS for Health FHIR R4", "HL7 v2.6", "REST Subscriptions"],
    fhirEndpoint: "https://trakcare-fhir.danatalemarat.ae/csp/healthshare/r4",
    scopes: ["Patient.read", "Observation.read", "ImmunizationRecommendation.write"],
    description:
      "Women's specialty hospital EMR connector supporting preeclampsia prophylaxis windows and postpartum immunization reactivation.",
    connected: true,
    lastSync: "Synced 1m ago · Subscription Live",
  },
  {
    id: "INT-NABIDH",
    name: "NABIDH (Dubai Health Authority HIE)",
    vendor: "Dubai Health Authority (DHA)",
    category: "hie",
    categoryLabel: "UAE National HIE",
    logoUrl: "https://nabidh.dha.gov.ae/assets/images/nabidh-logo.png",
    fallbackMonogram: "NB",
    fallbackAccent: "from-emerald-600 to-teal-700",
    facilities: "Dubai Healthcare City & DHA Private Maternity Network",
    protocols: ["HL7 FHIR R4", "HL7 v2.5.1", "IHE PIX/PDQ"],
    fhirEndpoint: "https://gateway.nabidh.dha.gov.ae/fhir/r4",
    scopes: ["Patient.read", "Observation.read", "AllergyIntolerance.read"],
    description:
      "Cross-emirate reproductive care continuity bridge for patients transferring between Abu Dhabi and Dubai maternity providers.",
    connected: false,
    lastSync: "Ready for 1-click FHIR handshake",
  },
  {
    id: "INT-RIAYATI",
    name: "Riayati (National Unified Medical Record)",
    vendor: "UAE Ministry of Health & Prevention (MOHAP)",
    category: "hie",
    categoryLabel: "UAE National HIE",
    logoUrl: "https://riayati.ae/wp-content/uploads/2021/10/Riayati-Logo.png",
    fallbackMonogram: "RY",
    fallbackAccent: "from-amber-600 to-orange-600",
    facilities: "Federal & Northern Emirates Maternal-Child Health Centers",
    protocols: ["FHIR R4 National Core", "National Immunization Registry"],
    fhirEndpoint: "https://api.riayati.gov.ae/fhir/v4.0.1",
    scopes: ["Patient.read", "Immunization.read", "CarePlan.read"],
    description:
      "Federal NUMR connector synchronizing national Rubella, Varicella, and HPV immunization history across emirates.",
    connected: false,
    lastSync: "Ready for 1-click FHIR handshake",
  },
  {
    id: "INT-MEDITECH",
    name: "MEDITECH Expanse",
    vendor: "Medical Information Technology, Inc.",
    category: "emr",
    categoryLabel: "Hospital EMR / EHR",
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Meditech_logo.svg",
    fallbackMonogram: "MT",
    fallbackAccent: "from-blue-600 to-cyan-700",
    facilities: "Al Bateen & Khalifa City Affiliated Community Clinics",
    protocols: ["Expanse FHIR R4", "Traverse Exchange", "CCDA 2.1"],
    fhirEndpoint: "https://fhir.meditech-uae.ae/r4",
    scopes: ["Observation.read", "DiagnosticReport.read", "Task.write"],
    description:
      "Community family-medicine EHR connector for preconception screening panels and primary care follow-up tasks.",
    connected: false,
    lastSync: "Ready for 1-click FHIR handshake",
  },
  {
    id: "INT-PURELAB",
    name: "PureLab & National Reference LIMS",
    vendor: "PureHealth / HL7 Lab Interoperability Network",
    category: "lab",
    categoryLabel: "Diagnostics & Lab",
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/8/87/HL7_International_logo.svg",
    fallbackMonogram: "PL",
    fallbackAccent: "from-purple-600 to-indigo-700",
    facilities: "Abu Dhabi Central Endocrinology, Serology & Molecular Labs",
    protocols: ["FHIR Observation R4", "LOINC 2.77", "HL7 ORU^R01"],
    fhirEndpoint: "https://lims-fhir.purelab.ae/r4",
    scopes: ["Observation.read", "DiagnosticReport.read", "Specimen.read"],
    description:
      "Automated LOINC-coded laboratory feed delivering real-time TSH, free T4, 75g OGTT, HbA1c, and IgG serology titers.",
    connected: false,
    lastSync: "Ready for 1-click FHIR handshake",
  },
];

// Lazy probe for discrete `display` transitions
let cachedDisplayTransitionSupport: boolean | undefined;

function canTransitionDisplay(): boolean {
  if (cachedDisplayTransitionSupport !== undefined) return cachedDisplayTransitionSupport;
  if (
    typeof window === "undefined" ||
    !window.CSS?.supports?.("transition-behavior", "allow-discrete") ||
    !document.body
  ) {
    return false;
  }
  const probe = document.createElement("div");
  probe.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = "none";
  cachedDisplayTransitionSupport = getComputedStyle(probe).display === "block";
  probe.remove();
  return cachedDisplayTransitionSupport;
}

function supportsTopLayerExit(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.CSS?.supports?.("overlay", "auto")) &&
    canTransitionDisplay()
  );
}

async function closeDialogWithAnimation(dialog: HTMLDialogElement): Promise<void> {
  if (!dialog.open) return;
  if (!supportsTopLayerExit()) {
    dialog.setAttribute("data-closing", "");
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((resolve) => window.setTimeout(resolve, 400)),
      ]);
    }
    if (!dialog.hasAttribute("data-closing")) return;
    dialog.removeAttribute("data-closing");
  }
  if (dialog.open) {
    dialog.close();
  }
}

function IntegrationLogo({ item }: { item: EmrIntegrationItem }) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className="flex h-12 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200/90 bg-white px-2.5 py-1.5 shadow-2xs">
      {!imgFailed ? (
        <img
          src={item.logoUrl}
          alt={`${item.name} logo`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="max-h-8 w-auto max-w-full object-contain"
        />
      ) : (
        <div
          aria-hidden="true"
          className={`flex h-8 w-14 items-center justify-center rounded-lg bg-gradient-to-br ${item.fallbackAccent} font-mono text-xs font-bold tracking-wider text-white shadow-2xs`}
        >
          {item.fallbackMonogram}
        </div>
      )}
    </div>
  );
}

interface FloatingIntegrationsTabProps {
  connectedCount: number;
  initialSide?: DocsDockSide;
  initialYRatio?: number;
  onDockChange?: (side: DocsDockSide) => void;
  onOpen: () => void;
}

const TOP_SAFE_MARGIN = 64;
const BOTTOM_SAFE_MARGIN = 16;
const DRAG_THRESHOLD_PX = 5;
const DEFAULT_TAB_WIDTH = 44;
const DEFAULT_TAB_HEIGHT = 176;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getViewportSize(): { width: number; height: number } {
  const docEl = typeof document !== "undefined" ? document.documentElement : null;
  const fallbackW = typeof window !== "undefined" ? window.innerWidth : 1280;
  const fallbackH = typeof window !== "undefined" ? window.innerHeight : 800;
  return {
    width: docEl && docEl.clientWidth > 0 ? docEl.clientWidth : fallbackW,
    height: docEl && docEl.clientHeight > 0 ? docEl.clientHeight : fallbackH,
  };
}

function computeDockedPosition(
  side: DocsDockSide,
  yRatio: number,
  width: number,
  height: number
): { left: number; top: number } {
  const { width: viewportWidth, height: viewportHeight } = getViewportSize();
  const maxLeft = Math.max(0, viewportWidth - width);
  const left = side === "left" ? 0 : maxLeft;
  const maxTop = Math.max(TOP_SAFE_MARGIN, viewportHeight - height - BOTTOM_SAFE_MARGIN);
  const rawTop = Math.round(TOP_SAFE_MARGIN + yRatio * (maxTop - TOP_SAFE_MARGIN));
  return {
    left,
    top: clamp(rawTop, TOP_SAFE_MARGIN, maxTop),
  };
}

export function FloatingIntegrationsTab({
  connectedCount,
  initialSide = "right",
  initialYRatio = 0.76,
  onDockChange,
  onOpen,
}: FloatingIntegrationsTabProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const suppressClickRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    lastLeft: number;
    lastTop: number;
    width: number;
    height: number;
    didDrag: boolean;
  } | null>(null);

  const [dockSide, setDockSide] = useState<DocsDockSide>(initialSide);
  const [yRatio, setYRatio] = useState<number>(initialYRatio);
  const [isDragging, setIsDragging] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>(() =>
    computeDockedPosition(initialSide, initialYRatio, DEFAULT_TAB_WIDTH, DEFAULT_TAB_HEIGHT)
  );

  const measureDimensions = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    return {
      width: rect && rect.width > 0 ? rect.width : DEFAULT_TAB_WIDTH,
      height: rect && rect.height > 0 ? rect.height : DEFAULT_TAB_HEIGHT,
    };
  }, []);

  const syncDockedPosition = useCallback(
    (targetSide: DocsDockSide, targetYRatio: number) => {
      const { width, height } = measureDimensions();
      setPos(computeDockedPosition(targetSide, targetYRatio, width, height));
    },
    [measureDimensions]
  );

  useLayoutEffect(() => {
    if (!isDragging) {
      syncDockedPosition(dockSide, yRatio);
    }
  }, [dockSide, yRatio, isDragging, connectedCount, syncDockedPosition]);

  useEffect(() => {
    const onResize = () => {
      if (!dragRef.current) {
        syncDockedPosition(dockSide, yRatio);
      }
    };
    window.addEventListener("resize", onResize);
    const observer =
      typeof ResizeObserver !== "undefined" && document.documentElement
        ? new ResizeObserver(onResize)
        : null;
    if (observer && document.documentElement) {
      observer.observe(document.documentElement);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [dockSide, yRatio, syncDockedPosition]);

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    const { width, height } = measureDimensions();
    const currentPos = computeDockedPosition(dockSide, yRatio, width, height);
    const startLeft = isDragging ? pos.left : currentPos.left;
    const startTop = isDragging ? pos.top : currentPos.top;

    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originLeft: startLeft,
      originTop: startTop,
      lastLeft: startLeft,
      lastTop: startTop,
      width,
      height,
      didDrag: false,
    };

    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignore synthetic events where pointer capture is unavailable
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const session = dragRef.current;
    if (!session || session.pointerId !== e.pointerId) return;

    const dx = e.clientX - session.startX;
    const dy = e.clientY - session.startY;
    if (!session.didDrag) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      session.didDrag = true;
      setIsDragging(true);
    }

    const { width: viewportWidth, height: viewportHeight } = getViewportSize();
    const maxLeft = Math.max(0, viewportWidth - session.width);
    const maxTop = Math.max(
      TOP_SAFE_MARGIN,
      viewportHeight - session.height - BOTTOM_SAFE_MARGIN
    );
    const nextLeft = clamp(session.originLeft + dx, 0, maxLeft);
    const nextTop = clamp(session.originTop + dy, TOP_SAFE_MARGIN, maxTop);

    session.lastLeft = nextLeft;
    session.lastTop = nextTop;
    setPos({ left: nextLeft, top: nextTop });
  }

  function finishDrag(e: React.PointerEvent<HTMLButtonElement>) {
    const session = dragRef.current;
    if (!session || session.pointerId !== e.pointerId) return;
    dragRef.current = null;

    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      // Ignore synthetic events
    }

    if (session.didDrag) {
      suppressClickRef.current = true;
      const { width: viewportWidth, height: viewportHeight } = getViewportSize();
      const centerX = session.lastLeft + session.width / 2;
      const nextSide: DocsDockSide = centerX < viewportWidth / 2 ? "left" : "right";
      const maxTop = Math.max(
        TOP_SAFE_MARGIN,
        viewportHeight - session.height - BOTTOM_SAFE_MARGIN
      );
      const span = maxTop - TOP_SAFE_MARGIN;
      const nextYRatio =
        span > 0 ? clamp((session.lastTop - TOP_SAFE_MARGIN) / span, 0, 1) : 0.76;

      setDockSide(nextSide);
      setYRatio(nextYRatio);
      setPos(computeDockedPosition(nextSide, nextYRatio, session.width, session.height));
      setIsDragging(false);
      onDockChange?.(nextSide);
    } else {
      setIsDragging(false);
    }
  }

  function handleClick() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onOpen();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const nextSide: DocsDockSide = e.key === "ArrowLeft" ? "left" : "right";
      setDockSide(nextSide);
      syncDockedPosition(nextSide, yRatio);
      onDockChange?.(nextSide);
    }
  }

  const baseClass =
    "fixed z-30 hidden touch-none select-none flex-col items-center gap-2 border px-2.5 py-3.5 text-xs font-semibold backdrop-blur-xs md:flex";

  const stateClass = isDragging
    ? "cursor-grabbing scale-[1.03] rounded-xl border-indigo-400 bg-white text-indigo-950 shadow-2xl transition-none"
    : dockSide === "left"
      ? "cursor-grab rounded-r-xl border-l-0 border-slate-300 bg-white/95 text-slate-800 shadow-lg transition-[left,top,transform,box-shadow,border-color,background-color] duration-200 ease-out hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-950 motion-reduce:transition-none"
      : "cursor-grab rounded-l-xl border-r-0 border-slate-300 bg-white/95 text-slate-800 shadow-lg transition-[left,top,transform,box-shadow,border-color,background-color] duration-200 ease-out hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-950 motion-reduce:transition-none";

  return (
    <button
      ref={buttonRef}
      type="button"
      data-dock-side={dockSide}
      data-dragging={isDragging ? "true" : "false"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
      aria-label={`Open HIE & EMR Integrations Hub (${connectedCount} connected). Drag to move to left or right edge.`}
      title="Click to open HIE & EMR Integrations · Drag to move to left or right edge"
      className={`${baseClass} ${stateClass}`}
    >
      <Network className="h-4 w-4 text-indigo-600" aria-hidden="true" />
      <span className="[writing-mode:vertical-rl] rotate-180 tracking-wide">
        Integrations
      </span>
      <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
        {connectedCount}
      </span>
    </button>
  );
}

interface IntegrationsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  side?: DocsDockSide;
  drawerWidth?: number;
  onDrawerWidthChange?: (width: number) => void;
  onConnectedCountChange?: (count: number) => void;
}

export default function IntegrationsDrawer({
  isOpen,
  onClose,
  side = "right",
  drawerWidth: propDrawerWidth,
  onDrawerWidthChange,
  onConnectedCountChange,
}: IntegrationsDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    lastWidth: number;
  } | null>(null);

  const [width, setWidth] = useState<number>(() =>
    clampDrawerWidth(propDrawerWidth ?? DEFAULT_DRAWER_WIDTH)
  );
  const [isResizing, setIsResizing] = useState(false);

  const [integrations, setIntegrations] =
    useState<EmrIntegrationItem[]>(INITIAL_INTEGRATIONS);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<
    "ALL" | "CONNECTED" | "hie" | "emr" | "lab"
  >("ALL");
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const [customName, setCustomName] = useState("");
  const [customVendor, setCustomVendor] = useState("");
  const [customLogoUrl, setCustomLogoUrl] = useState("");
  const [customFacility, setCustomFacility] = useState("");
  const [customEndpoint, setCustomEndpoint] = useState("");

  useEffect(() => {
    if (typeof propDrawerWidth === "number" && !resizeRef.current) {
      setWidth(clampDrawerWidth(propDrawerWidth));
    }
  }, [propDrawerWidth]);

  const connectedCount = useMemo(
    () => integrations.filter((item) => item.connected).length,
    [integrations]
  );

  useEffect(() => {
    onConnectedCountChange?.(connectedCount);
  }, [connectedCount, onConnectedCountChange]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.removeAttribute("data-closing");
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      void closeDialogWithAnimation(dialog);
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = "";
      onClose();
    };
    const handleCancel = (event: Event) => {
      event.preventDefault();
      void closeDialogWithAnimation(dialog);
    };

    dialog.addEventListener("close", handleClose);
    dialog.addEventListener("cancel", handleCancel);

    let cleanupLightDismiss: (() => void) | undefined;
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const isOutside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      const onPointerDown = (e: PointerEvent) => {
        pressedOutside = isOutside(e);
      };
      const onPointerUp = (e: PointerEvent) => {
        if (pressedOutside && isOutside(e)) {
          void closeDialogWithAnimation(dialog);
        }
        pressedOutside = false;
      };
      dialog.addEventListener("pointerdown", onPointerDown);
      dialog.addEventListener("pointerup", onPointerUp);
      cleanupLightDismiss = () => {
        dialog.removeEventListener("pointerdown", onPointerDown);
        dialog.removeEventListener("pointerup", onPointerUp);
      };
    }

    return () => {
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("cancel", handleCancel);
      cleanupLightDismiss?.();
    };
  }, [onClose]);

  const filteredIntegrations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return integrations.filter((item) => {
      if (categoryFilter === "CONNECTED" && !item.connected) return false;
      if (
        categoryFilter !== "ALL" &&
        categoryFilter !== "CONNECTED" &&
        item.category !== categoryFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.vendor.toLowerCase().includes(q) ||
        item.facilities.toLowerCase().includes(q) ||
        item.protocols.some((p) => p.toLowerCase().includes(q))
      );
    });
  }, [integrations, searchQuery, categoryFilter]);

  function handleToggleConnection(id: string) {
    setConnectingId(id);
    window.setTimeout(() => {
      setIntegrations((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                connected: !item.connected,
                lastSync: !item.connected
                  ? "Connected just now · FHIR R4 CapabilityStatement verified"
                  : "Disconnected · Ready for 1-click FHIR handshake",
              }
            : item
        )
      );
      setConnectingId(null);
    }, 240);
  }

  function handleAddCustomIntegration(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = customName.trim();
    if (!trimmedName) return;

    const newItem: EmrIntegrationItem = {
      id: `INT-CUSTOM-${Date.now()}`,
      name: trimmedName,
      vendor: customVendor.trim() || "Hospital HL7 FHIR R4 Connector",
      category: "emr",
      categoryLabel: "Hospital EMR / EHR",
      logoUrl:
        customLogoUrl.trim() ||
        "https://upload.wikimedia.org/wikipedia/commons/8/87/HL7_International_logo.svg",
      fallbackMonogram: trimmedName.slice(0, 2).toUpperCase(),
      fallbackAccent: "from-teal-600 to-indigo-700",
      facilities: customFacility.trim() || "Abu Dhabi DoH Partner Facility",
      protocols: ["HL7 FHIR R4", "SMART on FHIR", "OAuth 2.0"],
      fhirEndpoint:
        customEndpoint.trim() ||
        `https://fhir.${trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, "")}.ae/r4`,
      scopes: ["Patient.read", "Observation.read", "CarePlan.write"],
      description:
        "Custom hospital EHR connector configured for bidirectional Clinical Obligation Passport synchronization within the UAE boundary.",
      connected: true,
      lastSync: "Connected just now · Custom FHIR R4 Endpoint",
    };

    setIntegrations((prev) => [newItem, ...prev]);
    setCustomName("");
    setCustomVendor("");
    setCustomLogoUrl("");
    setCustomFacility("");
    setCustomEndpoint("");
    setShowAddForm(false);
  }

  function handleResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    resizeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startWidth: width,
      lastWidth: width,
    };
    setIsResizing(true);
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignore synthetic events
    }
  }

  function handleResizePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const session = resizeRef.current;
    if (!session || session.pointerId !== e.pointerId) return;
    const dx = e.clientX - session.startX;
    const nextWidth = clampDrawerWidth(
      side === "left" ? session.startWidth + dx : session.startWidth - dx
    );
    session.lastWidth = nextWidth;
    setWidth(nextWidth);
  }

  function finishResize(e: React.PointerEvent<HTMLDivElement>) {
    const session = resizeRef.current;
    if (!session || session.pointerId !== e.pointerId) return;
    resizeRef.current = null;
    setIsResizing(false);
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      // Ignore synthetic events
    }
    const finalWidth = clampDrawerWidth(session.lastWidth);
    onDrawerWidthChange?.(finalWidth);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      data-side={side}
      data-resizing={isResizing ? "true" : "false"}
      style={{ "--rb-drawer-width": `${width}px` } as CSSProperties}
      className="rb-doc-drawer"
      {...({ closedby: "any" } as Record<string, string>)}
    >
      <div className="relative flex h-full flex-col overflow-hidden bg-slate-100 text-slate-900 shadow-2xl">
        {/* Draggable Width Resize Handle */}
        <div
          role="separator"
          aria-orientation="vertical"
          tabIndex={0}
          aria-label="Resize Integrations drawer width"
          aria-valuemin={MIN_DRAWER_WIDTH}
          aria-valuemax={getMaxDrawerWidth()}
          aria-valuenow={width}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          className={`group absolute inset-y-0 z-20 flex w-2.5 touch-none cursor-ew-resize items-center justify-center focus:outline-none ${
            side === "left" ? "right-0" : "left-0"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-12 w-1 rounded-full transition-colors ${
              isResizing
                ? "bg-indigo-600"
                : "bg-slate-300/80 group-hover:bg-indigo-500"
            }`}
          />
        </div>

        {/* Top Header */}
        <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-2xs">
                  <Network className="h-4 w-4" aria-hidden="true" />
                </span>
                <h2 id={titleId} className="text-sm font-semibold text-slate-900">
                  HIE &amp; EMR Integrations Hub
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                  {connectedCount} Connected · {integrations.length - connectedCount} Available
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-[11px] font-medium text-teal-800">
                  <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                  HL7 FHIR R4 · UAE Local Boundary
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Connect Abu Dhabi Malaffi HIE, Oracle Health (Cerner), Epic, and regional hospital EMRs to synchronize longitudinal maternal obligations.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs transition hover:bg-indigo-700"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add EMR / Hospital
              </button>
              <button
                type="button"
                onClick={() => {
                  if (dialogRef.current) void closeDialogWithAnimation(dialogRef.current);
                }}
                aria-label="Close Integrations panel"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Close
              </button>
            </div>
          </div>

          {/* Search & Category Filter Bar */}
          <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2.5 border-t border-slate-100 pt-3">
            <label className="relative min-w-[240px] flex-1">
              <span className="sr-only">Search HIE and EMR integrations</span>
              <Search
                className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Malaffi, Oracle Health, Epic, Nabidh, FHIR R4…"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
              />
            </label>

            <div className="flex flex-wrap items-center gap-1 text-[11px]">
              {(
                [
                  { id: "ALL", label: "All Systems" },
                  { id: "CONNECTED", label: `Connected (${connectedCount})` },
                  { id: "hie", label: "UAE National HIE" },
                  { id: "emr", label: "Hospital EMR / EHR" },
                  { id: "lab", label: "Diagnostics & Lab" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCategoryFilter(tab.id)}
                  className={`rounded-lg px-2.5 py-1 font-medium transition ${
                    categoryFilter === tab.id
                      ? "bg-indigo-600 text-white shadow-2xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* Main Scrollable Content */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Add Custom Hospital / EMR Integration Form */}
          {showAddForm && (
            <form
              onSubmit={handleAddCustomIntegration}
              className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-900">
                  Register New Hospital EMR or HIE Endpoint
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  Cancel
                </button>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="font-medium text-slate-700">EMR / HIE System Name *</span>
                  <input
                    type="text"
                    required
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="e.g. Allscripts Sunrise / NMC Royal EHR"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </label>
                <label className="block text-xs">
                  <span className="font-medium text-slate-700">Vendor / Authority</span>
                  <input
                    type="text"
                    value={customVendor}
                    onChange={(e) => setCustomVendor(e.target.value)}
                    placeholder="e.g. Veradigm / NMC Healthcare"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </label>
                <label className="block text-xs">
                  <span className="font-medium text-slate-700">Hospital / Clinic Network</span>
                  <input
                    type="text"
                    value={customFacility}
                    onChange={(e) => setCustomFacility(e.target.value)}
                    placeholder="e.g. NMC Royal Women's Hospital Abu Dhabi"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </label>
                <label className="block text-xs">
                  <span className="font-medium text-slate-700">Logo Image URL (Optional)</span>
                  <input
                    type="url"
                    value={customLogoUrl}
                    onChange={(e) => setCustomLogoUrl(e.target.value)}
                    placeholder="https://upload.wikimedia.org/..."
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </label>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <input
                  type="text"
                  value={customEndpoint}
                  onChange={(e) => setCustomEndpoint(e.target.value)}
                  placeholder="FHIR R4 Base URL (e.g. https://fhir.hospital.ae/r4)"
                  className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-xs focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-indigo-700"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Connect Endpoint
                </button>
              </div>
            </form>
          )}

          {/* Integration Cards Grid */}
          <div
            className={`grid gap-3.5 ${
              width >= 820 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
            }`}
          >
            {filteredIntegrations.map((item) => {
              const isConnecting = connectingId === item.id;
              const isConfiguring = configuringId === item.id;

              return (
                <article
                  key={item.id}
                  className={`flex flex-col justify-between rounded-xl border bg-white p-4 shadow-xs transition ${
                    item.connected
                      ? "border-emerald-200/90 ring-1 ring-emerald-500/10"
                      : "border-slate-200/90 hover:border-slate-300"
                  }`}
                >
                  <div>
                    {/* Top Row: Logo + Title + Status */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <IntegrationLogo item={item} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                              {item.categoryLabel}
                            </span>
                            {item.connected ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                                <span
                                  aria-hidden="true"
                                  className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                                />
                                Connected
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                                Available
                              </span>
                            )}
                          </div>
                          <h3 className="mt-1 truncate text-sm font-semibold text-slate-900">
                            {item.name}
                          </h3>
                          <p className="truncate text-[11px] text-slate-500">{item.vendor}</p>
                        </div>
                      </div>
                    </div>

                    <p className="mt-2.5 text-xs leading-relaxed text-slate-600">
                      {item.description}
                    </p>

                    {/* Facility Mapping */}
                    <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-slate-600">
                      <Building2 className="h-3.5 w-3.5 shrink-0 text-teal-700" aria-hidden="true" />
                      <span className="truncate font-medium">{item.facilities}</span>
                    </div>

                    {/* Protocol Badges */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {item.protocols.map((proto) => (
                        <span
                          key={proto}
                          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] font-medium text-slate-700"
                        >
                          {proto}
                        </span>
                      ))}
                    </div>

                    {/* Expandable Endpoint & Scopes Inspector */}
                    {isConfiguring && (
                      <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px]">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-700">
                            FHIR R4 Endpoint Configuration
                          </span>
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-700">
                            <Lock className="h-3 w-3" aria-hidden="true" />
                            mTLS · UAE Residency
                          </span>
                        </div>
                        <div className="rounded border border-slate-200 bg-white px-2 py-1 font-mono text-[10px] text-slate-700">
                          {item.fhirEndpoint}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="text-[10px] font-medium text-slate-500">Scopes:</span>
                          {item.scopes.map((scope) => (
                            <span
                              key={scope}
                              className="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] text-indigo-800"
                            >
                              {scope}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Card Footer: Sync Telemetry + Connect / Configure Buttons */}
                  <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                      <Activity
                        className={`h-3 w-3 ${
                          item.connected ? "text-emerald-600" : "text-slate-400"
                        }`}
                        aria-hidden="true"
                      />
                      {item.lastSync}
                    </span>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setConfiguringId(isConfiguring ? null : item.id)
                        }
                        aria-label={`Configure ${item.name}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                      >
                        <Settings2 className="h-3 w-3" aria-hidden="true" />
                        {isConfiguring ? "Hide Config" : "FHIR Config"}
                      </button>

                      <button
                        type="button"
                        disabled={isConnecting}
                        onClick={() => handleToggleConnection(item.id)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold shadow-2xs transition disabled:opacity-60 ${
                          item.connected
                            ? "border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                            : "bg-indigo-600 text-white hover:bg-indigo-700"
                        }`}
                      >
                        {isConnecting ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            Syncing…
                          </>
                        ) : item.connected ? (
                          <>
                            <RefreshCw className="h-3 w-3" aria-hidden="true" />
                            Connected
                          </>
                        ) : (
                          <>
                            <Globe className="h-3 w-3" aria-hidden="true" />
                            Connect
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </dialog>
  );
}
