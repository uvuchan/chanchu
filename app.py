import os
import json
import uuid
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import eventlet # Ya está importado
from datetime import datetime

# Flask application configuration
app = Flask(__name__, static_folder='static', template_folder='static')

# Read SECRET_KEY from environment variables for security.
# Use a fallback for local development if the environment variable is not set.
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'una_clave_secreta_de_respaldo_para_desarrollo_local_insegura')

# --- IMPORTANTE: Configuración para soportar 50 MB de archivos ---
# Establece el límite de tamaño máximo para las solicitudes entrantes (50 MB)
# Esto es crucial para que Flask/Werkzeug (o el servidor subyacente de Eventlet)
# acepte el tamaño del payload.
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024 # 50 Megabytes (en bytes)

# Configure Socket.IO to allow connections from any origin (CORS)
# max_http_buffer_size también es importante para los buffers internos de Socket.IO/Eventlet.
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet', max_http_buffer_size=50 * 1024 * 1024)
# ----------------------------------------------------

# --- File Storage (Simulated Database) ---
DATA_FILE = 'exam_files.json'

def load_files():
    """Loads files from the JSON file."""
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except json.JSONDecodeError:
            print(f"Advertencia: {DATA_FILE} está vacío o corrupto. Iniciando con una base de datos vacía.")
            return {}
    return {}

def save_files(files_data):
    """Saves files to the JSON file."""
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(files_data, f, indent=4)

files_db = load_files() # Load files when the server starts

# --- Flask Routes ---
@app.route('/')
def index():
    """Serves the main HTML file."""
    return render_template('index.html')

# --- Socket.IO Events ---
@socketio.on('connect')
def handle_connect():
    """Handles a new client connection."""
    print(f"Client connected: {request.sid}")
    # Send the current list of files to the newly connected client
    files_to_send = []
    for file_data in files_db.values():
        # Ensure timestamp is a string (ISO format) before sending
        # No es necesario verificar si es datetime, ya lo guardas como string.
        # Solo asegúrate de que sea un string válido si lo modificaste antes.
        files_to_send.append(file_data)
    emit('files_list', files_to_send)

@socketio.on('upload_file')
def handle_upload_file(data):
    """Handles file upload from the client (individual file or part of a directory)."""
    file_id = str(uuid.uuid4())
    file_name = data.get('fileName')
    file_content = data.get('fileContent') # Base64 content
    uploaded_by = data.get('uploadedBy')
    # New field for the relative path if it's part of a directory upload
    relative_path = data.get('relativePath', file_name) # Use file_name if no relativePath

    # Basic data validation
    if not all([file_name, file_content, uploaded_by]):
        print("Datos de archivo incompletos recibidos.")
        return

    # Save to the simulated database
    files_db[file_id] = {
        'id': file_id,
        'fileName': file_name,
        'fileContent': file_content,
        'uploadedBy': uploaded_by,
        'timestamp': datetime.now().isoformat(), # Generate timestamp on the server as string ISO
        'relativePath': relative_path # Store the relative path
    }
    save_files(files_db)

    print(f"Archivo subido: {relative_path} por {uploaded_by}")
    # Emit the event to all connected clients to update their file list
    socketio.emit('file_updated', files_db[file_id])

@socketio.on('delete_file')
def handle_delete_file(file_id):
    """Maneja la eliminación de un archivo."""
    if file_id in files_db:
        file_name = files_db[file_id]['fileName']
        del files_db[file_id]
        save_files(files_db)
        print(f"Archivo eliminado: {file_name} (ID: {file_id})")
        # Emit the event to all connected clients to update their file list
        socketio.emit('file_deleted', file_id)
    else:
        print(f"Intento de eliminar archivo no existente: {file_id}")

# --- Application Execution ---
if __name__ == '__main__':
    print("Iniciando servidor Flask con Socket.IO...")
    port = int(os.environ.get('PORT', 5000))
    # Al usar async_mode='eventlet', es crucial usar eventlet.wsgi.server
    # si quieres que MAX_CONTENT_LENGTH sea gestionado por eventlet para HTTP requests,
    # aunque Socket.IO lo manejará para los mensajes de WebSocket.
    # En este caso, como los archivos se envían por WebSocket, el max_http_buffer_size en SocketIO
    # es el más relevante, pero mantener MAX_CONTENT_LENGTH también ayuda.
    # No uses debug=True en producción.
    socketio.run(app, host='0.0.0.0', port=port, debug=True)