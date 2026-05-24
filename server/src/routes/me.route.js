const express = require('express');
const { requireAuth } = require('../middleware/auth');
const sendResponse = require('../utils/sendResponse');

const router = express.Router();

router.get('/me', requireAuth, async(req, res) => {
    return sendResponse(res, 200, 'Authenticated user fetched successfully', {
        id: req.user.id,
        email: req.user.email,
        user_metadata: req.user.user_metadata
    });
});

module.exports = router;