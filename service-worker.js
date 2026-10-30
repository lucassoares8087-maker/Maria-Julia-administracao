const CACHE_NAME = 'mj-admin-shell-push-v2';
const APP_SHELL = ['./admin.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './marca-dagua-cartoon.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL).catch(err => { console.warn('Não foi possível armazenar todos os arquivos offline:', err); }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('mj-admin-shell-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// O endpoint do Netlify envia mensagens somente com dados. Este evento cria
// a notificação do Android quando o painel está em segundo plano ou fechado.
self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    try { data = { body: event.data ? event.data.text() : '' }; } catch (_) {}
  }
  const payload = data.data || data;
  const title = payload.title || 'Novo pedido! 💗';
  const options = {
    body: payload.body || 'Você recebeu um novo pedido no cardápio.',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: payload.orderId ? `mj-pedido-${payload.orderId}` : 'mj-novo-pedido',
    renotify: true,
    data: { url: payload.url || '/admin.html?tab=pedidos' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || '/admin.html?tab=pedidos', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(destination);
        return client.focus();
      }
    }
    return self.clients.openWindow(destination);
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/admin.html') || url.pathname.endsWith('/manifest.json') || url.pathname.includes('/icons/') || url.pathname.endsWith('/marca-dagua-cartoon.png')) {
    event.respondWith(fetch(event.request).then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request)));
  }
});
