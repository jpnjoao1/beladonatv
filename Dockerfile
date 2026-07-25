FROM node:20-slim

WORKDIR /app

# Instala dependencias (apenas producao)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Codigo
COPY server.js ./
COPY lib ./lib
COPY public ./public

# Videos e db.json ficam no volume persistente montado em /data
ENV DATA_DIR=/data
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
