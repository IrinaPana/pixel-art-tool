'use strict';

const SUPPORTED_TYPES = ['image/png', 'image/jpeg'];
const SUPPORTED_EXTENSIONS = /\.(png|jpe?g)$/i;
const PICK_TRANSPARENT_MESSAGE = 'Transparent pixel — pick another one.';
const PROCESS_ERROR_MESSAGE = 'Could not apply these settings.';
const PREVIEW_ERROR_MESSAGE = 'Preview could not be updated. Export is disabled.';
// Ограничение приложения для создаваемого canvas (Resize, Crop; самое строгое
// ограничение canvas по MDN — iOS, 4096 × 4096). Не гарантирует успешной отрисовки.
const MAX_RESIZE_SIDE = ImageProcessing.MAX_CANVAS_SIDE;
const RESIZE_SIZE_ERROR = 'Enter a whole number greater than 0.';
const RESIZE_LIMIT_ERROR = `Resize is limited to ${MAX_RESIZE_SIDE} px per side.`;
const RESIZE_RATIO_LIMIT_ERROR = `Preserving the ratio would exceed ${MAX_RESIZE_SIDE} px per side.`;
const CROP_MARGIN_ERROR = 'Enter a whole number, 0 or greater.';
const CROP_EMPTY_NOTE = 'No visible content — Crop is not applied.';
const ZOOM_LEVELS = [1, 2, 4, 8]; // масштаб preview; на обработку и экспорт не влияет

const state = {
    originalImage: null, // ImageData; никогда не изменяется
    resultImage: null,   // ImageData; производный результат, пересчитывается из originalImage
    fileName: '',
    settings: createDefaultSettings(0, 0), // только успешно применённые настройки
    // Текст полей Width/Height (UI-состояние). Может быть пустым, незавершённым
    // или недопустимым; в обработку попадает только через commitResizeDraft().
    resizeDraft: { width: '', height: '' },
    cropResult: null,    // геометрия Crop из process(); обновляется вместе с resultImage
    // Текст полей Crop (UI-состояние), по образцу resizeDraft; применяется через commitCropDraft().
    cropDraft: { margin: '', width: '', height: '' },
    zoom: 1,             // масштаб preview (ZOOM_LEVELS); не настройка обработки
    isPicking: false,    // режим пипетки; UI-состояние, не настройка обработки
    previewFailed: false // canvas не соответствует результату; экспорт и пипетка отключены
};

let loadRequestId = 0;
let dragDepth = 0;

const els = {
    openButton: document.getElementById('open-button'),
    chooseFileButton: document.getElementById('choose-file-button'),
    exportButton: document.getElementById('export-button'),
    resetButton: document.getElementById('reset-button'),
    fileInput: document.getElementById('file-input'),
    previewArea: document.getElementById('preview-area'),
    canvas: document.getElementById('preview-canvas'),
    fileNameValue: document.getElementById('file-name-value'),
    sizeValue: document.getElementById('size-value'),
    status: document.getElementById('status'),
    resultSize: document.getElementById('result-size'),
    zoomOutButton: document.getElementById('zoom-out-button'),
    zoomInButton: document.getElementById('zoom-in-button'),
    zoomSelect: document.getElementById('zoom-select'),
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
    resizeKeepRatio: document.getElementById('resize-keep-ratio'),
    cropEnabled: document.getElementById('crop-enabled'),
    cropOptions: document.getElementById('crop-options'),
    cropModeInputs: document.querySelectorAll('input[name="crop-mode"]'),
    cropMarginField: document.getElementById('crop-margin-field'),
    cropMargin: document.getElementById('crop-margin'),
    cropFixedFields: document.getElementById('crop-fixed-fields'),
    cropWidth: document.getElementById('crop-width'),
    cropHeight: document.getElementById('crop-height'),
    cropAnchorButtons: document.querySelectorAll('[data-anchor]'),
    cropNote: document.getElementById('crop-note'),
    cropError: document.getElementById('crop-error')
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
        crop: {
            enabled: false,
            mode: 'content',   // 'content' | 'margin' | 'fixed'
            margin: 0,         // px результата после Resize
            width: width,      // Fixed size; не зависит от Transform и Resize
            height: height,
            anchor: 'center'   // ключ CROP_ANCHORS в image-processing.js
        }
    };
}

// ---------- Processing ----------

// Полный пересчёт результата из оригинала. Предыдущий результат не используется.
function reprocess() {
    const processed = state.originalImage
        ? ImageProcessing.process(state.originalImage, state.settings)
        : null;
    state.resultImage = processed ? processed.image : null;
    state.cropResult = processed ? processed.crop : null;
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
    const previousCrop = state.cropResult;

    try {
        const processed = ImageProcessing.process(state.originalImage, next);
        state.settings = next;
        state.resultImage = processed.image;
        state.cropResult = processed.crop;
        if (syncDraft) syncResizeDraft();
        render();
    } catch (error) {
        state.settings = previousSettings;
        state.resultImage = previousResult;
        state.cropResult = previousCrop;
        syncResizeDraft();
        syncCropDraft();
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
        const zoomIndex = ZOOM_LEVELS.indexOf(state.zoom);
        els.zoomSelect.disabled = !hasImage;
        els.zoomSelect.value = String(state.zoom);
        els.zoomOutButton.disabled = !hasImage || zoomIndex <= 0;
        els.zoomInButton.disabled = !hasImage || zoomIndex >= ZOOM_LEVELS.length - 1;
        els.transformButtons.forEach((button) => {
            button.disabled = !hasImage;
        });
        renderBackgroundControls(hasImage);
        renderResizeControls(hasImage);
        renderCropControls(hasImage);

        if (!hasImage) {
            els.fileNameValue.textContent = '—';
            els.sizeValue.textContent = '—';
            els.resultSize.textContent = 'No image';
            return;
        }

        drawPreview(result);

        els.canvas.style.width = result.width * state.zoom + 'px';
        els.canvas.style.height = result.height * state.zoom + 'px';

        els.fileNameValue.textContent = state.fileName;
        els.sizeValue.textContent = `${result.width} × ${result.height} px`;
        els.resultSize.textContent = `${result.width} × ${result.height} px`;
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

    els.exportButton.disabled = !isPreviewReady || hasCropConflict();
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
    return `${message} Resize stays at ${resize.width} × ${resize.height} px.`;
}

function getResizeNote() {
    const resize = state.settings.resize;
    if (resize.method !== 'area') return '';
    const base = getResizeBaseSize();
    return ImageProcessing.getResizeMethod(base.width, base.height, resize) === 'area'
        ? 'Area applies to downscaling.'
        : 'Upscaling — Nearest is used.';
}

// Crop не применён из-за размера: preview не соответствует настройкам, экспорт запрещён.
function hasCropConflict() {
    const crop = state.cropResult;
    return crop !== null && (crop.status === 'overflow' || crop.status === 'too-large');
}

// Поля показывают черновик; сообщение = ошибка черновика + конфликт размера.
function renderCropControls(hasImage) {
    const crop = state.settings.crop;
    const check = hasImage ? getCropDraftCheck()
        : { marginInvalid: false, widthInvalid: false, heightInvalid: false, message: '' };

    els.cropEnabled.disabled = !hasImage;
    els.cropEnabled.checked = crop.enabled;
    els.cropOptions.disabled = !hasImage || !crop.enabled;
    els.cropModeInputs.forEach((input) => {
        input.checked = input.value === crop.mode;
    });
    els.cropMarginField.hidden = crop.mode !== 'margin';
    els.cropFixedFields.hidden = crop.mode !== 'fixed';

    renderResizeField(els.cropMargin, state.cropDraft.margin, check.marginInvalid);
    renderResizeField(els.cropWidth, state.cropDraft.width, check.widthInvalid);
    renderResizeField(els.cropHeight, state.cropDraft.height, check.heightInvalid);
    els.cropAnchorButtons.forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.anchor === crop.anchor));
    });

    const message = [check.message, getCropConflictMessage()].filter(Boolean).join(' ');
    if (els.cropError.textContent !== message) els.cropError.textContent = message;
    els.cropNote.textContent = state.cropResult && state.cropResult.status === 'empty' ? CROP_EMPTY_NOTE : '';
}

// Проверяются только поля текущего режима включённого Crop.
function getCropDraftCheck() {
    const crop = state.settings.crop;
    const check = { marginInvalid: false, widthInvalid: false, heightInvalid: false, message: '' };
    if (!crop.enabled) return check;

    if (crop.mode === 'margin') {
        check.marginInvalid = parseCropField('margin', state.cropDraft.margin) === null;
        if (check.marginInvalid) check.message = `${CROP_MARGIN_ERROR} Margin stays at ${crop.margin} px.`;
    } else if (crop.mode === 'fixed') {
        check.widthInvalid = parseCropField('width', state.cropDraft.width) === null;
        check.heightInvalid = parseCropField('height', state.cropDraft.height) === null;
        if (check.widthInvalid || check.heightInvalid) {
            check.message = `${RESIZE_SIZE_ERROR} Fixed size stays at ${crop.width} × ${crop.height} px.`;
        }
    }
    return check;
}

function getCropConflictMessage() {
    const crop = state.cropResult;
    if (!crop) return '';
    if (crop.status === 'overflow') {
        return `Content ${crop.contentWidth} × ${crop.contentHeight} px does not fit `
            + `${crop.width} × ${crop.height} px. Preview shows the image without Crop. Increase the size.`;
    }
    if (crop.status === 'too-large') {
        // Пределы — из обработки, по тому же правилу, что и проверка.
        return `Crop result ${crop.width} × ${crop.height} px exceeds the allowed `
            + `${crop.maxWidth} × ${crop.maxHeight} px. Preview shows the image without Crop.`;
    }
    return '';
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
    syncCropDraft();
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

// ---------- Crop ----------

// Margin — целое >= 0; Width/Height — положительное целое. Иначе null.
function parseCropField(field, text) {
    if (field !== 'margin') return parseResizeSize(text);
    const trimmed = text.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const value = Number(trimmed);
    return Number.isSafeInteger(value) ? value : null;
}

// Черновик = применённые значения (до загрузки — пустые поля).
function syncCropDraft() {
    const crop = state.settings.crop;
    state.cropDraft = state.originalImage
        ? { margin: String(crop.margin), width: String(crop.width), height: String(crop.height) }
        : { margin: '', width: '', height: '' };
}

// Применяет каждое корректное поле, отличающееся от настроек. Поля независимы.
// Размер результата и вместимость проверяет обработка (статус Crop).
function commitCropDraft() {
    const crop = state.settings.crop;
    const patch = {};
    ['margin', 'width', 'height'].forEach((field) => {
        const value = parseCropField(field, state.cropDraft[field]);
        if (value !== null && value !== crop[field]) patch[field] = value;
    });

    if (Object.keys(patch).length > 0) updateSettings('crop', patch);
    else renderCropControls(true);
}

function onCropFieldInput(field, input) {
    if (!state.originalImage) return;
    state.cropDraft[field] = input.value;
    commitCropDraft();
}

// Завершение ввода (blur, Enter): корректное значение нормализуется,
// некорректное откатывается к применённому.
function onCropFieldCommit(field) {
    if (!state.originalImage) return;
    const value = parseCropField(field, state.cropDraft[field]);
    state.cropDraft[field] = String(value !== null ? value : state.settings.crop[field]);
    commitCropDraft();
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
// уже удалённый цвет. Точка preview переводится в оригинал обратным Crop,
// затем обратным Resize и обратной трансформацией.
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
    // Размер после Resize всегда resize.width × resize.height.
    const cropped = ImageProcessing.inverseCropPoint(
        previewX, previewY, state.cropResult, resize.width, resize.height);
    if (!cropped) {
        showStatus(PICK_TRANSPARENT_MESSAGE); // добавленная прозрачная область
        return;
    }
    const resized = ImageProcessing.inverseResizePoint(
        cropped.x, cropped.y, base.width, base.height, resize.width, resize.height);
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
    if (!state.resultImage || state.previewFailed || hasCropConflict()) return;
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

// Сбрасывает настройки обработки; изображение и zoom сохраняются.
function reset() {
    if (!state.originalImage) return;
    state.settings = createDefaultSettings(state.originalImage.width, state.originalImage.height);
    syncResizeDraft();
    syncCropDraft();
    state.isPicking = false;
    showStatus('');
    reprocess();
}

// Zoom меняет только CSS-размер canvas (render), результат не пересчитывается.
function setZoom(zoom) {
    if (!state.resultImage || !ZOOM_LEVELS.includes(zoom)) return;
    state.zoom = zoom;
    render();
}

// Соседний уровень. Если кнопка стала disabled на крайнем уровне,
// фокус переходит на select, чтобы не потеряться.
function stepZoom(direction, button) {
    const index = ZOOM_LEVELS.indexOf(state.zoom) + direction;
    if (index < 0 || index >= ZOOM_LEVELS.length) return;
    setZoom(ZOOM_LEVELS[index]);
    if (button.disabled) els.zoomSelect.focus();
}

// ---------- UI components ----------

const TOOLTIP_DELAY = 450; // ms
const TOOLTIP_GAP = 6;     // px между элементом и tooltip
const TOOLTIP_MARGIN = 4;  // px минимальный отступ от края окна
const tooltipElement = document.getElementById('tooltip');
let tooltipTimer = 0;

// Заполненная часть slider (.range). Вызывать и после программной смены value.
function syncRangeFill(input) {
    const min = Number(input.min) || 0;
    const max = input.max === '' ? 100 : Number(input.max);
    const fill = max > min ? (Number(input.value) - min) / (max - min) * 100 : 0;
    input.style.setProperty('--range-fill', `${fill}%`);
}

// Swatch и hex у .color-control. Вызывать и после программной смены value.
function syncColorControl(input) {
    const control = input.closest('.color-control');
    control.querySelector('.color-swatch').style.backgroundColor = input.value;
    control.querySelector('.color-value').textContent = input.value.toUpperCase();
}

// Ограничивает координату диапазоном [TOOLTIP_MARGIN, limit - size - TOOLTIP_MARGIN].
// Если подсказка больше окна, побеждает начальный край (TOOLTIP_MARGIN).
function clampTooltipCoordinate(value, size, limit) {
    return Math.max(TOOLTIP_MARGIN, Math.min(value, limit - size - TOOLTIP_MARGIN));
}

// Один fixed-элемент для всех [data-tooltip]: под элементом, при нехватке
// места — над ним; координаты зажаты в окно по обеим осям, поэтому подсказка
// не обрезается прокруткой sidebar и краями окна. Ширину ограничивает CSS (max-width).
function showTooltip(target) {
    tooltipElement.textContent = target.dataset.tooltip;
    tooltipElement.style.left = '0px';
    tooltipElement.style.top = '0px';
    tooltipElement.hidden = false;

    const rect = target.getBoundingClientRect();
    const tip = tooltipElement.getBoundingClientRect();
    let top = rect.bottom + TOOLTIP_GAP;
    if (top + tip.height > window.innerHeight - TOOLTIP_MARGIN) top = rect.top - TOOLTIP_GAP - tip.height;
    top = clampTooltipCoordinate(top, tip.height, window.innerHeight);
    const left = clampTooltipCoordinate(rect.left + (rect.width - tip.width) / 2, tip.width, window.innerWidth);

    tooltipElement.style.left = `${left}px`;
    tooltipElement.style.top = `${top}px`;
}

function scheduleTooltip(target) {
    hideTooltip();
    tooltipTimer = setTimeout(() => showTooltip(target), TOOLTIP_DELAY);
}

function hideTooltip() {
    clearTimeout(tooltipTimer);
    tooltipElement.hidden = true;
}

function initUiComponents() {
    document.querySelectorAll('.range').forEach(syncRangeFill);
    document.querySelectorAll('.color-control input[type="color"]').forEach(syncColorControl);

    document.addEventListener('input', (event) => {
        const target = event.target;
        if (target.matches('.range')) syncRangeFill(target);
        else if (target.matches('.color-control input[type="color"]')) syncColorControl(target);
    });

    document.querySelectorAll('[data-tooltip]').forEach((element) => {
        element.addEventListener('mouseenter', () => scheduleTooltip(element));
        element.addEventListener('mouseleave', hideTooltip);
        element.addEventListener('focus', () => {
            if (element.matches(':focus-visible')) scheduleTooltip(element);
        });
        element.addEventListener('blur', hideTooltip);
        element.addEventListener('pointerdown', hideTooltip);
    });
    window.addEventListener('scroll', hideTooltip, true); // в т. ч. прокрутка sidebar и preview
    // Escape убирает подсказку, фокус остаётся на элементе. Отдельный listener:
    // существующий обработчик Escape (выход из пипетки) не меняется.
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') hideTooltip();
    });
}

// ---------- Events ----------

els.openButton.addEventListener('click', () => els.fileInput.click());
els.chooseFileButton.addEventListener('click', () => els.fileInput.click());

els.fileInput.addEventListener('change', () => {
    const file = els.fileInput.files[0];
    els.fileInput.value = ''; // позволяет повторно открыть тот же файл
    loadFile(file);
});

els.exportButton.addEventListener('click', exportPng);
els.resetButton.addEventListener('click', reset);

els.zoomOutButton.addEventListener('click', () => stepZoom(-1, els.zoomOutButton));
els.zoomInButton.addEventListener('click', () => stepZoom(1, els.zoomInButton));
els.zoomSelect.addEventListener('change', () => setZoom(Number(els.zoomSelect.value)));

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

els.cropEnabled.addEventListener('change', () => {
    updateSettings('crop', { enabled: els.cropEnabled.checked });
});

els.cropModeInputs.forEach((input) => {
    input.addEventListener('change', () => {
        if (input.checked) updateSettings('crop', { mode: input.value });
    });
});

els.cropAnchorButtons.forEach((button) => {
    button.addEventListener('click', () => updateSettings('crop', { anchor: button.dataset.anchor }));
});

[['margin', els.cropMargin], ['width', els.cropWidth], ['height', els.cropHeight]].forEach(([field, input]) => {
    input.addEventListener('input', () => onCropFieldInput(field, input));
    input.addEventListener('blur', () => onCropFieldCommit(field));
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') onCropFieldCommit(field);
    });
});

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

// Курсор «копирование» над drop-зоной.
els.previewArea.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
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

initUiComponents();
render();
