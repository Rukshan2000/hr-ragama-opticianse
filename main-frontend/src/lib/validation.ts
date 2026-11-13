import { z } from "zod";

// Mirrors main-backend src/shared/utils/password.ts so users see errors before submitting.
export const passwordSchema = z
  .string()
  .min(10, "At least 10 characters")
  .max(128, "At most 128 characters")
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/\d/, "Include a number");

export const emailSchema = z.email("Enter a valid email").max(255);
