from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import secrets
import os
from gevent import monkey
monkey.patch_all()

app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(16)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='gevent', logger=True, engineio_logger=True)

# Store waiting users
waiting_users = []

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('join')
def on_join(data):
    user_id = data['userId']
    if waiting_users and waiting_users[0] != user_id:
        # Match with waiting user
        partner_id = waiting_users.pop(0)
        room = f"{min(user_id, partner_id)}-{max(user_id, partner_id)}"
        join_room(room)
        emit('matched', {'room': room, 'partnerId': partner_id}, to=user_id)
        emit('matched', {'room': room, 'partnerId': user_id}, to=partner_id)
    else:
        # Add to waiting list
        if user_id not in waiting_users:
            waiting_users.append(user_id)
        emit('waiting')

@socketio.on('offer')
def on_offer(data):
    emit('offer', data, to=data['target'])

@socketio.on('answer')
def on_answer(data):
    emit('answer', data, to=data['target'])

@socketio.on('ice-candidate')
def on_ice_candidate(data):
    emit('ice-candidate', data, to=data['target'])

@socketio.on('disconnect')
def on_disconnect():
    global waiting_users
    waiting_users = [user for user in waiting_users if user != request.sid]

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))
    print(f"Starting server on port {port}")
    socketio.run(app, host='0.0.0.0', port=port, debug=True, allow_unsafe_werkzeug=True)
