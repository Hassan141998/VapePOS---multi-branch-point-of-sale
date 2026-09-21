/** Design tokens for VapePOS. See docs/TOOLS_GUIDE.md ("Tailwind CSS") for how they are used. */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#17212B', soft: '#3A4753', muted: '#66737E' },
        paper: '#F2F4F3',
        line: '#DCE2DF',
        currant: { 50: '#F1EDF8', 100: '#E3DBF1', 500: '#5B3D9F', 600: '#46307E', 700: '#382566' },
        mint: { 100: '#DDF6EC', 400: '#59D4A9', 600: '#1E9E78' },
        amber: { 100: '#FBF0D9', 700: '#93520A' },
        brick: { 100: '#FBE6E3', 600: '#B3261E' },
        moss: { 100: '#DDF1E6', 700: '#1B6B4A' },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque Variable"', 'system-ui', 'sans-serif'],
        body: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
      },
      borderRadius: { panel: '10px', ctl: '8px' },
    },
  },
  plugins: [],
}
