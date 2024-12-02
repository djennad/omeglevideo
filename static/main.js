const socket = io();
let localStream;
let peerConnection;
let userId;
let currentRoom;

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

const startButton = document.getElementById('startButton');
const nextButton = document.getElementById('nextButton');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const statusDiv = document.getElementById('status');

startButton.addEventListener('click', startChat);
nextButton.addEventListener('click', nextPeer);

async function startChat() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        userId = Math.random().toString(36).substr(2, 9);
        socket.emit('join', { userId });
        startButton.disabled = true;
        nextButton.disabled = false;
        statusDiv.textContent = 'Waiting for a peer...';
    } catch (error) {
        console.error('Error accessing media devices:', error);
        statusDiv.textContent = 'Error accessing camera/microphone';
    }
}

function nextPeer() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    socket.emit('join', { userId });
    statusDiv.textContent = 'Waiting for a peer...';
}

socket.on('matched', async (data) => {
    currentRoom = data.room;
    statusDiv.textContent = 'Connected to peer';
    createPeerConnection(data.partnerId);
    
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', {
            target: data.partnerId,
            sdp: offer
        });
    } catch (error) {
        console.error('Error creating offer:', error);
    }
});

socket.on('waiting', () => {
    statusDiv.textContent = 'Waiting for a peer...';
});

socket.on('offer', async (data) => {
    if (!peerConnection) {
        createPeerConnection(data.target);
    }
    
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', {
            target: data.target,
            sdp: answer
        });
    } catch (error) {
        console.error('Error handling offer:', error);
    }
});

socket.on('answer', async (data) => {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } catch (error) {
        console.error('Error handling answer:', error);
    }
});

socket.on('ice-candidate', async (data) => {
    try {
        if (data.candidate) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    } catch (error) {
        console.error('Error adding ice candidate:', error);
    }
});

function createPeerConnection(partnerId) {
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: partnerId,
                candidate: event.candidate
            });
        }
    };

    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
    };

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'disconnected') {
            statusDiv.textContent = 'Peer disconnected';
            nextButton.disabled = false;
        }
    };
}
