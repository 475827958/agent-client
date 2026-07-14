/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/src/**/*.{ts,tsx}', './src/renderer/index.html'],
  theme: {
    extend: {
      colors: {
        sidebar: {
          bg: '#1e1e2e',
          hover: '#2a2a3e',
          active: '#363650',
          border: '#2e2e42'
        },
        chat: {
          bg: '#181825',
          bubble: {
            user: '#3b3b5c',
            assistant: '#1e1e2e'
          }
        },
        accent: {
          DEFAULT: '#7c7cf8',
          hover: '#6a6ae8'
        }
      }
    }
  },
  plugins: []
}
