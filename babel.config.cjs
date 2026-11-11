// Babel config for Jest (transforms ES modules to CommonJS for the test run
// only; the app itself ships as native ES modules via Vite, untouched).
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }]
  ]
};
