const socket = io({
    transports: ['websocket'],
    upgrade: false,
    reconnection: true,
    reconnectionAttempts: 5
});

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
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    statusDiv.textContent = 'Disconnected from server';
    cleanupConnection();
});

async function startChat() {
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
    console.log('Looking for next peer');
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
        console.log('Creating offer for peer');
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
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
    console.log('Waiting for a peer to connect');
    statusDiv.textContent = 'Waiting for a peer...';
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
    statusDiv.textContent = 'Partner disconnected';
    cleanupConnection();
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
