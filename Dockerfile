# Use Node.js LTS version
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files first (for better caching)
COPY package*.json ./

# Install dependencies for production
RUN npm install --omit=dev

# Copy application files (including .env)
COPY . .

# Copy external .env file (NOT RECOMMENDED - exposes secrets)
# COPY .env .env

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Change ownership of app directory
RUN chown -R nodejs:nodejs /app
USER nodejs

# Set environment variable for internal port
ENV PORT=3000

# Expose port 80 for external web server access
EXPOSE 80

# Start the npm server
CMD ["npm", "start"]
