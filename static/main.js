const socket = io();
let localStream;
let peerConnection;
let currentRoom;
let isConnected = false;

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
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
    console.log('Connected to server');
    statusDiv.textContent = 'Connected to server';
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    statusDiv.textContent = 'Disconnected from server';
    cleanupConnection();
});

async function startChat() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        socket.emit('join');
        startButton.disabled = true;
        nextButton.disabled = false;
        statusDiv.textContent = 'Waiting for a peer...';
    } catch (error) {
        console.error('Error accessing media devices:', error);
        statusDiv.textContent = 'Error accessing camera/microphone';
    }
}

function nextPeer() {
    cleanupConnection();
    socket.emit('join');
    statusDiv.textContent = 'Waiting for a peer...';
}

socket.on('matched', async (data) => {
    console.log('Matched with peer:', data);
    currentRoom = data.room;
    statusDiv.textContent = 'Connected to peer';
    
    try {
        await createPeerConnection(data.partnerId);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', {
            target: data.partnerId,
            sdp: offer
        });
    } catch (error) {
        console.error('Error creating offer:', error);
        statusDiv.textContent = 'Connection failed';
    }
});

socket.on('waiting', () => {
    statusDiv.textContent = 'Waiting for a peer...';
});

socket.on('offer', async (data) => {
    console.log('Received offer');
    try {
        if (!peerConnection) {
            await createPeerConnection(data.target);
        }
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
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
    console.log('Received answer');
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } catch (error) {
        console.error('Error handling answer:', error);
    }
});

socket.on('ice-candidate', async (data) => {
    console.log('Received ICE candidate');
    try {
        if (data.candidate) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    } catch (error) {
        console.error('Error adding ice candidate:', error);
    }
});

socket.on('partner_disconnected', () => {
    statusDiv.textContent = 'Partner disconnected';
    cleanupConnection();
});

async function createPeerConnection(partnerId) {
    if (peerConnection) {
        cleanupConnection();
    }

    console.log('Creating peer connection');
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: partnerId,
                candidate: event.candidate
            });
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'disconnected') {
            statusDiv.textContent = 'Peer disconnected';
            cleanupConnection();
        }
    };

    peerConnection.ontrack = (event) => {
        console.log('Received remote track');
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
        }
    };

    // Add local tracks to the connection
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });
}

function cleanupConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
}
