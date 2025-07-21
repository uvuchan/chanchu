document.addEventListener("DOMContentLoaded", () => {
    const socket = io();
    const fileList = document.getElementById("file-list");
    const fileInput = document.getElementById("file-input");
    const uploadedByInput = document.getElementById("uploaded-by");
    const uploadBtn = document.getElementById("upload-btn");
    const downloadAllBtn = document.getElementById("download-all-btn");

    function renderFile(file) {
        const div = document.createElement("div");
        div.classList.add("file-item");
        div.innerHTML = `
            <strong>${file.relativePath}</strong> (por ${file.uploadedBy})
            <button class="download-btn" data-id="${file.id}">Descargar</button>
            <button class="delete-btn" data-id="${file.id}">Eliminar</button>
        `;
        fileList.appendChild(div);
    }

    socket.on("files_list", (files) => {
        fileList.innerHTML = "";
        files.forEach(renderFile);
    });

    socket.on("file_updated", (file) => {
        const existing = document.querySelector(`.download-btn[data-id="${file.id}"]`);
        if (!existing) renderFile(file);
    });

    socket.on("file_deleted", (fileId) => {
        const btn = document.querySelector(`.delete-btn[data-id="${fileId}"]`);
        if (btn) btn.parentElement.remove();
    });

    uploadBtn.addEventListener("click", () => {
        const files = fileInput.files;
        const uploadedBy = uploadedByInput.value.trim();
        if (!uploadedBy || files.length === 0) {
            alert("Falta nombre o archivo");
            return;
        }
        Array.from(files).forEach(file => {
            const reader = new FileReader();
            reader.onload = () => {
                socket.emit("upload_file", {
                    fileName: file.name,
                    fileContent: reader.result,
                    uploadedBy,
                    relativePath: file.webkitRelativePath || file.name
                });
            };
            reader.readAsDataURL(file);
        });
        fileInput.value = "";
    });

    fileList.addEventListener("click", (e) => {
        if (e.target.classList.contains("delete-btn")) {
            const id = e.target.dataset.id;
            socket.emit("delete_file", id);
        } else if (e.target.classList.contains("download-btn")) {
            const id = e.target.dataset.id;
            window.open(`/download/${id}`);
        }
    });

    downloadAllBtn.addEventListener("click", async () => {
        const response = await fetch("/get_all_files");
        const files = await response.json();

        for (const file of files) {
            const link = document.createElement("a");
            link.href = `/download/${file.id}`;
            link.download = file.relativePath;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            await new Promise(res => setTimeout(res, 500)); // Espera para evitar bloqueo por navegador
        }
    });
});