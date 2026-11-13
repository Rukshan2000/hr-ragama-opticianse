"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, BadgeCheck, ChevronRight, Gift, Plus, Star, Target, Trash2, UserCheck, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ActionDropdown } from "@/components/shared/action-dropdown";
import { DataTable, SearchInput } from "@/components/shared/data-table";
import { ContentCard, PageContainer, PageHeader } from "@/components/shared/page";
import { SelectField } from "@/components/shared/select-field";
import { EmptyState, LoadingState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/hooks/use-session";
import { api, errorMessage } from "@/lib/api/client";
import { formatDate, today } from "@/lib/format";
import { cn } from "@/lib/utils";
import { applicantsConfig, cyclesConfig, interviewsConfig, programsConfig, vacanciesConfig } from "./configs";
import { col, CrudDialog, CrudPage, FileLink, label, money, opts, Status, Tabs, useOptions, type Row } from "./kit";

const STAGES = ["applied", "screening", "interview", "offered", "hired", "rejected", "withdrawn"];
const FLOW: Record<string, string[]> = {
  applied: ["screening", "interview", "rejected", "withdrawn"],
  screening: ["interview", "offered", "rejected", "withdrawn"],
  interview: ["offered", "rejected", "withdrawn"],
  offered: ["interview", "rejected", "withdrawn"],
  rejected: ["screening"],
  hired: [],
  withdrawn: [],
};

/* ── Recruitment ── */

function Pipeline() {
  const { can } = useSession();
  const qc = useQueryClient();
  const vacancies = useOptions("vacancies", (r) => `${r.code} · ${r.title}`);
  const [vacancyId, setVacancyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ kind: "add" | "offer" | "hire"; row?: Row } | null>(null);
  const params = { vacancyId: vacancyId ?? undefined, search: search.trim() || undefined, limit: 500 };
  const q = useQuery({ queryKey: ["applications", params], queryFn: () => api.list<Row>("applications", params) });
  const stage = useMutation({
    mutationFn: ({ id, s }: { id: string; s: string }) => api.post(`applications/${id}/stage`, { stage: s }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["applications"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const manage = can("recruitment:manage");
  const items = q.data?.items ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-64"><SelectField value={vacancyId} onChange={setVacancyId} options={vacancies} noneLabel="All vacancies" /></div>
        <SearchInput value={search} onChange={setSearch} placeholder="Search candidate" />
        {manage && <Button className="ml-auto" onClick={() => setDialog({ kind: "add" })}><Plus /> Add application</Button>}
      </div>
      {q.isPending ? (
        <LoadingState />
      ) : (
        <div className="grid gap-3 overflow-x-auto pb-2 [grid-template-columns:repeat(5,minmax(220px,1fr))]">
          {["applied", "screening", "interview", "offered", "hired"].map((s) => {
            const col = items.filter((a) => a.stage === s);
            return (
              <section key={s} className="flex min-h-40 flex-col rounded-xl border bg-subtle/40">
                <header className="flex items-center justify-between px-3 py-2">
                  <span className="text-[13px] font-semibold">{label(s)}</span>
                  <span className="rounded-md bg-card px-1.5 text-xs tabular-nums text-muted-foreground">{col.length}</span>
                </header>
                <ul className="flex-1 space-y-2 p-2 pt-0">
                  {col.map((a) => (
                    <li key={a.id} className="rounded-lg border bg-card p-2.5 text-[13px] shadow-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{String(a.applicantName)}</p>
                          <p className="truncate text-xs text-muted-foreground">{String(a.vacancyTitle)}</p>
                        </div>
                        {manage && (
                          <ActionDropdown
                            items={[
                              ...FLOW[s]!.map((n) => ({ label: `Move to ${label(n)}`, icon: ChevronRight, onSelect: () => stage.mutate({ id: a.id, s: n }), destructive: n === "rejected" || n === "withdrawn" })),
                              { label: "Offer", icon: Gift, hidden: ["hired", "withdrawn"].includes(s), onSelect: () => setDialog({ kind: "offer", row: a }) },
                              { label: "Hire as employee", icon: UserCheck, hidden: s !== "offered" || a.offerStatus !== "accepted", onSelect: () => setDialog({ kind: "hire", row: a }) },
                            ]}
                          />
                        )}
                      </div>
                      {a.offerSalary ? <p className="mt-1 text-xs text-muted-foreground">Offer {money(a.offerSalary)} · {label(a.offerStatus as string)}</p> : null}
                      {a.cvFileId ? <div className="mt-1"><FileLink id={a.cvFileId as string} name="CV" /></div> : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {items.some((a) => ["rejected", "withdrawn"].includes(a.stage as string)) && (
        <p className="text-xs text-muted-foreground">{items.filter((a) => ["rejected", "withdrawn"].includes(a.stage as string)).length} rejected / withdrawn application(s) hidden from the board.</p>
      )}
      {dialog?.kind === "add" && (
        <CrudDialog
          title="Add application"
          fields={[
            { name: "vacancyId", label: "Vacancy", type: "ref", required: true, ref: { path: "vacancies", label: (r) => `${r.code} · ${r.title}`, query: { status: "open" } } },
            { name: "applicantId", label: "Applicant", type: "ref", required: true, ref: { path: "applicants", label: (r) => `${r.firstName} ${r.lastName} (${r.email})` } },
            { name: "rating", label: "Initial rating (1–5)", type: "number", min: 1, max: 5 },
            { name: "notes", label: "Notes", type: "textarea" },
          ]}
          row={null}
          open
          onOpenChange={(o) => !o && setDialog(null)}
          onSubmit={async (b) => {
            await api.post("applications", b);
            toast.success("Application added");
            qc.invalidateQueries({ queryKey: ["applications"] });
          }}
        />
      )}
      {dialog?.kind === "offer" && dialog.row && (
        <CrudDialog
          title={`Offer — ${dialog.row.applicantName}`}
          description="Record the offer and the candidate's response. Accepted offers can be converted into an employee."
          fields={[
            { name: "offerSalary", label: "Offered salary", type: "money", required: true, min: 0 },
            { name: "offerStartDate", label: "Start date", type: "date", required: true },
            { name: "offerStatus", label: "Status", type: "select", required: true, options: opts(["pending", "accepted", "declined"]), default: "pending" },
          ]}
          row={dialog.row.offerSalary ? dialog.row : null}
          open
          onOpenChange={(o) => !o && setDialog(null)}
          onSubmit={async (b) => {
            await api.post(`applications/${dialog.row!.id}/offer`, b);
            toast.success("Offer saved");
            qc.invalidateQueries({ queryKey: ["applications"] });
          }}
        />
      )}
      {dialog?.kind === "hire" && dialog.row && (
        <CrudDialog
          title={`Hire ${dialog.row.applicantName}`}
          description="Creates the employee from the applicant's details (no re-typing, no duplicates). The CV moves to the employee's documents."
          fields={[
            { name: "employeeNumber", label: "Employee number", type: "code", required: true },
            { name: "joiningDate", label: "Joining date", type: "date", default: dialog.row.offerStartDate as string },
            { name: "managerId", label: "Reporting manager", type: "employee", display: "managerName" },
          ]}
          row={null}
          open
          submitLabel="Create employee"
          onOpenChange={(o) => !o && setDialog(null)}
          onSubmit={async (b) => {
            await api.post(`applications/${dialog.row!.id}/hire`, b);
            toast.success("Employee created — start their onboarding from the profile");
            qc.invalidateQueries({ queryKey: ["applications"] });
            qc.invalidateQueries({ queryKey: ["employees"] });
          }}
        />
      )}
    </div>
  );
}

export function RecruitmentPage() {
  const [tab, setTab] = useState("pipeline");
  const pipeline = useQuery({ queryKey: ["applications", "pipeline"], queryFn: () => api.get<Record<string, number>>("recruitment/pipeline") });
  return (
    <PageContainer>
      <PageHeader title="Recruitment" description="Track candidates from application to hire: screening, interviews, evaluations and offers." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {STAGES.map((s) => (
          <div key={s} className="rounded-xl border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{label(s)}</p>
            <p className="text-xl font-semibold tabular-nums">{pipeline.data?.[s] ?? 0}</p>
          </div>
        ))}
      </div>
      <Tabs tabs={[{ value: "pipeline", label: "Pipeline" }, { value: "interviews", label: "Interviews" }]} value={tab} onChange={setTab} />
      {tab === "pipeline" ? <Pipeline /> : <CrudPage config={interviewsConfig} embedded />}
    </PageContainer>
  );
}

export const VacanciesPage = () => <CrudPage config={vacanciesConfig} />;
export const ApplicantsPage = () => <CrudPage config={applicantsConfig} />;

/* ── Performance ── */

type Review = Row & { goals: Row[]; access: { isHr: boolean; isSelf: boolean; isReviewer: boolean } };

function Rating({ value, onChange, disabled }: { value: number | null; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="flex gap-1" role="radiogroup">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} of 5`} disabled={disabled} onClick={() => onChange(n)} className="disabled:cursor-default">
          <Star className={cn("size-5", value !== null && n <= value ? "fill-warning text-warning" : "text-border-strong")} />
        </button>
      ))}
    </div>
  );
}

export function ReviewDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["reviews", id], queryFn: () => api.get<Review>(`performance-reviews/${id}`) });
  const [self, setSelf] = useState<{ rating: number | null; comments: string } | null>(null);
  const [mgr, setMgr] = useState<{ rating: number | null; comments: string } | null>(null);
  const [goal, setGoal] = useState({ title: "", kpi: "", target: "", weight: "" });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["reviews"] });
  const post = useMutation({
    mutationFn: ({ path, body }: { path: string; body: object }) => api.post(`performance-reviews/${id}/${path}`, body),
    onSuccess: () => {
      toast.success("Saved");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeGoal = useMutation({ mutationFn: (g: string) => api.delete(`performance-reviews/${id}/goals/${g}`), onSuccess: invalidate });
  const r = q.data;
  if (!r) return null;
  const s = self ?? { rating: r.selfRating === null ? null : Number(r.selfRating), comments: (r.selfComments as string) ?? "" };
  const m = mgr ?? { rating: r.managerRating === null ? null : Number(r.managerRating), comments: (r.managerComments as string) ?? "" };
  const done = r.status === "completed";
  const canSelf = r.access.isSelf && r.status === "self_review";
  const canMgr = (r.access.isReviewer || r.access.isHr) && !done;
  const editGoals = (r.access.isSelf || r.access.isReviewer || r.access.isHr) && !done;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{String(r.employeeName)} — {String(r.cycleName)}</DialogTitle>
          <DialogDescription>Reviewer: {(r.reviewerName as string) ?? "HR"} · <Status value={r.status as string} /></DialogDescription>
        </DialogHeader>
        <section className="space-y-2">
          <h3 className="text-[13px] font-semibold">Goals & KPIs</h3>
          <ul className="divide-y divide-border-subtle rounded-lg border">
            {r.goals.length === 0 && <li className="px-3 py-3 text-[13px] text-muted-foreground">No goals yet.</li>}
            {r.goals.map((g) => (
              <li key={g.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                <Target className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{String(g.title)}</p>
                  <p className="text-xs text-muted-foreground">{[g.kpi && `KPI: ${g.kpi}`, g.target && `Target: ${g.target}`, `${g.weight}%`].filter(Boolean).join(" · ")}</p>
                </div>
                {editGoals && <Button variant="ghost" size="icon-sm" aria-label="Remove goal" onClick={() => removeGoal.mutate(g.id)}><Trash2 /></Button>}
              </li>
            ))}
          </ul>
          {editGoals && (
            <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_5rem_auto]">
              <Input placeholder="Goal" value={goal.title} onChange={(e) => setGoal({ ...goal, title: e.target.value })} />
              <Input placeholder="KPI" value={goal.kpi} onChange={(e) => setGoal({ ...goal, kpi: e.target.value })} />
              <Input placeholder="Target" value={goal.target} onChange={(e) => setGoal({ ...goal, target: e.target.value })} />
              <Input placeholder="%" type="number" value={goal.weight} onChange={(e) => setGoal({ ...goal, weight: e.target.value })} />
              <Button
                variant="outline"
                disabled={!goal.title.trim()}
                onClick={() => {
                  post.mutate({ path: "goals", body: { title: goal.title, kpi: goal.kpi || null, target: goal.target || null, weight: Number(goal.weight || 0) } });
                  setGoal({ title: "", kpi: "", target: "", weight: "" });
                }}
              >
                <Plus />
              </Button>
            </div>
          )}
        </section>
        <section className="grid gap-4 sm:grid-cols-2">
          <ContentCard title="Self-assessment">
            <div className="space-y-2">
              <Rating value={s.rating} disabled={!canSelf} onChange={(v) => setSelf({ ...s, rating: v })} />
              <Textarea rows={4} disabled={!canSelf} value={s.comments} onChange={(e) => setSelf({ ...s, comments: e.target.value })} placeholder="Achievements, challenges, development needs" />
              {canSelf && (
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" disabled={!s.rating} onClick={() => post.mutate({ path: "self", body: { selfRating: s.rating, selfComments: s.comments || null, submit: false } })}>Save draft</Button>
                  <Button size="sm" disabled={!s.rating} onClick={() => post.mutate({ path: "self", body: { selfRating: s.rating, selfComments: s.comments || null, submit: true } })}>Submit</Button>
                </div>
              )}
            </div>
          </ContentCard>
          <ContentCard title="Manager evaluation">
            <div className="space-y-2">
              <Rating value={m.rating} disabled={!canMgr} onChange={(v) => setMgr({ ...m, rating: v })} />
              <Textarea rows={4} disabled={!canMgr} value={m.comments} onChange={(e) => setMgr({ ...m, comments: e.target.value })} placeholder="Evaluation and feedback" />
              {canMgr && (
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" disabled={!m.rating} onClick={() => post.mutate({ path: "manager", body: { managerRating: m.rating, managerComments: m.comments || null, submit: false } })}>Save draft</Button>
                  <Button size="sm" disabled={!m.rating} onClick={() => post.mutate({ path: "manager", body: { managerRating: m.rating, managerComments: m.comments || null, submit: true } })}>Complete review</Button>
                </div>
              )}
              {done && <p className="text-[13px]">Final rating: <span className="font-semibold">{Number(r.finalRating)}/5</span></p>}
            </div>
          </ContentCard>
        </section>
      </DialogContent>
    </Dialog>
  );
}

export function ReviewsList({ mine }: { mine?: boolean }) {
  const cycles = useOptions("performance-cycles", (r) => String(r.name));
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["reviews", cycleId, status, mine], queryFn: () => api.get<Row[]>("performance-reviews", { cycleId: cycleId ?? undefined, status: status ?? undefined, mine: mine ? "true" : undefined }) });
  return (
    <div className="space-y-4">
      <DataTable
        columns={[
          col.employee(),
          col.text("cycleName", "Cycle"),
          col.text("reviewerName", "Reviewer", { hideBelow: "md" }),
          { key: "self", header: "Self", cell: (r) => (r.selfRating ? `${Number(r.selfRating)}/5` : "—") },
          { key: "final", header: "Final", cell: (r) => (r.finalRating ? <span className="font-semibold">{Number(r.finalRating)}/5</span> : "—") },
          col.status(),
        ]}
        rows={q.data}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error?.message}
        onRowClick={(r) => setOpen(r.id)}
        toolbar={
          <>
            <div className="w-52"><SelectField value={cycleId} onChange={setCycleId} options={cycles} noneLabel="All cycles" /></div>
            <div className="w-44"><SelectField value={status} onChange={setStatus} options={opts(["self_review", "manager_review", "completed"])} noneLabel="All statuses" /></div>
          </>
        }
        empty={<EmptyState icon={Award} title="No reviews" description={mine ? "Reviews appear when HR launches a performance cycle." : "Launch a cycle to create reviews."} />}
      />
      {open && <ReviewDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function PerformancePage() {
  const { can } = useSession();
  const [tab, setTab] = useState("reviews");
  return (
    <PageContainer>
      <PageHeader title="Performance" description="Cycles, goals and KPIs, self-assessments, manager evaluations and review history." />
      <Tabs tabs={[{ value: "reviews", label: can("performance:read") ? "All reviews" : "My reviews" }, ...(can("performance:manage") ? [{ value: "cycles", label: "Cycles" }] : [])]} value={tab} onChange={setTab} />
      {tab === "reviews" ? <ReviewsList /> : <CrudPage config={cyclesConfig} embedded />}
    </PageContainer>
  );
}

/* ── Training ── */

function Enrollments() {
  const { can } = useSession();
  const qc = useQueryClient();
  const programs = useOptions("training-programs", (r) => `${r.code} · ${r.title}`);
  const [programId, setProgramId] = useState<string | null>(null);
  const [enroll, setEnroll] = useState(false);
  const [complete, setComplete] = useState<Row | null>(null);
  const q = useQuery({ queryKey: ["training-enrollments", programId], queryFn: () => api.list<Row>("training-enrollments", { programId: programId ?? undefined, limit: 500 }) });
  const cancel = useMutation({ mutationFn: (id: string) => api.patch(`training-enrollments/${id}`, { status: "cancelled" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["training-enrollments"] }) });
  const manage = can("training:manage");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="w-72"><SelectField value={programId} onChange={setProgramId} options={programs} noneLabel="All programs" /></div>
        {manage && <Button className="ml-auto" onClick={() => setEnroll(true)}><Plus /> Enroll employee</Button>}
      </div>
      <DataTable
        columns={[
          col.employee(),
          col.text("programTitle", "Program"),
          col.date("completedOn", "Completed"),
          { key: "score", header: "Score", cell: (r) => (r.score === null ? "—" : `${r.score}%`) },
          { key: "cert", header: "Certificate expires", cell: (r) => (r.certificateExpiresOn ? <span className={cn("text-[13px]", String(r.certificateExpiresOn) < today() && "text-danger")}>{formatDate(r.certificateExpiresOn as string)}</span> : "—") },
          { key: "file", header: "", hideBelow: "md", cell: (r) => <FileLink id={r.certificateFileId as string} name="Certificate" /> },
          col.status(),
          {
            key: "a",
            header: "",
            className: "w-12",
            cell: (r) =>
              manage && (
                <ActionDropdown
                  items={[
                    { label: "Record outcome", icon: BadgeCheck, hidden: r.status === "cancelled", onSelect: () => setComplete(r) },
                    { label: "Cancel enrollment", icon: Trash2, destructive: true, hidden: r.status !== "enrolled", onSelect: () => cancel.mutate(r.id) },
                  ]}
                />
              ),
          },
        ]}
        rows={q.data?.items}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error?.message}
        empty={<EmptyState icon={Users} title="No enrollments" />}
      />
      {enroll && (
        <CrudDialog
          title="Enroll employee"
          fields={[
            { name: "programId", label: "Program", type: "ref", required: true, ref: { path: "training-programs", label: (r) => `${r.code} · ${r.title}` } },
            { name: "employeeId", label: "Employee", type: "employee", required: true },
          ]}
          row={null}
          open
          onOpenChange={setEnroll}
          onSubmit={async (b) => {
            await api.post(`training-programs/${b.programId}/enroll`, { employeeIds: [b.employeeId] });
            toast.success("Enrolled");
            qc.invalidateQueries({ queryKey: ["training-enrollments"] });
          }}
        />
      )}
      {complete && (
        <CrudDialog
          title={`Outcome — ${complete.employeeName}`}
          description="Completing a certified program sets the certificate expiry from the program's validity."
          fields={[
            { name: "status", label: "Result", type: "select", required: true, options: opts(["completed", "failed"]), default: "completed" },
            { name: "completedOn", label: "Completed on", type: "date", required: true, default: today() },
            { name: "score", label: "Score (%)", type: "number", min: 0, max: 100 },
            { name: "certificateFileId", label: "Certificate", type: "file", purpose: "certificate" },
          ]}
          row={null}
          open
          employeeId={complete.employeeId as string}
          onOpenChange={(o) => !o && setComplete(null)}
          onSubmit={async (b) => {
            await api.post(`training-enrollments/${complete.id}/complete`, b);
            toast.success("Outcome recorded");
            qc.invalidateQueries({ queryKey: ["training-enrollments"] });
          }}
        />
      )}
    </div>
  );
}

export function TrainingPage() {
  const [tab, setTab] = useState("programs");
  return (
    <PageContainer>
      <PageHeader title="Training & development" description="Programs, enrollments, completions, certifications and expiry reminders." />
      <Tabs tabs={[{ value: "programs", label: "Programs" }, { value: "enrollments", label: "Enrollments & certificates" }]} value={tab} onChange={setTab} />
      {tab === "programs" ? <CrudPage config={programsConfig} embedded /> : <Enrollments />}
    </PageContainer>
  );
}

