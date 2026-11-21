import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";

type DockSide = "left" | "right";

interface DockState {
  side: DockSide;
  yRatio: number;
}

interface FloatingDocsTabProps {
  count: number;
  onOpen: () => void;
}

const STORAGE_KEY = "reprobridge:floating-docs-tab-v1";
const TOP_SAFE_MARGIN = 64;
const BOTTOM_SAFE_MARGIN = 16;
const DRAG_THRESHOLD_PX = 5;
const DEFAULT_WIDTH = 44;
const DEFAULT_HEIGHT = 176;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function loadSavedDock(): DockState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { side: "right", yRatio: 0.5 };
    const parsed = JSON.parse(raw) as Partial<DockState>;
    const side: DockSide = parsed.side === "left" ? "left" : "right";
    const yRatio =
      typeof parsed.yRatio === "number" && Number.isFinite(parsed.yRatio)
        ? clamp(parsed.yRatio, 0, 1)
        : 0.5;
    return { side, yRatio };
  } catch {
    return { side: "right", yRatio: 0.5 };
  }
}

function saveDock(dock: DockState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dock));
  } catch {
    // Ignore storage quota or privacy-mode errors
  }
}

function computeDockedPosition(
  dock: DockState,
  width: number,
  height: number
): { left: number; top: number } {
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;

  const maxLeft = Math.max(0, viewportWidth - width);
  const left = dock.side === "left" ? 0 : maxLeft;

  const maxTop = Math.max(TOP_SAFE_MARGIN, viewportHeight - height - BOTTOM_SAFE_MARGIN);
  const rawTop =
    dock.yRatio === 0.5
      ? Math.round((viewportHeight - height) / 2)
      : Math.round(TOP_SAFE_MARGIN + dock.yRatio * (maxTop - TOP_SAFE_MARGIN));

  return {
    left,
    top: clamp(rawTop, TOP_SAFE_MARGIN, maxTop),
  };
}

export default function FloatingDocsTab({ count, onOpen }: FloatingDocsTabProps) {
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

  const [dock, setDock] = useState<DockState>(() => loadSavedDock());
  const [isDragging, setIsDragging] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>(() =>
    computeDockedPosition(loadSavedDock(), DEFAULT_WIDTH, DEFAULT_HEIGHT)
  );

  const measureDimensions = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    return {
      width: rect && rect.width > 0 ? rect.width : DEFAULT_WIDTH,
      height: rect && rect.height > 0 ? rect.height : DEFAULT_HEIGHT,
    };
  }, []);

  const syncDockedPosition = useCallback(
    (targetDock: DockState) => {
      const { width, height } = measureDimensions();
      setPos(computeDockedPosition(targetDock, width, height));
    },
    [measureDimensions]
  );

  useLayoutEffect(() => {
    if (!isDragging) {
      syncDockedPosition(dock);
    }
  }, [dock, isDragging, count, syncDockedPosition]);

  useEffect(() => {
    const onResize = () => {
      if (!dragRef.current) {
        syncDockedPosition(dock);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [dock, syncDockedPosition]);

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;

    const { width, height } = measureDimensions();
    const currentPos = computeDockedPosition(dock, width, height);
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

    const maxLeft = Math.max(0, window.innerWidth - session.width);
    const maxTop = Math.max(TOP_SAFE_MARGIN, window.innerHeight - session.height - BOTTOM_SAFE_MARGIN);
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
      // Ignore synthetic events where pointer capture was not held
    }

    if (session.didDrag) {
      suppressClickRef.current = true;
      const centerX = session.lastLeft + session.width / 2;
      const nextSide: DockSide = centerX < window.innerWidth / 2 ? "left" : "right";
      const maxTop = Math.max(TOP_SAFE_MARGIN, window.innerHeight - session.height - BOTTOM_SAFE_MARGIN);
      const span = maxTop - TOP_SAFE_MARGIN;
      const nextYRatio = span > 0 ? clamp((session.lastTop - TOP_SAFE_MARGIN) / span, 0, 1) : 0.5;
      const nextDock: DockState = { side: nextSide, yRatio: nextYRatio };

      saveDock(nextDock);
      setDock(nextDock);
      setPos(computeDockedPosition(nextDock, session.width, session.height));
      setIsDragging(false);
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
      const nextSide: DockSide = e.key === "ArrowLeft" ? "left" : "right";
      const nextDock: DockState = { side: nextSide, yRatio: dock.yRatio };
      saveDock(nextDock);
      setDock(nextDock);
      syncDockedPosition(nextDock);
    }
  }

  const baseClass =
    "fixed z-30 hidden touch-none select-none flex-col items-center gap-2 border px-2.5 py-3.5 text-xs font-semibold backdrop-blur-xs md:flex";

  const stateClass = isDragging
    ? "cursor-grabbing scale-[1.03] rounded-xl border-teal-400 bg-white text-teal-950 shadow-2xl transition-none"
    : dock.side === "left"
      ? "cursor-grab rounded-r-xl border-l-0 border-slate-300 bg-white/95 text-slate-800 shadow-lg transition-[left,top,transform,box-shadow,border-color,background-color] duration-200 ease-out hover:border-teal-400 hover:bg-teal-50 hover:text-teal-950 motion-reduce:transition-none"
      : "cursor-grab rounded-l-xl border-r-0 border-slate-300 bg-white/95 text-slate-800 shadow-lg transition-[left,top,transform,box-shadow,border-color,background-color] duration-200 ease-out hover:border-teal-400 hover:bg-teal-50 hover:text-teal-950 motion-reduce:transition-none";

  return (
    <button
      ref={buttonRef}
      type="button"
      data-dock-side={dock.side}
      data-dragging={isDragging ? "true" : "false"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
      aria-label={`Open Clinical Source Documents (${count} synthetic records). Drag to move to left or right edge.`}
      title="Click to open · Drag to move to left or right edge"
      className={`${baseClass} ${stateClass}`}
    >
      <FileText className="h-4 w-4 text-teal-700" aria-hidden="true" />
      <span className="[writing-mode:vertical-rl] rotate-180 tracking-wide">
        Clinical Docs
      </span>
      <span className="rounded-full bg-teal-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
        {count}
      </span>
    </button>
  );
}
