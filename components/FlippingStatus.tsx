"use client";

import { useState } from "react";
import { useMediaQuery } from "@/lib/client/use-media-query";

export function FlippingStatus({ message }: { message: string }) {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [status, setStatus] = useState({
    current: message,
    next: null as string | null,
    id: 0,
  });

  if (reduceMotion && (status.current !== message || status.next !== null)) {
    setStatus({ current: message, next: null, id: status.id });
  } else if (!reduceMotion && status.next === null && message !== status.current) {
    // Finish each quarter turn before picking up the latest server message.
    setStatus({ ...status, next: message, id: status.id + 1 });
  }

  return (
    <div className="flipping-status text-sm">
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {message}
      </span>
      <div
        key={status.id}
        className={`flipping-status-column${status.next !== null ? " flipping-status-turning" : ""}`}
        aria-hidden="true"
        onAnimationEnd={(event) => {
          if (event.target !== event.currentTarget) return;
          setStatus((previous) =>
            previous.next === null ? previous : { ...previous, current: previous.next, next: null },
          );
        }}
      >
        <span className="flipping-status-face flipping-status-front bg-kumo-base">
          {status.current}
        </span>
        {status.next !== null && (
          <span className="flipping-status-face flipping-status-top bg-kumo-base">
            {status.next}
          </span>
        )}
      </div>
    </div>
  );
}
