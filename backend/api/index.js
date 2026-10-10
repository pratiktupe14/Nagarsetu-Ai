const app = require('../src/app');
const { initDatabase } = require('../src/config/db');

let dbInitPromise = null;

module.exports = async (req, res) => {
  try {
    if (!dbInitPromise && typeof initDatabase === 'function') {
      dbInitPromise = initDatabase().catch(err => {
        console.warn('[SERVERLESS DB INIT NOTE]', err.message);
      });
    }
    if (dbInitPromise) {
      await dbInitPromise;
    }
    return app(req, res);
  } catch (err) {
    console.error('[SERVERLESS HANDLER ERROR]', err);
    return res.status(500).json({
      success: false,
      error: 'Serverless Function Error: ' + err.message
    });
  }
};
