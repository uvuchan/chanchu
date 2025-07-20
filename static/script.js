document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    // const userIdDisplay = document.getElementById('userIdDisplay'); // ELIMINADO
    const fileInput = document.getElementById('fileInput');
    const uploadFileBtn = document.getElementById('uploadFileBtn');
    const uploadingMessage = document.getElementById('uploadingMessage');
    const filesList = document.getElementById('filesList');
    const noFilesMessage = document.getElementById('noFilesMessage');
    const errorMessageDiv = document.getElementById('errorMessage');
    const errorTextSpan = document.getElementById('errorText');
    const downloadAllFilesBtn = document.getElementById('downloadAllFilesBtn');
    const dropArea = document.getElementById('dropArea');

    // Obtener o generar un ID de usuario único para esta sesión
    let userId = localStorage.getItem('exam_app_userId');
    if (!userId) {
        userId = crypto.randomUUID(); // Genera un ID de usuario único
        localStorage.setItem('exam_app_userId', userId);
    }
    // No hay necesidad de actualizar userIdDisplay ya que fue eliminado del DOM.
    // userIdDisplay.textContent = userId.substring(0, 8) + '...';

    // --- Configuración de Socket.IO ---
    const socket = io();

    let currentFiles = {};

    // --- Funciones de Utilidad (sin cambios significativos) ---
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
            dropArea.classList.add('disabled');
            dropArea.removeEventListener('dragover', handleDragOver);
            dropArea.removeEventListener('dragleave', handleDragLeave);
            dropArea.removeEventListener('drop', handleDrop);
        } else {
            dropArea.classList.remove('disabled');
            addDropAreaListeners();
        }
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
            downloadAllFilesBtn.disabled = true;
        } else {
            noFilesMessage.classList.add('hidden');
            downloadAllFilesBtn.disabled = false;
            sortedFiles.forEach(file => {
                const li = document.createElement('li');
                li.className = `file-item`;
                
                // Asegurarse de que el userId se muestre completo si no hay dónde acortarlo
                const uploadedByFull = file.uploadedBy || 'Desconocido';

                const fileDate = file.timestamp ? new Date(file.timestamp).toLocaleString() : 'N/A';

                const displayName = file.relativePath || file.fileName;

                li.innerHTML = `
                    <div class="file-info">
                        <p class="file-name">
                            ${displayName}
                        </p>
                        <p class="file-meta">
                            Subido por: <span class="file-user-id">${uploadedByFull}</span>
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

    // --- Función Unificada para Manejar la Subida de Archivos ---
    async function processFilesForUpload(filesToProcess) {
        if (filesToProcess.length === 0) {
            displayError("No se seleccionaron archivos para subir.");
            return;
        }

        clearError();
        setUploadingState(true);

        let filesUploadedCount = 0;
        let filesSkippedCount = 0;
        const totalFiles = filesToProcess.length;

        for (let i = 0; i < totalFiles; i++) {
            const file = filesToProcess[i];

            if (file.isDirectory || file.type === "") {
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
        fileInput.value = '';

        if (filesSkippedCount > 0) {
            displayError(`Se subieron ${filesUploadedCount} de ${totalFiles} archivos. Se saltaron ${filesSkippedCount} archivos (demasiado grandes o directorios/errores).`);
        } else {
            clearError();
        }
    }

    // --- Event Listener para el botón único de Subida ---
    uploadFileBtn.addEventListener('click', () => {
        processFilesForUpload(fileInput.files);
    });

    // --- Event Listener para el botón "Descargar Todos" ---
    downloadAllFilesBtn.addEventListener('click', () => {
        if (Object.keys(currentFiles).length === 0) {
            displayError("No hay archivos para descargar.");
            return;
        }

        clearError();
        Object.values(currentFiles).forEach(file => {
            const link = document.createElement('a');
            link.href = file.fileContent;
            link.download = file.relativePath || file.fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    });

    // --- Manejadores de Eventos de Drag and Drop ---
    function handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        dropArea.classList.add('drag-over');
    }

    function handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        dropArea.classList.remove('drag-over');
    }

    async function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        dropArea.classList.remove('drag-over');

        const files = [];
        const items = e.dataTransfer.items;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry();
                if (entry) {
                    await traverseFileTree(entry, files);
                }
            }
        }
        
        processFilesForUpload(files);
    }

    // Función auxiliar para recorrer directorios arrastrados
    async function traverseFileTree(item, filesList) {
        return new Promise(resolve => {
            if (item.isFile) {
                item.file(file => {
                    filesList.push(file);
                    resolve();
                });
            } else if (item.isDirectory) {
                const dirReader = item.createReader();
                dirReader.readEntries(async (entries) => {
                    const promises = [];
                    for (let i = 0; i < entries.length; i++) {
                        promises.push(traverseFileTree(entries[i], filesList));
                    }
                    await Promise.all(promises);
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    // --- Inicialización de Listeners de Drag and Drop ---
    function addDropAreaListeners() {
        dropArea.addEventListener('dragover', handleDragOver);
        dropArea.addEventListener('dragleave', handleDragLeave);
        dropArea.addEventListener('drop', handleDrop);
    }
    addDropAreaListeners();

    // --- Manejadores de Eventos de Socket.IO (sin cambios) ---
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

    // Deshabilitar botones inicialmente
    fileInput.addEventListener('change', () => {
        uploadFileBtn.disabled = fileInput.files.length === 0;
    });
    uploadFileBtn.disabled = true;
    downloadAllFilesBtn.disabled = true;
});