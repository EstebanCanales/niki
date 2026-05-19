import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

const config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        "card-foreground": "hsl(var(--card-foreground))",
        popover: "hsl(var(--popover))",
        "popover-foreground": "hsl(var(--popover-foreground))",
        primary: "hsl(var(--primary))",
        "primary-foreground": "hsl(var(--primary-foreground))",
        secondary: "hsl(var(--secondary))",
        "secondary-foreground": "hsl(var(--secondary-foreground))",
        muted: "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        accent: "hsl(var(--accent))",
        "accent-foreground": "hsl(var(--accent-foreground))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        danger: "hsl(var(--danger))",
        "panel-solid": "hsl(var(--panel-solid))",
        "panel-glass": "hsl(var(--panel-glass))",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "sans-serif"],
        display: ["var(--font-inter)", "sans-serif"],
      },
      backgroundImage: {
        "hero-radial":
          "radial-gradient(circle at top, rgba(0, 200, 255, 0.12), transparent 34%), radial-gradient(circle at 70% 20%, rgba(0, 140, 200, 0.08), transparent 26%), linear-gradient(180deg, rgba(6, 9, 14, 0.9), rgba(4, 6, 10, 0.98))",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(0, 200, 255, 0.14), 0 18px 60px rgba(0, 80, 120, 0.24)",
        panel: "0 22px 80px rgba(3, 3, 7, 0.46)",
      },
      borderRadius: {
        xl: "1.25rem",
        "2xl": "1.75rem",
        "3xl": "2rem",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-8px)" },
        },
        pulseHalo: {
          "0%": { transform: "scale(0.94)", opacity: "0.48" },
          "50%": { transform: "scale(1.02)", opacity: "0.72" },
          "100%": { transform: "scale(0.94)", opacity: "0.48" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        float: "float 7s ease-in-out infinite",
        halo: "pulseHalo 5s ease-in-out infinite",
        shimmer: "shimmer 6s linear infinite",
      },
    },
  },
  plugins: [animate, typography],
} satisfies Config;

export default config;
