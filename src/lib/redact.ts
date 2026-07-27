const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "accessToken",
  "access_token",
  "secret",
  "connectionString",
  "passwordEnv",
  "tokenEnv",
]);

const SENSITIVE_KEY_PATTERNS = [/password/i, /token/i, /secret/i, /pwd/i];

/**
 * Walks an object and replaces values of keys that look sensitive with
 * "***REDACTED***". Also redacts inline string occurrences of any secret
 * values found in the input.
 */
export function redactSecrets<T>(value: T, additionalSecrets: readonly string[] = []): T {
  const seen = new WeakSet<object>();
  const collectedSecrets: string[] = [...additionalSecrets].filter((s) => s.length > 0);

  const walk = (node: unknown): unknown => {
    if (node === null || node === undefined) return node;
    if (typeof node !== "object") return node;
    if (seen.has(node as object)) return node;
    seen.add(node as object);

    if (Array.isArray(node)) {
      return node.map((item) => walk(item));
    }

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEY_PATTERNS.some((re) => re.test(key))) {
        out[key] = "***REDACTED***";
      } else if (key === "odbcConnectionString" && typeof val === "string") {
        out[key] = redactOdbcConnectionString(val);
      } else if (key === "connectionString" && typeof val === "string") {
        out[key] = redactOdbcConnectionString(val);
      } else {
        out[key] = walk(val);
      }
    }
    return out;
  };

  const redacted = walk(value) as T;
  if (collectedSecrets.length === 0) return redacted;
  return scrubInlineSecrets(redacted, collectedSecrets);
}

const ODBC_SECRET_KEYS = [
  "Password",
  "Pwd",
  "UID",
  "UserId",
  "User ID",
  "Authentication",
] as const;

export function redactOdbcConnectionString(input: string): string {
  // Match `Key=Value;` segments where the key is a known secret. We replace
  // the value with `***REDACTED***`; case-insensitive on the key.
  return input.replace(
    /(^|;)\s*([A-Za-z][A-Za-z0-9 _]*?)\s*=\s*([^;]*)/g,
    (match, lead, key, _value) => {
      if (ODBC_SECRET_KEYS.some((k) => k.toLowerCase() === String(key).toLowerCase().trim())) {
        return `${lead}${key}=***REDACTED***`;
      }
      return match;
    },
  );
}

function scrubInlineSecrets<T>(value: T, secrets: readonly string[]): T {
  if (secrets.length === 0) return value;
  const filtered = secrets.filter((s) => s.length >= 4);
  if (filtered.length === 0) return value;
  const pattern = filtered.map(escapeRegex).join("|");
  const re = new RegExp(pattern, "gi");
  return scrub(value, re);
}

function scrub<T>(node: T, re: RegExp): T {
  if (typeof node === "string") return node.replace(re, "***REDACTED***") as unknown as T;
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) {
    return node.map((item) => scrub(item, re)) as unknown as T;
  }
  if (typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = scrub(v, re);
    }
    return out as unknown as T;
  }
  return node;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a redaction plan from a resolved config: collects every secret-bearing
 * field (password, tokenEnv-resolved tokens) so they can be scrubbed from any
 * error message that bubbles up.
 */
export function collectSecretStrings(input: unknown): string[] {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEY_PATTERNS.some((re) => re.test(key))) {
        if (typeof val === "string" && val.length > 0 && val !== "***REDACTED***") {
          out.add(val);
        }
      } else {
        walk(val);
      }
    }
  };
  walk(input);
  return [...out];
}
