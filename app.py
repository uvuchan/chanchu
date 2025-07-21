import os
import json
import uuid
import io
import base64
from flask import Flask, render_template, request, jsonify, send_file
from flask_socketio import SocketIO, emit
import eventlet
from datetime import datetime

# Flask application configuration
app = Flask(__name__, static_folder='static', template_folder='static')

# Secret key
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'una_clave_secreta_de_respaldo_para_desarrollo_local_insegura')

# Socket.IO configuration
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Simulated file storage
DATA_FILE = 'exam_files.json'

def load_files():
    """Load stored files from JSON."""
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except json.JSONDecodeError:
            print(f"Advertencia: {DATA_FILE} está vacío o corrupto. Iniciando con una base de datos vacía.")
            return {}
    return {}

def save_files(files_data):
    """Save file data to JSON."""
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(files_data, f, indent=4)

files_db = load_files()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/download/<file_id>')
def download_file(file_id):
    """Devuelve un archivo individual por ID."""
    file = files_db.get(file_id)
    if not file:
        return "Archivo no encontrado", 404

    try:
        file_content_base64 = file['fileContent'].split(',')[1]  # Quitar encabezado MIME
        file_bytes = base64.b64decode(file_content_base64)
        return send_file(
            io.BytesIO(file_bytes),
            download_name=file['relativePath'],
            as_attachment=True
        )
    except Exception as e:
        return f"Error al procesar archivo: {str(e)}", 500

@socketio.on('connect')
def handle_connect():
    print(f"Client connected: {request.sid}")
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
    relative_path = data.get('relativePath', file_name)

    if not all([file_name, file_content, uploaded_by]):
        print("Datos de archivo incompletos recibidos.")
        return

    files_db[file_id] = {
        'id': file_id,
        'fileName': file_name,
        'fileContent': file_content,
        'uploadedBy': uploaded_by,
        'timestamp': datetime.now().isoformat(),
        'relativePath': relative_path
    }
    save_files(files_db)
    print(f"Archivo subido: {relative_path} por {uploaded_by}")
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
