// Minimal classname joiner — shadcn normally uses clsx + tailwind-merge, but we
// keep it dependency-free. It filters falsy values and joins; it does not
// dedupe conflicting Tailwind classes, so pass overrides intentionally.
export function cn(...inputs: Array<string | false | null | undefined>): string {
  return inputs.filter(Boolean).join(" ");
}
