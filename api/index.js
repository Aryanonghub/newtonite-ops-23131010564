// Vercel Function: the whole API. It loads the compiled Express app, which the build step
// (`npm run build --prefix server` in vercel.json) puts in server/dist.
module.exports = require('../server/dist/vercel.js').default;
