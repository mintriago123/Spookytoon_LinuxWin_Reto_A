import { runBackendServer } from "./server.ts";

// PM2 importa el script desde su contenedor: no depende de process.argv[1].
void runBackendServer().catch(error => {
  console.error(error instanceof Error ? error.message : "BACKEND_START_FAILED");
  process.exitCode = 1;
});
