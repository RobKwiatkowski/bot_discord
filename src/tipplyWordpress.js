const axios = require('axios');
const { config } = require('./config');

async function saveTipToWordpress({
  nickname,
  amount,
  message = '',
  externalId = '',
  donatedAt = ''
}) {
  if (!config.wordpress.tipEndpoint) {
    return { saved: false, reason: 'missing_endpoint' };
  }

  const headers = config.wordpress.tipToken
    ? { Authorization: `Bearer ${config.wordpress.tipToken}` }
    : {};

  const response = await axios.post(
    config.wordpress.tipEndpoint,
    {
      nickname,
      amount,
      message,
      external_id: externalId,
      donated_at: donatedAt
    },
    {
      headers,
      timeout: 10 * 1000
    }
  );

  return {
    saved: true,
    status: response.status,
    data: response.data
  };
}

module.exports = { saveTipToWordpress };

