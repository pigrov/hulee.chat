# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim

ARG HULEE_BUILD_REVISION=development
ARG HULEE_SCHEMA_EPOCH=preproduction-inbox-v2-1

LABEL org.opencontainers.image.revision=$HULEE_BUILD_REVISION
LABEL io.hulee.schema-epoch=$HULEE_SCHEMA_EPOCH

ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HULEE_BUILD_REVISION=$HULEE_BUILD_REVISION
ENV HULEE_SCHEMA_EPOCH=$HULEE_SCHEMA_EPOCH

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @hulee/web build
RUN pnpm --filter @hulee/site build

EXPOSE 3000

CMD ["pnpm", "--filter", "@hulee/web", "start"]
