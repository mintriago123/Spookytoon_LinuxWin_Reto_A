import assert from "node:assert/strict";
import { test } from "node:test";
import { createBackendApp } from "../src/server.ts";

const apiKey = "operator-session-test-key-123456";

/** Extrae `name=value` del primer Set-Cookie de una respuesta de inject. */
function cookiePair(response: { headers: Record<string, unknown> }): string {
  const header = response.headers["set-cookie"];
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== "string") throw new Error("Sin Set-Cookie en la respuesta");
  return raw.split(";")[0];
}

test("login por contraseña da cookie de sesión que reemplaza a x-api-key en los controles", async () => {
  const { app } = await createBackendApp({ apiKey, operatorPassword: "clave-corta-operador", logger: false });
  try {
    // Sin ninguna credencial, el control sigue cerrado.
    assert.equal((await app.inject({ method: "POST", url: "/simulador/pausar", payload: { reason: "r" } })).statusCode, 401);

    // Contraseña incorrecta no fija cookie.
    const wrong = await app.inject({ method: "POST", url: "/operador/sesion", payload: { password: "incorrecta" } });
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.headers["set-cookie"], undefined);

    // Login correcto: 204 sin cuerpo y cookie httpOnly (SameSite=Lax porque
    // la inyección de test no pasa por https/X-Forwarded-Proto).
    const login = await app.inject({ method: "POST", url: "/operador/sesion", payload: { password: "clave-corta-operador" } });
    assert.equal(login.statusCode, 204);
    const setCookie = String(login.headers["set-cookie"]);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.doesNotMatch(setCookie, /Secure/);
    const cookie = cookiePair(login);

    // GET /operador/sesion confirma la sesión sin tocar el simulador.
    assert.equal((await app.inject({ method: "GET", url: "/operador/sesion", headers: { cookie } })).statusCode, 204);

    // La cookie basta para iniciar/pausar/cerrar segmento: nunca se envía x-api-key.
    const start = await app.inject({ method: "POST", url: "/simulador/iniciar", headers: { cookie },
      payload: { gameId: "operator-session-game", roundId: 1, seed: "s1" } });
    assert.equal(start.statusCode, 202);
    assert.equal((await app.inject({ method: "POST", url: "/simulador/pausar", headers: { cookie }, payload: { reason: "fin" } })).statusCode, 202);

    // x-api-key real sigue funcionando en paralelo (compatibilidad con /paso y /motor/*).
    assert.equal((await app.inject({ method: "GET", url: "/operador/sesion", headers: { "x-api-key": apiKey } })).statusCode, 204);

    // Logout revoca la cookie; el mismo token ya no sirve.
    const logout = await app.inject({ method: "POST", url: "/operador/salir", headers: { cookie } });
    assert.equal(logout.statusCode, 204);
    assert.match(String(logout.headers["set-cookie"]), /Max-Age=0/);
    assert.equal((await app.inject({ method: "GET", url: "/operador/sesion", headers: { cookie } })).statusCode, 401);

    // Logout sin ninguna sesión previa sigue siendo 204 (idempotente).
    assert.equal((await app.inject({ method: "POST", url: "/operador/salir" })).statusCode, 204);
  } finally { await app.close(); }
});

test("sin OPERATOR_PASSWORD explícita, la propia apiKey sirve como contraseña de login (compatibilidad)", async () => {
  const { app } = await createBackendApp({ apiKey, logger: false });
  try {
    const login = await app.inject({ method: "POST", url: "/operador/sesion", payload: { password: apiKey } });
    assert.equal(login.statusCode, 204);
  } finally { await app.close(); }
});

test("login rechaza propiedades adicionales prohibidas por OperadorSesionRequest", async () => {
  const { app } = await createBackendApp({ apiKey, operatorPassword: "clave-corta-operador", logger: false });
  try {
    const extra = await app.inject({ method: "POST", url: "/operador/sesion", payload: {
      password: "clave-corta-operador",
      roundId: 1,
    } });
    assert.equal(extra.statusCode, 400);
    assert.equal(extra.json().error.code, "VALIDATION_ERROR");
    assert.equal(extra.headers["set-cookie"], undefined);

    const missing = await app.inject({ method: "POST", url: "/operador/sesion", payload: { other: "value" } });
    assert.equal(missing.statusCode, 400);
  } finally { await app.close(); }
});

test("una OPERATOR_PASSWORD separada invalida el login con la apiKey larga", async () => {
  const { app } = await createBackendApp({ apiKey, operatorPassword: "otra-clave-operador", logger: false });
  try {
    assert.equal((await app.inject({ method: "POST", url: "/operador/sesion", payload: { password: apiKey } })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/operador/sesion", payload: { password: "otra-clave-operador" } })).statusCode, 204);
  } finally { await app.close(); }
});

test("una OPERATOR_PASSWORD de menos de 8 caracteres se rechaza al construir el backend", async () => {
  await assert.rejects(createBackendApp({ apiKey, operatorPassword: "corta", logger: false }), /OPERATOR_PASSWORD/);
});
