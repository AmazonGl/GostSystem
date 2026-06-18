/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['IBM Plex Sans', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      colors: {
        bg:      '#0d0f14',
        surface: '#13161e',
        card:    '#1a1d27',
        border:  '#252836',
        muted:   '#3a3d4f',
        text:    '#e2e4f0',
        dim:     '#7b7f96',
        accent:  '#f0b429',
        'accent-hover': '#e0a820',
        danger:  '#f05252',
        success: '#34d399',
        info:    '#60a5fa',
      },
      borderRadius: { DEFAULT: '6px' },
    },
  },
  plugins: [],
}
