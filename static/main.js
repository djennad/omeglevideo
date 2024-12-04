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
    isConnected = true;
    statusDiv.textContent = 'Connected to server';
});

socket.on('connection_status', (data) => {
    console.log('Connection status:', data);
    statusDiv.textContent = `Connected (ID: ${data.id})`;
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    if (isWaiting) {
        statusDiv.textContent = 'No other users online - Waiting for someone to join...';
    } else {
        statusDiv.textContent = 'Disconnected - Please refresh the page';
    }
    isConnected = false;
    isWaiting = false;
    startButton.disabled = true;
    nextButton.disabled = true;
    cleanupConnection();
});

socket.on('error', (data) => {
    console.error('Server error:', data.message);
    if (data.message.includes('no other users')) {
        statusDiv.textContent = 'No other users online - Staying in current chat';
        setTimeout(() => {
            if (peerConnection) {
                statusDiv.textContent = 'Connected to peer';
            }
        }, 3000);
    } else {
        statusDiv.textContent = 'Error: ' + data.message;
    }
    if (data.message === 'Already waiting or in a chat') {
        cleanupConnection();
        isWaiting = false;
        startButton.disabled = false;
        nextButton.disabled = true;
    }
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    if (error.message === 'timeout') {
        statusDiv.textContent = 'No other users online right now - Waiting for someone to join...';
    } else {
        statusDiv.textContent = 'Connection error - Please refresh the page';
    }
    isConnected = false;
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
        statusDiv.textContent = 'Not connected to server - Please refresh the page';
        return;
    }

    // First check if there are other users online
    socket.emit('check_users', (response) => {
        if (response.hasUsers) {
            console.log('Looking for next peer');
            cleanupConnection();
            isWaiting = true;
            statusDiv.textContent = 'Looking for next person...';
            socket.emit('next');
        } else {
            console.log('No other users online, staying in current connection');
            statusDiv.textContent = 'No other users online right now - Staying in current chat';
            setTimeout(() => {
                if (peerConnection) {
                    statusDiv.textContent = 'Connected to peer';
                }
            }, 3000);
        }
    });
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
        // Only create offer if we're the initiator (user1)
        if (socket.id === data.initiator) {
            console.log('Creating offer as initiator');
            return peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
        }
    }).then(offer => {
        if (offer) { // only if we created an offer
            console.log('Setting local description');
            return peerConnection.setLocalDescription(offer);
        }
    }).then(() => {
        if (socket.id === data.initiator) { // only if we're the initiator
            console.log('Sending offer to peer');
            socket.emit('offer', {
                target: data.partnerId,
                sdp: peerConnection.localDescription
            });
        }
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
        console.log('Creating answer');
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        console.log('Sending answer to peer');
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
        if (peerConnection && peerConnection.signalingState === "have-local-offer") {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            console.log('Remote description set successfully');
        } else {
            console.warn('Received answer in wrong state:', peerConnection?.signalingState);
        }
    } catch (error) {
        console.error('Error handling answer:', error);
    }
});

socket.on('ice_candidate', async (data) => {
    try {
        if (peerConnection) {
            console.log('Received ICE candidate');
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            console.log('Added ICE candidate successfully');
        }
    } catch (error) {
        console.error('Error adding ICE candidate:', error);
    }
});

socket.on('partner_disconnected', () => {
    console.log('Partner disconnected');
    // Check if there are other users before cleaning up
    socket.emit('check_users', (response) => {
        if (response.hasUsers) {
            console.log('Other users online, looking for next partner');
            cleanupConnection();
            isWaiting = true;
            statusDiv.textContent = 'Partner left - Looking for a new person...';
            socket.emit('next');
        } else {
            console.log('No other users online, keeping connection ready');
            statusDiv.textContent = 'Partner left - Waiting for new users to join...';
            // Don't cleanup connection, just wait for new users
            isWaiting = true;
        }
    });
});

async function createPeerConnection(partnerId) {
    console.log('Creating new peer connection');
    const configuration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
        ]
    };

    peerConnection = new RTCPeerConnection(configuration);
    
    // Add all tracks from local stream to peer connection
    localStream.getTracks().forEach(track => {
        console.log('Adding local track to peer connection:', track.kind);
        peerConnection.addTrack(track, localStream);
    });

    // Handle incoming tracks
    peerConnection.ontrack = (event) => {
        console.log('Received remote track');
        const [remoteStream] = event.streams;
        const remoteVideo = document.getElementById('remoteVideo');
        
        if (remoteStream && remoteVideo) {
            console.log('Setting remote video stream');
            remoteVideo.srcObject = remoteStream;
            
            // Wait for video to be ready before playing
            remoteVideo.onloadedmetadata = () => {
                console.log('Remote video metadata loaded, attempting to play');
                const playPromise = remoteVideo.play();
                
                if (playPromise !== undefined) {
                    playPromise
                        .then(() => {
                            console.log('Remote video playing successfully');
                        })
                        .catch(error => {
                            console.error('Error playing remote video:', error);
                            // Try to play again after a short delay
                            setTimeout(() => {
                                remoteVideo.play()
                                    .then(() => console.log('Remote video playing after retry'))
                                    .catch(e => console.error('Failed to play video after retry:', e));
                            }, 1000);
                        });
                }
            };
            
            // Handle video playing
            remoteVideo.onplaying = () => {
                console.log('Remote video is now playing');
                statusDiv.textContent = 'Connected to peer';
                isWaiting = false;
            };
            
            // Handle video errors
            remoteVideo.onerror = (error) => {
                console.error('Remote video error:', error);
            };
        } else {
            console.error('Missing remote stream or video element');
        }
    };

    // ICE candidate handling
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Sending ICE candidate to peer');
            socket.emit('ice_candidate', {
                target: partnerId,
                candidate: event.candidate
            });
        }
    };

    // Connection state handling
    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'connected') {
            statusDiv.textContent = 'Connected to peer';
            isWaiting = false;
        } else if (peerConnection.iceConnectionState === 'failed') {
            console.error('ICE connection failed');
            statusDiv.textContent = 'Connection failed - Click Next to try again';
        }
    };

    return peerConnection;
}

function cleanupConnection() {
    console.log('Cleaning up peer connection');
    if (peerConnection) {
        // Close all tracks but keep the connection
        const senders = peerConnection.getSenders();
        senders.forEach(sender => {
            if (sender.track) {
                sender.track.stop();
            }
        });
        
        // Only close the connection if we're sure we want to disconnect
        if (!isWaiting) {
            peerConnection.close();
            peerConnection = null;
        }
    }
    
    // Clear remote video
    const remoteVideo = document.getElementById('remoteVideo');
    if (remoteVideo.srcObject) {
        const tracks = remoteVideo.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        remoteVideo.srcObject = null;
    }
}
