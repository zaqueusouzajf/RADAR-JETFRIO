# =================================================================================================
# FASE 1: Instalação de dependências (otimizada para cache)
FROM node:20-slim AS deps

WORKDIR /app
RUN mkdir -p /app/.cache/puppeteer && chown -R node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --only=production

# =================================================================================================
# FASE 2: Build da aplicação final
FROM node:20-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libgcc1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  lsb-release \
  wget \
  xdg-utils && \
  rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

USER root
RUN chown -R node:node /app
USER node

EXPOSE 10000

CMD ["node", "index.js"]
