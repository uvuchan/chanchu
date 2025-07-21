import os
import base64
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit

app = Flask(__name__)
# ¡IMPORTANTE! Cambia esto por una clave segura en producción
app.config['SECRET_KEY'] = 'your_secret_key_very_secret_and_long_random_string'

# --- Configuración para soportar 50 MB de archivos ---
# Establece el límite de tamaño máximo para las solicitudes entrantes (50 MB)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024 # 50 Megabytes (en bytes)

# Configura Flask-SocketIO. Ajusta max_http_buffer_size para mensajes grandes
socketio = SocketIO(app, cors_allowed_origins="*", max_http_buffer_size=50 * 1024 * 1024)
# ----------------------------------------------------

# Diccionario para almacenar los archivos en memoria (para demostración)
# En un entorno de producción real, NUNCA almacenarías archivos grandes en memoria de esta forma.
# Usarías una base de datos (como PostgreSQL con un campo BLOB), un sistema de almacenamiento de archivos
# (como AWS S3, Google Cloud Storage), o guardarías los archivos directamente en el disco duro del servidor
# y solo almacenarías sus metadatos (ruta, nombre, etc.) en la memoria o DB.
uploaded_files = {} # {file_id: {fileName, fileContent (base64), uploadedBy, timestamp, relativePath}}

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    print(f'Cliente conectado: {request.sid}')
    # Cuando un cliente se conecta, envía la lista actual de archivos
    emit('files_list', list(uploaded_files.values()))

@socketio.on('upload_file')
def handle_upload_file(data):
    file_id = os.urandom(16).hex() # Genera un ID único para el archivo
    file_name = data.get('fileName')
    file_content = data.get('fileContent') # Contenido en base64
    uploaded_by = data.get('uploadedBy')
    timestamp = data.get('timestamp')
    relative_path = data.get('relativePath', file_name) # Usa relativePath si existe, si no fileName

    # NOTA IMPORTANTE SOBRE EL RENDIMIENTO:
    # Almacenar el contenido del archivo directamente en 'fileContent' (Base64) en este diccionario
    # 'uploaded_files' consume memoria del servidor. Para archivos de 50MB, esto puede ser significativo.
    # Si varios usuarios suben archivos grandes simultáneamente, tu servidor podría quedarse sin memoria.
    # Considera guardar los archivos en el disco y solo almacenar la ruta al archivo aquí,
    # o usar una base de datos/servicio de almacenamiento en la nube.
    uploaded_files[file_id] = {
        'id': file_id,
        'fileName': file_name,
        'fileContent': file_content, # Se mantiene en base64 para la demostración
        'uploadedBy': uploaded_by,
        'timestamp': timestamp,
        'relativePath': relative_path
    }
    print(f"Archivo subido: {relative_path} (ID: {file_id}, por: {uploaded_by})")
    # Emitir el archivo actualizado a todos los clientes conectados
    emit('file_updated', uploaded_files[file_id], broadcast=True)

@socketio.on('delete_file')
def handle_delete_file(file_id):
    if file_id in uploaded_files:
        del uploaded_files[file_id]
        print(f'Archivo con ID {file_id} eliminado.')
        # Emitir el ID del archivo eliminado a todos los clientes conectados
        emit('file_deleted', file_id, broadcast=True)
    else:
        print(f'Intento de eliminar archivo con ID {file_id} que no existe.')
        emit('error', 'El archivo no se encontró para eliminar.')

if __name__ == '__main__':
    # 'debug=True' y 'allow_unsafe_werkzeug=True' son solo para desarrollo.
    # NUNCA uses esto en producción, ya que puede exponer información sensible
    # y es menos seguro y robusto.
    socketio.run(app, debug=True, allow_unsafe_werkzeug=True)