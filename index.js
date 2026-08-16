// Vercel serverless entry point. Vercel invokes this per request; we hand the
// request straight to the Express app defined in ../server.js.
module.exports = require('../server.js');
