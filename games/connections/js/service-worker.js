self.addEventListener('install', function(event) {
    // Perform install steps
    console.log('Service Worker installing.');
});

self.addEventListener('fetch', function(event) {
    event.respondWith(
        caches.match(event.request).then(function(response) {
            return response || fetch(event.request);
        })
    );
});