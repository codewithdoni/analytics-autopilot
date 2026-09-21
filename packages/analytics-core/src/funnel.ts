/**
 * Sequential funnel math over raw events.
 *
 * An entity (device or profile) reaches step i when it has a step-i event at or
 * after the moment it reached step i-1. Step 0 is reached at the entity's first
 * step-0 event in the range. This is the "closed funnel, any time within range"
 * definition — the one product people usually mean by "how many who saw the
 * paywall went on to buy".
 */
export type FunnelEvent = { id: string; ts: number };

export type FunnelStepResult = {
  event: string;
  reached: number;
  /** Conversion from the previous step, 0..1 (1 for the first step). */
  from_prev: number;
  /** Conversion from the first step, 0..1. */
  from_first: number;
  /** Entities lost between the previous step and this one. */
  dropped: number;
};

function firstAtOrAfter(sorted: number[], t: number): number | undefined {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] as number) < t) lo = mid + 1;
    else hi = mid;
  }
  return sorted[lo];
}

function indexByEntity(events: FunnelEvent[]): Map<string, number[]> {
  const byId = new Map<string, number[]>();
  for (const e of events) {
    if (!e.id) continue;
    const list = byId.get(e.id);
    if (list) list.push(e.ts);
    else byId.set(e.id, [e.ts]);
  }
  for (const list of byId.values()) list.sort((a, b) => a - b);
  return byId;
}

export function computeSequentialFunnel(steps: string[], eventsByStep: FunnelEvent[][]): FunnelStepResult[] {
  if (steps.length !== eventsByStep.length) throw new Error('steps and eventsByStep must have the same length');
  const indexes = eventsByStep.map(indexByEntity);
  const reached = new Array<number>(steps.length).fill(0);

  const first = indexes[0];
  if (first) {
    for (const [id, times] of first) {
      let t = times[0] as number;
      reached[0] = (reached[0] as number) + 1;
      for (let i = 1; i < steps.length; i++) {
        const stepTimes = indexes[i]?.get(id);
        const hit = stepTimes ? firstAtOrAfter(stepTimes, t) : undefined;
        if (hit === undefined) break;
        t = hit;
        reached[i] = (reached[i] as number) + 1;
      }
    }
  }

  const top = reached[0] ?? 0;
  return steps.map((event, i) => {
    const n = reached[i] ?? 0;
    const prev = i === 0 ? n : (reached[i - 1] ?? 0);
    return {
      event,
      reached: n,
      from_prev: i === 0 ? 1 : prev === 0 ? 0 : round4(n / prev),
      from_first: top === 0 ? 0 : round4(n / top),
      dropped: i === 0 ? 0 : prev - n,
    };
  });
}

/** Non-sequential funnel from independent per-event unique counts (fast path). */
export function funnelFromCounts(steps: string[], counts: Map<string, number>): FunnelStepResult[] {
  const values = steps.map((s) => counts.get(s) ?? 0);
  const top = values[0] ?? 0;
  return steps.map((event, i) => {
    const n = values[i] ?? 0;
    const prev = i === 0 ? n : (values[i - 1] ?? 0);
    return {
      event,
      reached: n,
      from_prev: i === 0 ? 1 : prev === 0 ? 0 : round4(n / prev),
      from_first: top === 0 ? 0 : round4(n / top),
      dropped: i === 0 ? 0 : Math.max(prev - n, 0),
    };
  });
}

function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}
