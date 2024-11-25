# Use Node.js Latest 23
FROM node:23-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    bash \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN npm install -g pnpm@9.12.3

# Set working directory
WORKDIR /app

# First layer: base configuration
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY .npmrc ./
COPY tsconfig.json ./
COPY pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy the entire project
COPY . .

# Make build script executable and build
RUN chmod +x scripts/build.sh && \
    cd packages/core && pnpm build && cd ../.. && \
    pnpm run build

# Expose necessary port
EXPOSE 3000

# Start the application
CMD ["pnpm", "start:all"]