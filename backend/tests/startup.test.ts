import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";

async function verifyShutdown(mode: "ipc" | "signal"): Promise<void> {
  const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const address = probe.address(); assert(address && typeof address !== "string");
  await new Promise<void>(resolve => probe.close(() => resolve()));
  // Solo el bootstrap de prueba recibe IPC; la aplicación conserva su manejador real.
  const bootstrap = mode === "ipc" ? `
    process.once("message", message => {
      if (message !== "test:shutdown") throw new Error("Mensaje de prueba inesperado");
      process.disconnect();
      process.emit("SIGTERM");
    });
    await import('./src/start.ts');
  ` : "await import('./src/start.ts')";
  const child = spawn(process.execPath, ["--input-type=module", "--eval", bootstrap], {
    cwd: new URL("../", import.meta.url), env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1",
      PORT: String(address.port), ROUTE_API_KEY: "startup-local-verification" },
    stdio: mode === "ipc" ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stderr!.on("data", data => { output += data; });
  const exited = once(child, "exit");
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`El supervisor no instaló el manejador SIGTERM: ${output}`)), 8_000);
      child.stdout!.on("data", data => { output += data; if (output.includes('"event":"shutdown-handlers-installed"')) { clearTimeout(timer); resolve(); } });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`El proceso terminó antes de instalar el manejador: ${output}`)); });
    });
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 8_000;
      const poll = async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${address.port}/health/ready`, {
            signal: AbortSignal.timeout(1_000),
          });
          if (response.status === 200) { resolve(); return; }
        } catch { /* El servidor todavía está iniciando. */ }
        if (Date.now() >= deadline) { reject(new Error("El supervisor no abrió HTTP después de instalar el manejador")); return; }
        setTimeout(poll, 25);
      };
      void poll();
    });
    if (mode === "ipc") child.send("test:shutdown");
    else assert.equal(child.kill("SIGTERM"), true);
    const [code, signal] = await exited;
    assert.equal(signal, null, `El cierre debe ser natural: ${output}`);
    assert.equal(code, 0, output);
    await assert.rejects(fetch(`http://127.0.0.1:${address.port}/health/ready`, {
      signal: AbortSignal.timeout(1_000),
    }), "HTTP debe dejar de aceptar conexiones después del apagado");
  } finally {
    clearTimeout(watchdog);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
}

test("manejador SIGTERM cierra HTTP y workers cooperativamente mediante IPC de prueba",
  { timeout: 12_000 }, () => verifyShutdown("ipc"));

test("supervisor entrega SIGTERM real y el servidor termina naturalmente", {
  timeout: 12_000,
  skip: process.platform === "win32"
    ? "Windows termina abruptamente con child.kill; la entrega POSIX se verifica en Linux"
    : false,
}, () => verifyShutdown("signal"));
