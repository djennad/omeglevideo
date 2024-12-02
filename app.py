from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import secrets
import os
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class UserManager:
    def __init__(self):
        self.active_users = {}
        self.waiting_users = []

    def add_user(self, user_id):
        self.active_users[user_id] = {'connected': True, 'partner': None}
        logger.info(f'User {user_id} connected. Total active users: {len(self.active_users)}')

    def remove_user(self, user_id):
        if user_id in self.active_users:
            partner_id = self.active_users[user_id].get('partner')
            if partner_id and partner_id in self.active_users:
                self.active_users[partner_id]['partner'] = None
                return partner_id
            del self.active_users[user_id]
            if user_id in self.waiting_users:
                self.waiting_users.remove(user_id)
        return None

    def add_to_waiting(self, user_id):
        if user_id not in self.waiting_users:
            self.waiting_users.append(user_id)
            logger.info(f'User {user_id} added to waiting list. Total waiting: {len(self.waiting_users)}')

    def find_match(self, user_id):
        # Clean waiting list
        self.waiting_users[:] = [uid for uid in self.waiting_users 
                               if uid in self.active_users and self.active_users[uid]['connected']]
        
        if self.waiting_users and user_id not in self.waiting_users:
            partner_id = self.waiting_users.pop(0)
            if partner_id in self.active_users and self.active_users[partner_id]['connected']:
                self.active_users[user_id]['partner'] = partner_id
                self.active_users[partner_id]['partner'] = user_id
                return partner_id
        return None

    def is_user_active(self, user_id):
        return user_id in self.active_users and self.active_users[user_id]['connected']

app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(16)
socketio = SocketIO(app, async_mode='gevent', cors_allowed_origins="*", logger=True, engineio_logger=True)
user_manager = UserManager()

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    user_id = request.sid
    user_manager.add_user(user_id)

@socketio.on('join')
def on_join(data):
    user_id = request.sid
    logger.info(f'Join request from user {user_id}. Waiting users: {len(user_manager.waiting_users)}')
    
    partner_id = user_manager.find_match(user_id)
    if partner_id:
        room = f"{min(user_id, partner_id)}-{max(user_id, partner_id)}"
        join_room(room)
        logger.info(f'Matched users {user_id} and {partner_id} in room {room}')
        emit('matched', {'room': room, 'partnerId': partner_id}, to=user_id)
        emit('matched', {'room': room, 'partnerId': user_id}, to=partner_id)
    else:
        user_manager.add_to_waiting(user_id)
        emit('waiting')

@socketio.on('offer')
def on_offer(data):
    target = data.get('target')
    if user_manager.is_user_active(target):
        logger.info(f'Sending offer from {request.sid} to {target}')
        emit('offer', data, to=target)

@socketio.on('answer')
def on_answer(data):
    target = data.get('target')
    if user_manager.is_user_active(target):
        logger.info(f'Sending answer from {request.sid} to {target}')
        emit('answer', data, to=target)

@socketio.on('ice-candidate')
def on_ice_candidate(data):
    target = data.get('target')
    if user_manager.is_user_active(target):
        logger.info(f'Sending ICE candidate from {request.sid} to {target}')
        emit('ice-candidate', data, to=target)

@socketio.on('disconnect')
def on_disconnect():
    user_id = request.sid
    partner_id = user_manager.remove_user(user_id)
    if partner_id:
        emit('partner_disconnected', to=partner_id)
    logger.info(f'User {user_id} disconnected. Remaining active users: {len(user_manager.active_users)}')

@socketio.on_error()
def error_handler(e):
    logger.error(f'SocketIO error: {str(e)}')

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host='0.0.0.0', port=port, debug=False)
