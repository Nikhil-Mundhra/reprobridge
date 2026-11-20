/**
 * Geometry-based 2D directional focus navigation for composite widgets.
 *
 * Follows modern-web-guidance `spatial-navigation`:
 * - Live `getBoundingClientRect()` candidate selection (edge-based direction filter)
 * - Prefers perpendicular-axis-overlapping candidates before weighted fallback
 * - Preserves native browser scrolling when no candidate exists in the pressed direction
 * - Ignores modifier keys and editable/arrow-consuming controls via `composedPath()[0]`
 */

export type ArrowDirection = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

const ARROW_KEYS = new Set<string>(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
const EDGE_TOLERANCE = 2;

export function findSpatialCandidate(
  container: HTMLElement,
  current: HTMLElement,
  direction: ArrowDirection,
  selector: string
): HTMLElement | null {
  const all = Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el !== current && (typeof el.checkVisibility === "function" ? el.checkVisibility() : el.offsetParent !== null)
  );
  if (all.length === 0) return null;

  const cur = current.getBoundingClientRect();
  const curCx = (cur.left + cur.right) / 2;
  const curCy = (cur.top + cur.bottom) / 2;

  const horizontal = direction === "ArrowLeft" || direction === "ArrowRight";

  type Scored = { el: HTMLElement; aligned: boolean; gap: number; perpOffset: number };
  const candidates: Scored[] = [];

  for (const el of all) {
    const r = el.getBoundingClientRect();
    let inDirection = false;
    let gap = 0;

    if (direction === "ArrowRight") {
      inDirection = r.left >= cur.right - EDGE_TOLERANCE;
      gap = Math.max(0, r.left - cur.right);
    } else if (direction === "ArrowLeft") {
      inDirection = r.right <= cur.left + EDGE_TOLERANCE;
      gap = Math.max(0, cur.left - r.right);
    } else if (direction === "ArrowDown") {
      inDirection = r.top >= cur.bottom - EDGE_TOLERANCE;
      gap = Math.max(0, r.top - cur.bottom);
    } else if (direction === "ArrowUp") {
      inDirection = r.bottom <= cur.top + EDGE_TOLERANCE;
      gap = Math.max(0, cur.top - r.bottom);
    }

    if (!inDirection) continue;

    const rCx = (r.left + r.right) / 2;
    const rCy = (r.top + r.bottom) / 2;
    const aligned = horizontal
      ? r.bottom > cur.top + EDGE_TOLERANCE && r.top < cur.bottom - EDGE_TOLERANCE
      : r.right > cur.left + EDGE_TOLERANCE && r.left < cur.right - EDGE_TOLERANCE;
    const perpOffset = horizontal ? Math.abs(rCy - curCy) : Math.abs(rCx - curCx);

    candidates.push({ el, aligned, gap, perpOffset });
  }

  if (candidates.length === 0) return null;

  const alignedOnes = candidates.filter((c) => c.aligned);
  if (alignedOnes.length > 0) {
    alignedOnes.sort((a, b) => a.gap - b.gap || a.perpOffset - b.perpOffset);
    return alignedOnes[0].el;
  }

  candidates.sort((a, b) => a.gap + 2.5 * a.perpOffset - (b.gap + 2.5 * b.perpOffset));
  return candidates[0].el;
}

export function handleSpatialKeyDown(
  event: React.KeyboardEvent<HTMLElement>,
  selector: string,
  onFocusMove?: (next: HTMLElement) => void
): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return false;
  }

  const native = event.nativeEvent;
  const innermost = (typeof native.composedPath === "function" ? native.composedPath()[0] : event.target) as
    | HTMLElement
    | null;
  if (
    !innermost ||
    !(innermost instanceof HTMLElement) ||
    innermost.matches(':read-write, select, input[type="range"], [role="slider"]')
  ) {
    return false;
  }

  if (!innermost.matches(selector)) return false;

  const container = event.currentTarget;
  const items = Array.from(container.querySelectorAll<HTMLElement>(selector)).filter((el) =>
    typeof el.checkVisibility === "function" ? el.checkVisibility() : el.offsetParent !== null
  );
  if (items.length === 0) return false;

  let next: HTMLElement | null = null;
  if (event.key === "Home") {
    next = items[0] ?? null;
  } else if (event.key === "End") {
    next = items[items.length - 1] ?? null;
  } else if (ARROW_KEYS.has(event.key)) {
    next = findSpatialCandidate(container, innermost, event.key as ArrowDirection, selector);
  } else {
    return false;
  }

  if (!next || next === innermost) {
    // Do NOT call preventDefault() so native browser scrolling works at boundaries.
    return false;
  }

  event.preventDefault();
  next.focus();
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
  onFocusMove?.(next);
  return true;
}
