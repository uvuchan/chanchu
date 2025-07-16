document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const userIdDisplay = document.getElementById('userIdDisplay');
    const fileInput = document.getElementById('fileInput');
    const uploadFileBtn = document.getElementById('uploadFileBtn');
    const uploadingMessage = document.getElementById('uploadingMessage');
    const filesList = document.getElementById('filesList');
    const noFilesMessage = document.getElementById('noFilesMessage');
    const errorMessageDiv = document.getElementById('errorMessage');
    const errorTextSpan = document.getElementById('errorText');

    // Obtener o generar un ID de usuario único para esta sesión
    let userId = localStorage.getItem('exam_app_userId');
    if (!userId) {
        userId = crypto.randomUUID(); // Genera un ID de usuario único
        localStorage.setItem('exam_app_userId', userId);
    }
    userIdDisplay.textContent = userId.substring(0, 8) + '...'; // Mostrar una versión corta del ID

    // --- Configuración de Socket.IO ---
    // Se conecta al host actual donde se sirve la aplicación Flask
    const socket = io();

    let currentFiles = {}; // Objeto para almacenar archivos por ID para fácil actualización

    // --- Funciones de Utilidad ---
    function showMessage(element, message, isError = false) {
        element.textContent = message;
        if (isError) {
            errorMessageDiv.classList.remove('hidden');
            errorMessageDiv.classList.add('block');
        } else {
            uploadingMessage.classList.remove('hidden');
            uploadingMessage.classList.add('block');
        }
    }

    function hideMessage(element, isError = false) {
        if (isError) {
            errorMessageDiv.classList.remove('block');
            errorMessageDiv.classList.add('hidden');
        } else {
            uploadingMessage.classList.remove('block');
            uploadingMessage.classList.add('hidden');
        }
    }

    function displayError(message) {
        console.error("Error recibido en frontend:", message); // Línea de depuración
        errorTextSpan.textContent = message;
        showMessage(errorTextSpan, message, true);
    }

    function clearError() {
        hideMessage(errorTextSpan, true);
    }

    function setUploadingState(isUploading) {
        fileInput.disabled = isUploading;
        uploadFileBtn.disabled = isUploading || fileInput.files.length === 0; // Habilitar/deshabilitar el botón único
        if (isUploading) {
            showMessage(uploadingMessage, 'Por favor, espere mientras se suben los archivos...');
        } else {
            hideMessage(uploadingMessage);
        }
    }

    function renderFiles() {
        // Convertir el objeto a un array y ordenarlo por timestamp (más reciente primero)
        const sortedFiles = Object.values(currentFiles).sort((a, b) => {
            const dateA = new Date(a.timestamp);
            const dateB = new Date(b.timestamp);
            return dateB.getTime() - dateA.getTime();
        });

        filesList.innerHTML = ''; // Limpiar la lista actual

        if (sortedFiles.length === 0) {
            noFilesMessage.classList.remove('hidden');
        } else {
            noFilesMessage.classList.add('hidden');
            sortedFiles.forEach(file => {
                const li = document.createElement('li');
                li.className = `file-item`; // Usar clase personalizada para el elemento de lista
                
                const uploadedByShort = file.uploadedBy ? file.uploadedBy.substring(0, 8) + '...' : 'Desconocido';
                const fileDate = file.timestamp ? new Date(file.timestamp).toLocaleString() : 'N/A';

                // Mostrar la ruta relativa si existe, de lo contrario, solo el nombre del archivo
                const displayName = file.relativePath || file.fileName;

                li.innerHTML = `
                    <div class="file-info">
                        <p class="file-name">
                            ${displayName}
                        </p>
                        <p class="file-meta">
                            Subido por: <span class="file-user-id">${uploadedByShort}</span>
                        </p>
                        <p class="file-meta">
                            Fecha: ${fileDate}
                        </p>
                    </div>
                    <div class="file-actions">
                        <button data-id="${file.id}" data-action="download" class="btn btn-download">
                            Descargar
                        </button>
                        <button data-id="${file.id}" data-action="delete" class="btn btn-delete">
                            Eliminar
                        </button>
                    </div>
                `;
                filesList.appendChild(li);
            });

            // Adjuntar event listeners a los nuevos botones
            filesList.querySelectorAll('button[data-action="download"]').forEach(button => {
                button.addEventListener('click', (e) => {
                    const fileId = e.target.dataset.id;
                    const file = currentFiles[fileId];
                    if (file) {
                        const link = document.createElement('a');
                        link.href = file.fileContent;
                        link.download = file.fileName; // Descargar con el nombre original del archivo
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                    }
                });
            });

            filesList.querySelectorAll('button[data-action="delete"]').forEach(button => {
                button.addEventListener('click', (e) => {
                    const fileId = e.target.dataset.id;
                    const fileName = currentFiles[fileId]?.fileName || 'este archivo';
                    if (window.confirm(`¿Estás seguro de que quieres eliminar "${fileName}"?`)) {
                        socket.emit('delete_file', fileId);
                    }
                });
            });
        }
    }

    // --- Event Listener para el botón único de Subida ---
    uploadFileBtn.addEventListener('click', () => handleFileUpload());

    async function handleFileUpload() {
        const files = fileInput.files; // files es ahora una FileList (puede contener múltiples archivos/directorios)
        if (files.length === 0) {
            displayError("Por favor, selecciona al menos un archivo o un directorio.");
            return;
        }

        clearError();
        setUploadingState(true);

        let filesUploadedCount = 0;
        let filesSkippedCount = 0;
        const totalFiles = files.length;

        for (let i = 0; i < totalFiles; i++) {
            const file = files[i];

            // Omitir directorios si el navegador los incluye en la FileList
            // file.isDirectory es una propiedad no estándar pero útil
            if (file.isDirectory) {
                filesSkippedCount++;
                continue;
            }

            // --- Límite de tamaño de archivo (AUMENTADO A 20 MB) ---
            if (file.size > 20 * 1024 * 1024) { // 20 MB
                console.warn(`Archivo ${file.name} es demasiado grande (${(file.size / (1024 * 1024)).toFixed(2)}MB). Saltando.`);
                filesSkippedCount++;
                continue;
            }
            
            // Usar una Promesa para manejar la lectura asíncrona de cada archivo
            await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const fileContent = e.target.result; // Contenido en Base64
                    socket.emit('upload_file', {
                        fileName: file.name,
                        fileContent: fileContent,
                        uploadedBy: userId,
                        timestamp: new Date().toISOString(),
                        relativePath: file.webkitRelativePath || file.name // Enviar la ruta relativa
                    });
                    filesUploadedCount++;
                    resolve(); // Resolver la promesa cuando el archivo ha sido emitido
                };
                reader.onerror = () => {
                    console.error(`Error al leer el archivo ${file.name}.`);
                    filesSkippedCount++;
                    resolve();
                };
                reader.readAsDataURL(file); // Leer el archivo como Base64
            });
        }

        // Limpiar el input después de procesar todos los archivos
        fileInput.value = '';
        setUploadingState(false);

        if (filesSkippedCount > 0) {
            // Mostrar un mensaje de resumen si algunos archivos fueron omitidos
            displayError(`Se subieron ${filesUploadedCount} de ${totalFiles} archivos. Se saltaron ${filesSkippedCount} archivos (demasiado grandes o directorios).`);
        } else {
            clearError(); // Limpiar cualquier mensaje de error previo si todos los archivos se subieron con éxito
        }
    }

    // --- Manejadores de Eventos de Socket.IO ---
    socket.on('connect', () => {
        console.log('Conectado al servidor Socket.IO');
        // Cuando se conecta, el servidor emitirá 'files_list' automáticamente
    });

    socket.on('disconnect', () => {
        console.log('Desconectado del servidor Socket.IO');
        displayError("Desconectado del servidor. Reintentando conexión...");
    });

    socket.on('files_list', (filesArray) => {
        // Recibir la lista completa de archivos al conectar o actualizar
        currentFiles = {};
        filesArray.forEach(file => {
            currentFiles[file.id] = file;
        });
        renderFiles();
        clearError();
    });

    socket.on('file_updated', (file) => {
        currentFiles[file.id] = file;
        renderFiles();
        clearError();
    });

    socket.on('file_deleted', (fileId) => {
        delete currentFiles[fileId];
        renderFiles();
        clearError();
    });

    socket.on('error', (message) => {
        console.error('Error del servidor:', message);
        displayError(`Error del servidor: ${message}`);
    });

    // Deshabilitar el botón de subida inicialmente si no hay archivo seleccionado
    fileInput.addEventListener('change', () => {
        uploadFileBtn.disabled = fileInput.files.length === 0;
    });
    uploadFileBtn.disabled = true; // Deshabilitar al cargar inicialmente
});