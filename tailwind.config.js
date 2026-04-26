/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx}', './public/index.html'],
  theme: {
    extend: {
      colors: {
        app: {
          bg:        '#0d0d0d',
          sidebar:   '#141414',
          surface:   '#1c1c1c',
          border:    '#2a2a2a',
          user:      '#1a3352',
          assistant: '#1c1c1c',
          code:      '#0a0a0a',
          accent:    '#3b82f6',
          'accent-hover': '#2563eb',
          text:      '#e2e8f0',
          muted:     '#64748b',
          danger:    '#ef4444',
          success:   '#22c55e',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-dot': 'pulse 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
