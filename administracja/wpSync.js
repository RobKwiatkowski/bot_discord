// Synchronizes the local administration list with WordPress.
const { loadData } = require('./adminStore');
const { config } = require('../src/config');

async function syncAdministrationToWP() {
  const data = loadData();
  const res = await fetch(config.wordpress.administrationEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  const text = await res.text();
  let json = {};

  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }

  if (!res.ok) {
    throw new Error(`WP administration error: ${JSON.stringify(json)}`);
  }

  return json;
}

module.exports = {
  syncAdministrationToWP
};
