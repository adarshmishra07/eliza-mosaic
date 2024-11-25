# Use Node.js 23
FROM node:23-slim

# Install system dependencies including build tools
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    bash \
    build-essential \
    libtool \
    autoconf \
    automake \
    ffmpeg \
    opus-tools \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN npm install -g pnpm@9.12.3

WORKDIR /app

COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY .npmrc ./
COPY tsconfig.json ./
COPY pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

RUN chmod +x scripts/build.sh && \
    cd packages/core && pnpm build && cd ../.. && \
    pnpm run build

EXPOSE 3000

CMD ["pnpm", "start:all"]