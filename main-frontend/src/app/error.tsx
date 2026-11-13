"use client";

import { ErrorState } from "@/components/shared/states";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="grid min-h-[60dvh] place-items-center p-4">
      <div className="w-full max-w-md rounded-xl border bg-card">
        <ErrorState message={error.message || "An unexpected error occurred."} onRetry={reset} />
      </div>
    </div>
  );
}
