# ---- Builder Stage ----
# Use a full Node.js image for building (Updated to Node 20)
FROM node:20 as builder

# Install necessary tools: curl for downloading, unzip for flyctl, git
RUN apt-get update && apt-get install -y curl unzip git --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Install flyctl
RUN curl -L https://fly.io/install.sh | sh
ENV FLYCTL_INSTALL="/root/.fly"
ENV PATH="$FLYCTL_INSTALL/bin:$PATH"

WORKDIR /app

# Copy package files and install ALL dependencies (including devDeps for build)
COPY package.json package-lock.json* ./
RUN npm install

# Copy the rest of the application code needed for the build
COPY vite.config.js tailwind.config.js postcss.config.js ./
COPY index.html ./
COPY src ./src

# Build the React frontend
RUN npm run build

# Prune devDependencies after build
RUN npm prune --production

# ---- Final Stage ----
# Use a slimmer Node.js image for the final application (Updated to Node 20)
FROM node:20-slim

# Install curl, unzip, and ca-certificates for flyctl and TLS verification in the final image
RUN apt-get update && apt-get install -y curl unzip ca-certificates --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Copy flyctl from the builder stage
ENV FLYCTL_INSTALL="/root/.fly"
ENV PATH="$FLYCTL_INSTALL/bin:$PATH"
COPY --from=builder ${FLYCTL_INSTALL} ${FLYCTL_INSTALL}

WORKDIR /app

# Set NODE_ENV to production
ENV NODE_ENV=production

# Copy production node_modules and package files from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY package.json package-lock.json* ./

# Copy server code and built frontend from builder stage
COPY --from=builder /app/dist ./dist
COPY server.js .
COPY deployment-logic.js .

# Expose the port the app runs on
EXPOSE 8080

# Define the command to run the app in production
CMD ["node", "server.js"]
