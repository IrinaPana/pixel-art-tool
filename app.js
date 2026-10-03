'use strict';

const SUPPORTED_TYPES = ['image/png', 'image/jpeg'];
const SUPPORTED_EXTENSIONS = /\.(png|jpe?g)$/i;

const state = {
    originalImage: null, // ImageData; никогда не изменяется
    resultImage: null,   // ImageData; производный результат, пересчитывается из originalImage
    fileName: '',
    settings: createDefaultSettings(),
    zoom: 1
};

let loadRequestId = 0;
let dragDepth = 0;

const els = {
    openButton: document.getElementById('open-button'),
    exportButton: document.getElementById('export-button'),
    resetButton: document.getElementById('reset-button'),
    fileInput: document.getElementById('file-input'),
    previewArea: document.getElementById('preview-area'),
    canvas: document.getElementById('preview-canvas'),
    zoomButtons: document.querySelectorAll('[data-zoom]'),
    fileNameValue: document.getElementById('file-name-value'),
    sizeValue: document.getElementById('size-value'),
    status: document.getElementById('status')
};

const previewContext = els.canvas.getContext('2d');

// Настройки обработки по умолчанию. Каждый вызов создаёт новый объект
// с независимыми группами. Параметры групп добавляются вместе с инструментами.
function createDefaultSettings() {
    return {
        background: {},
        transform: {},
        resize: {},
        crop: {}
    };
}

// ---------- Processing ----------

// Полный пересчёт результата из оригинала. Предыдущий результат не используется.
function reprocess() {
    state.resultImage = state.originalImage
        ? ImageProcessing.process(state.originalImage, state.settings)
        : null;
    render();
}

// Единая точка изменения настроек обработки для контролов.
function updateSettings(group, patch) {
    if (!Object.prototype.hasOwnProperty.call(state.settings, group)) {
        throw new Error(`Unknown settings group: ${group}`);
    }
    state.settings[group] = Object.assign({}, state.settings[group], patch);
    reprocess();
}

// ---------- Render ----------

function render() {
    const result = state.resultImage;
    const hasImage = result !== null;

    els.previewArea.classList.toggle('has-image', hasImage);
    els.exportButton.disabled = !hasImage;
    els.resetButton.disabled = !hasImage;
    els.zoomButtons.forEach((button) => {
        button.disabled = !hasImage;
        button.setAttribute('aria-pressed', String(Number(button.dataset.zoom) === state.zoom));
    });

    if (!hasImage) {
        els.fileNameValue.textContent = '—';
        els.sizeValue.textContent = '—';
        return;
    }

    if (els.canvas.width !== result.width) els.canvas.width = result.width;
    if (els.canvas.height !== result.height) els.canvas.height = result.height;
    previewContext.putImageData(result, 0, 0);

    els.canvas.style.width = result.width * state.zoom + 'px';
    els.canvas.style.height = result.height * state.zoom + 'px';

    els.fileNameValue.textContent = state.fileName;
    els.sizeValue.textContent = `${result.width} × ${result.height} px`;
}

function showStatus(message, isError = false) {
    els.status.textContent = message;
    els.status.classList.toggle('is-error', isError);
}

// ---------- Loading ----------

function isSupportedFile(file) {
    if (file.type) return SUPPORTED_TYPES.includes(file.type);
    return SUPPORTED_EXTENSIONS.test(file.name);
}

async function loadFile(file) {
    if (!file) return;

    if (!isSupportedFile(file)) {
        showStatus(`“${file.name}” is not a PNG or JPEG image.`, true);
        return;
    }

    const requestId = ++loadRequestId;
    showStatus('Loading…');

    let imageData;
    try {
        imageData = await decodeFile(file);
    } catch (error) {
        if (requestId === loadRequestId) {
            showStatus(`Could not open “${file.name}”.`, true);
        }
        return;
    }

    if (requestId !== loadRequestId) return;

    state.originalImage = imageData;
    state.fileName = file.name;
    state.settings = createDefaultSettings();
    state.zoom = 1;
    showStatus('');
    reprocess();
}

async function decodeFile(file) {
    if (typeof createImageBitmap === 'function') {
        let bitmap = null;
        try {
            bitmap = await createImageBitmap(file, { colorSpaceConversion: 'none' });
        } catch (error) {
            bitmap = null; // переходим к fallback
        }
        if (bitmap) {
            try {
                return sourceToImageData(bitmap, bitmap.width, bitmap.height);
            } finally {
                bitmap.close();
            }
        }
    }
    return decodeWithImageElement(file);
}

// Fallback: стандартное декодирование браузера,
// без гарантии отключения цветового преобразования.
function decodeWithImageElement(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            try {
                resolve(sourceToImageData(image, image.naturalWidth, image.naturalHeight));
            } catch (error) {
                reject(error);
            } finally {
                URL.revokeObjectURL(url);
            }
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Image decoding failed'));
        };
        image.src = url;
    });
}

function sourceToImageData(source, width, height) {
    if (!width || !height) throw new Error('Empty image');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0);
    return context.getImageData(0, 0, width, height);
}

// ---------- Actions ----------

function exportPng() {
    if (!state.resultImage) return;
    const fileName = getExportFileName(state.fileName);

    // Preview canvas содержит результат в натуральном размере;
    // CSS-масштаб и шахматный фон в данные не входят.
    els.canvas.toBlob((blob) => {
        if (!blob) {
            showStatus('Export failed.', true);
            return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }, 'image/png');
}

function getExportFileName(name) {
    const base = name.replace(/\.[^.]+$/, '') || 'image';
    return `${base}-edited.png`;
}

function reset() {
    if (!state.originalImage) return;
    state.settings = createDefaultSettings();
    state.zoom = 1;
    showStatus('');
    reprocess();
}

// ---------- Events ----------

els.openButton.addEventListener('click', () => els.fileInput.click());

els.fileInput.addEventListener('change', () => {
    const file = els.fileInput.files[0];
    els.fileInput.value = ''; // позволяет повторно открыть тот же файл
    loadFile(file);
});

els.exportButton.addEventListener('click', exportPng);
els.resetButton.addEventListener('click', reset);

els.zoomButtons.forEach((button) => {
    button.addEventListener('click', () => {
        state.zoom = Number(button.dataset.zoom);
        render();
    });
});

// Не даём браузеру открыть файл, брошенный мимо drop-зоны.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

els.previewArea.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth++;
    els.previewArea.classList.add('is-dragging');
});

els.previewArea.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) els.previewArea.classList.remove('is-dragging');
});

els.previewArea.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    els.previewArea.classList.remove('is-dragging');
    loadFile(event.dataTransfer.files[0]);
});

render();
