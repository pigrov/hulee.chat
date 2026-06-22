# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @hulee/web build

EXPOSE 3000

CMD ["pnpm", "--filter", "@hulee/web", "start"]
