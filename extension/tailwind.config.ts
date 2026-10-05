import type { Config } from 'tailwindcss';

export default {
  content: ['./entrypoints/**/*.{ts,tsx,html}', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        privacy: {
          local: '#16a34a',
          remote: '#2563eb',
          mixed: '#9333ea',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
