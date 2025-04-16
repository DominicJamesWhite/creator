import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os"; // Import os module

// Helper function to execute shell commands and stream output
async function runCommand(
  command,
  args,
  deploymentId,
  sendStatusUpdate,
  options = {}
) {
  return new Promise((resolve, reject) => {
    const commandString = `${command} ${args.join(" ")}`;
    sendStatusUpdate(`Executing: ${commandString}...`);
    console.log(`[${deploymentId}] Executing: ${commandString}`);

    const proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"], // stdin, stdout, stderr
      ...options, // Pass any additional spawn options
    });

    let stdoutData = "";
    let stderrData = "";

    proc.stdout.on("data", (data) => {
      const line = data.toString().trim();
      if (line) {
        stdoutData += line + "\n";
        sendStatusUpdate(`[stdout] ${line}`);
        console.log(`[${deploymentId}] STDOUT: ${line}`);
      }
    });

    proc.stderr.on("data", (data) => {
      const line = data.toString().trim();
      if (line) {
        stderrData += line + "\n";
        // Treat stderr as progress unless it's a known fatal error pattern
        sendStatusUpdate(`[stderr] ${line}`);
        console.error(`[${deploymentId}] STDERR: ${line}`);
      }
    });

    proc.on("error", (err) => {
      console.error(`[${deploymentId}] Spawn Error: ${err.message}`);
      sendStatusUpdate(`Spawn Error: ${err.message}`, true);
      reject(
        new Error(`Failed to start command "${commandString}": ${err.message}`)
      );
    });

    proc.on("close", (code) => {
      console.log(`[${deploymentId}] Exit Code: ${code}`);
      if (code !== 0) {
        const errorMessage = `Command "${commandString}" failed with exit code ${code}. Stderr: ${
          stderrData || "None"
        }`;
        console.error(`[${deploymentId}] ${errorMessage}`);
        sendStatusUpdate(errorMessage, true);
        reject(new Error(errorMessage));
      } else {
        sendStatusUpdate(`Command "${commandString}" completed successfully.`);
        resolve({ stdout: stdoutData, stderr: stderrData, exitCode: code });
      }
    });
  });
}

// Main deployment logic function
async function startDeployment(formData, deploymentId, sendStatusUpdate) {
  let uniqueAppName = ""; // Keep track for cleanup
  let tempFlyTomlPath = ""; // Keep track for cleanup

  try {
    const { orgName, geminiKey } = formData;

    // --- Generate Unique Fly App Name ---
    sendStatusUpdate("Generating unique application name...");
    const randomSuffix = Math.floor(1000 + Math.random() * 9000).toString();
    const sanitizedOrgName = orgName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .substring(0, 40);
    uniqueAppName = `${sanitizedOrgName}-${randomSuffix}`;
    sendStatusUpdate(`Generated Fly app name: ${uniqueAppName}`);
    console.log(
      `[${deploymentId}] Generated unique Fly app name: ${uniqueAppName}`
    );
    // --- End Unique Fly App Name ---

    // --- Humanitec Service User and Token Creation ---
    sendStatusUpdate("Setting up Humanitec service user and token...");
    const adminToken = process.env.HUMANITEC_SERVICE_USER_API_TOKEN; // Use process.env for Node.js
    if (!adminToken) {
      throw new Error(
        "Missing HUMANITEC_SERVICE_USER_API_TOKEN in environment variables."
      );
    }

    const humanitecOrgId = "canyon-demo"; // Consider making this configurable
    const serviceUserName = `canyon-chat-fly-${uniqueAppName}`;
    const tokenId = `canyon-chat-fly-token-${uniqueAppName}`;
    const tokenDescription = `Token for Canyon Chat Fly deployment (${uniqueAppName})`;
    const expiryDate = "2035-01-01T00:00:00Z"; // Consider making expiry configurable

    sendStatusUpdate(
      `Creating/finding Humanitec service user: ${serviceUserName}...`
    );
    console.log(
      `[${deploymentId}] Attempting to create/find Humanitec service user: ${serviceUserName}`
    );

    let newUserId;
    try {
      const createUserResponse = await fetch(
        `https://api.humanitec.io/orgs/${humanitecOrgId}/users`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            name: serviceUserName,
            role: "member", // Ensure this role has sufficient permissions
            type: "service",
          }),
        }
      );

      if (!createUserResponse.ok) {
        if (createUserResponse.status === 409) {
          sendStatusUpdate(
            `Service user '${serviceUserName}' already exists. Fetching ID...`
          );
          console.warn(
            `[${deploymentId}] Service user '${serviceUserName}' likely already exists. Attempting to fetch ID.`
          );
          const getUsersResponse = await fetch(
            `https://api.humanitec.io/orgs/${humanitecOrgId}/users?name=${encodeURIComponent(
              serviceUserName
            )}`,
            {
              headers: {
                Authorization: `Bearer ${adminToken}`,
                Accept: "application/json",
              },
            }
          );
          if (!getUsersResponse.ok)
            throw new Error(
              `Failed to find existing service user '${serviceUserName}'. Status: ${getUsersResponse.status}`
            );
          const users = await getUsersResponse.json();
          if (!users || users.length === 0 || !users[0].id)
            throw new Error(
              `Failed to find ID for existing service user '${serviceUserName}'.`
            );
          newUserId = users[0].id;
          sendStatusUpdate(`Found existing service user ID: ${newUserId}`);
          console.log(
            `[${deploymentId}] Found existing service user ID: ${newUserId}`
          );
        } else {
          throw new Error(
            `Failed to create Humanitec service user. Status: ${
              createUserResponse.status
            }, Body: ${await createUserResponse.text()}`
          );
        }
      } else {
        const newUser = await createUserResponse.json();
        if (!newUser || !newUser.id)
          throw new Error(
            "Failed to parse service user ID from Humanitec response."
          );
        newUserId = newUser.id;
        sendStatusUpdate(
          `Successfully created Humanitec service user. ID: ${newUserId}`
        );
        console.log(
          `[${deploymentId}] Successfully created Humanitec service user. ID: ${newUserId}`
        );
      }
    } catch (error) {
      console.error(
        `[${deploymentId}] Error during Humanitec user creation/lookup: ${error.message}`
      );
      throw new Error(`Humanitec user setup failed: ${error.message}`);
    }

    let newUserToken;
    try {
      sendStatusUpdate(`Generating API token for user ID: ${newUserId}...`);
      console.log(
        `[${deploymentId}] Attempting to generate token for user ID: ${newUserId}`
      );
      const createTokenResponse = await fetch(
        `https://api.humanitec.io/users/${newUserId}/tokens`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            id: tokenId,
            description: tokenDescription,
            expires_at: expiryDate,
            type: "static", // Static tokens are required here
          }),
        }
      );

      if (!createTokenResponse.ok) {
        if (createTokenResponse.status === 409) {
          // If token exists, we cannot retrieve it. Fail the deployment.
          const errorMsg = `Token with ID '${tokenId}' already exists for user '${newUserId}'. Cannot retrieve existing static token. Please delete it manually in Humanitec if you want to proceed.`;
          console.error(`[${deploymentId}] ${errorMsg}`);
          throw new Error(errorMsg);
        } else {
          throw new Error(
            `Failed to generate Humanitec API token. Status: ${
              createTokenResponse.status
            }, Body: ${await createTokenResponse.text()}`
          );
        }
      } else {
        const tokenData = await createTokenResponse.json();
        if (!tokenData || !tokenData.token)
          throw new Error(
            "Failed to parse generated token from Humanitec response."
          );
        newUserToken = tokenData.token;
        sendStatusUpdate("Successfully generated Humanitec API token.");
        console.log(
          `[${deploymentId}] Successfully generated Humanitec API token.`
        );
      }
    } catch (error) {
      console.error(
        `[${deploymentId}] Error during Humanitec token generation: ${error.message}`
      );
      throw new Error(`Humanitec token setup failed: ${error.message}`);
    }
    sendStatusUpdate("Humanitec setup complete.");
    // --- End Humanitec ---

    // --- Fly.io App Creation and Deployment ---
    const flyRegion = process.env.FLY_REGION || "ams"; // Get from env or default
    const imageName =
      process.env.DEPLOY_IMAGE || "dominicwhitehumanitec/canyonchat:latest"; // Image to deploy
    const flyOrg = process.env.FLY_ORG || "personal"; // Fly organization slug
    sendStatusUpdate(
      `Creating Fly app '${uniqueAppName}' in region '${flyRegion}'...`
    );
    await runCommand(
      "flyctl",
      ["apps", "create", uniqueAppName, "--org", flyOrg],
      deploymentId,
      sendStatusUpdate
    );
    sendStatusUpdate(`Fly app '${uniqueAppName}' created.`);

    sendStatusUpdate("Setting secrets in Fly app (one by one)...");

    // Set secrets individually
    const secrets = {
      GOOGLE_API_KEY: geminiKey, // Use the key from the form (Assuming this is GEMINI_API_KEY)
      HUMANITEC_TOKEN: newUserToken, // Use the generated token
      DEFAULT_MODEL: "gemini-2.5-pro-preview-03-25",
      ENABLE_MCP: "true",
      MINIO_ACCESS_KEY_ID: "KNI6gzCN3ueRujNrzQj5",
      MINIO_BUCKET: "canyon-render-bucket",
      MINIO_ENDPOINT: "https://bucket-production-670c.up.railway.app:443",
      MINIO_SECRET_ACCESS_KEY: "MGtkqapxCcbYS532RQVDUA9rdhPU6Ie7NT0LKgdj",
      MINIO_USE_SSL: "true",
    };

    for (const [key, value] of Object.entries(secrets)) {
      if (!value) {
        sendStatusUpdate(`Skipping secret ${key} as value is empty.`);
        console.warn(
          `[${deploymentId}] Skipping secret ${key} as value is empty.`
        );
        continue;
      }
      sendStatusUpdate(`Setting secret ${key}...`);
      await runCommand(
        "flyctl",
        ["secrets", "set", "-a", uniqueAppName, `${key}=${value}`],
        deploymentId,
        sendStatusUpdate
      );
      sendStatusUpdate(`Secret ${key} set.`);
    }

    sendStatusUpdate("All secrets processed.");

    // --- Generate and Write Temporary fly.toml ---
    tempFlyTomlPath = path.join(
      os.tmpdir(), // Use imported os module
      `fly_${deploymentId}_${uniqueAppName}.toml`
    ); // Unique temp file
    const flyTomlContent = `
app = "${uniqueAppName}"
primary_region = "${flyRegion}"

[build]
  image = "${imageName}" # Specify the image to deploy

[http_service]
  internal_port = 3000 # Port the application inside the container listens on (Reverted back to 3000 based on startup logs)
  force_https = true
  auto_stop_machines = true # Keep machines running? Set to false if needed
  auto_start_machines = true
  min_machines_running = 0 # Scale to zero when idle

`;
    sendStatusUpdate(`Writing temporary fly.toml to ${tempFlyTomlPath}...`);
    console.log(
      `[${deploymentId}] Writing temporary fly.toml to ${tempFlyTomlPath}`
    );
    await fs.writeFile(tempFlyTomlPath, flyTomlContent);
    // --- End Temporary fly.toml ---

    sendStatusUpdate(
      `Deploying image '${imageName}' to Fly app '${uniqueAppName}'...`
    );
    // Deploy using the generated fly.toml and the specified image
    // Set HA=false to only launch one machine initially.
    await runCommand(
      "flyctl",
      [
        "deploy",
        "-a",
        uniqueAppName,
        "-c",
        tempFlyTomlPath, // Use the generated config file
        "--image",
        imageName, // Explicitly specify image again (belt and suspenders)
        "--ha=false", // Start with one machine
        "--detach", // Run deploy in background on Fly's side (optional, but good for long deploys)
      ],
      deploymentId,
      sendStatusUpdate
    );
    sendStatusUpdate("Fly deployment command initiated.");
    // Note: '--detach' means flyctl returns quickly. Actual deployment progress might continue.
    // For more detailed progress, you might need to omit --detach and parse flyctl's output,
    // or use flyctl status/logs commands afterwards. For now, we assume success after the command exits.

    // --- End Fly.io App Creation and Deployment ---

    // Construct the final URL
    // TODO: Determine the correct domain - is it always canyon-beta.com? Make configurable?
    const appUrl = `https://${uniqueAppName}.canyon-beta.com`;
    sendStatusUpdate(
      `Deployment successful! App should be available shortly at: ${appUrl}`,
      false, // isError
      true, // isComplete
      { appUrl: appUrl } // Pass URL as data
    );
    console.log(
      `[${deploymentId}] Deployment process completed successfully. App URL: ${appUrl}`
    );
  } catch (error) {
    const errorContext = uniqueAppName || deploymentId;
    console.error(`[${errorContext}] Deployment Error:`, error.message);
    sendStatusUpdate(`Deployment failed: ${error.message}`, true, true); // Send final error via SSE

    // Attempt cleanup only if app creation was likely started
    if (uniqueAppName) {
      sendStatusUpdate(
        `Attempting to clean up failed deployment for app ${uniqueAppName}...`
      );
      console.log(
        `[${errorContext}] Attempting to clean up app ${uniqueAppName}...`
      );
      try {
        await runCommand(
          "flyctl",
          ["apps", "destroy", uniqueAppName, "--yes"],
          errorContext, // Use app name or deployment ID for logging context
          sendStatusUpdate // Also send cleanup status via SSE
        );
        sendStatusUpdate(`Cleaned up failed app ${uniqueAppName}.`);
        console.log(`[${errorContext}] Cleaned up app ${uniqueAppName}.`);
      } catch (cleanupError) {
        const cleanupMsg = `Failed to cleanup app ${uniqueAppName}: ${cleanupError.message}`;
        sendStatusUpdate(cleanupMsg, true); // Report cleanup failure via SSE
        console.error(`[${errorContext}] ${cleanupMsg}`);
        // Don't mark as complete=true here, the main error already did that.
      }
    }
  } finally {
    // --- Clean up temporary fly.toml regardless of success/failure ---
    if (tempFlyTomlPath) {
      console.log(
        `[${deploymentId}] Cleaning up temporary config file ${tempFlyTomlPath}`
      );
      try {
        await fs.unlink(tempFlyTomlPath);
        console.log(`[${deploymentId}] Temporary config file removed.`);
        // Don't send SSE for this, it's internal cleanup
      } catch (rmError) {
        // Log if removal fails, but don't fail the whole process
        console.error(
          `[${deploymentId}] Warning: Failed to remove temporary config file ${tempFlyTomlPath}: ${rmError.message}`
        );
      }
    }
  }
}

export { startDeployment };
