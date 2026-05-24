const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/me', requireAuth, async (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Authenticated user fetched successfully',
    data: {
      id: req.user.id,
      email: req.user.email,
      user_metadata: req.user.user_metadata
    }
  });
});

module.exports = router;