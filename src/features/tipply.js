const { EmbedBuilder } = require('discord.js');
const puppeteer = require('puppeteer');
const { config } = require('../config');
const { saveTipToWordpress } = require('../tipplyWordpress');

const NAVIGATION_ATTEMPTS = 2;
const NAVIGATION_TIMEOUT_MS = 60 * 1000;

function extractBalancedJson(text, openingIndex) {
  const opening = text[openingIndex];
  const closing = opening === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = openingIndex; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === opening) {
      depth += 1;
    } else if (character === closing) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(openingIndex, index + 1);
      }
    }
  }

  return null;
}

function parseTipplyPayload(payload) {
  if (typeof payload !== 'string' || !payload.includes('"alert"')) {
    return null;
  }

  // Tipply zwykle wysyla zdarzenie Socket.IO w formacie:
  // 42["alert", { ...dane wplaty... }].
  const arrayIndex = payload.indexOf('[');
  if (arrayIndex >= 0) {
    const json = extractBalancedJson(payload, arrayIndex);
    if (json) {
      try {
        const event = JSON.parse(json);
        if (Array.isArray(event) && event[0] === 'alert' && event[1]) {
          return event[1];
        }
      } catch {
        // Nie kazda ramka z nawiasem kwadratowym jest zdarzeniem Socket.IO.
      }
    }
  }

  // Zgodnosc ze starszym formatem ramek uzywanym przez poprzednia wersje.
  const objectIndex = payload.indexOf('{');
  if (objectIndex < 0) return null;

  const json = extractBalancedJson(payload, objectIndex);
  if (!json) return null;

  try {
    const event = JSON.parse(json);
    if (event.alert && typeof event.alert === 'object') return event.alert;
    return event;
  } catch {
    return null;
  }
}

function textOrFallback(value, fallback, maxLength) {
  const text = String(value ?? '').trim() || fallback;
  return text.slice(0, maxLength);
}

async function publishTip(client, tip) {
  const amountInCents = Number(tip.amount);
  if (!Number.isFinite(amountInCents)) {
    console.warn('[tipply] Pomijam zdarzenie bez poprawnej kwoty.');
    return;
  }

  const amountValue = amountInCents / 100;
  const amount = amountValue.toLocaleString('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const nickname = textOrFallback(tip.nickname, 'Anonim', 1024);
  const message = textOrFallback(tip.message, 'Brak wiadomości', 1024);

  let color = '#2ecc71';
  if (amountValue >= 100) color = '#f1c40f';
  else if (amountValue >= 50) color = '#9b59b6';
  else if (amountValue >= 10) color = '#3498db';

  const channel = await client.channels.fetch(config.tipply.channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Nie znaleziono tekstowego kanalu ${config.tipply.channelId}.`);
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('💰 Nowa wpłata!')
    .addFields(
      { name: '👤 Wspierający', value: nickname, inline: true },
      { name: '💵 Kwota', value: `${amount} PLN`, inline: true },
      { name: '💬 Wiadomość', value: message }
    )
    .setFooter({
      text: 'Ty też możesz zostać naszym sponsorem! | tipply.pl/@polishpubglegion'
    })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  console.log(`[tipply] Opublikowano wpłatę ${amount} PLN od ${nickname}.`);

  if (!config.wordpress.tipEndpoint) return;

  try {
    await saveTipToWordpress({
      nickname,
      amount: amountValue,
      message: tip.message || '',
      externalId: tip.id || tip.paymentId || tip.payment_id || tip.transactionId || '',
      donatedAt: tip.createdAt || tip.created_at || tip.date || ''
    });
  } catch (error) {
    console.warn(`[tipply] Nie udalo sie zapisac wplaty w WordPress: ${error.message}`);
  }
}

async function openWidget(page) {
  for (let attempt = 1; attempt <= NAVIGATION_ATTEMPTS; attempt += 1) {
    try {
      await page.goto(config.tipply.widgetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS
      });
      console.log('[tipply] Widget zaladowany.');
      return;
    } catch (error) {
      if (attempt === NAVIGATION_ATTEMPTS) throw error;
      console.warn(`[tipply] Nie udalo sie zaladowac widgetu (proba ${attempt}), ponawiam.`);
    }
  }
}

async function startTipplyListener(client) {
  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote'
    ],
    timeout: NAVIGATION_TIMEOUT_MS
  };

  if (config.tipply.browserExecutablePath) {
    launchOptions.executablePath = config.tipply.browserExecutablePath;
  }

  const browser = await puppeteer.launch(launchOptions);
  browser.on('disconnected', () => {
    console.warn('[tipply] Przegladarka zostala rozlaczona. Zrestartuj bota, aby wznowic nasluch.');
  });

  try {
    const page = await browser.newPage();
    await openWidget(page);

    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    cdp.on('Network.webSocketFrameReceived', ({ response }) => {
      const tip = parseTipplyPayload(response.payloadData);
      if (!tip) return;

      publishTip(client, tip).catch(error => {
        console.error('[tipply] Blad obslugi wplaty:', error);
      });
    });

    console.log('[tipply] Listener uruchomiony.');
    return browser;
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

function setupTipply(client) {
  if (!config.tipply.widgetUrl) {
    console.warn('[tipply] Pomijam integracje: brak TIPPLY_WIDGET_URL w ENV.');
    return;
  }

  if (!config.tipply.channelId) {
    console.warn('[tipply] Pomijam integracje: brak TIPPLY_CHANNEL_ID w ENV.');
    return;
  }

  client.once('clientReady', () => {
    startTipplyListener(client).catch(error => {
      console.error('[tipply] Nie udalo sie uruchomic listenera:', error);
    });
  });
}

module.exports = {
  setupTipply,
  parseTipplyPayload
};
