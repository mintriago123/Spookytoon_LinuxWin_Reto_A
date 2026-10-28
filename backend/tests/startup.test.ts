import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";

test("entrada importada por un supervisor inicia HTTP y cierra con SIGTERM", { timeout: 12_000 }, async () => {
  const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const address = probe.address(); assert(address && typeof address !== "string");
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const child = spawn(process.execPath, ["--input-type=module", "--eval", "await import('./src/start.ts')"], {
    cwd: new URL("../", import.meta.url), env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1",
      PORT: String(address.port), ROUTE_API_KEY: "startup-local-verification" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const exited = once(child, "exit");
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
          const response = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
          if (response.status === 200) { resolve(); return; }
        } catch { /* El servidor todavía está iniciando. */ }
        if (Date.now() >= deadline) { reject(new Error("El supervisor no abrió HTTP después de instalar el manejador")); return; }
        setTimeout(poll, 25);
      };
      void poll();
    });
  } finally { child.kill("SIGTERM"); }
  assert.equal((await exited)[0], 0);
});
