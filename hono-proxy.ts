import { Hono } from "hono";

const app = new Hono();

// Define the base domain we expect requests for
const BASE_DOMAIN = "canyon-alpha.com";
// Define the internal port the target services listen on
const INTERNAL_PORT = 8080; // Next.js servers typically run on this port

app.all("*", async (c) => {
  const host = c.req.header("host");

  if (!host) {
    return c.text("Host header is missing", 400);
  }

  // Check if the host ends with the expected base domain
  if (!host.endsWith(`.${BASE_DOMAIN}`)) {
    // Allow requests directly to the base domain (e.g., for health checks or a landing page)
    if (host === BASE_DOMAIN) {
      return c.text(
        `Hono Proxy Root - Ready to route subdomains of ${BASE_DOMAIN}`,
        200
      );
    }
    console.error(`Received request for unexpected host: ${host}`);
    return c.text(
      `Invalid host: ${host}. Expected a subdomain of ${BASE_DOMAIN}.`,
      400
    );
  }

  // Extract the subdomain part
  const subdomain = host.substring(0, host.indexOf(`.${BASE_DOMAIN}`));

  if (!subdomain) {
    // This case should ideally be caught by the host === BASE_DOMAIN check above,
    // but adding it for robustness.
    console.error(`Could not extract subdomain from host: ${host}`);
    return c.text("Could not determine target service from hostname.", 400);
  }

  // Parse the incoming request URL to extract path and query parameters
  const incomingUrl = new URL(c.req.url);
  const pathAndQuery = `${incomingUrl.pathname}${incomingUrl.search}`;

  // Construct the internal target URL - Reverting to standard hostname format
  const targetUrl = `http://${subdomain}.railway.internal:${INTERNAL_PORT}${pathAndQuery}`;

  console.log(`Proxying request for ${host} to ${targetUrl}`);

  try {
    // Forward the request to the internal service
    // Pass through method, headers (excluding host), and body
    const requestHeaders = new Headers(c.req.header());
    requestHeaders.delete("host"); // Let fetch set the correct internal host

    const response = await fetch(targetUrl, {
      method: c.req.method,
      headers: requestHeaders,
      body: c.req.raw.body,
      redirect: "manual", // Prevent fetch from following redirects automatically
    });

    // Return the response from the internal service directly
    // Ensure headers like Content-Type are passed back
    const responseHeaders = new Headers(response.headers);
    // Remove Content-Encoding as fetch might auto-decompress
    responseHeaders.delete("Content-Encoding");
    // Add CORS headers if needed, though maybe not necessary for a pure proxy
    // responseHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error: any) {
    // Add type 'any' to access potential properties
    console.error(
      `Error proxying to ${targetUrl}:`,
      JSON.stringify(error, null, 2)
    ); // Log the full error object
    // Log specific properties if they exist
    if (error.cause)
      console.error("Error Cause:", JSON.stringify(error.cause, null, 2));
    if (error.code) console.error("Error Code:", error.code);
    if (error.errno) console.error("Error Errno:", error.errno);
    if (error.syscall) console.error("Error Syscall:", error.syscall);
    return c.text(
      `Failed to connect to the upstream service for ${subdomain}. Code: ${
        error.code || "N/A"
      }`, // Include error code in response
      502 // Bad Gateway
    );
  }
});

const port = parseInt(Bun.env.PORT ?? "3000"); // Use 3000 as a safer default if PORT isn't set
console.log(
  `Hono proxy server running on port ${port}, routing *.${BASE_DOMAIN}`
);

export default {
  port: port,
  fetch: app.fetch,
};
