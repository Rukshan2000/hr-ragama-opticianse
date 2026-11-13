"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Loader2, Mail, ShieldCheck, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/badges";
import { FormField, PasswordInput } from "@/components/shared/form";
import { ContentCard } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormAlert } from "@/features/auth/auth-card";
import { errorMessage } from "@/lib/api/client";
import { mfaApi } from "@/lib/api/endpoints";

type Factor = "totp" | "email" | "passkey";
type Action = { op: "enable" | "disable"; factor: Factor } | { op: "regenerate" };
type Step =
  | { kind: "password"; action: Action }
  | { kind: "totp"; secret: string; url: string }
  | { kind: "codes"; codes: string[] }
  | null;

const KEY = ["mfa"];
const FACTORS: { id: Factor; title: string; text: string; icon: typeof Smartphone }[] = [
  { id: "totp", title: "Authenticator app", text: "Codes from Google Authenticator, 1Password, Authy…", icon: Smartphone },
  { id: "email", title: "Email codes", text: "A one-time code sent to your email address.", icon: Mail },
  { id: "passkey", title: "Passkey", text: "Confirm with a passkey after entering your password.", icon: KeyRound },
];

export function MfaCard() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: KEY, queryFn: mfaApi.status });
  const [step, setStep] = useState<Step>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const go = (next: Step) => {
    setValue("");
    setError(null);
    setStep(next);
  };
  const finish = (codes?: string[], message = "Saved") => {
    qc.invalidateQueries({ queryKey: KEY });
    toast.success(message);
    go(codes?.length ? { kind: "codes", codes } : null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!step || step.kind === "codes" || !value.trim()) return;
    setPending(true);
    setError(null);
    try {
      if (step.kind === "totp") {
        const { data } = await mfaApi.totpEnable(value.trim());
        return finish(data.recoveryCodes, "Authenticator app enabled");
      }
      const a = step.action;
      if (a.op === "regenerate") {
        const { data } = await mfaApi.regenerate(value);
        return finish(data.recoveryCodes, "New recovery codes generated");
      }
      if (a.op === "disable") {
        await mfaApi.disable(a.factor, value);
        return finish(undefined, "Turned off");
      }
      if (a.factor === "totp") {
        const { data } = await mfaApi.totpSetup(value);
        return go({ kind: "totp", secret: data.secret, url: data.otpauthUrl });
      }
      const { data } = await mfaApi.enable(a.factor, value);
      finish(data.recoveryCodes, "Turned on");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const s = status.data;
  return (
    <ContentCard
      title="2-step verification"
      description="Ask for a second step after your password. Passkey sign-in already counts as strong and skips it."
      bodyClassName="p-0"
    >
      {status.isLoading ? (
        <p className="px-5 py-4 text-[13px] text-muted-foreground">Loading…</p>
      ) : status.isError || !s ? (
        <p className="px-5 py-4 text-[13px] text-destructive">{errorMessage(status.error)}</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {FACTORS.map(({ id, title, text, icon: Icon }) => {
            const on = s[id];
            const blocked = id === "passkey" && !on && s.passkeyCount === 0;
            return (
              <li key={id} className="flex items-center gap-3 px-5 py-3">
                <Icon className="size-4 shrink-0 text-brand-accent" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[13px] font-medium">
                    {title} {on && <StatusBadge tone="success">On</StatusBadge>}
                  </p>
                  <p className="truncate text-xs text-text-muted">{blocked ? "Add a passkey below first." : text}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={blocked}
                  onClick={() => go({ kind: "password", action: { op: on ? "disable" : "enable", factor: id } })}
                >
                  {on ? "Turn off" : "Turn on"}
                </Button>
              </li>
            );
          })}
          {s.enabled && (
            <li className="flex items-center gap-3 px-5 py-3">
              <ShieldCheck className="size-4 shrink-0 text-brand-accent" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">Recovery codes</p>
                <p className="text-xs text-text-muted">{s.recoveryCodesRemaining} of 10 unused. Use one if you lose your device.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => go({ kind: "password", action: { op: "regenerate" } })}>
                Regenerate
              </Button>
            </li>
          )}
        </ul>
      )}

      <Dialog open={!!step} onOpenChange={(o) => !o && step?.kind !== "codes" && go(null)}>
        <DialogContent showCloseButton={step?.kind !== "codes"}>
          {step?.kind === "codes" ? (
            <RecoveryCodes codes={step.codes} onDone={() => go(null)} />
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <DialogHeader>
                <DialogTitle>{step?.kind === "totp" ? "Scan with your authenticator app" : "Confirm your password"}</DialogTitle>
                <DialogDescription>
                  {step?.kind === "totp"
                    ? "Scan the QR code, or enter the key manually, then type the 6-digit code it shows."
                    : "For your security, re-enter your password to change 2-step verification."}
                </DialogDescription>
              </DialogHeader>
              {error && <FormAlert>{error}</FormAlert>}
              {step?.kind === "totp" ? (
                <>
                  <div className="flex justify-center rounded-lg bg-white p-3">
                    <QRCodeSVG value={step.url} size={168} aria-label="Authenticator setup QR code" />
                  </div>
                  <code className="block rounded-md bg-subtle px-3 py-2 text-center text-xs tracking-wider break-all">
                    {step.secret.match(/.{1,4}/g)?.join(" ")}
                  </code>
                  <FormField label="6-digit code">
                    {(p) => (
                      <Input
                        {...p}
                        autoFocus
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={value}
                        onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
                      />
                    )}
                  </FormField>
                </>
              ) : (
                <FormField label="Current password">
                  {(p) => (
                    <PasswordInput {...p} autoFocus autoComplete="current-password" value={value} onChange={(e) => setValue(e.target.value)} />
                  )}
                </FormField>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => go(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || !value.trim()}>
                  {pending && <Loader2 className="animate-spin" />}
                  {step?.kind === "totp" ? "Verify & turn on" : "Continue"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </ContentCard>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy. Select and copy the codes manually.");
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Save your recovery codes</DialogTitle>
        <DialogDescription>
          Each code signs you in once if you lose access to your second factor. They won&apos;t be shown again.
        </DialogDescription>
      </DialogHeader>
      <ul className="grid grid-cols-2 gap-2 rounded-lg border bg-subtle/40 p-3 font-mono text-[13px]">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <DialogFooter>
        <Button variant="outline" onClick={copy}>
          <Copy /> Copy
        </Button>
        <Button onClick={onDone}>I&apos;ve saved them</Button>
      </DialogFooter>
    </>
  );
}
