FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Gunakan variable START_FILE, defaultnya ke server.js
ENV START_FILE=src/server.js
CMD node ${START_FILE}