/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // --- Backwards-compatible base tokens (used across existing pages) ---
        primary: '#080808', // app background (near-black)
        secondary: '#1A1A1A', // legacy raised panel
        'input-bg': '#141414',

        // --- Accent (indigo) ---
        accent: {
          DEFAULT: '#6366F1',
          hover: '#4F46E5',
          soft: '#818CF8',
          muted: 'rgba(99, 102, 241, 0.12)',
        },

        // --- Semantic surfaces (raised above `primary`) ---
        surface: {
          DEFAULT: '#101013', // card
          raised: '#17171B', // raised card / header
          overlay: '#1D1D23', // modal / popover
        },

        // --- Borders / hairlines ---
        border: {
          DEFAULT: 'rgba(255, 255, 255, 0.08)',
          strong: 'rgba(255, 255, 255, 0.16)',
        },

        // --- Muted text ---
        muted: {
          DEFAULT: '#9CA3AF',
          foreground: '#6B7280',
        },

        // --- Status ---
        success: { DEFAULT: '#22C55E', muted: 'rgba(34, 197, 94, 0.14)' },
        warning: { DEFAULT: '#F59E0B', muted: 'rgba(245, 158, 11, 0.14)' },
        danger: { DEFAULT: '#EF4444', muted: 'rgba(239, 68, 68, 0.14)' },
        info: { DEFAULT: '#38BDF8', muted: 'rgba(56, 189, 248, 0.14)' },
      },
      fontFamily: {
        montserrat: ['Montserrat', 'sans-serif'],
        inter: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 12px 32px -16px rgba(0,0,0,0.7)',
        glow: '0 0 0 1px rgba(99,102,241,0.4), 0 10px 40px -12px rgba(99,102,241,0.45)',
        focus: '0 0 0 3px rgba(99,102,241,0.35)',
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.85)', opacity: '0.6' },
          '100%': { transform: 'scale(1.7)', opacity: '0' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.5s infinite',
        'fade-in': 'fade-in 0.3s ease-out both',
        'fade-in-up': 'fade-in-up 0.4s ease-out both',
        'pulse-ring': 'pulse-ring 1.6s ease-out infinite',
        'scale-in': 'scale-in 0.2s ease-out both',
      },
    },
  },
  plugins: [],
};
