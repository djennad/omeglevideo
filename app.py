from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import secrets
import os
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(16)
socketio = SocketIO(app, async_mode='gevent', cors_allowed_origins="*", logger=True, engineio_logger=True)

# Store active users and their connection status
active_users = {}
waiting_users = []

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    user_id = request.sid
    active_users[user_id] = {'connected': True, 'partner': None}
    logger.info(f'User {user_id} connected. Total active users: {len(active_users)}')

@socketio.on('join')
def on_join(data):
    user_id = request.sid
    logger.info(f'Join request from user {user_id}. Waiting users: {len(waiting_users)}')
    
    # Remove disconnected users from waiting list
    global waiting_users
    waiting_users = [uid for uid in waiting_users if uid in active_users and active_users[uid]['connected']]
    
    if waiting_users and user_id not in waiting_users:
        # Match with first waiting user
        partner_id = waiting_users.pop(0)
        if partner_id in active_users and active_users[partner_id]['connected']:
            room = f"{min(user_id, partner_id)}-{max(user_id, partner_id)}"
            join_room(room)
            
            # Update partner information
            active_users[user_id]['partner'] = partner_id
            active_users[partner_id]['partner'] = user_id
            
            logger.info(f'Matched users {user_id} and {partner_id} in room {room}')
            emit('matched', {'room': room, 'partnerId': partner_id}, to=user_id)
            emit('matched', {'room': room, 'partnerId': user_id}, to=partner_id)
        else:
            waiting_users = [uid for uid in waiting_users if uid != partner_id]
            emit('waiting')
    else:
        # Add to waiting list if not already waiting
        if user_id not in waiting_users:
            waiting_users.append(user_id)
            logger.info(f'User {user_id} added to waiting list. Total waiting: {len(waiting_users)}')
        emit('waiting')

@socketio.on('offer')
def on_offer(data):
    target = data.get('target')
    if target in active_users and active_users[target]['connected']:
        logger.info(f'Sending offer from {request.sid} to {target}')
        emit('offer', data, to=target)

@socketio.on('answer')
def on_answer(data):
    target = data.get('target')
    if target in active_users and active_users[target]['connected']:
        logger.info(f'Sending answer from {request.sid} to {target}')
        emit('answer', data, to=target)

@socketio.on('ice-candidate')
def on_ice_candidate(data):
    target = data.get('target')
    if target in active_users and active_users[target]['connected']:
        logger.info(f'Sending ICE candidate from {request.sid} to {target}')
        emit('ice-candidate', data, to=target)

@socketio.on('disconnect')
def on_disconnect():
    user_id = request.sid
    if user_id in active_users:
        # Notify partner if exists
        partner_id = active_users[user_id].get('partner')
        if partner_id and partner_id in active_users:
            emit('partner_disconnected', to=partner_id)
            active_users[partner_id]['partner'] = None
        
        # Remove user from active users and waiting list
        del active_users[user_id]
        if user_id in waiting_users:
            waiting_users.remove(user_id)
        
        logger.info(f'User {user_id} disconnected. Remaining active users: {len(active_users)}')

@socketio.on_error()
def error_handler(e):
    logger.error(f'SocketIO error: {str(e)}')

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host='0.0.0.0', port=port, debug=False)
