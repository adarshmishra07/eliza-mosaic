FROM node:23.1.0

# Install pnpm globally
RUN npm install -g pnpm@9.4.0

# Set the working directory
WORKDIR /app

# Copy all files into the container
COPY . .

# Install dependencies
RUN pnpm install

# Ensure the start script has execute permissions
RUN chmod +x scripts/start.sh


