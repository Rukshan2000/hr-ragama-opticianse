/** Must match the backend TENANCY_MODE. "single" hides everything about organizations. */
export const SINGLE_TENANT = process.env.NEXT_PUBLIC_TENANCY_MODE === "single";
