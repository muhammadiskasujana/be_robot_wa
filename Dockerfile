FROM node:20-slim

# Install dependencies untuk library WA/Puppeteer jika diperlukan
RUN apt-get update && apt-get install -y \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgbm1 libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Optimasi Cache: Copy package.json dulu
COPY package*.json ./
RUN npm install

# Copy seluruh source code
COPY . .

# Default command (akan di-override oleh Coolify)
CMD ["node", "src/server.js"]