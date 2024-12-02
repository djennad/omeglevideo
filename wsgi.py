from gevent import monkey
monkey.patch_all()

from app import app, socketio

if __name__ == "__main__":
    socketio.run(app)
