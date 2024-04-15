FROM node:21-bookworm AS base

# ------------------------------------------------------------------------------

FROM base AS dependencies

WORKDIR /deps/dev
COPY package.json ./
RUN npm install

WORKDIR /deps/prod
COPY package.json ./
RUN npm install --prod

# ------------------------------------------------------------------------------

FROM base AS build

WORKDIR /app
COPY . .
COPY --from=dependencies /deps/dev/node_modules ./node_modules

RUN npm run build

# ------------------------------------------------------------------------------

FROM node:21-alpine AS prod

WORKDIR /app

COPY --from=build /app/build ./build
COPY --from=dependencies /deps/prod/node_modules ./node_modules

ENV NODE_ENV=production
ENTRYPOINT ["node", "./build/src/index.js"]