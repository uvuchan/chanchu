document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const fileInput = document.getElementById('fileInput');
    const uploadFileBtn = document.getElementById('uploadFileBtn');
    const uploadingMessage = document.getElementById('uploadingMessage');
    const filesList = document.getElementById('filesList');
    const noFilesMessage = document.getElementById('noFilesMessage');
    const errorMessageDiv = document.getElementById('errorMessage');
    const errorTextSpan = document.getElementById('errorText');
    const downloadAllFilesBtn = document.getElementById('downloadAllFilesBtn');
    const dropArea = document.getElementById('dropArea');

    // Get or generate a unique user ID for this session
    let userId = localStorage.getItem('exam_app_userId');
    if (!userId) {
        userId = crypto.randomUUID(); // Generates a unique user ID
        localStorage.setItem('exam_app_userId', userId);
    }

    // --- Socket.IO Configuration ---
    const socket = io();

    let currentFiles = {}; // Stores file metadata received from the server

    // --- Utility Functions ---
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
        console.error("Error received on frontend:", message);
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
            // Remove listeners when disabled to prevent new drag/drops during upload
            dropArea.removeEventListener('dragover', handleDragOver);
            dropArea.removeEventListener('dragleave', handleDragLeave);
            dropArea.removeEventListener('drop', handleDrop);
        } else {
            dropArea.classList.remove('disabled');
            // Re-add listeners when not uploading
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

        filesList.innerHTML = ''; // Clear existing list

        if (sortedFiles.length === 0) {
            noFilesMessage.classList.remove('hidden');
            downloadAllFilesBtn.disabled = true;
        } else {
            noFilesMessage.classList.add('hidden');
            downloadAllFilesBtn.disabled = false;
            sortedFiles.forEach(file => {
                const li = document.createElement('li');
                li.className = `file-item`;
                
                const uploadedByFull = file.uploadedBy || 'Desconocido';
                const fileDate = file.timestamp ? new Date(file.timestamp).toLocaleString() : 'N/A';
                const displayName = file.relativePath || file.fileName; // Use relativePath for display

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

            // --- Download button event listeners (now points to server download endpoint) ---
            filesList.querySelectorAll('button[data-action="download"]').forEach(button => {
                button.addEventListener('click', (e) => {
                    const fileId = e.target.dataset.id;
                    // Open the direct download URL for the file on the server
                    window.open(`/download/${fileId}`, '_blank');
                });
            });

            // --- Delete button event listeners ---
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

    // --- Unified Function to Handle File Uploads (NOW USES FETCH/HTTP POST) ---
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

        const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB (Frontend validation)

        for (let i = 0; i < totalFiles; i++) {
            const file = filesToProcess[i];

            console.log(`Procesando archivo: ${file.name}, Tipo: ${file.type}, Tamaño: ${file.size} bytes`);
            // file.isDirectory is only reliably set when using webkitGetAsEntry for folders
            // file.type === "" is a common indicator for folders in some browsers' FileList
            console.log(`Es directorio: ${file.isDirectory}, webkitRelativePath: ${file.webkitRelativePath}`);

            // Check if it's a directory (often file.size is 0 and file.type is empty for directories)
            // or if it's explicitly marked as a directory by webkitRelativePath processing
            if (file.isDirectory || file.type === "") {
                console.warn(`Archivo ${file.name} (tipo: ${file.type}) detectado como directorio o tipo desconocido. Saltando.`);
                filesSkippedCount++;
                continue;
            }

            // --- File size limit ---
            if (file.size > MAX_FILE_SIZE) {
                console.warn(`Archivo ${file.name} es demasiado grande (${(file.size / (1024 * 1024)).toFixed(2)}MB). Saltando.`);
                filesSkippedCount++;
                continue;
            }

            // --- NEW: Use FormData and fetch to send the file via HTTP POST ---
            const formData = new FormData();
            formData.append('file', file); // Append the actual File object
            formData.append('uploadedBy', userId);
            // Include relativePath if available (for nested folders)
            if (file.webkitRelativePath) {
                formData.append('relativePath', file.webkitRelativePath);
            } else {
                formData.append('relativePath', file.name); // Fallback for single file uploads or browsers without webkitRelativePath
            }

            try {
                // Send the file to the /upload endpoint
                const response = await fetch('/upload', {
                    method: 'POST',
                    body: formData // FormData handles setting Content-Type: multipart/form-data
                });

                if (response.ok) {
                    const data = await response.json();
                    console.log(`Archivo subido exitosamente: ${data.fileName}`);
                    filesUploadedCount++;
                    // Note: file_updated will come via Socket.IO after server saves.
                    // No need to manually add to currentFiles here.
                } else {
                    const errorData = await response.json();
                    console.error(`Error al subir ${file.name}: ${errorData.error || response.statusText}`);
                    filesSkippedCount++;
                }
            } catch (error) {
                console.error(`Error de red o desconocido al subir ${file.name}:`, error);
                filesSkippedCount++;
            }
        }

        setUploadingState(false);
        fileInput.value = ''; // Clear file input after processing

        if (filesSkippedCount > 0) {
            displayError(`Se subieron ${filesUploadedCount} de ${totalFiles} archivos. Se saltaron ${filesSkippedCount} archivos (demasiado grandes o errores de subida).`);
        } else {
            clearError();
        }
    }

    // --- Event Listener for the single Upload button ---
    uploadFileBtn.addEventListener('click', () => {
        processFilesForUpload(fileInput.files);
    });

    // --- Event Listener for "Download All" button (points to server-side ZIP download) ---
    downloadAllFilesBtn.addEventListener('click', () => {
        if (Object.keys(currentFiles).length === 0) {
            displayError("No hay archivos para descargar.");
            return;
        }

        clearError();
        // The most reliable way to download all files is to request a ZIP from the server.
        window.open('/download_all_zip', '_blank'); // This endpoint needs to be implemented in app.py
        console.log('Solicitando descarga de todos los archivos como ZIP.');

        // If you *really* want to try to download them one by one (highly prone to browser blocking):
        /*
        const filesToDownload = Object.values(currentFiles);
        let downloadIndex = 0;
        function initiateDownload() {
            if (downloadIndex < filesToDownload.length) {
                const file = filesToDownload[downloadIndex];
                // The individual download URL is now /download/<file_id>
                window.open(`/download/${file.id}`, '_blank');
                console.log(`Intentando descargar: ${file.fileName}`);
                downloadIndex++;
                setTimeout(initiateDownload, 500); // Small delay to attempt to bypass blockers
            } else {
                console.log('Todos los intentos de descarga iniciados.');
            }
        }
        initiateDownload();
        */
    });

    // --- Drag and Drop Event Handlers ---
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

    // Helper function to traverse dragged directories
    async function traverseFileTree(item, filesList) {
        return new Promise(resolve => {
            if (item.isFile) {
                item.file(file => {
                    // Augment file object to include webkitRelativePath for proper server-side pathing
                    file.webkitRelativePath = item.fullPath.substring(1); // Remove leading slash
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

    // --- Initialize Drag and Drop Listeners ---
    function addDropAreaListeners() {
        dropArea.addEventListener('dragover', handleDragOver);
        dropArea.addEventListener('dragleave', handleDragLeave);
        dropArea.addEventListener('drop', handleDrop);
    }
    addDropAreaListeners(); // Add them on initial load

    // --- Socket.IO Event Handlers ---
    socket.on('connect', () => {
        console.log('Conectado al servidor Socket.IO');
        // Initial request for files list upon connection
        // No explicit emit needed here, server sends 'files_list' on connect.
    });

    socket.on('disconnect', () => {
        console.log('Desconectado del servidor Socket.IO');
        displayError("Desconectado del servidor. Reintentando conexión...");
    });

    socket.on('files_list', (filesArray) => {
        // This event is received on connect and after certain server updates
        currentFiles = {};
        filesArray.forEach(file => {
            currentFiles[file.id] = file;
        });
        renderFiles();
        clearError();
    });

    socket.on('file_updated', (fileMetadata) => { // Server sends only metadata after HTTP POST upload
        currentFiles[fileMetadata.id] = fileMetadata;
        renderFiles();
        clearError();
    });

    socket.on('file_deleted', (fileId) => {
        delete currentFiles[fileId];
        renderFiles();
        clearError();
    });

    socket.on('error', (message) => {
        console.error('Error del servidor (Socket.IO):', message);
        displayError(`Error del servidor: ${message}`);
    });

    // Disable buttons initially
    fileInput.addEventListener('change', () => {
        uploadFileBtn.disabled = fileInput.files.length === 0;
    });
    uploadFileBtn.disabled = true;
    downloadAllFilesBtn.disabled = true; // Disabled until files are loaded/present
});