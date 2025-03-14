#!/usr/bin/env node

/**
 * Simple MCP SSE Bridge
 * 
 * Bridges between Roo-Code's stdio and an SSE-based MCP server.
 * 
 * Usage: node index.js <server-url>
 * Example: node index.js http://localhost:8077
 */

const fetch = require('node-fetch');
const EventSource = require('eventsource');

// Get server URL from command-line arguments
const serverUrl = process.argv[2];

// Check if URL is provided
if (!serverUrl) {
  console.error('Error: Server URL is required');
  console.error('Usage: node index.js <server-url>');
  console.error('Example: node index.js http://localhost:8077');
  process.exit(1);
}

// Validate URL format
try {
  new URL(serverUrl);
} catch (error) {
  console.error(`Error: Invalid URL format: ${serverUrl}`);
  console.error('Please provide a valid URL including the protocol (http:// or https://)');
  process.exit(1);
}

// Construct SSE and POST URLs
const sseUrl = `${serverUrl}/sse`;
const postUrl = `${serverUrl}/messages/`;

// Set up SSE connection
console.error(`Connecting to SSE endpoint: ${sseUrl}`);
const es = new EventSource(sseUrl);
let sessionId = null;
let connectTime = Date.now();
let isConnected = false;

// Connection opened handler
es.onopen = () => {
  isConnected = true;
  console.error(`SSE connection established (took ${Date.now() - connectTime}ms)`);
};

// Forward messages to stdout
es.onmessage = (event) => {
  try {
    // Update last message time to track server activity
    updateLastMessageTime();
    
    // Log received messages when debugging
    console.error(`Received message: ${event.data.substring(0, 100)}${event.data.length > 100 ? '...' : ''}`);
    process.stdout.write(event.data + '\n');
    // Make sure data is flushed
    process.stdout.flush?.();
  } catch (error) {
    console.error(`Error processing message: ${error.message}`);
  }
};

// Handle any other event types the server might send
es.addEventListener('message', (event) => {
  updateLastMessageTime();
  console.error(`Named message event received: ${event.data.substring(0, 100)}`);
  process.stdout.write(event.data + '\n');
  process.stdout.flush?.();
});

// Listen for other common event types
['ready', 'update', 'notification', 'error', 'ping'].forEach(eventName => {
  es.addEventListener(eventName, (event) => {
    updateLastMessageTime();
    console.error(`${eventName} event received`);
    process.stdout.write(JSON.stringify({
      event: eventName,
      data: event.data
    }) + '\n');
    process.stdout.flush?.();
  });
});

// Handle the endpoint event to get the session ID
es.addEventListener('endpoint', (event) => {
  // Debug information
  console.error(`Endpoint event received. Data type: ${typeof event.data}`);
  console.error(`Data content: ${event.data}`);
  
  try {
    // Multiple strategies to extract the session ID
    
    // Strategy 1: Try parsing as JSON if it's a string
    let parsedData = event.data;
    if (typeof event.data === 'string') {
      try {
        parsedData = JSON.parse(event.data);
        console.error('Successfully parsed data as JSON');
      } catch (e) {
        // Not JSON, continue with raw string
        console.error('Data is not JSON, using as raw string');
      }
    }
    
    // Strategy 2: Check if data is an object with session_id
    if (typeof parsedData === 'object' && parsedData !== null) {
      if (parsedData.session_id) {
        sessionId = parsedData.session_id;
        console.error(`Found session ID directly in object: ${sessionId}`);
        return;
      }
      
      // Try other common properties that might contain the URL
      if (parsedData.url || parsedData.endpoint || parsedData.uri) {
        const urlString = parsedData.url || parsedData.endpoint || parsedData.uri;
        console.error(`Found URL in object: ${urlString}`);
        try {
          const url = new URL(urlString);
          sessionId = url.searchParams.get('session_id');
          if (sessionId) {
            console.error(`Extracted session ID from URL params: ${sessionId}`);
            return;
          }
        } catch (e) {
          console.error(`Failed to parse URL from object: ${e.message}`);
        }
      }
    }
    
    // Strategy 3: Try direct URL parsing (original approach)
    try {
      const endpointUrl = event.data;
      const url = new URL(endpointUrl);
      sessionId = url.searchParams.get('session_id');
      if (sessionId) {
        console.error(`Extracted session ID from direct URL: ${sessionId}`);
        return;
      }
    } catch (e) {
      console.error(`Failed direct URL parsing: ${e.message}`);
    }
    
    // Strategy 4: Look for session_id in the URL path
    if (typeof event.data === 'string' && event.data.includes('session_id')) {
      const match = event.data.match(/session_id=([^&]+)/);
      if (match && match[1]) {
        sessionId = match[1];
        console.error(`Extracted session ID from URL string pattern: ${sessionId}`);
        return;
      }
    }
    
    // If we got here, we failed to extract the session ID
    console.error('Failed to extract session ID using all strategies');
    console.error('Will continue running but bridge may not function correctly');
    
  } catch (error) {
    console.error(`Error in endpoint event handler: ${error.message}`);
    console.error(`Event data was: ${typeof event.data}:`, event.data);
    // Don't exit on error, just log it and continue
  }
});

// Forward stdin to HTTP POST
process.stdin.on('data', async (data) => {
  if (!isConnected) {
    console.error('Cannot send message: No connection to server');
    return;
  }
  
  if (!sessionId) {
    console.error('Cannot send message: Waiting for session ID (still initializing)');
    return;
  }
  
  try {
    const message = data.toString().trim();
    console.error(`Sending message to ${postUrl}?session_id=${sessionId}`);
    
    // Create an AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.error('Request timed out after 10 seconds');
      // Send a formatted error back to Roo
      process.stdout.write(JSON.stringify({
        error: "timeout",
        message: "Request timed out after 10 seconds"
      }) + '\n');
      process.stdout.flush?.();
    }, 10000); // 10 second timeout
    
    // Post the message to the server
    const response = await fetch(`${postUrl}?session_id=${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: message,
      signal: controller.signal
    });
    
    // Clear the timeout
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.error(`HTTP error: ${response.status} ${response.statusText}`);
      let errorMessage = `HTTP error: ${response.status} ${response.statusText}`;
      
      if (response.status === 404) {
        errorMessage = 'Endpoint not found. Make sure server has a /messages/ endpoint';
      } else if (response.status === 401 || response.status === 403) {
        errorMessage = 'Authentication error. Session ID might be invalid';
      }
      
      console.error(errorMessage);
      
      // Send a formatted error response back to Roo
      process.stdout.write(JSON.stringify({
        error: "http_error",
        status: response.status,
        message: errorMessage
      }) + '\n');
      process.stdout.flush?.();
      
    } else {
      console.error('Message sent successfully');
      
      // Forward the response back to stdout for Roo
      try {
        const responseData = await response.text();
        console.error(`Got response: ${responseData.substring(0, 100)}${responseData.length > 100 ? '...' : ''}`);
        process.stdout.write(responseData + '\n');
        process.stdout.flush?.();
      } catch (e) {
        console.error(`Error reading response: ${e.message}`);
        process.stdout.write(JSON.stringify({
          error: "response_error",
          message: e.message
        }) + '\n');
        process.stdout.flush?.();
      }
    }
  } catch (error) {
    console.error(`Error sending message: ${error.message}`);
    
    let errorType = "request_error";
    let errorMessage = error.message;
    
    if (error.name === 'AbortError') {
      errorType = "timeout";
      errorMessage = "Request timed out after 10 seconds";
    } else if (error.code === 'ECONNREFUSED') {
      errorType = "connection_refused";
      errorMessage = "Connection refused. Make sure the server is running and accessible";
    }
    
    console.error(errorMessage);
    
    // Send a formatted error response back to Roo
    process.stdout.write(JSON.stringify({
      error: errorType,
      message: errorMessage
    }) + '\n');
    process.stdout.flush?.();
  }
});

// Handle SSE connection errors
es.onerror = (error) => {
  isConnected = false;
  console.error(`SSE connection error:`, error);
  
  // If error persists for a while, provide more helpful debugging information
  if (!sessionId && (Date.now() - connectTime > 10000)) {
    console.error('\nConnection troubleshooting suggestions:');
    console.error('1. Verify the server URL is correct');
    console.error('2. Check that the server is running and accessible');
    console.error('3. Ensure the server supports SSE connections at the /sse endpoint');
    console.error('4. Check if the server is using a different port (8077 instead of 8577)');
    console.error('5. Try accessing the SSE endpoint directly in a browser\n');
  }
};

// Add a heartbeat mechanism to diagnose communication issues
let lastMessageTime = Date.now();
let heartbeatCount = 0;

// Set up a timer to check connection status and send heartbeats
const statusTimer = setInterval(() => {
  if (!isConnected) {
    console.error(`Still trying to connect to ${sseUrl}...`);
  } else if (!sessionId) {
    console.error('Connected but waiting for session ID...');
  } else {
    // If we have a session ID but no messages for 30 seconds, try sending a heartbeat
    const idleTime = Date.now() - lastMessageTime;
    if (idleTime > 30000) { // 30 seconds
      // Send a ping message to check if the server is responding
      heartbeatCount++;
      console.error(`Sending heartbeat #${heartbeatCount} after ${Math.round(idleTime/1000)}s of silence...`);
      
      try {
        // Create a dummy heartbeat message that follows MCP JSON-RPC protocol format
        const heartbeatMessage = JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "search_memories",
            arguments: {
              query: "ping",
              limit: 1
            }
          },
          id: `heartbeat-${heartbeatCount}`
        });
        
        // Send it directly to stdin handler to use existing error handling
        process.stdin.emit('data', Buffer.from(heartbeatMessage));
        
        // Update last message time to avoid sending too many heartbeats
        lastMessageTime = Date.now();
      } catch (e) {
        console.error(`Error sending heartbeat: ${e.message}`);
      }
      
      // If we've sent 5 heartbeats with no response, there's likely an issue
      if (heartbeatCount >= 5) {
        console.error('\n-------------------------------------------------------------');
        console.error('WARNING: Server appears unresponsive after multiple heartbeats');
        console.error('This may indicate a server issue rather than a bridge problem');
        console.error('Consider checking server logs or restarting the server');
        console.error('-------------------------------------------------------------\n');
      }
    }
  }
}, 5000);

// Update lastMessageTime whenever we receive any message
const updateLastMessageTime = () => {
  lastMessageTime = Date.now();
  heartbeatCount = 0; // Reset heartbeat count when we get any message
};

// Clear the timer on exit
process.on('exit', () => {
  clearInterval(statusTimer);
});

// Handle process exit
process.on('exit', () => {
  es.close();
});

// Handle process termination signals
process.on('SIGINT', () => {
  es.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  es.close();
  process.exit(0);
});