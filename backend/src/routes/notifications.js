'use strict';
// F.14 - in-app notification inbox.
const express = require('express');
const { authenticate } = require('../middleware/auth');
const notifications = require('../services/notifications');

const router = express.Router();

router.use(authenticate);

router.get('/', (req, res) => {
  res.json({
    notifications: notifications.list(req.user.user_id, Math.min(Number(req.query.limit) || 50, 200)),
    unread: notifications.unreadCount(req.user.user_id),
  });
});

router.post('/read', (req, res) => {
  notifications.markRead(req.user.user_id, req.body.ids);
  res.json({ message: 'Marked as read', unread: notifications.unreadCount(req.user.user_id) });
});

module.exports = router;
