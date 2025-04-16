import React, { useState, useEffect, useRef, useCallback } from "react";

function App() {
  const [orgName, setOrgName] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [messages, setMessages] = useState([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState(null);
  const [finalUrl, setFinalUrl] = useState(null);
  const eventSourceRef = useRef(null);
  const logContainerRef = useRef(null);

  // Function to scroll log to bottom
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [messages]); // Scroll whenever messages update

  // Cleanup SSE connection on component unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        console.log("Closing SSE connection on unmount");
        eventSourceRef.current.close();
      }
    };
  }, []);

  const handleDeploy = async (event) => {
    event.preventDefault();
    if (isDeploying || isComplete) return; // Prevent multiple submissions

    setIsDeploying(true);
    setIsComplete(false);
    setMessages([{ type: "info", text: "Deployment process initiated..." }]);
    setError(null);
    setFinalUrl(null);

    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      // Make the POST request to the backend to start deployment
      const response = await fetch("/deploy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orgName, geminiKey }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to initiate deployment: ${response.status} ${errorText}`
        );
      }

      // Get the deployment ID from the response (server needs to send this back)
      const { deploymentId } = await response.json();

      if (!deploymentId) {
        throw new Error("Server did not return a deployment ID.");
      }

      console.log(`Received deployment ID: ${deploymentId}`);
      setMessages((prev) => [
        ...prev,
        { type: "info", text: `Tracking deployment ID: ${deploymentId}` },
      ]);

      // Establish SSE connection
      console.log(`Connecting to SSE: /status/${deploymentId}`);
      eventSourceRef.current = new EventSource(`/status/${deploymentId}`);

      eventSourceRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("SSE Message Received:", data);

          setMessages((prev) => [
            ...prev,
            { type: data.isError ? "error" : "info", text: data.message },
          ]);

          if (data.isComplete) {
            console.log("SSE indicated completion.");
            setIsDeploying(false);
            setIsComplete(true);
            if (!data.isError && data.data && data.data.appUrl) {
              setFinalUrl(data.data.appUrl);
            } else if (data.isError) {
              setError(data.message); // Set final error message
            }
            eventSourceRef.current.close(); // Close connection on completion
          }
        } catch (parseError) {
          console.error("Failed to parse SSE message:", event.data, parseError);
          setMessages((prev) => [
            ...prev,
            {
              type: "error",
              text: `Failed to parse status update: ${event.data}`,
            },
          ]);
        }
      };

      eventSourceRef.current.onerror = (err) => {
        console.error("SSE Error:", err);
        setError("Connection error with status updates.");
        setMessages((prev) => [
          ...prev,
          { type: "error", text: "Status update connection error." },
        ]);
        setIsDeploying(false);
        setIsComplete(true); // Mark as complete on error too
        eventSourceRef.current.close();
      };
    } catch (err) {
      console.error("Deployment initiation error:", err);
      setError(err.message || "An unexpected error occurred.");
      setMessages((prev) => [
        ...prev,
        { type: "error", text: `Error: ${err.message}` },
      ]);
      setIsDeploying(false);
      setIsComplete(true); // Mark as complete on error
    }
  };

  const copyUrl = useCallback(() => {
    if (!finalUrl) return;
    navigator.clipboard
      .writeText(finalUrl)
      .then(() => {
        alert("URL Copied!"); // Simple feedback for now
      })
      .catch((err) => {
        console.error("Failed to copy URL: ", err);
        alert("Failed to copy URL. Please copy manually.");
      });
  }, [finalUrl]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h1 className="text-2xl font-semibold mb-6 text-center">
          Deploy New Canyon Chat Instance
        </h1>
        <p className="mb-4">This version runs on fly.io, which is better!</p>

        <form onSubmit={handleDeploy} className="space-y-4">
          <div>
            <label
              htmlFor="orgName"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Organization Name:
            </label>
            <input
              type="text"
              id="orgName"
              name="orgName"
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              disabled={isDeploying || isComplete}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50"
              placeholder="e.g., my-company"
            />
            <p className="text-xs text-gray-500 mt-1">
              Used to generate a unique app name.
            </p>
          </div>
          <div>
            <label
              htmlFor="geminiKey"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Google Gemini API Key:
            </label>
            <input
              type="password"
              id="geminiKey"
              name="geminiKey"
              required
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              disabled={isDeploying || isComplete}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50"
              placeholder="Enter your API key"
            />
            <p className="text-xs text-gray-500 mt-1">
              This will be stored as a secret in the Fly app.
            </p>
          </div>
          <button
            type="submit"
            disabled={isDeploying || isComplete}
            className="w-full bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition duration-150 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDeploying
              ? "Deploying..."
              : isComplete
              ? "Finished"
              : "Deploy App"}
          </button>
        </form>

        {(isDeploying || isComplete || messages.length > 0) && (
          <div className="mt-6 p-4 border border-gray-300 bg-gray-50 rounded-md">
            <h3 className="text-lg font-semibold mb-2">Deployment Progress</h3>
            <div
              ref={logContainerRef}
              className="space-y-1 text-sm font-mono max-h-60 overflow-y-auto border border-gray-200 p-2 bg-white rounded mb-4"
            >
              {messages.map((msg, index) => (
                <p
                  key={index}
                  className={
                    msg.type === "error" ? "text-red-600" : "text-gray-700"
                  }
                >
                  {msg.text}
                </p>
              ))}
            </div>

            {isComplete && (
              <div className="mt-4">
                {finalUrl && !error && (
                  <div className="p-4 border border-green-300 bg-green-100 text-green-700 rounded-md">
                    Deployment successful! App available at:
                    <br />
                    <span className="font-mono break-all">{finalUrl}</span>
                    <button
                      onClick={copyUrl}
                      className="ml-2 mt-2 px-2 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                    >
                      Copy URL
                    </button>
                  </div>
                )}
                {error && (
                  <div className="p-4 border border-red-300 bg-red-100 text-red-700 rounded-md">
                    <strong>Deployment Failed:</strong> {error}
                  </div>
                )}
                <button
                  onClick={() => window.location.reload()} // Simple way to reset for another deployment
                  className="mt-4 inline-block bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600"
                >
                  {error ? "Try Again" : "Deploy Another"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
