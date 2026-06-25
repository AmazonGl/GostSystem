/** @type {import('tailwindcss').Config} */
function withAlpha(varName) {
  return ({ opacityValue }) =>
    opacityValue === undefined
      ? `rgb(var(${varName}))`
      : `rgb(var(${varName}) / ${opacityValue})`
}

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['IBM Plex Sans', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      colors: {
        bg:      withAlpha('--c-bg'),
        surface: withAlpha('--c-surface'),
        card:    withAlpha('--c-card'),
        border:  withAlpha('--c-border'),
        muted:   withAlpha('--c-muted'),
        text:    withAlpha('--c-text'),
        dim:     withAlpha('--c-dim'),
        accent:  withAlpha('--c-accent'),
        'accent-hover': withAlpha('--c-accent-hover'),
        danger:  withAlpha('--c-danger'),
        success: withAlpha('--c-success'),
        info:    withAlpha('--c-info'),
      },
      borderRadius: { DEFAULT: '6px' },
    },
  },
  plugins: [],
}
