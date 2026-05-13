# Stage 1: Builder
FROM node:20 AS builder

WORKDIR /app

# Install system dependencies for sharp and other native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client (needs dummy DATABASE_URL for config)
ENV DATABASE_URL=postgresql://localhost:5432/dummy
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Remove devDependencies after build
RUN npm prune --production

# Stage 2: Production
FROM node:20 AS production

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    libvips \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs nodejs

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install only production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Generate Prisma client for production (needs dummy DATABASE_URL for config)
ENV DATABASE_URL=postgresql://localhost:5432/dummy
RUN npx prisma generate

# Copy built application and config from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/docs ./docs
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Create uploads directory and set permissions
RUN mkdir -p uploads && chown -R nodejs:nodejs uploads

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Start the application
CMD ["node", "dist/server.js"]
