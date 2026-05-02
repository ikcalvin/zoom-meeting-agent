FROM node:20-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx -y mastra@1.7.3 build
RUN npm prune --omit=dev

FROM node:20-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV TELEGRAM_WEBHOOK_PORT=8081

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.mastra/output ./.mastra/output

EXPOSE 8080
EXPOSE 8081

CMD ["node", "./.mastra/output/index.mjs"]
