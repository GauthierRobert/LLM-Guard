/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        ink: {
          900: '#0e0f11',
          800: '#14151a',
          700: '#1e1f23',
          600: '#2a2b30',
          500: '#3f3e3a',
          400: '#5f5e5a',
          300: '#888780',
          200: '#b8b7ae',
          100: '#d1d0c7',
          50:  '#e1f5ee',
        },
        brand: {
          900: '#085041',
          700: '#0F6E56',
          500: '#5DCAA5',
          300: '#9fe1cb',
        },
        danger: {
          900: '#3a0e0e',
          800: '#501313',
          700: '#7a2b2b',
          500: '#E24B4A',
          300: '#F09595',
          100: '#F4D4D4',
        },
        warn: {
          900: '#412402',
          700: '#5a3302',
          500: '#EF9F27',
          300: '#FAC775',
        },
        info: {
          900: '#042C53',
          500: '#85B7EB',
        },
        ai: {
          900: '#2a1b42',
          500: '#c4a6ff',
        },
        high: {
          900: '#4A1B0C',
          300: '#F0997B',
        },
        clean: {
          900: '#2a3b34',
        },
      },
    },
  },
  plugins: [],
};
