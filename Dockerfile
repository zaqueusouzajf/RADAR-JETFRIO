# =================================================================================================
# FASE 1: Instalação de dependências (otimizada para cache)
# Usamos a imagem oficial do Node.js v20 (versão slim para um tamanho menor).
# =================================================================================================
FROM node:20-slim AS deps

# Define o diretório de trabalho dentro do contêiner.
WORKDIR /app

# Cria um diretório de cache para o Puppeteer e define o usuário 'node' como proprietário.
RUN mkdir -p /app/.cache/puppeteer && chown -R node:node /app

# Define o usuário 'node' (não-root) para a instalação das dependências, por segurança.
USER node
# Copia apenas os arquivos de manifesto de pacote.
COPY --chown=node:node package.json ./
# Instala as dependências de produção usando 'npm install' pois não há 'package-lock.json'.
RUN npm install --only=production

# =================================================================================================
# FASE 2: Build da aplicação final
# Esta fase prepara a imagem que será executada no Render.
# =================================================================================================
FROM node:20-slim AS runner

# Define a variável de ambiente para produção.
ENV NODE_ENV=production
WORKDIR /app

# Atualiza os pacotes e instala o Chromium com TODAS as suas dependências necessárias.
RUN apt-get update && apt-get install -y --no-install-recommends \
  chromium \
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
  # Limpa o cache do apt para reduzir o tamanho da imagem final.
  rm -rf /var/lib/apt/lists/*

# Copia as dependências já instaladas da fase 'deps'.
COPY --from=deps /app/node_modules ./node_modules
# Copia todo o código da aplicação (incluindo index.js).
COPY . .

# Define o caminho do executável do Chromium para o Puppeteer.
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Muda o proprietário dos arquivos para o usuário 'node' por segurança.
USER root
RUN chown -R node:node /app
# Volta para o usuário 'node' para executar a aplicação.
USER node

# Expõe a porta que o Render usará para se conectar à sua aplicação.
EXPOSE 10000

# Comando final para iniciar a aplicação.
CMD ["node", "index.js"]
