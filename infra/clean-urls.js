// Turns /connections into /connections/index.html so the URLs don't need to end in .html.
// Only attached to S3, so the board API paths never reach it.
function handler(event) {
    var request = event.request;
    var uri = request.uri;

    if (uri.endsWith('/')) {
        request.uri = uri + 'index.html';
    } else if (uri.indexOf('.') === -1) {
        request.uri = uri + '/index.html';
    }

    return request;
}
