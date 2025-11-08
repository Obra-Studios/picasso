#!/bin/bash
# Quick start script for logger server with ngrok
# Usage: ./start_logger.sh [ngrok-url]

echo "Starting Figma Plugin Logger Server..."
echo ""

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "Error: python3 not found. Please install Python 3.8+"
    exit 1
fi

# Check if dependencies are installed
if ! python3 -c "import fastapi" 2>/dev/null; then
    echo "Installing Python dependencies..."
    pip3 install -r requirements.txt
fi

# Change to logger directory
cd "$(dirname "$0")"

# Start the server
echo "Starting FastAPI server on port 8000..."
uvicorn logger_server:app --host 0.0.0.0 --port 8000 &
SERVER_PID=$!

echo "Server started (PID: $SERVER_PID)"
echo "Server running at: http://localhost:8000"
echo ""
echo "To start ngrok tunnel, run in another terminal:"
echo "  ngrok http 8000"
echo ""
echo "Then copy the ngrok HTTPS URL and paste it into the plugin's 'Logger Server URL' field"
echo ""
echo "To stop the server, run: kill $SERVER_PID"
echo "Or: pkill -f 'uvicorn logger_server'"
echo ""

# Wait for server
wait $SERVER_PID

