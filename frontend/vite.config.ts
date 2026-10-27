import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// SPEC.md §6: la API key nunca va en el bundle. Las únicas variables
// expuestas al cliente son VITE_API_BASE_URL y VITE_WS_URL (ver .env.example).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
