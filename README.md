# MCP SSE Bridge

A simple bridge that connects Roo-Code to SSE-based MCP servers.

## What This Does

This small utility translates between:
- The stdin/stdout communication that Roo-Code uses
- The HTTP/SSE protocol that many MCP servers use

## Installation

1. Clone or download this repository
2. Install dependencies:
   ```
   npm install
   ```

## Usage

### Direct Usage

The server URL is required:

```
node index.js http://your-server-url:port
```

The script will exit with an error if the URL is not provided or invalid.

### Roo-Code Integration

Add this to your `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "your-server-name": {
      "command": "node",
      "args": [
        "path/to/mcp-sse-bridge/index.js",
        "http://your-server-url:port"
      ],
      "timeout": 120
    }
  }
}
```

Important: The server URL must be provided correctly in the args array.

### Example for Windows

```json
{
  "mcpServers": {
    "zagmems": {
      "command": "node",
      "args": [
        "C:\\Users\\username\\mcp-servers\\mcp-sse-bridge\\index.js",
        "http://thor.ffcem.com:8577"
      ],
      "timeout": 120
    }
  }
}
```

## How It Works

1. Connects to your server's SSE endpoint (`/sse`)
2. Receives messages from Roo via stdin and forwards them to your server 
3. Forwards responses from your server back to Roo via stdout

## Troubleshooting

- Make sure your server is running and accessible
- Check that your server uses the standard `/sse` and `/messages/` endpoints
- If it fails to connect, try accessing the server URL directly in your browser