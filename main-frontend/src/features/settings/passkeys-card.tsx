"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { FormField, PasswordInput } from "@/components/shared/form";
import { ContentCard } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createPasskey, PasskeyCancelled, usePasskeysSupported } from "@/features/auth/passkey";
import { errorMessage } from "@/lib/api/client";
import { passkeysApi } from "@/lib/api/endpoints";
import type { Passkey } from "@/lib/api/types";
import { formatDate, formatDateTime } from "@/lib/format";

const KEY = ["passkeys"];
type Edit = { mode: "rename" | "remove"; passkey: Passkey } | null;

export function PasskeysCard() {
  const qc = useQueryClient();
  const supported = usePasskeysSupported();
  const [edit, setEdit] = useState<Edit>(null);
  const [value, setValue] = useState("");
  const list = useQuery({ queryKey: KEY, queryFn: passkeysApi.list });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: ["mfa"] });
  };

  const add = useMutation({
    mutationFn: () => createPasskey(),
    onSuccess: () => {
      toast.success("Passkey added");
      refresh();
    },
    onError: (e) => !(e instanceof PasskeyCancelled) && toast.error(errorMessage(e)),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (edit!.mode === "rename") await passkeysApi.rename(edit!.passkey.id, value.trim());
      else await passkeysApi.remove(edit!.passkey.id, value);
    },
    onSuccess: () => {
      toast.success(edit!.mode === "rename" ? "Passkey renamed" : "Passkey removed");
      setEdit(null);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const open = (mode: "rename" | "remove", passkey: Passkey) => {
    setValue(mode === "rename" ? (passkey.deviceName ?? "") : "");
    setEdit({ mode, passkey });
  };
  const label = (p: Passkey) => p.deviceName ?? (p.deviceType === "multiDevice" ? "Synced passkey" : "Device passkey");

  return (
    <ContentCard
      title="Passkeys"
      description="Sign in with your device's screen lock or a security key instead of a password."
      bodyClassName="p-0"
    >
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <p className="text-[13px] text-muted-foreground">
          {supported ? "Your password keeps working as a fallback." : "This browser doesn't support passkeys."}
        </p>
        <Button variant="outline" size="sm" disabled={!supported || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add passkey
        </Button>
      </div>
      {list.isLoading ? (
        <p className="border-t border-border-subtle px-5 py-4 text-[13px] text-muted-foreground">Loading…</p>
      ) : list.isError ? (
        <p className="border-t border-border-subtle px-5 py-4 text-[13px] text-destructive">{errorMessage(list.error)}</p>
      ) : (
        <ul className="divide-y divide-border-subtle border-t border-border-subtle">
          {list.data?.length === 0 && <li className="px-5 py-4 text-[13px] text-muted-foreground">No passkeys yet.</li>}
          {list.data?.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-5 py-3">
              <KeyRound className="size-4 shrink-0 text-brand-accent" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{label(p)}</p>
                <p className="truncate text-xs text-text-muted">
                  Added {formatDate(p.createdAt)} · Last used {formatDateTime(p.lastUsedAt)}
                </p>
              </div>
              <Button variant="ghost" size="icon" aria-label={`Rename ${label(p)}`} onClick={() => open("rename", p)}>
                <Pencil />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Remove ${label(p)}`} onClick={() => open("remove", p)}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim()) save.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>{edit?.mode === "rename" ? "Rename passkey" : "Remove passkey?"}</DialogTitle>
              <DialogDescription>
                {edit?.mode === "rename"
                  ? "Give it a name you'll recognise, like the device it's on."
                  : "Confirm your password. You can still sign in with your password afterwards."}
              </DialogDescription>
            </DialogHeader>
            {edit?.mode === "rename" ? (
              <FormField label="Name">
                {(p) => <Input {...p} maxLength={100} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />}
              </FormField>
            ) : (
              <FormField label="Current password">
                {(p) => (
                  <PasswordInput {...p} autoComplete="current-password" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
                )}
              </FormField>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEdit(null)}>
                Cancel
              </Button>
              <Button type="submit" variant={edit?.mode === "remove" ? "destructive" : "default"} disabled={!value.trim() || save.isPending}>
                {save.isPending && <Loader2 className="animate-spin" />}
                {edit?.mode === "rename" ? "Save" : "Remove"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </ContentCard>
  );
}
