# Small Node image with Express and ws installed from package-lock.json.
FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js espn.js ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=8080
# Everything is saved here. Attach a volume at /app/data to keep it through redeploys.
RUN mkdir -p /app/data

EXPOSE 8080
CMD ["node", "server.js"]
