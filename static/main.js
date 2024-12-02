const socket = io({
    transports: ['websocket'],
    upgrade: false,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: 10000
});

let localStream;
let peerConnection;
let currentRoom;
let isConnected = false;
let isWaiting = false;

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        {
            urls: 'turn:numb.viagenie.ca',
            username: 'webrtc@live.com',
            credential: 'muazkh'
        }
    ],
    iceCandidatePoolSize: 10
};

const startButton = document.getElementById('startButton');
const nextButton = document.getElementById('nextButton');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const statusDiv = document.getElementById('status');

startButton.addEventListener('click', startChat);
nextButton.addEventListener('click', nextPeer);

// Socket connection status
socket.on('connect', () => {
    console.log('Connected to server with ID:', socket.id);
    statusDiv.textContent = 'Connected to server';
    isConnected = true;
    startButton.disabled = false;
});

socket.on('connection_status', (data) => {
    console.log('Connection status:', data);
    statusDiv.textContent = `Connected (ID: ${data.id})`;
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    statusDiv.textContent = 'Disconnected from server - Trying to reconnect...';
    isConnected = false;
    isWaiting = false;
    startButton.disabled = true;
    nextButton.disabled = true;
    cleanupConnection();
});

socket.on('error', (data) => {
    console.error('Server error:', data.message);
    statusDiv.textContent = `Error: ${data.message}`;
    if (data.message === 'Already waiting or in a chat') {
        cleanupConnection();
        isWaiting = false;
        startButton.disabled = false;
        nextButton.disabled = true;
    }
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    statusDiv.textContent = 'Connection error - Please check your internet connection';
    isConnected = false;
    isWaiting = false;
    startButton.disabled = true;
    nextButton.disabled = true;
});

socket.on('reconnect', (attemptNumber) => {
    console.log('Reconnected after', attemptNumber, 'attempts');
    statusDiv.textContent = 'Reconnected to server';
    isConnected = true;
    startButton.disabled = false;
});

socket.on('reconnect_error', (error) => {
    console.error('Reconnection error:', error);
    statusDiv.textContent = 'Failed to reconnect - Please refresh the page';
});

socket.on('reconnect_failed', () => {
    console.error('Failed to reconnect');
    statusDiv.textContent = 'Failed to reconnect - Please refresh the page';
});

async function startChat() {
    if (!isConnected) {
        statusDiv.textContent = 'Not connected to server - Please wait...';
        return;
    }

    if (isWaiting) {
        statusDiv.textContent = 'Already waiting for a peer...';
        return;
    }

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                width: { ideal: 640 },
                height: { ideal: 480 }
            }, 
            audio: true 
        });
        localVideo.srcObject = localStream;
        console.log('Local stream acquired successfully');
        
        isWaiting = true;
        socket.emit('join');
        startButton.disabled = true;
        nextButton.disabled = false;
        statusDiv.textContent = 'Waiting for a peer...';
    } catch (error) {
        console.error('Error accessing media devices:', error);
        statusDiv.textContent = 'Error accessing camera/microphone';
        isWaiting = false;
    }
}

function nextPeer() {
    if (!isConnected) {
        statusDiv.textContent = 'Not connected to server - Please wait...';
        return;
    }

    console.log('Looking for next peer');
    cleanupConnection();
    isWaiting = true;
    socket.emit('join');
    statusDiv.textContent = 'Waiting for a peer...';
}

socket.on('waiting', () => {
    console.log('Waiting for a peer to connect');
    statusDiv.textContent = 'Waiting for someone to join...';
    isWaiting = true;
});

socket.on('matched', (data) => {
    console.log('Matched with peer:', data);
    statusDiv.textContent = 'Connected to peer - Starting video call...';
    currentRoom = data.room;
    isWaiting = false;
    
    createPeerConnection(data.partnerId).then(() => {
        console.log('Creating offer for peer');
        return peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
    }).then(offer => {
        console.log('Setting local description');
        return peerConnection.setLocalDescription(offer);
    }).then(() => {
        console.log('Sending offer to peer');
        socket.emit('offer', {
            target: data.partnerId,
            sdp: peerConnection.localDescription
        });
    }).catch(error => {
        console.error('Error in connection setup:', error);
        statusDiv.textContent = 'Failed to setup connection';
        cleanupConnection();
    });
});

socket.on('offer', async (data) => {
    console.log('Received offer from peer');
    try {
        if (!peerConnection) {
            await createPeerConnection(data.target);
        }
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        console.log('Creating answer for peer');
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', {
            target: data.target,
            sdp: answer
        });
    } catch (error) {
        console.error('Error handling offer:', error);
        statusDiv.textContent = 'Connection failed';
    }
});

socket.on('answer', async (data) => {
    console.log('Received answer from peer');
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        console.log('Remote description set successfully');
    } catch (error) {
        console.error('Error handling answer:', error);
    }
});

socket.on('ice-candidate', async (data) => {
    console.log('Received ICE candidate');
    try {
        if (data.candidate) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            console.log('Added ICE candidate successfully');
        }
    } catch (error) {
        console.error('Error adding ice candidate:', error);
    }
});

socket.on('partner_disconnected', () => {
    console.log('Partner disconnected');
    statusDiv.textContent = 'Partner disconnected - Click Next to find another partner';
    cleanupConnection();
    isWaiting = false;
});

async function createPeerConnection(partnerId) {
    if (peerConnection) {
        cleanupConnection();
    }

    console.log('Creating new peer connection');
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Sending ICE candidate to peer');
            socket.emit('ice-candidate', {
                target: partnerId,
                candidate: event.candidate
            });
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'disconnected' || 
            peerConnection.iceConnectionState === 'failed') {
            statusDiv.textContent = 'Peer connection lost';
            cleanupConnection();
        }
    };

    peerConnection.ontrack = (event) => {
        console.log('Received remote track');
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            console.log('Set remote video stream');
        }
    };

    // Add local tracks to the connection
    localStream.getTracks().forEach(track => {
        console.log('Adding local track to peer connection:', track.kind);
        peerConnection.addTrack(track, localStream);
    });
}

function cleanupConnection() {
    if (peerConnection) {
        console.log('Cleaning up peer connection');
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
}
