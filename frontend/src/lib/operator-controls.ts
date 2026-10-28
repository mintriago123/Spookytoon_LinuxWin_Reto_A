import type {
  ApiErrorBody,
  BloquearAristaRequest,
  BloquearAristaResponse,
  WorldSnapshot,
} from "../types/contracts";

export type ControlFailureKind = "rejected" | "uncertain";

export class OperatorControlError extends Error {
  constructor(
    message: string,
    readonly kind: ControlFailureKind,
    readonly details: { code?: string; requestId?: string; status?: number } = {},
  ) {
    super(message);
    this.name = "OperatorControlError";
  }
}

type Fetcher = typeof fetch;

async function apiErrorFrom(response: Response): Promise<ApiErrorBody["error"] | null> {
  const body = await response.clone().json().catch(() => null) as ApiErrorBody | null;
  return body && typeof body === "object" && body.error && typeof body.error === "object"
    ? body.error
    : null;
}

function controlError(
  response: Response,
  apiError: ApiErrorBody["error"] | null,
): OperatorControlError {
  const kind: ControlFailureKind = response.status >= 400 && response.status < 500
    ? "rejected"
    : "uncertain";
  const message = apiError?.message ?? `La solicitud respondió HTTP ${response.status}`;
  return new OperatorControlError(message, kind, {
    code: apiError?.code,
    requestId: apiError?.requestId,
    status: response.status,
  });
}

export async function operatorResponseError(response: Response): Promise<OperatorControlError> {
  return controlError(response, await apiErrorFrom(response));
}

/** Solo el 204 contractual confirma una sesión existente. */
export async function checkOperatorSession(
  apiBaseUrl: string,
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  const response = await fetcher(`${apiBaseUrl}/operador/sesion`, {
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 204) return true;
  if (response.status === 401) return false;
  throw controlError(response, await apiErrorFrom(response));
}

/** El inicio de sesión también confirma éxito solo con el 204 del contrato. */
export async function loginOperator(
  apiBaseUrl: string,
  password: string,
  fetcher: Fetcher = fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await fetcher(`${apiBaseUrl}/operador/sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ password }),
    });
  } catch {
    throw new OperatorControlError("No se pudo confirmar el inicio de sesión", "uncertain");
  }
  if (response.status === 204) return;
  throw controlError(response, await apiErrorFrom(response));
}

export interface SegmentCommandInput {
  snapshot: WorldSnapshot;
  eventId: string;
  edgeId: string;
  bloqueada: boolean;
  motivo: string;
  pausedEffectiveTurn?: string;
}

/**
 * El cliente propone un turno en pausa a partir del snapshot visible; el
 * servidor continúa validando que el turno siga disponible al recibirlo.
 */
export function createSegmentCommand(input: SegmentCommandInput): BloquearAristaRequest {
  const { snapshot } = input;
  if (snapshot.status !== "running" && snapshot.status !== "paused") {
    throw new Error("Los cierres solo se pueden programar en una partida en curso o pausada");
  }

  const command: BloquearAristaRequest = {
    eventId: input.eventId,
    edgeId: input.edgeId,
    bloqueada: input.bloqueada,
    motivo: input.motivo,
  };

  if (snapshot.status === "paused") {
    const entered = input.pausedEffectiveTurn?.trim();
    const effectiveTurnId = entered ? Number(entered) : snapshot.turnId + 1;
    if (!Number.isSafeInteger(effectiveTurnId) || effectiveTurnId <= snapshot.turnId || effectiveTurnId > 150) {
      throw new Error(`Indica un turno efectivo entre ${snapshot.turnId + 1} y 150`);
    }
    command.effectiveTurnId = effectiveTurnId;
  }

  return command;
}

function isSegmentReceipt(value: unknown): value is BloquearAristaResponse {
  if (typeof value !== "object" || value === null) return false;
  const receipt = value as Partial<BloquearAristaResponse>;
  return typeof receipt.eventId === "string" &&
    typeof receipt.segmentoId === "string" &&
    Number.isSafeInteger(receipt.effectiveTurnId) &&
    (receipt.effectiveTurnId ?? 0) >= 1 &&
    (receipt.effectiveTurnId ?? 151) <= 150 &&
    receipt.status === "programado";
}

/** 202 significa programación; una respuesta inválida no se presenta como éxito. */
export async function scheduleSegmentCommand(
  apiBaseUrl: string,
  command: BloquearAristaRequest,
  expectedSegmentId: string,
  fetcher: Fetcher = fetch,
): Promise<BloquearAristaResponse> {
  let response: Response;
  try {
    response = await fetcher(`${apiBaseUrl}/simulador/bloquear-arista`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(command),
    });
  } catch {
    throw new OperatorControlError(
      "No se confirmó la respuesta del servidor; la solicitud pudo quedar sin confirmar",
      "uncertain",
    );
  }

  if (response.status !== 202) {
    throw controlError(response, await apiErrorFrom(response));
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new OperatorControlError(
      "El servidor aceptó la solicitud, pero no devolvió el recibo JSON esperado",
      "uncertain",
      { status: response.status },
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new OperatorControlError(
      "El servidor aceptó la solicitud, pero el recibo no se pudo leer",
      "uncertain",
      { status: response.status },
    );
  }

  if (!isSegmentReceipt(body) || body.eventId !== command.eventId || body.segmentoId !== expectedSegmentId) {
    throw new OperatorControlError(
      "El servidor aceptó la solicitud, pero el recibo no coincide con el evento y segmento enviados",
      "uncertain",
      { status: response.status },
    );
  }
  return body;
}
