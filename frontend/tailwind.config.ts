import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          950: "#070e1a",
          900: "#0d1b2a",
          800: "#112235",
          700: "#162d44",
        },
        teal: {
          400: "#3ddbd9",
          500: "#2bc4c2",
          600: "#1ea8a6",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
        heading: ["Outfit", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
