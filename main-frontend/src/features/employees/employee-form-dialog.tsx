"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { FormField } from "@/components/shared/form";
import { SelectField } from "@/components/shared/select-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormAlert } from "@/features/auth/auth-card";
import { applyFieldErrors, errorMessage } from "@/lib/api/client";
import { employeesApi } from "@/lib/api/endpoints";
import type { Employee } from "@/lib/api/types";
import { today } from "@/lib/format";
import { EMPLOYMENT_TYPES, EmployeePicker, GENDERS, options, useLookups } from "./shared";

const opt = (max: number) => z.string().trim().max(max);
const date = z.union([z.literal(""), z.iso.date("Enter a valid date")]);

const profileSchema = z.object({
  firstName: z.string().trim().min(1, "Enter a first name").max(100),
  lastName: z.string().trim().min(1, "Enter a last name").max(100),
  displayName: opt(150),
  email: z.union([z.literal(""), z.email("Enter a valid email")]),
  phone: opt(30),
  dateOfBirth: date,
  gender: z.string().nullable(),
  address: opt(500),
  emergencyContactName: opt(150),
  emergencyContactPhone: opt(30),
  emergencyContactRelationship: opt(50),
  employmentType: z.enum(["permanent", "temporary", "contract", "internship"]),
  probationStartDate: date,
  probationEndDate: date,
  notes: opt(5000),
});

const createSchema = profileSchema.extend({
  employeeNumber: z.string().trim().min(1, "Enter an employee number").max(30).regex(/^[A-Za-z0-9._/-]+$/, "Letters, numbers, dot, dash, slash or underscore"),
  joiningDate: z.iso.date("Enter the joining date"),
  status: z.enum(["onboarding", "probation", "active"]),
  departmentId: z.string().nullable(),
  designationId: z.string().nullable(),
  branchId: z.string().nullable(),
  manager: z.object({ id: z.string(), name: z.string().nullable() }).nullable(),
});

type Values = z.infer<typeof createSchema>;

const blank: Values = {
  employeeNumber: "",
  firstName: "",
  lastName: "",
  displayName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  gender: null,
  address: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelationship: "",
  employmentType: "permanent",
  probationStartDate: "",
  probationEndDate: "",
  notes: "",
  joiningDate: today(),
  status: "onboarding",
  departmentId: null,
  designationId: null,
  branchId: null,
  manager: null,
};

function fromEmployee(e: Employee): Values {
  return {
    ...blank,
    employeeNumber: e.employeeNumber,
    firstName: e.firstName,
    lastName: e.lastName,
    displayName: e.displayName ?? "",
    email: e.email ?? "",
    phone: e.phone ?? "",
    dateOfBirth: e.dateOfBirth ?? "",
    gender: e.gender,
    address: e.address ?? "",
    emergencyContactName: e.emergencyContact.name ?? "",
    emergencyContactPhone: e.emergencyContact.phone ?? "",
    emergencyContactRelationship: e.emergencyContact.relationship ?? "",
    employmentType: e.employmentType,
    probationStartDate: e.probationStartDate ?? "",
    probationEndDate: e.probationEndDate ?? "",
    notes: e.notes ?? "",
    joiningDate: e.joiningDate,
  };
}

const nullIfEmpty = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === "" ? null : v]));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-semibold tracking-wide text-text-muted uppercase">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function EmployeeFormDialog({ open, onOpenChange, employee }: { open: boolean; onOpenChange: (o: boolean) => void; employee?: Employee }) {
  const qc = useQueryClient();
  const router = useRouter();
  const editing = Boolean(employee);
  const lookups = useLookups(open && !editing);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    // Edits skip the hire-only fields, which are prefilled and unchanged.
    resolver: zodResolver(editing ? (profileSchema as unknown as typeof createSchema) : createSchema),
    values: employee ? fromEmployee(employee) : blank,
  });
  const { errors, isSubmitting } = form.formState;
  const reg = form.register;

  const close = (o: boolean) => {
    if (!o) {
      setError(null);
      form.reset();
    }
    onOpenChange(o);
  };

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      if (employee) {
        const { employeeNumber: _n, joiningDate: _j, status: _s, departmentId: _d, designationId: _g, branchId: _b, manager: _m, ...profile } = v;
        await employeesApi.update(employee.id, nullIfEmpty(profile));
        toast.success("Profile updated");
        qc.invalidateQueries({ queryKey: ["employees"] });
        close(false);
      } else {
        const { manager, ...rest } = v;
        const res = await employeesApi.create({ ...nullIfEmpty(rest), managerId: manager?.id ?? null });
        toast.success(`${v.firstName} ${v.lastName} was added`);
        qc.invalidateQueries({ queryKey: ["employees"] });
        close(false);
        router.push(`/employees/${res.data.id}`);
      }
    } catch (e) {
      if (!applyFieldErrors(e, form.setError)) setError(errorMessage(e));
    }
  });

  const select = (name: "gender" | "departmentId" | "designationId" | "branchId", opts: { value: string; label: string }[], p: { id: string }) => (
    <Controller control={form.control} name={name} render={({ field }) => <SelectField {...p} value={field.value} onChange={field.onChange} options={opts} noneLabel="Not set" />} />
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit profile" : "Add employee"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Department, designation, manager and status changes are made from the employee page so they are recorded in history."
              : "Create the employee record. A login account is optional and managed separately under Users."}
          </DialogDescription>
        </DialogHeader>
        <form id="employee-form" onSubmit={onSubmit} className="space-y-6" noValidate>
          {error && <FormAlert>{error}</FormAlert>}
          {!editing && (
            <Section title="Employment">
              <FormField label="Employee number" error={errors.employeeNumber?.message}>
                {(p) => <Input {...p} className="font-mono" {...reg("employeeNumber")} />}
              </FormField>
              <FormField label="Joining date" error={errors.joiningDate?.message}>
                {(p) => <Input {...p} type="date" {...reg("joiningDate")} />}
              </FormField>
              <FormField label="Initial status" error={errors.status?.message}>
                {(p) => (
                  <Controller
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <SelectField
                        {...p}
                        value={field.value}
                        onChange={(v) => field.onChange(v ?? "onboarding")}
                        options={[
                          { value: "onboarding", label: "Onboarding" },
                          { value: "probation", label: "Probation" },
                          { value: "active", label: "Active (confirmed)" },
                        ]}
                      />
                    )}
                  />
                )}
              </FormField>
              <FormField label="Employment type" error={errors.employmentType?.message}>
                {(p) => (
                  <Controller control={form.control} name="employmentType" render={({ field }) => <SelectField {...p} value={field.value} onChange={(v) => field.onChange(v ?? "permanent")} options={options(EMPLOYMENT_TYPES)} />} />
                )}
              </FormField>
              <FormField label="Department">{(p) => select("departmentId", lookups.departments, p)}</FormField>
              <FormField label="Designation">{(p) => select("designationId", lookups.designations, p)}</FormField>
              <FormField label="Branch">{(p) => select("branchId", lookups.branches, p)}</FormField>
              <FormField label="Reporting manager" error={errors.manager?.message}>
                {(p) => <Controller control={form.control} name="manager" render={({ field }) => <EmployeePicker {...p} value={field.value} onChange={field.onChange} />} />}
              </FormField>
            </Section>
          )}
          <Section title="Personal">
            <FormField label="First name" error={errors.firstName?.message}>
              {(p) => <Input {...p} autoComplete="off" {...reg("firstName")} />}
            </FormField>
            <FormField label="Last name" error={errors.lastName?.message}>
              {(p) => <Input {...p} autoComplete="off" {...reg("lastName")} />}
            </FormField>
            <FormField label="Display name (optional)" error={errors.displayName?.message}>
              {(p) => <Input {...p} {...reg("displayName")} />}
            </FormField>
            <FormField label="Gender (optional)">{(p) => select("gender", options(GENDERS), p)}</FormField>
            <FormField label="Date of birth (optional)" error={errors.dateOfBirth?.message}>
              {(p) => <Input {...p} type="date" max={today()} {...reg("dateOfBirth")} />}
            </FormField>
            {editing && (
              <FormField label="Employment type" error={errors.employmentType?.message}>
                {(p) => (
                  <Controller control={form.control} name="employmentType" render={({ field }) => <SelectField {...p} value={field.value} onChange={(v) => field.onChange(v ?? "permanent")} options={options(EMPLOYMENT_TYPES)} />} />
                )}
              </FormField>
            )}
          </Section>
          <Section title="Contact">
            <FormField label="Email (optional)" error={errors.email?.message}>
              {(p) => <Input {...p} type="email" {...reg("email")} />}
            </FormField>
            <FormField label="Phone (optional)" error={errors.phone?.message}>
              {(p) => <Input {...p} type="tel" {...reg("phone")} />}
            </FormField>
            <FormField label="Address (optional)" error={errors.address?.message} className="sm:col-span-2">
              {(p) => <Textarea {...p} rows={2} {...reg("address")} />}
            </FormField>
            <FormField label="Emergency contact name" error={errors.emergencyContactName?.message}>
              {(p) => <Input {...p} {...reg("emergencyContactName")} />}
            </FormField>
            <FormField label="Emergency contact phone" error={errors.emergencyContactPhone?.message}>
              {(p) => <Input {...p} type="tel" {...reg("emergencyContactPhone")} />}
            </FormField>
            <FormField label="Relationship" error={errors.emergencyContactRelationship?.message}>
              {(p) => <Input {...p} {...reg("emergencyContactRelationship")} />}
            </FormField>
          </Section>
          <Section title="Probation">
            <FormField label="Probation start" error={errors.probationStartDate?.message}>
              {(p) => <Input {...p} type="date" {...reg("probationStartDate")} />}
            </FormField>
            <FormField label="Probation end" error={errors.probationEndDate?.message}>
              {(p) => <Input {...p} type="date" {...reg("probationEndDate")} />}
            </FormField>
            <FormField label="Notes (optional)" error={errors.notes?.message} className="sm:col-span-2">
              {(p) => <Textarea {...p} rows={3} {...reg("notes")} />}
            </FormField>
          </Section>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="submit" form="employee-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" />}
            {editing ? "Save changes" : "Add employee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
