// connections.trailmatt.com moved under the playbook, so send everything to the new home.
function handler(event) {
    return {
        statusCode: 301,
        statusDescription: 'Moved Permanently',
        headers: {
            'location': { value: 'https://playbook.trailmatt.com/connections' },
            'cache-control': { value: 'max-age=3600' }
        }
    };
}
