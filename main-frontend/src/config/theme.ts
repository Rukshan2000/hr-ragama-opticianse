import colors from "./colors.json";

type Palette = (typeof colors)["light"];

/** Maps the JSON palette onto the CSS variables every component reads (shadcn tokens + our extras). */
function vars(c: Palette): Record<string, string> {
  return {
    "--background": c.background.app,
    "--foreground": c.text.primary,
    "--card": c.background.surface,
    "--card-foreground": c.text.primary,
    "--popover": c.background.surface,
    "--popover-foreground": c.text.primary,
    "--primary": c.brand.primary,
    "--primary-foreground": c.text.inverse,
    "--secondary": c.background.subtle,
    "--secondary-foreground": c.text.primary,
    "--muted": c.background.subtle,
    "--muted-foreground": c.text.secondary,
    "--accent": c.background.subtle,
    "--accent-foreground": c.text.primary,
    "--destructive": c.status.danger,
    "--border": c.border.default,
    "--input": c.border.strong,
    "--ring": c.brand.accent,
    "--sidebar": c.background.sidebar,
    "--sidebar-foreground": c.text.primary,
    "--sidebar-border": c.border.default,
    "--brand": c.brand.primary,
    "--brand-secondary": c.brand.secondary,
    "--brand-accent": c.brand.accent,
    "--subtle": c.background.subtle,
    "--text-muted": c.text.muted,
    "--border-subtle": c.border.subtle,
    "--border-strong": c.border.strong,
    "--success": c.status.success,
    "--warning": c.status.warning,
    "--danger": c.status.danger,
    "--info": c.status.info,
  };
}

const block = (selector: string, c: Palette) =>
  `${selector}{${Object.entries(vars(c))
    .map(([k, v]) => `${k}:${v}`)
    .join(";")}}`;

export const themeCss = block(":root", colors.light) + block(".dark", colors.dark);
