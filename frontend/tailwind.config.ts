import type { Config } from "tailwindcss";

// Paleta del boceto "Navegación tipo Waze" (ver docs de diseño del equipo):
// base nocturna + acentos por rol. Único tema: los mockups del equipo son
// solo oscuros, no hay variante clara que mantener.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Manrope", "system-ui", "sans-serif"],
      },
      colors: {
        night: {
          950: "#06100a",
          900: "#0a0e16",
          800: "#111826",
          700: "#17213a",
          600: "#1e2a40",
          500: "#2a3a58",
        },
        accent: {
          cyan: "#22d3ee",
          amber: "#fbbf24",
          green: "#34d399",
          purple: "#3b0646",
          purplelight: "#f0abfc",
          rose: "#ff5a5a",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
