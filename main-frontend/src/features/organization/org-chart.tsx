"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, Maximize2, Minus, Network, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { StatusBadge } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SearchInput } from "@/components/shared/data-table";
import { FormField } from "@/components/shared/form";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { SelectField } from "@/components/shared/select-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { FormAlert } from "@/features/auth/auth-card";
import { useSession } from "@/hooks/use-session";
import { applyFieldErrors, errorMessage } from "@/lib/api/client";
import { organizationApi } from "@/lib/api/endpoints";
import type { OrgUnit } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const ZOOM = { min: 0.4, max: 1.6, step: 0.15 };

/** children index + ancestor lookup, built once per data change. */
function indexTree(units: OrgUnit[]) {
  const children = new Map<string | null, OrgUnit[]>();
  const byId = new Map(units.map((u) => [u.id, u]));
  for (const u of units) {
    // An orphan (parent outside the list) is shown as a root rather than hidden.
    const key = u.parentId && byId.has(u.parentId) ? u.parentId : null;
    children.set(key, [...(children.get(key) ?? []), u]);
  }
  const ancestors = (id: string) => {
    const out: string[] = [];
    for (let p = byId.get(id)?.parentId; p && byId.has(p); p = byId.get(p)!.parentId) out.push(p);
    return out;
  };
  const descendants = (id: string): string[] =>
    (children.get(id) ?? []).flatMap((c) => [c.id, ...descendants(c.id)]);
  return { children, byId, ancestors, descendants };
}

type Tree = ReturnType<typeof indexTree>;

function Node({
  unit,
  tree,
  collapsed,
  toggle,
  matches,
  selected,
  onSelect,
}: {
  unit: OrgUnit;
  tree: Tree;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  matches: Set<string>;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const kids = tree.children.get(unit.id) ?? [];
  const open = !collapsed.has(unit.id);
  return (
    <li>
      <div
        className={cn(
          "relative w-52 rounded-lg border bg-card px-3 py-2.5 text-left shadow-xs transition-colors",
          matches.has(unit.id) && "border-brand-accent ring-2 ring-brand-accent/30",
          selected === unit.id && "border-foreground/40 bg-subtle",
        )}
      >
        <button
          type="button"
          onClick={() => onSelect(unit.id)}
          className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="block text-[11px] font-medium tracking-wide text-text-muted uppercase">{unit.level.name}</span>
          <span className="mt-0.5 block truncate text-[13px] font-semibold">{unit.name}</span>
          {unit.department && <span className="block truncate text-xs text-muted-foreground">{unit.department.name}</span>}
        </button>
        {kids.length > 0 && (
          <button
            type="button"
            onClick={() => toggle(unit.id)}
            aria-label={open ? `Collapse ${unit.name}` : `Expand ${unit.name}`}
            aria-expanded={open}
            className="absolute -bottom-3 left-1/2 z-10 flex h-6 -translate-x-1/2 items-center gap-0.5 rounded-full border bg-card px-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            {kids.length}
          </button>
        )}
      </div>
      {open && kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <Node key={k.id} unit={k} tree={tree} collapsed={collapsed} toggle={toggle} matches={matches} selected={selected} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

const unitSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(150),
  code: z.string().trim().max(30).regex(/^[A-Za-z0-9._-]*$/, "Letters, numbers, dot, dash or underscore"),
  levelId: z.string().min(1, "Choose a level"),
  parentId: z.string().nullable(),
  departmentId: z.string().nullable(),
  description: z.string().trim().max(500),
  sortOrder: z.coerce.number().int().min(0).max(10000),
});

function UnitDialog({
  state,
  onClose,
  tree,
}: {
  state: { mode: "create"; parentId: string | null } | { mode: "edit"; unit: OrgUnit } | null;
  onClose: () => void;
  tree: Tree;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const levels = useQuery({ queryKey: ["levels", "all"], queryFn: () => organizationApi.levels.list({ limit: 100, sort: "rank", order: "asc" }), enabled: Boolean(state) });
  const depts = useQuery({
    queryKey: ["departments", "all"],
    queryFn: () => organizationApi.departments.list({ limit: 100, sort: "name", order: "asc", isActive: true }),
    enabled: Boolean(state),
  });
  const editing = state?.mode === "edit" ? state.unit : null;
  // A unit can't move under itself or its own sub-units.
  const blocked = new Set(editing ? [editing.id, ...tree.descendants(editing.id)] : []);
  const parents = [...tree.byId.values()].filter((u) => !blocked.has(u.id)).map((u) => ({ value: u.id, label: `${u.name} · ${u.level.name}` }));

  const form = useForm({
    resolver: zodResolver(unitSchema),
    values: {
      name: editing?.name ?? "",
      code: editing?.code ?? "",
      levelId: editing?.level.id ?? "",
      parentId: editing ? editing.parentId : state?.mode === "create" ? state.parentId : null,
      departmentId: editing?.department?.id ?? null,
      description: editing?.description ?? "",
      sortOrder: editing?.sortOrder ?? 0,
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const body = { ...v, code: v.code || null, description: v.description || null };
    try {
      if (editing) await organizationApi.units.update(editing.id, body);
      else await organizationApi.units.create(body);
      toast.success(editing ? "Unit updated" : "Unit created");
      qc.invalidateQueries({ queryKey: ["units"] });
      onClose();
    } catch (e) {
      if (!applyFieldErrors(e, form.setError)) setError(errorMessage(e));
    }
  });

  return (
    <Dialog open={Boolean(state)} onOpenChange={(o) => !o && (setError(null), onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit unit" : "New unit"}</DialogTitle>
          <DialogDescription>Units form the chart. Employees are assigned to departments on their own record, not to chart nodes.</DialogDescription>
        </DialogHeader>
        <form id="unit-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
          {error && (
            <div className="sm:col-span-2">
              <FormAlert>{error}</FormAlert>
            </div>
          )}
          <FormField label="Name" error={errors.name?.message}>
            {(p) => <Input {...p} {...form.register("name")} />}
          </FormField>
          <FormField label="Code (optional)" error={errors.code?.message}>
            {(p) => <Input {...p} className="font-mono uppercase" {...form.register("code")} />}
          </FormField>
          <FormField label="Level" error={errors.levelId?.message} hint={levels.data?.items.length === 0 ? "Create organization levels first." : undefined}>
            {(p) => (
              <Controller
                control={form.control}
                name="levelId"
                render={({ field }) => (
                  <SelectField {...p} value={field.value || null} onChange={(v) => field.onChange(v ?? "")} options={(levels.data?.items ?? []).map((l) => ({ value: l.id, label: `${l.rank}. ${l.name}` }))} />
                )}
              />
            )}
          </FormField>
          <FormField label="Parent unit" error={errors.parentId?.message}>
            {(p) => (
              <Controller control={form.control} name="parentId" render={({ field }) => <SelectField {...p} value={field.value} onChange={field.onChange} options={parents} noneLabel="None (top level)" />} />
            )}
          </FormField>
          <FormField label="Linked department (optional)" error={errors.departmentId?.message}>
            {(p) => (
              <Controller
                control={form.control}
                name="departmentId"
                render={({ field }) => (
                  <SelectField {...p} value={field.value} onChange={field.onChange} noneLabel="None" options={(depts.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))} />
                )}
              />
            )}
          </FormField>
          <FormField label="Sort order" error={errors.sortOrder?.message} hint="Lower numbers appear first among siblings">
            {(p) => <Input {...p} type="number" min={0} {...form.register("sortOrder")} />}
          </FormField>
          <FormField label="Description (optional)" error={errors.description?.message} className="sm:col-span-2">
            {(p) => <Textarea {...p} rows={2} {...form.register("description")} />}
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="unit-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" />}
            {editing ? "Save changes" : "Create unit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OrgChartPage() {
  const { can } = useSession();
  const canManage = can("organization:manage");
  const qc = useQueryClient();
  const units = useQuery({ queryKey: ["units"], queryFn: organizationApi.units.list });
  const tree = useMemo(() => indexTree(units.data ?? []), [units.data]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Parameters<typeof UnitDialog>[0]["state"]>(null);
  const [removing, setRemoving] = useState<OrgUnit | null>(null);

  const term = search.trim().toLowerCase();
  const matches = useMemo(
    () =>
      new Set(
        term
          ? (units.data ?? [])
              .filter((u) => [u.name, u.code, u.department?.name].some((s) => s?.toLowerCase().includes(term)))
              .map((u) => u.id)
          : [],
      ),
    [term, units.data],
  );

  // Searching expands the path to every match.
  const effectiveCollapsed = useMemo(() => {
    if (!matches.size) return collapsed;
    const open = new Set([...matches].flatMap((id) => tree.ancestors(id)));
    return new Set([...collapsed].filter((id) => !open.has(id)));
  }, [collapsed, matches, tree]);

  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const remove = useMutation({
    mutationFn: (u: OrgUnit) => organizationApi.units.remove(u.id),
    onSuccess: () => {
      toast.success("Unit deleted");
      setRemoving(null);
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["units"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const sel = selected ? tree.byId.get(selected) : undefined;
  const roots = tree.children.get(null) ?? [];
  const zoomBy = (d: number) => setZoom((v) => Math.min(ZOOM.max, Math.max(ZOOM.min, +(v + d).toFixed(2))));

  return (
    <PageContainer className="max-w-none">
      <PageHeader
        title="Organization Chart"
        description="Structural hierarchy of the organization. Click a unit for details."
        actions={
          canManage && (
            <Button onClick={() => setDialog({ mode: "create", parentId: null })}>
              <Plus /> New unit
            </Button>
          )
        }
      />
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-col gap-2 border-b border-border-subtle p-3 sm:flex-row sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Find a unit or department" />
          {term && (
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {matches.size} match{matches.size === 1 ? "" : "es"}
            </span>
          )}
          <div className="flex items-center gap-1.5 sm:ml-auto">
            <Button variant="outline" size="sm" onClick={() => setCollapsed(new Set())}>
              Expand all
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCollapsed(new Set([...tree.children.keys()].filter((k): k is string => k !== null)))}>
              Collapse all
            </Button>
            <div className="ml-1 flex items-center rounded-lg border">
              <Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => zoomBy(-ZOOM.step)} disabled={zoom <= ZOOM.min}>
                <Minus />
              </Button>
              <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
              <Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => zoomBy(ZOOM.step)} disabled={zoom >= ZOOM.max}>
                <Plus />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Reset zoom" onClick={() => setZoom(1)}>
                <Maximize2 />
              </Button>
            </div>
          </div>
        </div>

        {units.isPending ? (
          <LoadingState className="p-5" />
        ) : units.error ? (
          <ErrorState message={units.error.message} onRetry={() => units.refetch()} />
        ) : roots.length === 0 ? (
          <EmptyState
            icon={Network}
            title="No chart yet"
            description={canManage ? "Define organization levels, then add your top-level unit." : "No organization units have been defined."}
            action={
              canManage && (
                <Link href="/organization/levels" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Manage levels
                </Link>
              )
            }
          />
        ) : (
          <div className="min-h-[28rem] overflow-auto bg-subtle/30 p-8">
            <div className="org-tree w-max origin-top-left transition-transform" style={{ transform: `scale(${zoom})` }}>
              <ul>
                {roots.map((r) => (
                  <Node key={r.id} unit={r} tree={tree} collapsed={effectiveCollapsed} toggle={toggle} matches={matches} selected={selected} onSelect={setSelected} />
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <Sheet open={Boolean(sel)} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent>
          {sel && (
            <>
              <SheetHeader>
                <SheetTitle>{sel.name}</SheetTitle>
                <SheetDescription>
                  <StatusBadge dot={false}>{sel.level.name}</StatusBadge>
                </SheetDescription>
              </SheetHeader>
              <dl className="grid gap-2 px-6 text-[13px]">
                {[
                  ["Code", sel.code ?? "—"],
                  ["Parent", sel.parentId ? tree.byId.get(sel.parentId)?.name ?? "—" : "Top level"],
                  ["Linked department", sel.department?.name ?? "—"],
                  ["Sub-units", String(tree.children.get(sel.id)?.length ?? 0)],
                  ["Description", sel.description ?? "—"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg border bg-subtle/40 px-3 py-2.5">
                    <dt className="text-[11px] font-medium tracking-wide text-text-muted uppercase">{k}</dt>
                    <dd className="mt-0.5 font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap gap-2 px-6">
                {sel.department && can("employees:read") && (
                  <Link href={`/employees?departmentId=${sel.department.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    View department employees
                  </Link>
                )}
                {canManage && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setDialog({ mode: "create", parentId: sel.id })}>
                      <Plus /> Add sub-unit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDialog({ mode: "edit", unit: sel })}>
                      <Pencil /> Edit
                    </Button>
                    <Button size="sm" variant="outline" className="text-danger" onClick={() => setRemoving(sel)}>
                      <Trash2 /> Delete
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <UnitDialog state={dialog} onClose={() => setDialog(null)} tree={tree} />
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Delete ${removing?.name}?`}
        description="Units that still have sub-units can’t be deleted. Move or delete those first."
        confirmLabel="Delete unit"
        destructive
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </PageContainer>
  );
}
