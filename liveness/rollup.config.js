import terser from '@rollup/plugin-terser'; 

export default {
  input: "src/index.js",
  output: {
    file: "dist/liveness.min.js",
    format: "es",
    name: "Liveness",
    sourcemap: true,
    exports: 'default'
  },
  plugins: [terser()],
};