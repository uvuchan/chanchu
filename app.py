import os
import json
import uuid
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import eventlet 
from datetime import datetime

# Configuración de la aplicación Flask
app = Flask(__name__, static_folder='static', template_folder='static')

# --- ¡CAMBIO AQUÍ! Leer SECRET_KEY de las variables de entorno ---
# Si la variable de entorno no existe (ej. en desarrollo local sin configurar),
# usa un valor por defecto (que NO debe ser el mismo que en producción).
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'una_clave_secreta_de_respaldo_para_desarrollo_local')
# -----------------------------------------------------------------

socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# --- Almacenamiento de Archivos (Simulación de DB) ---
DATA_FILE = 'exam_files.json'

def load_files():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def save_files(files_data):
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(files_data, f, indent=4)

files_db = load_files()

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    print(f"Cliente conectado: {request.sid}")
    files_to_send = []
    for file_data in files_db.values():
        if isinstance(file_data.get('timestamp'), datetime):
            file_data['timestamp'] = file_data['timestamp'].isoformat()
        files_to_send.append(file_data)
    emit('files_list', files_to_send)

@socketio.on('upload_file')
def handle_upload_file(data):
    file_id = str(uuid.uuid4())
    file_name = data.get('fileName')
    file_content = data.get('fileContent')
    uploaded_by = data.get('uploadedBy')
    
    if not all([file_name, file_content, uploaded_by]):
        print("Datos de archivo incompletos.")
        return

    files_db[file_id] = {
        'id': file_id,
        'fileName': file_name,
        'fileContent': file_content,
        'uploadedBy': uploaded_by,
        'timestamp': datetime.now().isoformat()
    }
    save_files(files_db)

    print(f"Archivo subido: {file_name} por {uploaded_by}")
    socketio.emit('file_updated', files_db[file_id])

@socketio.on('delete_file')
def handle_delete_file(file_id):
    if file_id in files_db:
        file_name = files_db[file_id]['fileName']
        del files_db[file_id]
        save_files(files_db)
        print(f"Archivo eliminado: {file_name} (ID: {file_id})")
        socketio.emit('file_deleted', file_id)
    else:
        print(f"Intento de eliminar archivo no existente: {file_id}")

if __name__ == '__main__':
    print("Iniciando servidor Flask con Socket.IO...")
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, debug=True)