import { ValidationError } from "./errors";

export function renderTemplate(source: string, vars: Record<string, string | number>): string {
  return source.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === undefined) {
      throw new ValidationError(`Template variable not provided: ${key}`);
    }
    return String(value);
  });
}

export function normalizeTemplateVars(
  vars: Record<string, string | number> | undefined
): Record<string, string | number> {
  return vars ?? {};
}
