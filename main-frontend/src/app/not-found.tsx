import Link from "next/link";
import { BrandMark } from "@/components/layout/brand";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-8 text-center">
        <BrandMark className="mx-auto" />
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="text-sm text-muted-foreground">The page you&apos;re looking for doesn&apos;t exist.</p>
        <Link href="/" className={buttonVariants()}>
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
