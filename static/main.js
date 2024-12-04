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

// WebRTC configuration
const configuration = {
    iceServers: [
        {
            urls: [
                'turn:freeturn.net:3478',
                'turn:freeturn.net:3478?transport=tcp'
            ],
            username: 'free',
            credential: 'free'
        },
        {
            urls: [
                'turn:relay.metered.ca:80',
                'turn:relay.metered.ca:443',
                'turn:relay.metered.ca:443?transport=tcp',
                'turn:relay.metered.ca:80?transport=tcp'
            ],
            username: '83e4a0df687f3fd5e777f491',
            credential: 'L8YhnBwZ+q1Ey7Yc'
        },
        {
            urls: [
                'stun:stun.l.google.com:19302',
                'stun:stun1.l.google.com:19302',
                'stun:stun2.l.google.com:19302'
            ]
        }
    ],
    iceTransportPolicy: 'relay', // Force usage of TURN servers
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
};

const startButton = document.getElementById('startButton');
const nextButton = document.getElementById('nextButton');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const statusDiv = document.getElementById('status');

startButton.addEventListener('click', startChat);
nextButton.addEventListener('click', next);

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

let autoSkipTimer = null;
let isAutoSkipping = false;

function startAutoSkip() {
    if (!isAutoSkipping) {
        isAutoSkipping = true;
        checkAndSkip();
    }
}

function stopAutoSkip() {
    isAutoSkipping = false;
    if (autoSkipTimer) {
        clearTimeout(autoSkipTimer);
        autoSkipTimer = null;
    }
}

function checkAndSkip() {
    if (!isAutoSkipping) return;
    
    socket.emit('check_users', (response) => {
        console.log('Checking for users:', response);
        if (!response.hasUsers) {
            statusDiv.textContent = 'No users online. Will automatically connect when someone joins...';
            // Check again in 5 seconds
            autoSkipTimer = setTimeout(checkAndSkip, 5000);
        } else {
            statusDiv.textContent = 'Users found! Connecting...';
            stopAutoSkip();
            nextButton.click();
        }
    });
}

async function next() {
    if (isWaiting) {
        console.log('Already waiting for a peer');
        return;
    }

    console.log('Looking for next peer');
    cleanupConnection();
    isWaiting = true;
    nextButton.disabled = true;
    statusDiv.textContent = 'Looking for a peer...';

    // Start auto-skip if no users are available
    socket.emit('check_users', (response) => {
        if (!response.hasUsers) {
            startAutoSkip();
        }
    });

    socket.emit('next', async (response) => {
        if (response.error) {
            console.log('Error finding next peer:', response.error);
            statusDiv.textContent = response.error;
            if (response.error === 'no other users online') {
                startAutoSkip();
            }
            nextButton.disabled = false;
            isWaiting = false;
            return;
        }

        stopAutoSkip();
        currentRoom = response.room;
        console.log('Matched with peer:', response);
        
        try {
            await setupConnection(response.partnerId);
        } catch (error) {
            console.error('Error setting up connection:', error);
            statusDiv.textContent = 'Connection failed - Click Next to try again';
            nextButton.disabled = false;
            isWaiting = false;
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
    try {
        peerConnection = new RTCPeerConnection(configuration);
        console.log('Created peer connection with config:', configuration);
        
        // Add all tracks from local stream to peer connection
        localStream.getTracks().forEach(track => {
            console.log('Adding local track to peer connection:', track.kind);
            peerConnection.addTrack(track, localStream);
        });

        // Handle incoming tracks
        peerConnection.ontrack = (event) => {
            console.log('Received remote track:', event.track.kind);
            const [remoteStream] = event.streams;
            const remoteVideo = document.getElementById('remoteVideo');
            
            if (remoteStream && remoteVideo) {
                console.log('Setting remote video stream');
                
                // Set the stream immediately
                if (!remoteVideo.srcObject || remoteVideo.srcObject.id !== remoteStream.id) {
                    remoteVideo.srcObject = remoteStream;
                    console.log('New stream set:', remoteStream.id);
                    
                    // Log tracks in the stream
                    remoteStream.getTracks().forEach(track => {
                        console.log(`Remote track: ${track.kind}, enabled: ${track.enabled}, state: ${track.readyState}`);
                    });

                    // Try to play immediately
                    const playPromise = remoteVideo.play();
                    if (playPromise !== undefined) {
                        playPromise.catch(error => {
                            console.log('Immediate play failed, waiting for user interaction:', error);
                            // Add a play button if needed
                            remoteVideo.setAttribute('controls', '');
                        });
                    }
                }
                
                // Also try to play when metadata is loaded
                remoteVideo.onloadedmetadata = () => {
                    console.log('Remote video metadata loaded, attempting to play');
                    remoteVideo.play()
                        .then(() => {
                            console.log('Remote video playing successfully');
                            remoteVideo.removeAttribute('controls');
                            statusDiv.textContent = 'Connected to peer';
                            isWaiting = false;
                        })
                        .catch(error => {
                            console.error('Error playing remote video:', error);
                            // Show controls if autoplay fails
                            remoteVideo.setAttribute('controls', '');
                        });
                };

                // Additional event listeners for debugging
                remoteVideo.onplay = () => console.log('Remote video play event fired');
                remoteVideo.onplaying = () => console.log('Remote video playing event fired');
                remoteVideo.onwaiting = () => console.log('Remote video waiting for data');
                remoteVideo.onstalled = () => console.log('Remote video stalled');
            } else {
                console.error('Missing remote stream or video element');
            }
        };

        // Connection state handling
        peerConnection.onconnectionstatechange = () => {
            console.log('Connection state changed:', peerConnection.connectionState);
            switch(peerConnection.connectionState) {
                case 'connected':
                    console.log('Successfully connected to peer');
                    statusDiv.textContent = 'Connected to peer';
                    break;
                case 'disconnected':
                    console.log('Disconnected from peer');
                    statusDiv.textContent = 'Disconnected - Attempting to reconnect...';
                    // Don't cleanup immediately, give it a chance to reconnect
                    setTimeout(() => {
                        if (peerConnection && peerConnection.connectionState === 'disconnected') {
                            cleanupConnection();
                        }
                    }, 5000);
                    break;
                case 'failed':
                    console.log('Connection failed');
                    statusDiv.textContent = 'Connection failed - Click Next to try again';
                    cleanupConnection();
                    break;
                case 'closed':
                    console.log('Connection closed');
                    statusDiv.textContent = 'Connection closed - Click Next to try again';
                    cleanupConnection();
                    break;
            }
        };

        // ICE connection state handling
        peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE connection state:', peerConnection.iceConnectionState);
            switch(peerConnection.iceConnectionState) {
                case 'checking':
                    statusDiv.textContent = 'Connecting...';
                    break;
                case 'connected':
                    console.log('ICE connection established');
                    statusDiv.textContent = 'Connected';
                    break;
                case 'completed':
                    console.log('ICE connection completed');
                    break;
                case 'failed':
                    console.error('ICE connection failed');
                    // Try reconnecting with a new configuration
                    if (peerConnection) {
                        console.log('Attempting to restart ICE connection...');
                        peerConnection.restartIce();
                        // Create and send a new offer
                        createAndSendOffer();
                    }
                    break;
                case 'disconnected':
                    console.log('ICE connection disconnected');
                    statusDiv.textContent = 'Connection interrupted - Attempting to reconnect...';
                    if (peerConnection) {
                        console.log('Attempting to restart ICE connection...');
                        peerConnection.restartIce();
                    }
                    break;
            }
        };

        // ICE gathering state handling
        peerConnection.onicegatheringstatechange = () => {
            console.log('ICE gathering state:', peerConnection.iceGatheringState);
            switch(peerConnection.iceGatheringState) {
                case 'gathering':
                    console.log('Gathering ICE candidates...');
                    break;
                case 'complete':
                    console.log('ICE gathering completed');
                    break;
            }
        };

        // ICE candidate handling
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                const candidate = event.candidate;
                console.log('New ICE candidate:', {
                    type: candidate.type,
                    protocol: candidate.protocol,
                    address: candidate.address,
                    port: candidate.port,
                    priority: candidate.priority
                });
                
                // Only send relay candidates or if we've waited long enough
                if (candidate.type === 'relay' || peerConnection.iceGatheringState === 'complete') {
                    socket.emit('ice_candidate', {
                        target: partnerId,
                        candidate: candidate
                    });
                }
            } else {
                console.log('All ICE candidates have been gathered');
            }
        };

        return peerConnection;
    } catch (error) {
        console.error('Error creating peer connection:', error);
    }
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

function createAndSendOffer() {
    peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
    })
    .then(offer => {
        console.log('Setting local description');
        return peerConnection.setLocalDescription(offer);
    })
    .then(() => {
        console.log('Sending offer to peer');
        socket.emit('offer', {
            target: currentRoom,
            sdp: peerConnection.localDescription
        });
    })
    .catch(error => {
        console.error('Error creating and sending offer:', error);
    });
}
