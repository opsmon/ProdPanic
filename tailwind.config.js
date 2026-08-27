import forms from '@tailwindcss/forms';
import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        panel: '#101418',
        panelSoft: '#151b20',
        line: '#2a343d',
        signal: '#f8c95a',
        ok: '#6ee7a8',
        danger: '#ff6b6b',
        ink: '#edf3f7'
      },
      fontFamily: {
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: [forms, typography]
};
