'use strict';

const SUPPORTED_TYPES = ['image/png', 'image/jpeg'];
const SUPPORTED_EXTENSIONS = /\.(png|jpe?g)$/i;
const PICK_TRANSPARENT_MESSAGE = 'Transparent pixel — pick another one.';

const state = {
    originalImage: null, // ImageData; никогда не изменяется
    resultImage: null,   // ImageData; производный результат, пересчитывается из originalImage
    fileName: '',
    settings: createDefaultSettings(),
    zoom: 1,
    isPicking: false // режим пипетки; UI-состояние, не настройка обработки
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
    status: document.getElementById('status'),
    bgEnabled: document.getElementById('bg-enabled'),
    bgOptions: document.getElementById('bg-options'),
    bgColor: document.getElementById('bg-color'),
    bgColorValue: document.getElementById('bg-color-value'),
    bgPickButton: document.getElementById('bg-pick-button'),
    bgTolerance: document.getElementById('bg-tolerance'),
    bgToleranceValue: document.getElementById('bg-tolerance-value'),
    bgModeInputs: document.querySelectorAll('input[name="bg-mode"]')
};

const previewContext = els.canvas.getContext('2d');

// Настройки обработки по умолчанию. Каждый вызов создаёт новый объект
// с независимыми группами. Параметры групп добавляются вместе с инструментами.
function createDefaultSettings() {
    return {
        background: {
            enabled: false,
            color: '#ffffff',
            tolerance: 0,
            mode: 'connected'
        },
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
    renderBackgroundControls(hasImage);

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

// Контролы Background всегда отражают state.settings.background и state.isPicking.
function renderBackgroundControls(hasImage) {
    const background = state.settings.background;

    els.bgEnabled.disabled = !hasImage;
    els.bgEnabled.checked = background.enabled;
    els.bgOptions.disabled = !hasImage || !background.enabled;

    els.bgColor.value = background.color;
    els.bgColorValue.textContent = background.color.toUpperCase();
    els.bgTolerance.value = String(background.tolerance);
    els.bgToleranceValue.textContent = String(background.tolerance);
    els.bgModeInputs.forEach((input) => {
        input.checked = input.value === background.mode;
    });

    els.bgPickButton.setAttribute('aria-pressed', String(state.isPicking));
    els.canvas.classList.toggle('is-picking', state.isPicking);
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
    state.isPicking = false;
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

// ---------- Color picking ----------

// Убирает только подсказку пипетки; ошибки загрузки и прочие сообщения остаются.
function clearPickingStatus() {
    if (els.status.textContent === PICK_TRANSPARENT_MESSAGE) showStatus('');
}

function setPicking(active) {
    state.isPicking = active;
    clearPickingStatus();
    render();
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('');
}

// Пипетка выбирает только цвет. Читает оригинал: так можно повторно выбрать
// уже удалённый цвет. На этом этапе геометрия оригинала и результата совпадает.
function pickColor(event) {
    const image = state.originalImage;
    if (!state.isPicking || !image) return;

    const rect = els.canvas.getBoundingClientRect();
    const x = Math.min(image.width - 1, Math.max(0,
        Math.floor((event.clientX - rect.left) * els.canvas.width / rect.width)));
    const y = Math.min(image.height - 1, Math.max(0,
        Math.floor((event.clientY - rect.top) * els.canvas.height / rect.height)));

    const i = (y * image.width + x) * 4;
    const data = image.data;
    if (data[i + 3] === 0) {
        showStatus(PICK_TRANSPARENT_MESSAGE);
        return;
    }

    state.isPicking = false;
    clearPickingStatus();
    updateSettings('background', { color: rgbToHex(data[i], data[i + 1], data[i + 2]) });
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
    state.isPicking = false;
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

els.bgEnabled.addEventListener('change', () => {
    if (!els.bgEnabled.checked) {
        state.isPicking = false; // пипетка становится недоступной — завершаем выбор
        clearPickingStatus();
    }
    updateSettings('background', { enabled: els.bgEnabled.checked });
});

els.bgColor.addEventListener('input', () => {
    updateSettings('background', { color: els.bgColor.value });
});

els.bgTolerance.addEventListener('input', () => {
    updateSettings('background', { tolerance: Number(els.bgTolerance.value) });
});

els.bgModeInputs.forEach((input) => {
    input.addEventListener('change', () => {
        if (input.checked) updateSettings('background', { mode: input.value });
    });
});

els.bgPickButton.addEventListener('click', () => setPicking(!state.isPicking));

els.canvas.addEventListener('click', pickColor);

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.isPicking) setPicking(false);
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
