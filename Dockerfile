FROM node:20-bookworm-slim

WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_short_drama" pnpm exec prisma generate
RUN pnpm build

EXPOSE 3000

CMD ["pnpm", "start"]
