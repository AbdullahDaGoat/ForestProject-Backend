import express, { Request, Response } from 'express';
import * as webpush from 'web-push';
import { addSubscription, getSubscriptions } from '../lib/pushSubscriptions';

const router = {
  saveSubscription: express.Router(),
  triggerNotification: express.Router()
};

// Read VAPID keys from environment variables
const VAPID_PUBLIC_KEY = 'BFvwfwSPtFBlC6QOB8h2RcapVKbn0PL3Yxj4J96pQIwkWu4fWTjgqv1eJ9N8lfk4sMPVKZkt19BCI49kMuQcpns';
const VAPID_PRIVATE_KEY = 'rL-l2arV293DEb_l99_23OugcAhaY4wVwwAafBnFM2w';

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('VAPID keys are not defined! Please set them in your environment variables.');
  process.exit(1);
}

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
    // Destructure the fields from the request body.
    const {
      title,
      body,
      data,
      icon,
      badge,
      tag,
      requireInteraction,
      vibrate,
      actions,
      image,
      silent,
      timestamp,
      color
    } = req.body;

    // Build the enhanced payload
    const payload = JSON.stringify({
      title: title || 'Environmental Alert',
      body: body || 'New environmental alert detected!',
      icon: icon || '/icons/icon-192x192.png',
      badge: badge || '/icons/badge-72x72.png',
      tag: tag || 'environmental-alert',
      requireInteraction: requireInteraction !== undefined ? requireInteraction : true,
      vibrate: vibrate || [100, 50, 100, 50, 100, 50, 200],
      actions: actions || [
        { action: 'view', title: 'View Details', icon: '/icons/view-icon.png' },
        { action: 'dismiss', title: 'Dismiss', icon: '/icons/dismiss-icon.png' }
      ],
      // Enhanced properties for more beautiful notifications
      image: image || '/images/alert-banner.jpg', // Large banner image
      silent: silent || false,
      timestamp: timestamp || Date.now(),
      color: color || '#E53935', // Brand color for the notification
      data: data || { 
        url: '/',
        importance: 'high',
        category: 'environmental',
        // You can include styling data here if your service worker uses it
        style: {
          type: 'banner',
          backgroundColor: '#E53935',
          textColor: '#FFFFFF',
          borderRadius: '8px'
        }
      }
    });

    const subs = getSubscriptions();
    const sendPromises = subs.map((sub) =>
      webpush.sendNotification(sub, payload)
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