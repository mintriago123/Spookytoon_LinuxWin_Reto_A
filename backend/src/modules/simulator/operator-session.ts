import { randomBytes } from "node:crypto";

/**
 * Sesión de operador en memoria: reemplaza el envío de x-api-key en cada
 * petición del navegador por una cookie httpOnly obtenida vía login. El
 * token nunca revela la x-api-key real (SPEC.md §3.1/§3.3, docs/team/
 * michael/README.md "no exponer la API key en el navegador").
 */
export const OPERATOR_SESSION_COOKIE = "spookython_operator";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface OperatorSessionStore {
  create(): string;
  isValid(token: string | undefined): boolean;
  revoke(token: string | undefined): void;
}

export function createOperatorSessionStore(): OperatorSessionStore {
  const expiresAtByToken = new Map<string, number>();
  const prune = () => {
    const now = Date.now();
    for (const [token, expiresAt] of expiresAtByToken) if (expiresAt <= now) expiresAtByToken.delete(token);
  };
  return {
    create: () => {
      prune();
      const token = randomBytes(32).toString("hex");
      expiresAtByToken.set(token, Date.now() + SESSION_TTL_MS);
      return token;
    },
    isValid: (token) => {
      if (!token) return false;
      const expiresAt = expiresAtByToken.get(token);
      return expiresAt !== undefined && expiresAt > Date.now();
    },
    revoke: (token) => { if (token) expiresAtByToken.delete(token); },
  };
}

/** Parser mínimo de Cookie: sin dependencia nueva, solo pares name=value. */
export function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const raw = Array.isArray(header) ? header.join("; ") : header;
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name) continue;
    try { out[name] = decodeURIComponent(value); } catch { out[name] = value; }
  }
  return out;
}
