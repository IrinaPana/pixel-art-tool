'use strict';

const ImageProcessing = (function () {
    function cloneImageData(imageData) {
        return new ImageData(
            new Uint8ClampedArray(imageData.data),
            imageData.width,
            imageData.height
        );
    }

    // Шаги pipeline. Каждый получает рабочее изображение и свою группу
    // настроек, возвращает ImageData (при необходимости с новыми размерами).
    // Шаги не изменяют настройки и не обращаются к DOM.
    // Нереализованные шаги возвращают изображение без изменений.

    // '#rrggbb' → [r, g, b]
    function parseHexColor(hex) {
        const value = parseInt(hex.slice(1), 16);
        return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    }

    // Удаление фона: alpha = 0 у пикселей, совпадающих с options.color.
    // Совпадение — по RGB: max(|Δr|, |Δg|, |Δb|) <= tolerance; alpha не сравнивается.
    // Изменяет image на месте: process() передаёт сюда копию оригинала.
    function applyBackground(image, options) {
        if (!options.enabled) return image;

        const data = image.data;
        const width = image.width;
        const height = image.height;
        const pixelCount = width * height;
        const [targetR, targetG, targetB] = parseHexColor(options.color);
        const tolerance = options.tolerance;

        function matches(p) {
            const i = p * 4;
            return Math.max(
                Math.abs(data[i] - targetR),
                Math.abs(data[i + 1] - targetG),
                Math.abs(data[i + 2] - targetB)
            ) <= tolerance;
        }

        if (options.mode === 'all') {
            for (let p = 0; p < pixelCount; p++) {
                if (matches(p)) data[p * 4 + 3] = 0;
            }
            return image;
        }

        // 'connected': итеративный flood fill от всех краёв, 4-связность.
        // RGB при удалении не меняется, поэтому matches() стабилен во время обхода.
        const visited = new Uint8Array(pixelCount);
        const queue = new Int32Array(pixelCount); // каждый пиксель попадает в очередь не более одного раза
        let head = 0;
        let tail = 0;

        function enqueue(p) {
            if (visited[p] || !matches(p)) return;
            visited[p] = 1;
            queue[tail++] = p;
        }

        for (let x = 0; x < width; x++) {
            enqueue(x);
            enqueue((height - 1) * width + x);
        }
        for (let y = 0; y < height; y++) {
            enqueue(y * width);
            enqueue(y * width + width - 1);
        }

        while (head < tail) {
            const p = queue[head++];
            data[p * 4 + 3] = 0;
            const x = p % width;
            if (p >= width) enqueue(p - width);              // сверху
            if (p < pixelCount - width) enqueue(p + width);  // снизу
            if (x > 0) enqueue(p - 1);                       // слева
            if (x < width - 1) enqueue(p + 1);               // справа
        }

        return image;
    }

    // Размер результата поворота: при 90°/270° ширина и высота меняются местами.
    function getTransformedSize(width, height, options) {
        return options.quarterTurns % 2 === 1
            ? { width: height, height: width }
            : { width: width, height: height };
    }

    // Поворот на quarterTurns × 90° по часовой стрелке, затем отражения
    // в координатах повёрнутого изображения. Один проход, без интерполяции.
    // Для W × H источника пиксель (x, y) переходит в:
    //   0°:   (x, y)
    //   90°:  (H − 1 − y, x)
    //   180°: (W − 1 − x, H − 1 − y)
    //   270°: (y, W − 1 − x)
    function applyTransform(image, options) {
        const turns = options.quarterTurns;
        if (turns === 0 && !options.flipX && !options.flipY) return image;

        const srcWidth = image.width;
        const srcHeight = image.height;
        const size = getTransformedSize(srcWidth, srcHeight, options);
        const outWidth = size.width;
        const outHeight = size.height;
        const result = new ImageData(outWidth, outHeight);

        // Пиксель RGBA переносится целиком как одно 32-битное слово.
        const src = new Uint32Array(image.data.buffer, image.data.byteOffset, srcWidth * srcHeight);
        const dst = new Uint32Array(result.data.buffer, result.data.byteOffset, outWidth * outHeight);

        for (let y = 0; y < srcHeight; y++) {
            for (let x = 0; x < srcWidth; x++) {
                let dx;
                let dy;
                if (turns === 0) { dx = x; dy = y; }
                else if (turns === 1) { dx = srcHeight - 1 - y; dy = x; }
                else if (turns === 2) { dx = srcWidth - 1 - x; dy = srcHeight - 1 - y; }
                else { dx = y; dy = srcWidth - 1 - x; }

                if (options.flipX) dx = outWidth - 1 - dx;
                if (options.flipY) dy = outHeight - 1 - dy;

                dst[dy * outWidth + dx] = src[y * srcWidth + x];
            }
        }

        return result;
    }

    // Обратное преобразование точки результата Transform в точку исходного
    // изображения width × height: сначала отменяются отражения, затем поворот.
    function inverseTransformPoint(x, y, width, height, options) {
        const size = getTransformedSize(width, height, options);
        if (options.flipX) x = size.width - 1 - x;
        if (options.flipY) y = size.height - 1 - y;

        switch (options.quarterTurns) {
            case 1: return { x: y, y: height - 1 - x };
            case 2: return { x: width - 1 - x, y: height - 1 - y };
            case 3: return { x: width - 1 - y, y: x };
            default: return { x: x, y: y };
        }
    }

    function applyResize(image, options) {
        return image;
    }

    function applyCrop(image, options) {
        return image;
    }

    // Единая точка обработки. Оригинал никогда не изменяется:
    // шаги работают с его копией. Порядок шагов фиксирован:
    //   Remove background → Rotate / Flip → Resize → Crop
    function process(original, settings) {
        let image = cloneImageData(original);

        image = applyBackground(image, settings.background);
        image = applyTransform(image, settings.transform);
        image = applyResize(image, settings.resize);
        image = applyCrop(image, settings.crop);

        return image;
    }

    return {
        cloneImageData,
        inverseTransformPoint,
        process
    };
})();
