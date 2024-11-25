FROM node:23.1.0

# Install pnpm globally
RUN npm install -g pnpm@9.4.0

# Set the working directory
WORKDIR /app

# Add configuration files and install dependencies
COPY pnpm-workspace.yaml package.json .npmrc tsconfig.json pnpm-lock.yaml ./
RUN pnpm install

# Add the documentation
COPY docs ./docs

# Add the rest of the application code
COPY packages ./packages

# Add scripts and other necessary files
COPY scripts ./scripts
COPY characters ./characters

# Ensure the start script has execute permissions
RUN chmod +x scripts/start.sh

# Set the command to run the start script
CMD ["sh", "scripts/start.sh"]
