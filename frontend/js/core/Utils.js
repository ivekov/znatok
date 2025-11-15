// frontend/js/core/Utils.js
export const Utils = {
    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "<")
            .replace(/>/g, ">")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    },

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    getFileExtension(filename) {
        return filename.toLowerCase().split('.').pop();
    },

    getFileType(extension) {
        const map = { pdf: 'pdf', docx: 'docx', doc: 'doc', txt: 'txt' };
        return map[extension] || 'unknown';
    },

    getFileIcon(extension) {
        const map = {
            pdf: 'bi-file-earmark-pdf',
            docx: 'bi-file-earmark-word',
            doc: 'bi-file-earmark-word',
            txt: 'bi-file-earmark-text'
        };
        return map[extension] || 'bi-file-earmark';
    },

    isValidFile(filename) {
        return /\.(pdf|docx|doc|txt)$/i.test(filename);
    }
};