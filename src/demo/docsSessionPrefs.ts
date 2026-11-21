export type DocsDockSide = "left" | "right";

export interface DocsSessionPrefs {
  side: DocsDockSide;
  yRatio: number;
  drawerWidth: number;
}

export const DOCS_PREFS_COOKIE = "reprobridge_docs_prefs";
export const DEFAULT_DRAWER_WIDTH = 1080;
export const MIN_DRAWER_WIDTH = 480;
export const MAX_DRAWER_WIDTH = 1440;

const DEFAULT_PREFS: DocsSessionPrefs = {
  side: "right",
  yRatio: 0.5,
  drawerWidth: DEFAULT_DRAWER_WIDTH,
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getMaxDrawerWidth(viewportWidth?: number): number {
  const vw =
    viewportWidth ?? (typeof window !== "undefined" ? window.innerWidth : MAX_DRAWER_WIDTH);
  return Math.max(MIN_DRAWER_WIDTH, Math.min(MAX_DRAWER_WIDTH, Math.floor(vw * 0.96)));
}

export function clampDrawerWidth(width: number, viewportWidth?: number): number {
  return Math.round(clampNumber(width, MIN_DRAWER_WIDTH, getMaxDrawerWidth(viewportWidth)));
}

export function readDocsSessionPrefs(): DocsSessionPrefs {
  if (typeof document === "undefined") {
    return { ...DEFAULT_PREFS };
  }

  try {
    const cookiePrefix = `${DOCS_PREFS_COOKIE}=`;
    const entries = document.cookie ? document.cookie.split(";") : [];
    let rawValue: string | null = null;
    for (const entry of entries) {
      const trimmed = entry.trim();
      if (trimmed.startsWith(cookiePrefix)) {
        rawValue = trimmed.slice(cookiePrefix.length);
        break;
      }
    }
    if (!rawValue) {
      return { ...DEFAULT_PREFS };
    }

    const parsed = JSON.parse(decodeURIComponent(rawValue)) as Partial<DocsSessionPrefs>;
    const side: DocsDockSide = parsed.side === "left" ? "left" : "right";
    const yRatio =
      typeof parsed.yRatio === "number" && Number.isFinite(parsed.yRatio)
        ? clampNumber(parsed.yRatio, 0, 1)
        : DEFAULT_PREFS.yRatio;
    const drawerWidth =
      typeof parsed.drawerWidth === "number" && Number.isFinite(parsed.drawerWidth)
        ? Math.round(clampNumber(parsed.drawerWidth, MIN_DRAWER_WIDTH, MAX_DRAWER_WIDTH))
        : DEFAULT_PREFS.drawerWidth;

    return { side, yRatio, drawerWidth };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writeDocsSessionPrefs(patch: Partial<DocsSessionPrefs>): DocsSessionPrefs {
  const current = readDocsSessionPrefs();
  const next: DocsSessionPrefs = {
    side: patch.side === "left" ? "left" : patch.side === "right" ? "right" : current.side,
    yRatio:
      typeof patch.yRatio === "number" && Number.isFinite(patch.yRatio)
        ? clampNumber(patch.yRatio, 0, 1)
        : current.yRatio,
    drawerWidth:
      typeof patch.drawerWidth === "number" && Number.isFinite(patch.drawerWidth)
        ? Math.round(clampNumber(patch.drawerWidth, MIN_DRAWER_WIDTH, MAX_DRAWER_WIDTH))
        : current.drawerWidth,
  };

  if (typeof document !== "undefined") {
    try {
      // Session cookie (no Expires / Max-Age): persists until the browser session ends
      document.cookie = `${DOCS_PREFS_COOKIE}=${encodeURIComponent(JSON.stringify(next))}; path=/; SameSite=Lax`;
    } catch {
      // Ignore cookie write failures in restricted environments
    }
  }

  return next;
}

export function clearDocsSessionPrefs(): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${DOCS_PREFS_COOKIE}=; max-age=0; path=/; SameSite=Lax`;
  } catch {
    // Ignore cookie clear failures
  }
}
