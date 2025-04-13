/** @jsx jsx */
/** @jsxImportSource hono/jsx */
import { Hono } from "hono";
import { html } from "hono/html";

const app = new Hono();

app.get("/", (c) => {
  return c.html(
    <html>
      <head>
        <title>Canyon Chat Deployer</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gray-100 flex items-center justify-center min-h-screen">
        <form
          id="deployForm"
          class="bg-white p-8 rounded-lg shadow-md w-96"
          method="POST"
          action="/deploy"
        >
          <h2 class="text-2xl mb-6 text-center">Deploy Canyon Chat</h2>

          <div class="mb-4">
            <label class="block text-gray-700 mb-2">Org Name</label>
            <input
              type="text"
              name="orgName"
              required
              class="w-full px-3 py-2 border rounded-md"
            />
          </div>

          <div class="mb-4">
            <label class="block text-gray-700 mb-2">Gemini Key</label>
            <input
              type="text"
              name="geminiKey"
              required
              class="w-full px-3 py-2 border rounded-md"
            />
          </div>

          {/* Humanitec Token input removed */}

          <button
            type="submit"
            class="w-full bg-blue-500 text-white py-2 rounded-md hover:bg-blue-600"
          >
            Deploy Canyon Chat
          </button>

          {/* Response Message Area */}
          <div
            id="responseMessage"
            class="mt-4 p-3 border rounded-md hidden"
          ></div>
        </form>
      </body>
    </html>
  );
});

// Helper function to render response page
const renderResponsePage = (title, message, isError = false) => {
  const bgColor = isError ? "bg-red-100" : "bg-green-100";
  const borderColor = isError ? "border-red-300" : "border-green-300";
  const textColor = isError ? "text-red-700" : "text-green-700";

  // Check if it's the success message with the URL and extract URL
  const successPrefix = "Service will be available shortly at: ";
  const isSuccessUrlMessage = !isError && message.startsWith(successPrefix);
  let url = "";
  if (isSuccessUrlMessage) {
    url = message.substring(successPrefix.length);
  }

  return html`
    <html>
      <head>
        <title>${title}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        ${isSuccessUrlMessage // Conditionally include the script in the head
          ? html`
              <script>
                function copyUrl() {
                  // Use the extracted URL directly
                  const urlToCopy = "${url}";
                  navigator.clipboard
                    .writeText(urlToCopy)
                    .then(() => {
                      const button = document.getElementById("copy-button");
                      if (!button) return; // Guard clause
                      const originalText = button.innerText;
                      button.innerText = "Copied!";
                      button.disabled = true;
                      setTimeout(() => {
                        button.innerText = originalText;
                        button.disabled = false;
                      }, 2000); // Reset after 2 seconds
                    })
                    .catch((err) => {
                      console.error("Failed to copy URL: ", err);
                      // Provide feedback in case of error
                      alert("Failed to copy URL. Please copy manually.");
                    });
                }
              </script>
            `
          : ""}
      </head>
      <body class="bg-gray-100 flex items-center justify-center min-h-screen">
        <div class="bg-white p-8 rounded-lg shadow-md w-96 text-center">
          <h2 class="text-2xl mb-6">${title}</h2>
          <div
            class="p-4 border ${borderColor} ${bgColor} ${textColor} rounded-md"
          >
            ${
              isSuccessUrlMessage // Conditionally render the message with the button
                ? html`
                    ${successPrefix}
                    <span id="deployment-url" class="font-mono">${url}</span>
                    <button
                      id="copy-button"
                      onclick="copyUrl()"
                      class="ml-2 px-2 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                    >
                      Copy URL
                    </button>
                  `
                : message /* Otherwise, just display the original message */
            }
          </div>
          <a
            href="/"
            class="mt-6 inline-block bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600"
          >
            Go Back
          </a>
        </div>
      </body>
    </html>
  `;
};

app.post("/deploy", async (c) => {
  // Read form data using parseBody for standard form submission
  const { orgName, geminiKey } = await c.req.parseBody(); // Removed humanitecToken

  // Basic validation (can be expanded)
  if (!orgName || !geminiKey) {
    // Removed humanitecToken check
    return c.html(
      renderResponsePage(
        "Deployment Failed",
        "Missing required form fields.",
        true
      ),
      400
    );
  }

  try {
    // --- Humanitec Service User and Token Creation ---
    const adminToken = Bun.env.humanitec_service_user_api_token;
    if (!adminToken) {
      throw new Error(
        "Missing humanitec_service_user_api_token in environment variables."
      );
    }
    const humanitecOrgId = "canyon-demo";
    const serviceUserName = `canyon-chat-deployer-${orgName}`; // Unique name
    const tokenId = `canyon-chat-token-${orgName}`; // Unique token ID
    const tokenDescription = `Token for Canyon Chat deployment (${orgName})`;
    const expiryDate = "2035-01-01T00:00:00Z"; // Far future expiry

    console.log(`Attempting to create/find service user: ${serviceUserName}`);

    // 1. Create Service User
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
          role: "member",
          type: "service",
        }),
      }
    );

    if (!createUserResponse.ok) {
      const errorBody = await createUserResponse.text();
      // Check if user already exists (Humanitec might return 409 Conflict)
      if (createUserResponse.status === 409) {
        console.warn(
          `Service user '${serviceUserName}' likely already exists. Attempting to fetch ID.`
        );
        // If user exists, we need to fetch their ID to generate a token
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
        if (!getUsersResponse.ok) {
          throw new Error(
            `Failed to create or find existing service user '${serviceUserName}'. Status: ${
              getUsersResponse.status
            }, Body: ${await getUsersResponse.text()}`
          );
        }
        const users = await getUsersResponse.json();
        if (!users || users.length === 0 || !users[0].id) {
          throw new Error(
            `Failed to find ID for existing service user '${serviceUserName}'.`
          );
        }
        var newUserId = users[0].id; // Use var to allow access outside if block
        console.log(`Found existing service user ID: ${newUserId}`);
      } else {
        throw new Error(
          `Failed to create Humanitec service user. Status: ${createUserResponse.status}, Body: ${errorBody}`
        );
      }
    } else {
      const newUser = await createUserResponse.json();
      if (!newUser || !newUser.id) {
        throw new Error(
          "Failed to parse service user ID from Humanitec response."
        );
      }
      var newUserId = newUser.id; // Use var to allow access outside if block
      console.log(
        `Successfully created Humanitec service user. ID: ${newUserId}`
      );
    }

    // 2. Generate API Token for the Service User
    console.log(`Attempting to generate token for user ID: ${newUserId}`);
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
          type: "static",
        }),
      }
    );

    let newUserToken; // Declare outside the block
    if (!createTokenResponse.ok) {
      const errorBody = await createTokenResponse.text();
      // Check if token already exists (Humanitec might return 409 Conflict)
      // NOTE: Humanitec currently doesn't allow retrieving existing static tokens.
      // If creation fails with 409, we cannot proceed easily without manual intervention or a different token strategy.
      if (createTokenResponse.status === 409) {
        console.error(
          `Token with ID '${tokenId}' likely already exists for user '${newUserId}'. Static tokens cannot be retrieved after creation. Manual intervention may be required.`
        );
        throw new Error(
          `Token with ID '${tokenId}' already exists. Cannot retrieve existing static token.`
        );
      } else {
        throw new Error(
          `Failed to generate Humanitec API token. Status: ${createTokenResponse.status}, Body: ${errorBody}`
        );
      }
    } else {
      const tokenData = await createTokenResponse.json();
      if (!tokenData || !tokenData.token) {
        throw new Error(
          "Failed to parse generated token from Humanitec response."
        );
      }
      newUserToken = tokenData.token; // Assign the token here
      console.log(
        `Successfully generated Humanitec API token for service user.`
      );
    }

    // --- End Humanitec ---

    const projectId = "20b69f3f-59aa-48dd-b872-55c2e41ba599";
    const environmentId = "f9d99ce5-56ee-4556-a6b3-91b4db64ca37";

    // Define the GraphQL mutation (adjust based on actual schema)
    const mutation = `
      mutation CreateService($input: ServiceCreateInput!) {
        serviceCreate(input: $input) {
          id
          name
        }
      }
    `;

    // Define the serviceDomainCreate mutation
    const serviceDomainCreateMutation = `
      mutation ServiceDomainCreate($input: ServiceDomainCreateInput!) {
        serviceDomainCreate(input: $input) {
          domain # Assuming the response includes the created domain
        }
      }
    `;

    // Define the variables for the serviceCreate mutation
    const serviceCreateVariables = {
      input: {
        projectId: projectId,
        environmentId: environmentId,
        name: orgName,
        // branch: "main", // Removed - Not needed for image source
        source: {
          // repo: "DominicJamesWhite/CanyonChat", // Removed
          image: "dominicwhitehumanitec/canyonchat:latest", // Use Docker image
        },
        variables: {
          GOOGLE_API_KEY: geminiKey,
          HUMANITEC_TOKEN: newUserToken, // Use the newly generated token
          ENABLE_MCP: "true",
          DEFAULT_MODEL: "gemini-2.5-pro-preview-03-25",
          MINIO_ENDPOINT: "https://bucket-production-670c.up.railway.app:443",
          MINIO_ACCESS_KEY_ID: "KNI6gzCN3ueRujNrzQj5",
          MINIO_SECRET_ACCESS_KEY: "MGtkqapxCcbYS532RQVDUA9rdhPU6Ie7NT0LKgdj",
          MINIO_BUCKET: "canyon-render-bucket",
          MINIO_USE_SSL: "true",
        },
      },
    };

    // Send the GraphQL request
    const deployResponse = await fetch(
      "https://backboard.railway.com/graphql/v2", // Correct GraphQL endpoint
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Bun.env.RAILWAY_TOKEN}`,
          Accept: "application/json",
        },
        body: JSON.stringify({
          query: mutation, // Uses serviceCreate mutation query
          variables: serviceCreateVariables, // Use the correct variables
        }),
      }
    );

    const serviceCreateResult = await deployResponse.json();

    // Check for GraphQL errors in serviceCreate response
    if (serviceCreateResult.errors) {
      console.error(
        "GraphQL Errors (serviceCreate):",
        serviceCreateResult.errors
      );
      const errorMessages = serviceCreateResult.errors
        .map((e) => e.message)
        .join("; ");
      throw new Error(`Service creation failed: ${errorMessages}`);
    }

    // Check if the expected data is present in serviceCreate response
    if (
      !serviceCreateResult.data ||
      !serviceCreateResult.data.serviceCreate ||
      !serviceCreateResult.data.serviceCreate.id
    ) {
      console.error(
        "Unexpected GraphQL response structure (serviceCreate):",
        serviceCreateResult
      );
      throw new Error(
        "Failed to create service or retrieve its ID from the response."
      );
    }

    // Extract the service ID from the successful serviceCreate response
    const serviceId = serviceCreateResult.data.serviceCreate.id;
    console.log(`Service created successfully. Service ID: ${serviceId}`);

    // --- Step 2: Create the Service Domain ---

    const serviceDomainCreateVariables = {
      input: {
        environmentId: environmentId,
        serviceId: serviceId,
        targetPort: 8080, // Use the provided port
      },
    };

    console.log("Attempting to create service domain...");
    const serviceDomainResponse = await fetch(
      "https://backboard.railway.com/graphql/v2",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Bun.env.RAILWAY_TOKEN}`,
          Accept: "application/json",
        },
        body: JSON.stringify({
          query: serviceDomainCreateMutation, // Use the domain creation query
          variables: serviceDomainCreateVariables, // Use the domain creation variables
        }),
      }
    );

    const serviceDomainResult = await serviceDomainResponse.json();

    // Check for GraphQL errors in serviceDomainCreate response
    if (serviceDomainResult.errors) {
      console.error(
        "GraphQL Errors (serviceDomainCreate):",
        serviceDomainResult.errors
      );
      // Combine error messages for display
      const errorMessages = serviceDomainResult.errors
        .map((e) => e.message)
        .join("; ");
      // Proceed but maybe log a warning or include in the success message?
      // For now, let's throw an error to make it clear.
      throw new Error(`Service domain creation failed: ${errorMessages}`);
    }

    // Check if the expected data is present in serviceDomainCreate response
    // Assuming the domain is returned directly, adjust if nested differently
    if (
      !serviceDomainResult.data ||
      !serviceDomainResult.data.serviceDomainCreate ||
      !serviceDomainResult.data.serviceDomainCreate.domain
    ) {
      console.error(
        "Unexpected GraphQL response structure (serviceDomainCreate):",
        serviceDomainResult
      );
      // Don't fail the whole process, but log it. The service exists.
      console.warn(
        "Could not retrieve domain from service domain creation response."
      );
      // Fallback message if domain creation failed or didn't return expected structure
      return c.html(
        renderResponsePage(
          "Deployment Partially Successful",
          `Service created (ID: ${serviceId}), but failed to assign or retrieve public domain.`
        )
      );
    }

    const domain = serviceDomainResult.data.serviceDomainCreate.domain;
    console.log(`Service domain created successfully: ${domain}`);

    // Return HTML success page with domain
    return c.html(
      renderResponsePage(
        "Deployment Complete",
        `Service will be available shortly at: https://${orgName}.canyon-alpha.com`
      )
    );
  } catch (error) {
    console.error("Deployment Error:", error.message);
    // Return HTML error page
    return c.html(
      renderResponsePage(
        "Deployment Failed",
        `An error occurred: ${error.message}`,
        true
      ),
      500
    );
  }
});

Bun.serve({
  port: Bun.env.PORT ?? 3000,
  fetch: app.fetch,
});
