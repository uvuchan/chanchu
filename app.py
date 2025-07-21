# app.py

import os
import base64
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your_secret_key' # ¡Asegúrate de cambiar esto por una clave segura!

# --- AÑADE O MODIFICA ESTA LÍNEA ---
# Establece el límite de tamaño de la carga a 50 MB (50 * 1024 * 1024 bytes)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024 # 50 Megabytes
# -----------------------------------

socketio = SocketIO(app, cors_allowed_origins="*", max_http_buffer_size=50 * 1024 * 1024) # También ajusta aquí si usas un buffer HTTP

# Diccionario para almacenar los archivos en memoria (para demostración)
# En un entorno de producción, usarías una base de datos o un sistema de almacenamiento de archivos.
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

    # Opcional: Decodificar y guardar el archivo si es necesario.
    # Para esta demo, lo mantenemos en base64 para evitar IO de disco compleja en el backend,
    # pero en una aplicación real, probablemente guardarías el binario.
    # Ejemplo de cómo decodificarlo (no se guarda en disco aquí):
    # try:
    #     header, encoded = file_content.split(",", 1)
    #     decoded_content = base64.b64decode(encoded)
    #     # Aquí podrías guardar decoded_content en un archivo en el servidor
    # except Exception as e:
    #     print(f"Error decodificando base64 para {file_name}: {e}")
    #     emit('error', f'Error al procesar el archivo {file_name}.')
    #     return

    uploaded_files[file_id] = {
        'id': file_id,
        'fileName': file_name,
        'fileContent': file_content, # Mantener en base64 para la demo
        'uploadedBy': uploaded_by,
        'timestamp': timestamp,
        'relativePath': relative_path
    }
    print(f"Archivo subido: {relative_path} (ID: {file_id}, por: {uploaded_by})")
    emit('file_updated', uploaded_files[file_id], broadcast=True)

@socketio.on('delete_file')
def handle_delete_file(file_id):
    if file_id in uploaded_files:
        del uploaded_files[file_id]
        print(f'Archivo con ID {file_id} eliminado.')
        emit('file_deleted', file_id, broadcast=True)
    else:
        print(f'Intento de eliminar archivo con ID {file_id} que no existe.')
        emit('error', 'El archivo no se encontró para eliminar.')

if __name__ == '__main__':
    # Usar reloader=True solo para desarrollo
    socketio.run(app, debug=True, allow_unsafe_werkzeug=True) # allow_unsafe_werkzeug para algunos entornos de desarrollo