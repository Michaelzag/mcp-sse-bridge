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
const es = new EventSource(sseUrl);
let sessionId = null;

// Forward messages to stdout
es.onmessage = (event) => {
  process.stdout.write(event.data + '\n');
};

// Handle the endpoint event to get the session ID
es.addEventListener('endpoint', (event) => {
  try {
    const endpointUrl = event.data;
    const url = new URL(endpointUrl);
    sessionId = url.searchParams.get('session_id');
  } catch (error) {
    console.error(`Failed to extract session ID: ${error.message}`);
    process.exit(1);
  }
});

// Forward stdin to HTTP POST
process.stdin.on('data', async (data) => {
  if (!sessionId) {
    return; // Wait for session ID
  }
  
  try {
    const message = data.toString().trim();
    
    // Post the message to the server
    const response = await fetch(`${postUrl}?session_id=${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: message,
    });
    
    if (!response.ok) {
      console.error(`HTTP error: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error(`Error sending message: ${error.message}`);
  }
});

// Handle SSE connection errors
es.onerror = (error) => {
  console.error(`SSE connection error:`, error);
};

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