import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy API requests to the Express server
    proxy: {
      "/deploy": "http://localhost:8080", // Proxy POST /deploy
      "/status": "http://localhost:8080", // Proxy GET /status/:deploymentId
    },
    // Make Vite available on the network if needed (e.g., for testing on other devices)
    // host: true,
  },
  build: {
    // Output directory relative to project root
    outDir: "dist",
    // Generate source maps for debugging production issues
    sourcemap: true,
  },
  // Define base path if deploying to a subdirectory, otherwise '/'
  base: "/",
});
