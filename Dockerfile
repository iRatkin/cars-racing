FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=prod

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY swagger.yaml ./swagger.yaml
COPY public ./public

CMD ["sh", "-c", "echo \"ENV CHECK: BOT_TOKEN=${BOT_TOKEN:+SET} MONGO_URI=${MONGO_URI:+SET} JWT_SECRET=${JWT_SECRET:+SET}\" && node dist/src/server.js"]
