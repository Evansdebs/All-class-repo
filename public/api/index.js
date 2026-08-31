'use strict';

const requestHandler = require('../server');

module.exports = async (req, res) => {
    try {
        await requestHandler(req, res);
    } catch (err) {
        console.error('Serverless function error:', err);
        if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Serverless invocation error', details: err.message }));
        }
    }
};

