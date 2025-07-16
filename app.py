import os
import json
import uuid
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import eventlet
from datetime import datetime # Importar datetime

# Configuración de la aplicación Flask
app = Flask(__name__, static_folder='static', template_folder='static')

# Leer SECRET_KEY de las variables de entorno para seguridad.
# Usar un valor de respaldo para desarrollo local si la variable no está configurada.
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'una_clave_secreta_de_respaldo_para_desarrollo_local_insegura')

# Configurar Socket.IO para permitir conexiones desde cualquier origen (CORS)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# --- Almacenamiento de Archivos (Simulación de DB) ---
DATA_FILE = 'exam_files.json'

def load_files():
    """Carga los archivos desde el archivo JSON."""
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except json.JSONDecodeError:
            print(f"Advertencia: {DATA_FILE} está vacío o corrupto. Iniciando con una base de datos vacía.")
            return {}
    return {}

def save_files(files_data):
    """Guarda los archivos en el archivo JSON."""
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(files_data, f, indent=4)

files_db = load_files() # Carga los archivos al iniciar el servidor

# --- Rutas Flask ---
@app.route('/')
def index():
    """Sirve el archivo HTML principal."""
    return render_template('index.html')

# --- Eventos de Socket.IO ---
@socketio.on('connect')
def handle_connect():
    """Maneja la conexión de un nuevo cliente."""
    print(f"Cliente conectado: {request.sid}")
    # Envía la lista actual de archivos al cliente recién conectado
    files_to_send = []
    for file_data in files_db.values():
        # Asegurarse de que el timestamp sea un string (formato ISO) antes de enviarlo
        if isinstance(file_data.get('timestamp'), datetime):
            file_data['timestamp'] = file_data['timestamp'].isoformat()
        files_to_send.append(file_data)
    emit('files_list', files_to_send)

@socketio.on('upload_file')
def handle_upload_file(data):
    """Maneja la subida de un archivo individual o parte de un directorio."""
    file_id = str(uuid.uuid4())
    file_name = data.get('fileName')
    file_content = data.get('fileContent') # Contenido Base64
    uploaded_by = data.get('uploadedBy')
    # Nuevo campo para la ruta relativa si es parte de un directorio
    relative_path = data.get('relativePath', file_name) # Usa file_name si no hay relativePath

    # Validar datos básicos
    if not all([file_name, file_content, uploaded_by]):
        print("Datos de archivo incompletos recibidos.")
        return

    # Guardar en la base de datos simulada
    files_db[file_id] = {
        'id': file_id,
        'fileName': file_name,
        'fileContent': file_content,
        'uploadedBy': uploaded_by,
        'timestamp': datetime.now().isoformat(), # Genera el timestamp en el servidor como string ISO
        'relativePath': relative_path # Guarda la ruta relativa
    }
    save_files(files_db)

    print(f"Archivo subido: {relative_path} por {uploaded_by}")
    # Emitir el evento a todos los clientes para actualizar su lista de archivos
    socketio.emit('file_updated', files_db[file_id])

@socketio.on('delete_file')
def handle_delete_file(file_id):
    """Maneja la eliminación de un archivo."""
    if file_id in files_db:
        file_name = files_db[file_id]['fileName']
        del files_db[file_id]
        save_files(files_db)
        print(f"Archivo eliminado: {file_name} (ID: {file_id})")
        # Emitir el evento a todos los clientes para actualizar su lista de archivos
        socketio.emit('file_deleted', file_id)
    else:
        print(f"Intento de eliminar archivo no existente: {file_id}")

# --- Ejecución de la aplicación ---
if __name__ == '__main__':
    print("Iniciando servidor Flask con Socket.IO...")
    # Para Render, el puerto se obtiene de la variable de entorno PORT
    # Para ejecución local, por defecto es 5000
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, debug=True)