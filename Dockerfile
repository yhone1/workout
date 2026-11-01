FROM node:20-alpine

WORKDIR /app

COPY server/package*.json ./
RUN npm install --omit=dev

COPY server/ ./server/
COPY index.html media-config.js gif-links.js ./public/
COPY home-access.js home-sync.js ./public/
COPY portal ./public/portal
COPY member ./public/member
COPY gym ./public/gym
COPY IMG ./public/IMG
COPY VIDEO ./public/VIDEO

EXPOSE 3000
CMD ["node", "server/server.js"]
