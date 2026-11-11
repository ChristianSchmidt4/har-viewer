// Babel config for Jest (transforms ES modules/TypeScript to CommonJS for
// the test run only; the app itself ships as native ES modules/TS via Vite,
// untouched by Babel - types are only stripped, never checked, here).
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-typescript'
  ]
};
