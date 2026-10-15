'use strict';
// F.14 - in-app notification inbox.
const express = require('express');
const { authenticate } = require('../middleware/auth');
const notifications = require('../services/notifications');
const push = require('../services/push');
const v = require('../utils/validate');
const { audit } = require('../db');

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

/**
 * The app registers its Expo push token here after the person grants
 * permission, and again on every sign-in: a token can rotate, and it has to
 * follow whoever is actually signed in on that handset.
 */
router.post('/push-token', (req, res) => {
  const push_token = String(v.required(req.body.push_token, 'push_token')).trim();
  // Expo's own tokens have a fixed shape. Rejecting anything else keeps a
  // typo or a stray FCM key out of the table, where it would fail on every
  // send forever.
  if (!/^Expo(nent)?PushToken\[[^\]]+\]$/.test(push_token)) {
    return res.status(400).json({ error: 'That is not an Expo push token', field: 'push_token' });
  }

  push.register(req.user.user_id, {
    push_token,
    platform: req.body.platform ? String(req.body.platform).slice(0, 20) : null,
    device_name: req.body.device_name ? String(req.body.device_name).slice(0, 80) : null,
  });

  res.json({ message: 'This device will receive alerts', devices: push.tokensFor(req.user.user_id).length });
});

/** Sign-out, or the person turning alerts off for this handset. */
router.delete('/push-token', (req, res) => {
  const push_token = String(v.required(req.body.push_token, 'push_token')).trim();
  push.forget(push_token);
  res.json({ message: 'This device will no longer receive alerts' });
});

/**
 * Sends a test alert to the caller's own devices, so a driver can satisfy
 * themselves that offers will actually reach them before they go on duty -
 * and so the problem is found then rather than during an emergency.
 */
router.post('/push-test', async (req, res) => {
  const devices = push.tokensFor(req.user.user_id).length;
  if (devices === 0) {
    return res.status(409).json({ error: 'No device is registered for alerts on this account' });
  }
  await push.send(req.user.user_id, {
    title: 'Alerts are working',
    body: 'This is what a dispatch offer will look like.',
    priority: 'high',
    data: { type: 'TEST' },
  });
  audit('PUSH_TEST', { actorUserId: req.user.user_id, actorRole: req.user.role_code, details: { devices } });
  res.json({ message: `Test alert sent to ${devices} device${devices === 1 ? '' : 's'}`, devices });
});

module.exports = router;
