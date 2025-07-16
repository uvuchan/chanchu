document.addEventListener('DOMContentLoaded', () => {
    // --- Elementos del DOM ---
    const userIdDisplay = document.getElementById('userIdDisplay');
    const fileInput = document.getElementById('fileInput');
    const uploadFileBtn = document.getElementById('uploadFileBtn');
    const uploadingMessage = document.getElementById('uploadingMessage');
    const filesList = document.getElementById('filesList');
    const noFilesMessage = document.getElementById('noFilesMessage');
    const errorMessageDiv = document.getElementById('errorMessage');
    const errorTextSpan = document.getElementById('errorText');

    let userId = localStorage.getItem('exam_app_userId');
    if (!userId) {
        userId = crypto.randomUUID(); // Genera un ID de usuario único
        localStorage.setItem('exam_app_userId', userId);
    }
    userIdDisplay.textContent = userId.substring(0, 8) + '...'; // Muestra una parte del ID

    // --- Configuración de Socket.IO ---
    const socket = io(); // Se conecta al host actual

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
        errorTextSpan.textContent = message;
        showMessage(errorTextSpan, message, true);
    }

    function clearError() {
        hideMessage(errorTextSpan, true);
    }

    function setUploadingState(isUploading) {
        fileInput.disabled = isUploading;
        uploadFileBtn.disabled = isUploading || fileInput.files.length === 0; // Habilita/deshabilita el botón único
        if (isUploading) {
            showMessage(uploadingMessage, 'Por favor, espere mientras se suben los archivos...');
        } else {
            hideMessage(uploadingMessage);
        }
    }

    function renderFiles() {
        // Convierte el objeto a un array y lo ordena por timestamp (más reciente primero)
        const sortedFiles = Object.values(currentFiles).sort((a, b) => {
            const dateA = new Date(a.timestamp);
            const dateB = new Date(b.timestamp);
            return dateB.getTime() - dateA.getTime();
        });

        filesList.innerHTML = ''; // Limpia la lista actual

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

                // Mostrar la ruta relativa si existe, de lo contrario, solo el nombre del archivo
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

            // Adjuntar event listeners a los nuevos botones
            filesList.querySelectorAll('button[data-action="download"]').forEach(button => {
                button.addEventListener('click', (e) => {
                    const fileId = e.target.dataset.id;
                    const file = currentFiles[fileId];
                    if (file) {
                        const link = document.createElement('a');
                        link.href = file.fileContent;
                        link.download = file.fileName; // Descarga con el nombre original del archivo
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
        const files = fileInput.files; // Ahora files es una FileList
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

            // Ignorar directorios si el navegador los incluye en la FileList
            if (file.isDirectory) { // file.isDirectory es una propiedad no estándar pero útil
                filesSkippedCount++;
                continue;
            }

            if (file.size > 500 * 1024) { // Límite de 500KB para Base64
                console.warn(`Archivo ${file.name} es demasiado grande (${(file.size / 1024).toFixed(2)}KB). Saltando.`);
                filesSkippedCount++;
                continue;
            }
            
            // Usar una Promise para manejar la lectura asíncrona de cada archivo
            await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const fileContent = e.target.result; // Contenido en Base64
                    socket.emit('upload_file', {
                        fileName: file.name,
                        fileContent: fileContent,
                        uploadedBy: userId,
                        timestamp: new Date().toISOString(),
                        relativePath: file.webkitRelativePath || file.name // Envía la ruta relativa
                    });
                    filesUploadedCount++;
                    resolve(); // Resuelve la promesa cuando el archivo ha sido emitido
                };
                reader.onerror = () => {
                    console.error(`Error al leer el archivo ${file.name}.`);
                    filesSkippedCount++;
                    resolve(); // Resuelve la promesa incluso si hay error para continuar con el siguiente archivo
                };
                reader.readAsDataURL(file); // Lee el archivo como Base64
            });
        }

        // Limpia el input después de procesar todos los archivos
        fileInput.value = '';
        setUploadingState(false);

        if (filesSkippedCount > 0) {
            displayError(`Se subieron ${filesUploadedCount} de ${totalFiles} archivos. Se saltaron ${filesSkippedCount} archivos (demasiado grandes o directorios).`);
        } else {
            clearError();
        }
    }

    // --- Manejadores de Eventos de Socket.IO ---
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

    // Deshabilitar botón de subida inicialmente si no hay archivo seleccionado
    fileInput.addEventListener('change', () => {
        uploadFileBtn.disabled = fileInput.files.length === 0;
    });
    uploadFileBtn.disabled = true; // Deshabilitar al inicio
});