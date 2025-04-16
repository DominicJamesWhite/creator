import express from "express";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { startDeployment } from "./deployment-logic.js"; // Use .js extension for ES modules

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8080;
const isProduction = process.env.NODE_ENV === "production";

// Store active SSE connections (clients)
const clients = {};

// Middleware to parse form data
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // Needed for React app sending JSON

// --- SSE Status Update Function ---
const sendStatusUpdate = (
  deploymentId,
  message,
  isError = false,
  isComplete = false,
  data = null
) => {
  if (clients[deploymentId]) {
    const eventData = JSON.stringify({ message, isError, isComplete, data });
    clients[deploymentId].write(`data: ${eventData}\n\n`);
    console.log(
      `[${deploymentId}] SSE Sent: ${message.substring(0, 100)}${
        message.length > 100 ? "..." : ""
      }`
    );
    if (isComplete) {
      console.log(
        `[${deploymentId}] Deployment complete. Closing SSE connection.`
      );
      clients[deploymentId].end(); // Close connection on completion
      delete clients[deploymentId];
    }
  } else {
    console.warn(
      `[${deploymentId}] Attempted to send status update, but client disconnected.`
    );
  }
};

// --- API Routes ---

// POST /deploy: Start deployment and return deployment ID
app.post("/deploy", async (req, res) => {
  const formData = req.body;
  console.log("[POST /deploy] Received deployment request:", formData);

  // Basic validation
  if (!formData.orgName || !formData.geminiKey) {
    console.error("[POST /deploy] Missing required form fields.");
    return res
      .status(400)
      .json({
        error: "Missing required form fields (Organization Name, Gemini Key).",
      });
  }

  const deploymentId = crypto.randomUUID();
  console.log(`[${deploymentId}] Generated deployment ID.`);

  // Define the callback function specifically for this request
  const sendUpdateCallback = (
    message,
    isError = false,
    isComplete = false,
    data = null
  ) => {
    sendStatusUpdate(deploymentId, message, isError, isComplete, data);
  };

  // Start the deployment process asynchronously
  // No await here, we respond immediately after starting
  startDeployment(formData, deploymentId, sendUpdateCallback)
    .then(() => {
      console.log(
        `[${deploymentId}] Deployment process initiated successfully (async).`
      );
      // Success/failure is handled via SSE
    })
    .catch((error) => {
      // This catch handles errors *before* the async process starts
      console.error(
        `[${deploymentId}] Critical error initiating deployment:`,
        error
      );
      // Try to send a final error message via SSE if the client connected briefly
      sendUpdateCallback(
        `Critical error initiating deployment: ${error.message}`,
        true,
        true
      );
      // Note: The initial response has already been sent by this point.
    });

  // Immediately respond with the deployment ID so the frontend can connect to SSE
  res.status(202).json({ deploymentId }); // 202 Accepted
});

// GET /status/:deploymentId: Establish SSE connection
app.get("/status/:deploymentId", (req, res) => {
  const { deploymentId } = req.params;
  if (!deploymentId) {
    return res.status(400).send("Missing deployment ID");
  }
  console.log(`[${deploymentId}] Client connected for SSE.`);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    // Consider adding CORS headers if frontend is served from a different origin in dev
    // 'Access-Control-Allow-Origin': '*'
  });

  // Store the client connection
  clients[deploymentId] = res;

  // Send an initial confirmation message (optional)
  const initialMessage = JSON.stringify({
    message: "Connected to status updates.",
    isError: false,
    isComplete: false,
  });
  res.write(`data: ${initialMessage}\n\n`);

  // Handle client disconnect
  req.on("close", () => {
    console.log(`[${deploymentId}] Client disconnected SSE.`);
    delete clients[deploymentId];
    res.end();
  });
});

// --- Static File Serving (Production Only) ---
if (isProduction) {
  const buildPath = path.join(__dirname, "dist");
  console.log(`Production mode: Serving static files from ${buildPath}`);
  app.use(express.static(buildPath));

  // Serve index.html for all non-API GET requests
  app.get("*", (req, res) => {
    // Check if the request looks like an API call or a file request
    if (req.path.startsWith("/status/") || req.path.includes(".")) {
      // Let specific handlers or static middleware handle it, or 404
      return res.status(404).send("Not Found");
    }
    // Otherwise, serve the main React app entry point
    res.sendFile(path.join(buildPath, "index.html"));
  });
} else {
  console.log(
    "Development mode: API server only. Vite handles frontend serving."
  );
  // In development, Vite's proxy handles routing to this server for API calls.
  // We don't need to serve static files here.
}

// --- Server Start ---
app.listen(port, "0.0.0.0", () => {
  console.log(
    `Creator server listening on http://0.0.0.0:${port} (Mode: ${
      isProduction ? "Production" : "Development"
    })`
  );
});

// Basic error handling middleware (remains useful)
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  // Avoid sending HTML errors for SSE routes
  if (req.path.startsWith("/status/")) {
    return res.end(); // Just close the connection
  }
  // Send JSON error for API routes if possible
  if (req.path.startsWith("/deploy")) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
  // Fallback for other errors
  res.status(500).send("Something broke!");
});
