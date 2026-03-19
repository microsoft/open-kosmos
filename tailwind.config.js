/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: false,
  content: [
    './src/renderer/**/*.{ts,tsx}',
    './src/renderer/index.html',
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        // Light Mode color scheme
        glass: {
          white: "rgba(255, 255, 255, 0.8)",
          light: "rgba(255, 255, 255, 0.6)",
          medium: "rgba(255, 255, 255, 0.4)",
          subtle: "rgba(255, 255, 255, 0.2)",
        },
        primary: {
          50: "#f0f9ff",
          100: "#e0f2fe", 
          200: "#bae6fd",
          300: "#7dd3fc",
          400: "#38bdf8",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
          800: "#075985",
          900: "#0c4a6e",
        },
        neutral: {
          50: "#fafafa",
          100: "#f5f5f5",
          200: "#e5e5e5",
          300: "#d4d4d4",
          400: "#a3a3a3",
          500: "#737373",
          600: "#525252",
          700: "#404040",
          800: "#262626",
          900: "#171717",
        },
        surface: {
          primary: "rgba(250, 250, 250, 0.9)",
          secondary: "rgba(245, 245, 245, 0.8)",
          accent: "rgba(240, 249, 255, 0.9)",
        },
      },
      backdropBlur: {
        xs: "2px",
        sm: "4px",
        DEFAULT: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px",
        "2xl": "40px",
        "3xl": "64px",
      },
      borderRadius: {
        none: "0",
        sm: "2px",
        DEFAULT: "4px", 
        md: "6px",
        lg: "8px",
        xl: "12px",
      },
      animation: {
        "fadeIn": "fadeIn 0.3s ease-out",
        "slideIn": "slideIn 0.2s ease-out",
        "glass-shine": "glass-shine 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        slideIn: {
          from: { opacity: "0", transform: "translateX(20px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "glass-shine": {
          "0%, 100%": { transform: "translateX(-100%)" },
          "50%": { transform: "translateX(100%)" },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
