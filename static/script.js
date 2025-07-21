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
    const dropZone = document.getElementById('dropZone');

    // Obtener o generar un ID de usuario único para esta sesión
    let userId = localStorage.getItem('exam_app_userId');
    if (!userId) {
        userId = crypto.randomUUID(); // Genera un ID de usuario único
        localStorage.setItem('exam_app_userId', userId);
    }
    userIdDisplay.textContent = userId.substring(0, 8) + '...'; // Mostrar una versión corta del ID

    // --- Configuración de Socket.IO ---
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
        console.error("Error recibido en frontend:", message);
        errorTextSpan.textContent = message;
        showMessage(errorTextSpan, message, true);
    }

    function clearError() {
        hideMessage(errorTextSpan, true);
    }

    function setUploadingState(isUploading) {
        fileInput.disabled = isUploading;
        uploadFileBtn.disabled = isUploading || fileInput.files.length === 0;
        if (isUploading) {
            showMessage(uploadingMessage, 'Por favor, espere mientras se suben los archivos...');
        } else {
            hideMessage(uploadingMessage);
        }
    }

    function renderFiles() {
        const sortedFiles = Object.values(currentFiles).sort((a, b) => {
            const dateA = new Date(a.timestamp);
            const dateB = new Date(b.timestamp);
            return dateB.getTime() - dateA.getTime();
        });

        filesList.innerHTML = '';

        if (sortedFiles.length === 0) {
            noFilesMessage.classList.remove('hidden');
        } else {
            noFilesMessage.classList.add('hidden');
            sortedFiles.forEach(file => {
                const li = document.createElement('li');
                li.className = `file-item`;
                
                const uploadedByShort = file.uploadedBy ? file.uploadedBy.substring(0, 8) + '...' : 'Desconocido';
                const fileDate = file.timestamp ? new Date(file.timestamp).toLocaleString() : 'N/A';
                const displayName = file.relativePath || file.fileName;

                li.innerHTML = `
                    <div class="file-info">
                        <p class="file-name">${displayName}</p>
                        <p class="file-meta">Subido por: <span class="file-user-id">${uploadedByShort}</span></p>
                        <p class="file-meta">Fecha: ${fileDate}</p>
                    </div>
                    <div class="file-actions">
                        <button data-id="${file.id}" data-action="download" class="btn btn-download">Descargar</button>
                        <button data-id="${file.id}" data-action="delete" class="btn btn-delete">Eliminar</button>
                    </div>
                `;
                filesList.appendChild(li);
            });

            filesList.querySelectorAll('button[data-action="download"]').forEach(button => {
                button.addEventListener('click', (e) => {
                    const fileId = e.target.dataset.id;
                    const file = currentFiles[fileId];
                    if (file) {
                        const link = document.createElement('a');
                        link.href = file.fileContent;
                        link.download = file.fileName;
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

    // --- Upload Button Event Listener ---
    uploadFileBtn.addEventListener('click', () => handleFileUpload());

    async function handleFileUpload() {
        const files = fileInput.files;
        if (files.length === 0) {
            displayError("Por favor, selecciona al menos un archivo o un directorio.");
            return;
        }
        await uploadFiles(files);
        fileInput.value = '';
    }

    // --- Drag & Drop Handlers ---
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');

        const files = e.dataTransfer.files;
        if (files.length === 0) {
            displayError("No se detectaron archivos para subir.");
            return;
        }
        await uploadFiles(files);
    });

    async function uploadFiles(filesList) {
        clearError();
        setUploadingState(true);

        let filesUploadedCount = 0;
        let filesSkippedCount = 0;
        const totalFiles = filesList.length;

        for (let i = 0; i < totalFiles; i++) {
            const file = filesList[i];

            if (file.isDirectory) {
                filesSkippedCount++;
                continue;
            }

            if (file.size > 20 * 1024 * 1024) {
                console.warn(`Archivo ${file.name} es demasiado grande (${(file.size / (1024 * 1024)).toFixed(2)}MB). Saltando.`);
                filesSkippedCount++;
                continue;
            }

            await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const fileContent = e.target.result;
                    socket.emit('upload_file', {
                        fileName: file.name,
                        fileContent: fileContent,
                        uploadedBy: userId,
                        timestamp: new Date().toISOString(),
                        relativePath: file.webkitRelativePath || file.name
                    });
                    filesUploadedCount++;
                    resolve();
                };
                reader.onerror = () => {
                    console.error(`Error al leer el archivo ${file.name}.`);
                    filesSkippedCount++;
                    resolve();
                };
                reader.readAsDataURL(file);
            });
        }

        setUploadingState(false);

        if (filesSkippedCount > 0) {
            displayError(`Se subieron ${filesUploadedCount} de ${totalFiles} archivos. Se saltaron ${filesSkippedCount} archivos (demasiado grandes o directorios).`);
        } else {
            clearError();
        }
    }

    // --- Socket.IO Event Handlers ---
    socket.on('connect', () => {
        console.log('Conectado al servidor Socket.IO');
    });

    socket.on('disconnect', () => {
        console.log('Desconectado del servidor Socket.IO');
        displayError("Desconectado del servidor. Reintentando conexión...");
    });

    socket.on('files_list', (filesArray) => {
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

    // Inicializar estado del botón subir
    fileInput.addEventListener('change', () => {
        uploadFileBtn.disabled = fileInput.files.length === 0;
    });
    uploadFileBtn.disabled = true;
});
