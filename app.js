'use strict';

const SUPPORTED_TYPES = ['image/png', 'image/jpeg'];
const SUPPORTED_EXTENSIONS = /\.(png|jpe?g)$/i;
const PICK_TRANSPARENT_MESSAGE = 'Transparent pixel — pick another one.';
const PROCESS_ERROR_MESSAGE = 'Could not apply these settings.';
const PREVIEW_ERROR_MESSAGE = 'Preview could not be updated. Export is disabled.';
// Ограничение приложения для явного Resize (самое строгое ограничение canvas
// по MDN — iOS, 4096 × 4096). Не гарантирует успешной отрисовки.
const MAX_RESIZE_SIDE = 4096;
const RESIZE_SIZE_ERROR = 'Enter a whole number greater than 0.';
const RESIZE_LIMIT_ERROR = `Resize is limited to ${MAX_RESIZE_SIDE} px per side.`;
const RESIZE_RATIO_LIMIT_ERROR = `Preserving the ratio would exceed ${MAX_RESIZE_SIDE} px per side.`;

const state = {
    originalImage: null, // ImageData; никогда не изменяется
    resultImage: null,   // ImageData; производный результат, пересчитывается из originalImage
    fileName: '',
    settings: createDefaultSettings(0, 0), // только успешно применённые настройки
    // Текст полей Width/Height (UI-состояние). Может быть пустым, незавершённым
    // или недопустимым; в обработку попадает только через commitResizeDraft().
    resizeDraft: { width: '', height: '' },
    zoom: 1,
    isPicking: false,    // режим пипетки; UI-состояние, не настройка обработки
    previewFailed: false // canvas не соответствует результату; экспорт и пипетка отключены
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
    bgModeInputs: document.querySelectorAll('input[name="bg-mode"]'),
    transformButtons: document.querySelectorAll('[data-transform]'),
    resizeOptions: document.getElementById('resize-options'),
    resizeMethodButtons: document.querySelectorAll('[data-resize-method]'),
    resizeNote: document.getElementById('resize-note'),
    resizeWidth: document.getElementById('resize-width'),
    resizeHeight: document.getElementById('resize-height'),
    resizeError: document.getElementById('resize-error'),
    resizeKeepRatio: document.getElementById('resize-keep-ratio')
};

const previewContext = els.canvas.getContext('2d');

// Настройки обработки по умолчанию. Каждый вызов создаёт новый объект
// с независимыми группами. Параметры групп добавляются вместе с инструментами.
// Размеры Resize по умолчанию равны размерам загруженного изображения.
function createDefaultSettings(width, height) {
    return {
        background: {
            enabled: false,
            color: '#ffffff',
            tolerance: 0,
            mode: 'connected'
        },
        transform: {
            quarterTurns: 0, // 0–3, по часовой стрелке
            flipX: false,
            flipY: false
        },
        resize: {
            method: 'nearest', // 'nearest' | 'area'
            width: width,      // целевой размер после Transform
            height: height,
            preserveAspectRatio: true
        },
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

// Применяет новый набор настроек: обработка и обновление preview.
// syncDraft — заменить черновик Resize применёнными размерами (поворот,
// переключение пропорций). При любой ошибке (память, canvas) восстанавливаются
// предыдущие настройки, результат и черновик, preview перерисовывается.
// Сообщение о неисправном preview ведёт drawPreview().
function applySettings(next, syncDraft = false) {
    const previousSettings = state.settings;
    const previousResult = state.resultImage;

    try {
        const result = ImageProcessing.process(state.originalImage, next);
        state.settings = next;
        state.resultImage = result;
        if (syncDraft) syncResizeDraft();
        render();
    } catch (error) {
        state.settings = previousSettings;
        state.resultImage = previousResult;
        syncResizeDraft();
        try {
            render();
            showStatus(PROCESS_ERROR_MESSAGE, true);
        } catch (restoreError) {
            // drawPreview() уже показал PREVIEW_ERROR_MESSAGE
        }
        return false;
    }

    if (els.status.textContent === PROCESS_ERROR_MESSAGE) showStatus('');
    return true;
}

// Единая точка изменения одной группы настроек для контролов.
function updateSettings(group, patch, syncDraft = false) {
    if (!Object.prototype.hasOwnProperty.call(state.settings, group)) {
        throw new Error(`Unknown settings group: ${group}`);
    }
    const next = Object.assign({}, state.settings);
    next[group] = Object.assign({}, state.settings[group], patch);
    return applySettings(next, syncDraft);
}

// ---------- Render ----------

// Записывает результат в canvas. Единственное место, где меняются
// state.previewFailed и сообщение о неисправном preview: флаг снимается
// только после успешной записи, при исключении остаётся установленным
// (экспорт читает canvas), исключение пробрасывается.
function drawPreview(result) {
    state.previewFailed = true;
    try {
        if (els.canvas.width !== result.width) els.canvas.width = result.width;
        if (els.canvas.height !== result.height) els.canvas.height = result.height;
        previewContext.putImageData(result, 0, 0);
    } catch (error) {
        showStatus(PREVIEW_ERROR_MESSAGE, true);
        throw error;
    }
    state.previewFailed = false;
    if (els.status.textContent === PREVIEW_ERROR_MESSAGE) showStatus('');
}

// Исключения при обновлении canvas пробрасываются вызывающему.
// Доступность экспорта и пипетки обновляется после любой попытки отрисовки.
function render() {
    try {
        const result = state.resultImage;
        const hasImage = result !== null;

        els.previewArea.classList.toggle('has-image', hasImage);
        els.resetButton.disabled = !hasImage;
        els.zoomButtons.forEach((button) => {
            button.disabled = !hasImage;
            button.setAttribute('aria-pressed', String(Number(button.dataset.zoom) === state.zoom));
        });
        els.transformButtons.forEach((button) => {
            button.disabled = !hasImage;
        });
        renderBackgroundControls(hasImage);
        renderResizeControls(hasImage);

        if (!hasImage) {
            els.fileNameValue.textContent = '—';
            els.sizeValue.textContent = '—';
            return;
        }

        drawPreview(result);

        els.canvas.style.width = result.width * state.zoom + 'px';
        els.canvas.style.height = result.height * state.zoom + 'px';

        els.fileNameValue.textContent = state.fileName;
        els.sizeValue.textContent = `${result.width} × ${result.height} px`;
    } finally {
        renderPreviewControls();
    }
}

// Контролы, зависящие от исправности preview: экспорт читает canvas,
// пипетка — координаты canvas. При недоступном preview режим пипетки
// сбрасывается, чтобы не включиться неожиданно после восстановления.
function renderPreviewControls() {
    const isPreviewReady = state.resultImage !== null && !state.previewFailed;
    if (!isPreviewReady) state.isPicking = false;

    els.exportButton.disabled = !isPreviewReady;
    els.bgPickButton.disabled = !isPreviewReady || !state.settings.background.enabled;
    els.bgPickButton.setAttribute('aria-pressed', String(state.isPicking));
    els.canvas.classList.toggle('is-picking', state.isPicking);
}

// Контролы Background отражают state.settings.background;
// состояние пипетки — в renderPreviewControls().
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
}

// Поля Resize показывают черновик, а не применённые настройки.
// Значение присваивается только при отличии, чтобы не мешать вводу.
// Ошибки вычисляются из черновика; подсказка метода — из применённых настроек.
function renderResizeControls(hasImage) {
    const resize = state.settings.resize;
    const check = hasImage ? getResizeDraftCheck() : { widthInvalid: false, heightInvalid: false, message: '' };

    els.resizeOptions.disabled = !hasImage;
    els.resizeMethodButtons.forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.resizeMethod === resize.method));
    });
    els.resizeKeepRatio.checked = resize.preserveAspectRatio;

    renderResizeField(els.resizeWidth, state.resizeDraft.width, check.widthInvalid);
    renderResizeField(els.resizeHeight, state.resizeDraft.height, check.heightInvalid);
    if (els.resizeError.textContent !== check.message) els.resizeError.textContent = check.message;

    els.resizeNote.textContent = hasImage ? getResizeNote() : '';
}

function renderResizeField(input, text, isInvalid) {
    if (input.value !== text) input.value = text;
    if (isInvalid) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
}

// Проверка черновика: какие поля отметить и какое сообщение показать.
// Ошибка формата — у некорректного поля; ошибка лимита — у сторон,
// превышающих MAX_RESIZE_SIDE. Без ошибки черновик совпадает с применёнными
// размерами (иначе он был бы применён), поэтому пояснение нужно только при ошибке.
function getResizeDraftCheck() {
    const width = parseResizeSize(state.resizeDraft.width);
    const height = parseResizeSize(state.resizeDraft.height);

    if (width === null || height === null) {
        return {
            widthInvalid: width === null,
            heightInvalid: height === null,
            message: withAppliedSize(RESIZE_SIZE_ERROR)
        };
    }
    if (!isAllowedResizeSize(width, height, getResizeBaseSize())) {
        return {
            widthInvalid: width > MAX_RESIZE_SIDE,
            heightInvalid: height > MAX_RESIZE_SIDE,
            message: withAppliedSize(RESIZE_LIMIT_ERROR)
        };
    }
    return { widthInvalid: false, heightInvalid: false, message: '' };
}

function withAppliedSize(message) {
    const resize = state.settings.resize;
    return `${message} Preview shows ${resize.width} × ${resize.height} px.`;
}

function getResizeNote() {
    const resize = state.settings.resize;
    if (resize.method !== 'area') return '';
    const base = getResizeBaseSize();
    return ImageProcessing.getResizeMethod(base.width, base.height, resize) === 'area'
        ? 'Area applies to downscaling.'
        : 'Upscaling — Nearest is used.';
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
    state.settings = createDefaultSettings(imageData.width, imageData.height);
    syncResizeDraft();
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

// ---------- Transform ----------

// Команды действуют относительно текущего preview. В обработке порядок
// фиксирован (поворот → отражения), поэтому при повороте флаги отражений
// меняются местами: поворот отражённого изображения = отражение по другой оси
// после поворота. Целевой размер Resize задан после Transform, поэтому при
// повороте его стороны тоже меняются местами — в том же наборе настроек.
function applyTransformCommand(command) {
    if (!state.originalImage) return;
    const t = state.settings.transform;

    if (command === 'rotate-right' || command === 'rotate-left') {
        const turns = command === 'rotate-right' ? 1 : 3;
        const r = state.settings.resize;
        applySettings(Object.assign({}, state.settings, {
            transform: { quarterTurns: (t.quarterTurns + turns) % 4, flipX: t.flipY, flipY: t.flipX },
            resize: Object.assign({}, r, { width: r.height, height: r.width })
        }), true);
    } else if (command === 'flip-x') {
        updateSettings('transform', { flipX: !t.flipX });
    } else if (command === 'flip-y') {
        updateSettings('transform', { flipY: !t.flipY });
    }
}

// ---------- Resize ----------

// Размер изображения перед Resize: оригинал с учётом поворота.
// Пропорции всегда считаются от него, а не от прошлого результата Resize.
function getResizeBaseSize() {
    const image = state.originalImage;
    return ImageProcessing.getTransformedSize(image.width, image.height, state.settings.transform);
}

// Вторая сторона при сохранении пропорций; минимум 1 px.
function scaleSide(value, baseOther, baseThis) {
    return Math.max(1, Math.round(value * baseOther / baseThis));
}

// Исходный размер допустим всегда (Resize не выполняется), явный Resize —
// в пределах ограничения приложения.
function isAllowedResizeSize(width, height, base) {
    if (width === base.width && height === base.height) return true;
    return width <= MAX_RESIZE_SIDE && height <= MAX_RESIZE_SIDE;
}

// Положительное безопасное целое или null.
function parseResizeSize(text) {
    const trimmed = text.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const value = Number(trimmed);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
}

// Черновик = применённые размеры (до загрузки — пустые поля).
function syncResizeDraft() {
    const resize = state.settings.resize;
    state.resizeDraft = state.originalImage
        ? { width: String(resize.width), height: String(resize.height) }
        : { width: '', height: '' };
}

// Применяет черновик, если обе стороны — положительные целые, пара допустима
// и отличается от применённой. Иначе обновляет только поля и сообщение:
// preview остаётся с последним применённым размером, а превышение лимита
// сохраняется в черновике при переходе между полями.
function commitResizeDraft() {
    const resize = state.settings.resize;
    const width = parseResizeSize(state.resizeDraft.width);
    const height = parseResizeSize(state.resizeDraft.height);
    const canApply = width !== null && height !== null
        && isAllowedResizeSize(width, height, getResizeBaseSize())
        && (width !== resize.width || height !== resize.height);

    if (canApply) updateSettings('resize', { width: width, height: height });
    else renderResizeControls(true);
}

function onResizeSizeInput(axis) {
    if (!state.originalImage) return;
    const input = axis === 'width' ? els.resizeWidth : els.resizeHeight;
    state.resizeDraft[axis] = input.value;

    const value = parseResizeSize(input.value);
    if (value !== null && state.settings.resize.preserveAspectRatio) {
        const base = getResizeBaseSize();
        if (axis === 'width') state.resizeDraft.height = String(scaleSide(value, base.height, base.width));
        else state.resizeDraft.width = String(scaleSide(value, base.width, base.height));
    }
    commitResizeDraft();
}

// Завершение ввода поля (blur, Enter). Положительное целое сохраняется,
// даже если пара пока превышает лимит, — можно перейти ко второму полю.
// Некорректное значение откатывается к применённому; при сохранении
// пропорций — обе стороны, чтобы черновик не нарушал пропорции.
function onResizeSizeCommit(axis) {
    if (!state.originalImage) return;
    const value = parseResizeSize(state.resizeDraft[axis]);
    if (value !== null) state.resizeDraft[axis] = String(value);
    else if (state.settings.resize.preserveAspectRatio) syncResizeDraft();
    else state.resizeDraft[axis] = String(state.settings.resize[axis]);
    commitResizeDraft();
}

// Переключение пропорций работает от применённых размеров; при успехе
// черновик заменяется применёнными размерами.
function onKeepRatioChange() {
    if (!state.originalImage) return;
    const resize = state.settings.resize;
    if (!els.resizeKeepRatio.checked) {
        updateSettings('resize', { preserveAspectRatio: false }, true);
        return;
    }
    const base = getResizeBaseSize();
    const height = scaleSide(resize.width, base.height, base.width);
    if (!isAllowedResizeSize(resize.width, height, base)) {
        els.resizeKeepRatio.checked = false;
        els.resizeError.textContent = RESIZE_RATIO_LIMIT_ERROR;
        return;
    }
    updateSettings('resize', { preserveAspectRatio: true, width: resize.width, height: height }, true);
}

// ---------- Color picking ----------

// Убирает только подсказку пипетки; ошибки загрузки и прочие сообщения остаются.
function clearPickingStatus() {
    if (els.status.textContent === PICK_TRANSPARENT_MESSAGE) showStatus('');
}

// Включить пипетку можно только при исправном preview.
function setPicking(active) {
    if (active && (state.resultImage === null || state.previewFailed)) return;
    state.isPicking = active;
    clearPickingStatus();
    render();
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('');
}

// Пипетка выбирает только цвет. Читает оригинал: так можно повторно выбрать
// уже удалённый цвет. Точка preview переводится в оригинал обратным Resize,
// затем обратной трансформацией. Crop пока не меняет геометрию.
function pickColor(event) {
    const image = state.originalImage;
    if (!state.isPicking || !image || state.previewFailed) return;

    const rect = els.canvas.getBoundingClientRect();
    const previewX = Math.min(els.canvas.width - 1, Math.max(0,
        Math.floor((event.clientX - rect.left) * els.canvas.width / rect.width)));
    const previewY = Math.min(els.canvas.height - 1, Math.max(0,
        Math.floor((event.clientY - rect.top) * els.canvas.height / rect.height)));
    const transform = state.settings.transform;
    const resize = state.settings.resize;
    const base = ImageProcessing.getTransformedSize(image.width, image.height, transform);
    const resized = ImageProcessing.inverseResizePoint(
        previewX, previewY, base.width, base.height, resize.width, resize.height);
    const point = ImageProcessing.inverseTransformPoint(
        resized.x, resized.y, image.width, image.height, transform);

    const i = (point.y * image.width + point.x) * 4;
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
    if (!state.resultImage || state.previewFailed) return;
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
    state.settings = createDefaultSettings(state.originalImage.width, state.originalImage.height);
    syncResizeDraft();
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

els.transformButtons.forEach((button) => {
    button.addEventListener('click', () => applyTransformCommand(button.dataset.transform));
});

els.resizeMethodButtons.forEach((button) => {
    button.addEventListener('click', () => {
        updateSettings('resize', { method: button.dataset.resizeMethod });
    });
});

els.resizeWidth.addEventListener('input', () => onResizeSizeInput('width'));
els.resizeHeight.addEventListener('input', () => onResizeSizeInput('height'));
els.resizeWidth.addEventListener('blur', () => onResizeSizeCommit('width'));
els.resizeHeight.addEventListener('blur', () => onResizeSizeCommit('height'));
els.resizeWidth.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') onResizeSizeCommit('width');
});
els.resizeHeight.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') onResizeSizeCommit('height');
});
els.resizeKeepRatio.addEventListener('change', onKeepRatioChange);

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
