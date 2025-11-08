#!/bin/bash
# Run the logger server with ngrok
# Make sure to install dependencies first: pip install -r requirements.txt

echo "Starting logger server..."
echo "Make sure ngrok is installed and configured"
echo ""

# Start the FastAPI server in the background
uvicorn logger_server:app --host 0.0.0.0 --port 8000 &
SERVER_PID=$!

echo "Logger server started on http://localhost:8000 (PID: $SERVER_PID)"
echo ""

# Wait a moment for server to start
sleep 2

# Start ngrok (you'll need to provide your ngrok auth token)
# Replace YOUR_NGROK_AUTH_TOKEN with your actual token
echo "Starting ngrok tunnel..."
echo "Please provide your ngrok URL and update it in the plugin settings"
echo ""

# Uncomment and configure ngrok command:
# ngrok http 8000 --authtoken YOUR_NGROK_AUTH_TOKEN

echo ""
echo "To stop the server, run: kill $SERVER_PID"
echo "Or use: pkill -f 'uvicorn logger_server'"

# Keep script running
wait $SERVER_PID

