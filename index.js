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
    // Log received messages when debugging
    console.error(`Received message: ${event.data.substring(0, 100)}${event.data.length > 100 ? '...' : ''}`);
    process.stdout.write(event.data + '\n');
  } catch (error) {
    console.error(`Error processing message: ${error.message}`);
  }
};

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
    
    // Post the message to the server
    const response = await fetch(`${postUrl}?session_id=${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: message,
    });
    
    if (!response.ok) {
      console.error(`HTTP error: ${response.status} ${response.statusText}`);
      if (response.status === 404) {
        console.error('Endpoint not found. Make sure server has a /messages/ endpoint');
      } else if (response.status === 401 || response.status === 403) {
        console.error('Authentication error. Session ID might be invalid');
      }
    } else {
      console.error('Message sent successfully');
    }
  } catch (error) {
    console.error(`Error sending message: ${error.message}`);
    if (error.code === 'ECONNREFUSED') {
      console.error('Connection refused. Make sure the server is running and accessible');
    }
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

// Set up a timer to check connection status
const statusTimer = setInterval(() => {
  if (!isConnected) {
    console.error(`Still trying to connect to ${sseUrl}...`);
  } else if (!sessionId) {
    console.error('Connected but waiting for session ID...');
  }
}, 5000);

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