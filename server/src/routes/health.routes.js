const express = require('express');
const sendResponse = require('../utils/sendResponse');

const router = express.Router();

router.get('/health', (req, res) => {
    return sendResponse(res, 200, 'Backend is healthy', {
        service: 'editor-flow-backend',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;