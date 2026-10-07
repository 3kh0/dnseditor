import { useMemo } from "react";

interface Seg {
  h: boolean;
  t: string;
}

export function HighlightedText({ text, query }: { text: string; query?: string }) {
  const segments = useMemo<Seg[]>(() => {
    const q = query?.trim();
    if (!q) return [{ h: false, t: text }];

    const out: Seg[] = [];
    const hay = text.toLocaleLowerCase();
    const needle = q.toLocaleLowerCase();
    let cur = 0;
    let m = hay.indexOf(needle);

    while (m !== -1) {
      if (m > cur) out.push({ h: false, t: text.slice(cur, m) });
      const end = m + q.length;
      out.push({ h: true, t: text.slice(m, end) });
      cur = end;
      m = hay.indexOf(needle, cur);
    }

    if (cur < text.length) out.push({ h: false, t: text.slice(cur) });
    return out.length ? out : [{ h: false, t: text }];
  }, [text, query]);

  return segments.map((s, i) =>
    s.h ? (
      <mark key={i} className="rounded-sm bg-kumo-info-tint text-kumo-link">
        {s.t}
      </mark>
    ) : (
      <span key={i}>{s.t}</span>
    ),
  );
}
