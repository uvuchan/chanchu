import os
import json
import uuid
from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit
import eventlet
from datetime import datetime
import mimetypes # Para determinar el tipo MIME del archivo al servirlo

# Flask application configuration
app = Flask(__name__, static_folder='static', template_folder='static')

# Read SECRET_KEY from environment variables for security.
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'una_clave_secreta_de_respaldo_para_desarrollo_local_insegura')

# --- IMPORTANTE: Configuración para soportar 50 MB de archivos ---
# Establece el límite de tamaño máximo para las solicitudes HTTP POST.
# Esto es crucial para que Flask/Werkzeug (o el servidor subyacente de Eventlet)
# acepte el tamaño del payload de la subida de archivos.
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024 # 50 Megabytes (en bytes)

# Configura Socket.IO. max_http_buffer_size es para mensajes WebSocket,
# pero con la subida vía HTTP POST, ya no enviaremos el archivo completo por WebSocket.
# Lo mantenemos para cualquier otro mensaje grande si lo hubiera.
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet', max_http_buffer_size=1 * 1024 * 1024) # Ajustar a 1MB si los mensajes son solo metadatos

# --- File Storage (Simulated Database & Upload Directory) ---
DATA_FILE = 'exam_files.json'
UPLOAD_FOLDER = 'uploads' # Directorio donde se guardarán los archivos subidos

# Crea el directorio de cargas si no existe
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

def load_files():
    """Loads file metadata from the JSON file."""
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except json.JSONDecodeError:
            print(f"Advertencia: {DATA_FILE} está vacío o corrupto. Iniciando con una base de datos vacía.")
            return {}
    return {}

def save_files(files_data):
    """Saves file metadata to the JSON file."""
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(files_data, f, indent=4)

files_db = load_files() # Load file metadata when the server starts

# --- Flask Routes ---
@app.route('/')
def index():
    """Serves the main HTML file."""
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    """Handles file uploads via HTTP POST."""
    if 'file' not in request.files:
        print("No se encontró 'file' en la solicitud.")
        return jsonify({"error": "No file part in the request"}), 400

    file = request.files['file']
    uploaded_by = request.form.get('uploadedBy', 'anonymous')
    relative_path = request.form.get('relativePath', file.filename) # Obtener relativePath si viene del frontend

    if file.filename == '':
        print("No se seleccionó ningún archivo.")
        return jsonify({"error": "No selected file"}), 400

    if file:
        file_id = str(uuid.uuid4())
        # Generar un nombre de archivo seguro para guardar en el servidor
        # Usamos el file_id para evitar conflictos de nombres y permitir múltiples archivos con el mismo nombre
        saved_filename = f"{file_id}_{file.filename}"
        file_path = os.path.join(UPLOAD_FOLDER, saved_filename)
        
        try:
            file.save(file_path) # Guarda el archivo en el sistema de archivos del servidor
            
            # Guardar los metadatos del archivo en la "base de datos" JSON
            # NOTA: Ya no guardamos 'fileContent' (Base64) aquí
            file_metadata = {
                'id': file_id,
                'fileName': file.filename, # Nombre original del archivo
                'serverFileName': saved_filename, # Nombre del archivo tal como se guardó en el servidor
                'uploadedBy': uploaded_by,
                'timestamp': datetime.now().isoformat(),
                'relativePath': relative_path # Ruta relativa del archivo original
            }
            files_db[file_id] = file_metadata
            save_files(files_db)

            print(f"Archivo subido y guardado: {saved_filename} por {uploaded_by}")
            
            # Emitir la actualización a través de Socket.IO a todos los clientes
            # Solo enviamos los metadatos, no el contenido del archivo
            socketio.emit('file_updated', file_metadata)

            return jsonify({"message": "File uploaded successfully", "fileId": file_id, "fileName": file.filename}), 200

        except Exception as e:
            print(f"Error al guardar el archivo: {e}")
            return jsonify({"error": f"Failed to save file: {str(e)}"}), 500
    
    return jsonify({"error": "Unknown error during upload"}), 500


@app.route('/download/<file_id>')
def download_file(file_id):
    """Serves files for download."""
    if file_id in files_db:
        file_metadata = files_db[file_id]
        server_filename = file_metadata['serverFileName']
        original_filename = file_metadata['fileName']

        # Determina el tipo MIME del archivo para el encabezado Content-Type
        mimetype, _ = mimetypes.guess_type(os.path.join(UPLOAD_FOLDER, server_filename))
        if mimetype is None:
            mimetype = 'application/octet-stream' # Tipo MIME genérico si no se puede determinar

        print(f"Sirviendo archivo: {server_filename} como {original_filename}")
        try:
            return send_from_directory(
                UPLOAD_FOLDER,
                server_filename,
                as_attachment=True,         # Fuerza la descarga en lugar de mostrar en el navegador
                download_name=original_filename, # Nombre con el que se descargará el archivo
                mimetype=mimetype           # Tipo MIME
            )
        except Exception as e:
            print(f"Error al servir el archivo {server_filename}: {e}")
            return "File not found or access error.", 404
    
    return "File not found.", 404


# --- Socket.IO Events ---
@socketio.on('connect')
def handle_connect():
    """Handles a new client connection."""
    print(f"Client connected: {request.sid}")
    # Send the current list of file metadata to the newly connected client
    emit('files_list', list(files_db.values()))

@socketio.on('delete_file')
def handle_delete_file(file_id):
    """Maneja la eliminación de un archivo."""
    if file_id in files_db:
        file_metadata = files_db[file_id]
        file_name = file_metadata['fileName']
        server_filename = file_metadata['serverFileName']
        
        # Eliminar el archivo del sistema de archivos
        file_path = os.path.join(UPLOAD_FOLDER, server_filename)
        if os.path.exists(file_path):
            os.remove(file_path)
            print(f"Archivo físico eliminado: {file_path}")
        else:
            print(f"Advertencia: Archivo físico no encontrado para eliminar: {file_path}")

        # Eliminar la entrada de la base de datos JSON
        del files_db[file_id]
        save_files(files_db)

        print(f"Metadatos de archivo eliminados: {file_name} (ID: {file_id})")
        # Emit the event to all connected clients to update their file list
        socketio.emit('file_deleted', file_id)
    else:
        print(f"Intento de eliminar archivo no existente: {file_id}")

# --- Application Execution ---
if __name__ == '__main__':
    print("Iniciando servidor Flask con Socket.IO...")
    port = int(os.environ.get('PORT', 5000))
    # Para producción, se recomienda usar Gunicorn con Eventlet en Render.
    # Para desarrollo, socketio.run es suficiente.
    socketio.run(app, host='0.0.0.0', port=port, debug=True)