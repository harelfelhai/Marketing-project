/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      keyframes: {
        // Amber pulse for client cards with failed actions — no external lib needed.
        pulseAmber: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        // Drawer slide-in from right — pure CSS, no tailwindcss-animate.
        drawerSlideIn: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        drawerSlideOut: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'pulse-amber': 'pulseAmber 1.5s ease-in-out infinite',
        'drawer-in': 'drawerSlideIn 0.3s ease-out forwards',
        'drawer-out': 'drawerSlideOut 0.3s ease-in forwards',
      },
    },
  },
  plugins: [],
};
