export const NPM_NAME_REGEX = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
export const PYPI_NAME_REGEX = /^[A-Za-z0-9._-]+$/;

export function validatePackageName(registry: string, name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Package name is required";
  if (registry === "npm") {
    if (!NPM_NAME_REGEX.test(trimmed)) {
      return "Invalid npm package name. Use lowercase letters, digits, `.`, `_`, `-`, optionally with an `@scope/` prefix.";
    }
    return null;
  }
  if (registry === "pypi") {
    if (!PYPI_NAME_REGEX.test(trimmed)) {
      return "Invalid PyPI package name. Use letters, digits, `.`, `_`, or `-` only (no slashes).";
    }
    return null;
  }
  return `Unknown registry "${registry}"`;
}
