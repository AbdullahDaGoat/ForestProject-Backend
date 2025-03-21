import express, { Request, Response } from 'express';
import * as webpush from 'web-push';
import { addSubscription, getSubscriptions } from '../lib/pushSubscriptions';

const router = {
  saveSubscription: express.Router(),
  triggerNotification: express.Router()
};

// Configure your VAPID keys
// In production, place them in environment variables or a secure location
const VAPID_PUBLIC_KEY = 'BMIlphB5UNplAcbs-4nVB9eHiIyawSQbd65fu8jm52PN4K5D_VYOhbwjcHDoCfXc02zl8xSYB0Rto8_zc6r3Qcs';
const VAPID_PRIVATE_KEY = 'nHsNJydV8QDe8QGAJt3snIsInFYj08sf9saZ5hBCGaA';

webpush.setVapidDetails(
  'mailto:abdullahaviator13@gmail.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// POST /save-subscription
router.saveSubscription.post('/', async (req: Request, res: Response) => {
  try {
    const sub = req.body as webpush.PushSubscription;
    addSubscription(sub);
    console.log('Subscription saved:', sub);
    return res.status(201).json({ message: 'Subscription saved successfully.' });
  } catch (err) {
    console.error('Failed to save subscription:', err);
    return res.status(500).json({ error: 'Failed to save subscription' });
  }
});

// POST /trigger-notification
router.triggerNotification.post('/', async (req: Request, res: Response) => {
  try {
    const { title, body, data } = req.body;
    const payload = JSON.stringify({ title, body, data });

    const subs = getSubscriptions();
    const sendPromises = subs.map((sub) =>
      webpush
        .sendNotification(sub, payload)
        .catch((err) => console.error('Error sending notification:', err))
    );

    await Promise.all(sendPromises);
    return res.json({ message: 'Notifications sent.' });
  } catch (error) {
    console.error('Error triggering notification:', error);
    return res.status(500).json({ error: 'Failed to send notifications' });
  }
});

export default router;
