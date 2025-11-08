# Logger Server Setup

## Prerequisites

1. Python 3.8+ installed
2. ngrok installed (https://ngrok.com/)

## Setup Steps

### 1. Install Python Dependencies

```bash
pip install -r requirements.txt
```

### 2. Start the Logger Server

```bash
# Navigate to logger directory
cd logger

# Option 1: Using uvicorn directly
uvicorn logger_server:app --reload --port 8000

# Option 2: Using the start script
chmod +x start_logger.sh
./start_logger.sh
```

### 3. Start ngrok Tunnel

In a separate terminal:

```bash
# If you have ngrok authtoken configured:
ngrok http 8000

# Or with authtoken:
ngrok http 8000 --authtoken YOUR_NGROK_AUTH_TOKEN
```

### 4. Configure Plugin with ngrok URL

1. Copy the ngrok HTTPS URL (e.g., `https://abc123.ngrok.io`)
2. Open the Figma plugin
3. Paste the URL into the "Logger Server URL" field
4. The URL will be saved automatically

## Directory Structure

The logger server creates data in the project root:
```
logger_data/
├── generation_logs.json    # Running JSON file with all logs
└── media/
    ├── YYYY-MM-DD_HH-MM-SS-before.png
    └── YYYY-MM-DD_HH-MM-SS-after.png
```

The logger code is in:
```
logger/
├── logger_server.py
├── requirements.txt
├── start_logger.sh
└── README_LOGGER.md
```

## API Endpoints

- `GET /` - Server status
- `GET /health` - Health check
- `POST /log` - Receive generation log from plugin
- `GET /logs?limit=100` - Get recent logs

## Notes

- The server runs on `http://localhost:8000` by default
- ngrok makes it publicly accessible for the Figma plugin
- Logs are appended to `logger/generation_logs.json`
- Screenshots are saved to `logger/media/` with timestamped filenames

