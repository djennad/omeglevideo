# Random Video Chat Application

A web-based random video chat application similar to Omegle, built with Flask and WebRTC.

## Features

- Random video chat with strangers
- Real-time peer-to-peer video and audio communication
- Simple and intuitive interface
- "Next" functionality to find new chat partners

## Prerequisites

- Python 3.8 or higher
- Webcam and microphone
- Modern web browser (Chrome, Firefox, or Safari)

## Installation

1. Install the required dependencies:
```bash
pip install -r requirements.txt
```

2. Run the application:
```bash
python app.py
```

3. Open your web browser and navigate to:
```
http://localhost:5000
```

## Usage

1. Click the "Start" button to begin
2. Allow camera and microphone access when prompted
3. Wait to be matched with another user
4. Click "Next" to skip the current user and find a new match

## Security Notes

- All video/audio communication is peer-to-peer
- No data is stored on the server
- Use at your own risk and be mindful of privacy

## Technologies Used

- Flask (Python web framework)
- WebRTC (Real-time communication)
- Socket.IO (Real-time events)
- JavaScript (Frontend logic)
