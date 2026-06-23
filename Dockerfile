# Obraz pod Raspberry Pi / Linux. Chromium jest instalowany systemowo,
# zeby Puppeteer nie sciagal wlasnej przegladarki podczas npm ci.
FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    ffmpeg \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    python3 \
    make \
    g++ \
    pkg-config \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
  && node -e "for (const p of ['@discordjs/voice','@noble/ciphers','axios','canvas','discord.js','dotenv','googleapis','node-cron','node-fetch','opusscript','puppeteer','spotify-url-info','xml2js','youtube-dl-exec']) require.resolve(p); console.log('dependencies ok')"

COPY . .
RUN npm run check

CMD ["npm", "start"]
