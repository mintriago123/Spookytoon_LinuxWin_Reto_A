import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { startBackendServer } from "../../server.ts";

export { createBackendApp, startBackendServer as startRoutingServer } from "../../server.ts";

function isMain() {
  return !!process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMain()) startBackendServer().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
