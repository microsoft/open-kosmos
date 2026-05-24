module.exports = function(api) {
  // Use api.env() which respects BABEL_ENV, then NODE_ENV
  const isDevelopment = api.env('development');

  return {
    presets: [
      '@babel/preset-react',
      '@babel/preset-typescript',
    ],
    plugins: [
      isDevelopment && 'react-refresh/babel',
    ].filter(Boolean),
  };
};
