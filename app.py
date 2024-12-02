from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit
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
            if user_id in self.waiting_users:
                return
            if user_id in self.active_users:
                return
            self.waiting_users.append(user_id)
            logger.info(f"Added user {user_id} to waiting list. Current waiting: {len(self.waiting_users)}")

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
            if len(self.waiting_users) < 2:
                return None

            user1 = self.waiting_users.pop(0)
            user2 = self.waiting_users.pop(0)

            # Double check users are still connected
            if not socketio.server.manager.is_connected(user1):
                logger.info(f"User {user1} no longer connected during matching")
                if socketio.server.manager.is_connected(user2):
                    self.waiting_users.insert(0, user2)
                return None

            if not socketio.server.manager.is_connected(user2):
                logger.info(f"User {user2} no longer connected during matching")
                if socketio.server.manager.is_connected(user1):
                    self.waiting_users.insert(0, user1)
                return None

            # Create the match
            self.active_users[user1] = user2
            self.active_users[user2] = user1
            
            room = f"room_{user1}_{user2}"
            logger.info(f"Matched users {user1} and {user2} in room {room}")
            return {'user1': user1, 'user2': user2, 'room': room}

user_manager = UserManager()

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    logger.info(f"User {request.sid} connected from {request.remote_addr}")
    emit('connection_status', {'status': 'connected', 'id': request.sid})

@socketio.on('disconnect')
def handle_disconnect():
    logger.info(f"User {request.sid} disconnected")
    user_manager.remove_user(request.sid)

@socketio.on('join')
def handle_join():
    logger.info(f"Join request from {request.sid}")
    user_manager.add_waiting_user(request.sid)
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
        logger.info(f"No match found for {request.sid}, adding to waiting list")
        emit('waiting')

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
    emit('error', {'message': 'An error occurred'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, debug=True)
