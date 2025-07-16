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

    // Get or generate a unique user ID for this session
    let userId = localStorage.getItem('exam_app_userId');
    if (!userId) {
        userId = crypto.randomUUID(); // Generates a unique user ID
        localStorage.setItem('exam_app_userId', userId);
    }
    userIdDisplay.textContent = userId.substring(0, 8) + '...'; // Display a short version of the ID

    // --- Socket.IO Configuration ---
    // Connects to the current host where the Flask app is served
    const socket = io();

    let currentFiles = {}; // Object to store files by ID for easy updates

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
        errorTextSpan.textContent = message;
        showMessage(errorTextSpan, message, true);
    }

    function clearError() {
        hideMessage(errorTextSpan, true);
    }

    function setUploadingState(isUploading) {
        fileInput.disabled = isUploading;
        uploadFileBtn.disabled = isUploading || fileInput.files.length === 0; // Enable/disable the single button
        if (isUploading) {
            showMessage(uploadingMessage, 'Por favor, espere mientras se suben los archivos...');
        } else {
            hideMessage(uploadingMessage);
        }
    }

    function renderFiles() {
        // Convert the object to an array and sort it by timestamp (most recent first)
        const sortedFiles = Object.values(currentFiles).sort((a, b) => {
            const dateA = new Date(a.timestamp);
            const dateB = new Date(b.timestamp);
            return dateB.getTime() - dateA.getTime();
        });

        filesList.innerHTML = ''; // Clear the current list

        if (sortedFiles.length === 0) {
            noFilesMessage.classList.remove('hidden');
        } else {
            noFilesMessage.classList.add('hidden');
            sortedFiles.forEach(file => {
                const li = document.createElement('li');
                li.className = `flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 bg-white dark:bg-gray-700 rounded-lg shadow-sm
                                border border-gray-200 dark:border-gray-600 hover:shadow-md transition-shadow duration-200`;
                
                const uploadedByShort = file.uploadedBy ? file.uploadedBy.substring(0, 8) + '...' : 'Desconocido';
                const fileDate = file.timestamp ? new Date(file.timestamp).toLocaleString() : 'N/A';

                // Display the relative path if it exists, otherwise just the file name
                const displayName = file.relativePath || file.fileName;

                li.innerHTML = `
                    <div class="flex-grow mb-2 sm:mb-0">
                        <p class="font-medium text-lg text-blue-700 dark:text-blue-300 break-words">
                            ${displayName}
                        </p>
                        <p class="text-xs text-gray-500 dark:text-gray-400">
                            Subido por: <span class="font-mono">${uploadedByShort}</span>
                        </p>
                        <p class="text-xs text-gray-500 dark:text-gray-400">
                            Fecha: ${fileDate}
                        </p>
                    </div>
                    <div class="flex space-x-2 mt-2 sm:mt-0">
                        <button data-id="${file.id}" data-action="download"
                                class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold rounded-full shadow-md
                                       transition duration-300 ease-in-out transform hover:scale-105">
                            Descargar
                        </button>
                        <button data-id="${file.id}" data-action="delete"
                                class="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-full shadow-md
                                       transition duration-300 ease-in-out transform hover:scale-105">
                            Eliminar
                        </button>
                    </div>
                `;
                filesList.appendChild(li);
            });

            // Attach event listeners to the new buttons
            filesList.querySelectorAll('button[data-action="download"]').forEach(button => {
                button.addEventListener('click', (e) => {
                    const fileId = e.target.dataset.id;
                    const file = currentFiles[fileId];
                    if (file) {
                        const link = document.createElement('a');
                        link.href = file.fileContent;
                        link.download = file.fileName; // Download with the original file name
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

    // --- Event Listener for the single Upload button ---
    uploadFileBtn.addEventListener('click', () => handleFileUpload());

    async function handleFileUpload() {
        const files = fileInput.files; // files is now a FileList (can contain multiple files/directories)
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

            // Skip directories if the browser includes them in the FileList
            // file.isDirectory is a non-standard property but useful
            if (file.isDirectory) { 
                filesSkippedCount++;
                continue;
            }

            // --- Increased file size limit to 5 MB (5 * 1024 * 1024 bytes) ---
            if (file.size > 5 * 1024 * 1024) { // 5 MB
                console.warn(`Archivo ${file.name} es demasiado grande (${(file.size / (1024 * 1024)).toFixed(2)}MB). Saltando.`);
                filesSkippedCount++;
                continue;
            }
            
            // Use a Promise to handle the asynchronous reading of each file
            await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const fileContent = e.target.result; // Content in Base64
                    socket.emit('upload_file', {
                        fileName: file.name,
                        fileContent: fileContent,
                        uploadedBy: userId,
                        timestamp: new Date().toISOString(),
                        relativePath: file.webkitRelativePath || file.name // Send the relative path
                    });
                    filesUploadedCount++;
                    resolve(); // Resolve the promise when the file has been emitted
                };
                reader.onerror = () => {
                    console.error(`Error al leer el archivo ${file.name}.`);
                    filesSkippedCount++;
                    resolve(); // Resolve the promise even if there's an error to continue with the next file
                };
                reader.readAsDataURL(file); // Read the file as Base64
            });
        }

        // Clear the input after processing all files
        fileInput.value = '';
        setUploadingState(false);

        if (filesSkippedCount > 0) {
            // Display a summary message if some files were skipped
            displayError(`Se subieron ${filesUploadedCount} de ${totalFiles} archivos. Se saltaron ${filesSkippedCount} archivos (demasiado grandes o directorios).`);
        } else {
            clearError(); // Clear any previous error message if all files were uploaded successfully
        }
    }

    // --- Socket.IO Event Handlers ---
    socket.on('connect', () => {
        console.log('Conectado al servidor Socket.IO');
        // When connected, the server will automatically emit 'files_list'
    });

    socket.on('disconnect', () => {
        console.log('Desconectado del servidor Socket.IO');
        displayError("Desconectado del servidor. Reintentando conexión...");
    });

    socket.on('files_list', (filesArray) => {
        // Receive the full list of files on connect or update
        currentFiles = {};
        filesArray.forEach(file => {
            currentFiles[file.id] = file;
        });
        renderFiles();
        clearError();
    });

    socket.on('file_updated', (file) => {
        // A file has been created or modified
        currentFiles[file.id] = file;
        renderFiles();
        clearError();
    });

    socket.on('file_deleted', (fileId) => {
        // A file has been deleted
        delete currentFiles[fileId];
        renderFiles();
        clearError();
    });

    socket.on('error', (message) => {
        console.error('Server error:', message);
        displayError(`Error del servidor: ${message}`);
    });

    // Disable upload button initially if no file is selected
    fileInput.addEventListener('change', () => {
        uploadFileBtn.disabled = fileInput.files.length === 0;
    });
    uploadFileBtn.disabled = true; // Disable on initial load
});