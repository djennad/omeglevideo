from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room, disconnect
import logging
import os
from threading import Lock

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins='*', logger=True, engineio_logger=True)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class UserManager:
    def __init__(self):
        self.waiting_users = []
        self.active_users = {}  # {user_id: partner_id}
        self.lock = Lock()

    def add_waiting_user(self, user_id):
        with self.lock:
            # Don't add if already waiting or active
            if user_id in self.waiting_users or user_id in self.active_users:
                logger.info(f"User {user_id} already in waiting list or active")
                return False
            
            self.waiting_users.append(user_id)
            logger.info(f"Added user {user_id} to waiting list. Current waiting: {len(self.waiting_users)}")
            return True

    def remove_user(self, user_id):
        with self.lock:
            # Remove from waiting list
            if user_id in self.waiting_users:
                self.waiting_users.remove(user_id)
                logger.info(f"Removed user {user_id} from waiting list")

            # Remove from active users and notify partner
            if user_id in self.active_users:
                partner_id = self.active_users[user_id]
                if partner_id in self.active_users:
                    del self.active_users[partner_id]
                    emit('partner_disconnected', room=partner_id)
                    logger.info(f"Notified partner {partner_id} of disconnection")
                del self.active_users[user_id]
                logger.info(f"Removed user {user_id} from active users")

    def try_match_users(self):
        with self.lock:
            logger.info(f"Trying to match users. Waiting users: {len(self.waiting_users)}")
            
            if len(self.waiting_users) < 2:
                logger.info("Not enough users to make a match")
                return None

            # Get the first two waiting users
            user1 = self.waiting_users[0]
            user2 = self.waiting_users[1]

            # Remove both users from waiting list
            self.waiting_users = self.waiting_users[2:]

            # Add them to active users
            self.active_users[user1] = user2
            self.active_users[user2] = user1
            
            room = f"room_{user1}_{user2}"
            logger.info(f"Successfully matched users {user1} and {user2} in room {room}")
            
            # Make both users join the room
            join_room(room, user1)
            join_room(room, user2)
            
            return {'user1': user1, 'user2': user2, 'room': room}

user_manager = UserManager()

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    logger.info(f"User {request.sid} connected")
    emit('connection_status', {'status': 'connected', 'id': request.sid})

@socketio.on('disconnect')
def handle_disconnect():
    logger.info(f"User {request.sid} disconnected")
    user_manager.remove_user(request.sid)

@socketio.on('join')
def handle_join():
    user_id = request.sid
    logger.info(f"Join request from {user_id}")
    
    if user_manager.add_waiting_user(user_id):
        match = user_manager.try_match_users()
        
        if match:
            logger.info(f"Match found: {match}")
            # Notify both users of the match
            emit('matched', {
                'partnerId': match['user2'],
                'room': match['room']
            }, room=match['user1'])
            
            emit('matched', {
                'partnerId': match['user1'],
                'room': match['room']
            }, room=match['user2'])
        else:
            logger.info(f"No match found for {user_id}, waiting...")
            emit('waiting')
    else:
        logger.warning(f"User {user_id} already in waiting list or active")
        emit('error', {'message': 'Already waiting or in a chat'})

@socketio.on('offer')
def handle_offer(data):
    logger.info(f"Handling offer from {request.sid} to {data['target']}")
    emit('offer', {
        'sdp': data['sdp'],
        'target': request.sid
    }, room=data['target'])

@socketio.on('answer')
def handle_answer(data):
    logger.info(f"Handling answer from {request.sid} to {data['target']}")
    emit('answer', {
        'sdp': data['sdp'],
        'target': request.sid
    }, room=data['target'])

@socketio.on('ice-candidate')
def handle_ice_candidate(data):
    logger.info(f"Handling ICE candidate from {request.sid} to {data['target']}")
    emit('ice-candidate', {
        'candidate': data['candidate'],
        'target': request.sid
    }, room=data['target'])

@socketio.on_error()
def error_handler(e):
    logger.error(f"SocketIO error for {request.sid}: {str(e)}")
    emit('error', {'message': str(e)})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, debug=True)
