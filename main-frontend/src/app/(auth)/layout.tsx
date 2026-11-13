import { Brand } from "@/components/layout/brand";
import { APP_NAME } from "@/config/navigation";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden rounded-2xl bg-brand p-10 text-white lg:flex dark:border dark:bg-card lg:flex-col lg:justify-between">
        <div className="[&_span.text-\[15px\]]:text-white">
          <div className="inline-flex rounded-xl bg-white/10 p-1.5 pr-3">
            <Brand />
          </div>
        </div>
        {/* Box motif: the product's shape language, drawn with the brand palette. */}
        <div aria-hidden className="grid max-w-md grid-cols-4 gap-3 opacity-90">
          {Array.from({ length: 12 }, (_, i) => (
            <span
              key={i}
              className={
                i === 5
                  ? "aspect-square rounded-xl bg-brand-secondary"
                  : i % 3 === 0
                    ? "aspect-square rounded-xl border border-white/20 bg-white/10"
                    : "aspect-square rounded-xl border border-white/10"
              }
            />
          ))}
        </div>
        <div className="max-w-md space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">Run your organization from one structured workspace.</h2>
          <p className="text-sm text-white/70">Users, roles and permissions for every team at {APP_NAME}, with access you control.</p>
        </div>
      </aside>
      <main className="grid place-items-center rounded-2xl px-1 py-8 sm:px-6">
        <div className="w-full max-w-[420px]">
          <div className="mb-8 lg:hidden">
            <Brand />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
