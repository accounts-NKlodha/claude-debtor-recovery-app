"use client";

import { ErrorState } from "@/components/states";

export default function InternalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="py-8">
      <ErrorState reset={reset} />
    </div>
  );
}
