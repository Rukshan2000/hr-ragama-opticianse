"use client";

import { Fingerprint, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api/client";
import { mfaApi } from "@/lib/api/endpoints";
import type { MfaMethod, MfaTicket, SessionResult } from "@/lib/api/types";
import { AuthCard, FormAlert } from "./auth-card";
import { PasskeyCancelled, verifyMfaWithPasskey } from "./passkey";

const LABEL: Record<MfaMethod, string> = {
  totp: "Authenticator app",
  email: "Email code",
  passkey: "Passkey",
  recovery: "Recovery code",
};
const HINT: Partial<Record<MfaMethod, string>> = {
  totp: "Enter the 6-digit code from your authenticator app.",
  email: "We'll email you a 6-digit code.",
  recovery: "Enter one of the recovery codes you saved. Each works once.",
};

export function MfaStep({
  ticket,
  onSuccess,
  onCancel,
}: {
  ticket: MfaTicket;
  onSuccess: (s: SessionResult) => void;
  onCancel: () => void;
}) {
  const [method, setMethod] = useState<MfaMethod>(ticket.methods[0]!);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setPending(true);
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof PasskeyCancelled)) setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  const sendEmail = () =>
    run(async () => {
      await mfaApi.sendEmail(ticket.mfaToken);
      setEmailSent(true);
      toast.success("Code sent. Check your inbox.");
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const { data } =
        method === "passkey"
          ? await verifyMfaWithPasskey(ticket.mfaToken)
          : await mfaApi.verify({ mfaToken: ticket.mfaToken, method, code });
      onSuccess(data);
    });
  };

  return (
    <AuthCard
      title="2-step verification"
      description="Confirm it's you to finish signing in."
      footer={
        <button type="button" onClick={onCancel} className="font-medium text-foreground underline-offset-4 hover:underline">
          Back to sign in
        </button>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <FormAlert>{error}</FormAlert>}
        {ticket.methods.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Verification method">
            {ticket.methods.map((m) => (
              <Button
                key={m}
                type="button"
                role="tab"
                aria-selected={m === method}
                size="sm"
                variant={m === method ? "default" : "outline"}
                onClick={() => {
                  setMethod(m);
                  setCode("");
                  setError(null);
                }}
              >
                {LABEL[m]}
              </Button>
            ))}
          </div>
        )}

        {method === "passkey" ? (
          <p className="text-[13px] text-muted-foreground">Use your device&apos;s screen lock or security key.</p>
        ) : (
          <>
            <p className="text-[13px] text-muted-foreground">{HINT[method]}</p>
            {method === "email" && (
              <Button type="button" variant="outline" className="w-full" disabled={pending} onClick={sendEmail}>
                {emailSent ? "Resend code" : "Send code"}
              </Button>
            )}
            <FormField label={LABEL[method]}>
              {(p) => (
                <Input
                  {...p}
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode={method === "recovery" ? "text" : "numeric"}
                  autoComplete="one-time-code"
                  maxLength={method === "recovery" ? 32 : 6}
                  placeholder={method === "recovery" ? "XXXXX-XXXXX" : "123456"}
                />
              )}
            </FormField>
          </>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={pending || (method !== "passkey" && !code.trim())}>
          {pending ? <Loader2 className="animate-spin" /> : method === "passkey" && <Fingerprint />}
          {method === "passkey" ? "Use passkey" : "Verify"}
        </Button>
      </form>
    </AuthCard>
  );
}
