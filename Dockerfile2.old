# Use Node.js 22
FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    bash \
    && rm -rf /var/lib/apt/lists/*

# Install specific pnpm version
RUN npm install -g pnpm@9.12.3

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/*/package.json ./packages/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy the rest of the application
COPY . .

# Build the application
RUN pnpm run build

# The default command uses the start:all script
CMD ["pnpm", "start:all"]