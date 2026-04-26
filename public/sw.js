// Service Worker for Training Hub Push Notifications
// This runs independently of the main app and can receive push events even when app is backgrounded

self.addEventListener('push', function(event) {
  let data = { title: 'Training Hub', body: 'Rest timer alert' };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || 'Rest timer alert',
    icon: '/logo192.png',
    badge: '/logo192.png',
    tag: data.tag || 'rest-timer',
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 300],
    data: { url: self.location.origin }
  };

  // Only show banner notification if no app window is currently focused
  // When app is in foreground, the in-app timer UI handles everything
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      const appFocused = clientList.some(function(client) {
        return client.url.includes(self.location.origin) && client.visibilityState === 'visible';
      });
      if (!appFocused) {
        return self.registration.showNotification(data.title || 'Training Hub', options);
      }
      // App is in foreground — skip the banner, in-app sounds handle it
    })
  );
});

// When user taps the notification, focus or open the app
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // If app is already open, focus it
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open it
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

// Activate immediately
self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});
