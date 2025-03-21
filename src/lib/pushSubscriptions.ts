import * as webpush from 'web-push';

// In-memory array of push subscriptions
const subscriptions: webpush.PushSubscription[] = [];

// Provide functions to access or modify this array
export function getSubscriptions(): webpush.PushSubscription[] {
  return subscriptions;
}

export function addSubscription(sub: webpush.PushSubscription) {
  // Optional: check if subscription already exists
  // For demonstration, simply push it
  subscriptions.push(sub);
}
