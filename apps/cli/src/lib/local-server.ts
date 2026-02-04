/**
 * Local HTTP server for OAuth callback handling.
 * Uses Bun's native HTTP server to receive the authorization code.
 */

type BunServer = ReturnType<typeof Bun.serve>;

export interface CallbackResult {
  code: string;
  state: string;
}

export interface CallbackError {
  error: string;
  errorDescription?: string;
}

/**
 * HTML page shown after successful authorization.
 */
const successHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Login Successful</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .card {
      background: white;
      padding: 40px 60px;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
    }
    .checkmark {
      width: 80px;
      height: 80px;
      background: #10b981;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
    }
    .checkmark svg {
      width: 40px;
      height: 40px;
      fill: white;
    }
    h1 { color: #1f2937; margin: 0 0 10px; }
    p { color: #6b7280; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="checkmark">
      <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
    </div>
    <h1>Login Successful</h1>
    <p>You can close this window and return to the terminal.</p>
  </div>
</body>
</html>`;

/**
 * HTML page shown when authorization fails.
 */
const errorHtml = (error: string, description?: string) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Login Failed</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    }
    .card {
      background: white;
      padding: 40px 60px;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
      max-width: 400px;
    }
    .error-icon {
      width: 80px;
      height: 80px;
      background: #ef4444;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
    }
    .error-icon svg {
      width: 40px;
      height: 40px;
      fill: white;
    }
    h1 { color: #1f2937; margin: 0 0 10px; }
    p { color: #6b7280; margin: 0; }
    .error-code { 
      font-family: monospace; 
      background: #f3f4f6; 
      padding: 8px 12px; 
      border-radius: 6px; 
      margin-top: 16px;
      font-size: 14px;
      color: #374151;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="error-icon">
      <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
    </div>
    <h1>Login Failed</h1>
    <p>${description || "An error occurred during authentication."}</p>
    <div class="error-code">${error}</div>
  </div>
</body>
</html>`;

/**
 * Find an available port starting from the given port.
 */
export async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  const maxAttempts = 10;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const server = Bun.serve({
        port,
        fetch: () => new Response(""),
      });
      server.stop();
      return port;
    } catch {
      port++;
    }
  }

  throw new Error(`Could not find an available port after ${maxAttempts} attempts`);
}

/**
 * Start a local HTTP server and wait for the OAuth callback.
 *
 * @param port - The port to listen on
 * @param expectedState - The expected state parameter for CSRF validation
 * @param timeoutMs - Timeout in milliseconds (default: 5 minutes)
 * @returns Promise that resolves with the authorization code
 */
export function waitForCallback(
  port: number,
  expectedState: string,
  timeoutMs = 300000
): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    let server: BunServer | null = null;
    let timeoutId: Timer | null = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (server) {
        server.stop();
        server = null;
      }
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Login timed out. Please try again."));
    }, timeoutMs);

    server = Bun.serve({
      port,
      fetch: (req) => {
        const url = new URL(req.url);

        // Only handle the callback path
        if (url.pathname !== "/callback") {
          return new Response("Not Found", { status: 404 });
        }

        // Check for error response from OAuth provider
        const error = url.searchParams.get("error");
        if (error) {
          const errorDescription = url.searchParams.get("error_description") || undefined;
          cleanup();
          reject({ error, errorDescription } as CallbackError);
          return new Response(errorHtml(error, errorDescription), {
            headers: { "Content-Type": "text/html" },
          });
        }

        // Get the authorization code
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        if (!code) {
          cleanup();
          reject(new Error("No authorization code received"));
          return new Response(errorHtml("missing_code", "No authorization code was received"), {
            headers: { "Content-Type": "text/html" },
          });
        }

        // Validate state to prevent CSRF
        if (state !== expectedState) {
          cleanup();
          reject(new Error("Invalid state parameter. Possible CSRF attack."));
          return new Response(errorHtml("invalid_state", "State parameter mismatch"), {
            headers: { "Content-Type": "text/html" },
          });
        }

        // Success!
        cleanup();
        resolve({ code, state });

        return new Response(successHtml, {
          headers: { "Content-Type": "text/html" },
        });
      },
    });
  });
}
