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

    function applyTransform(image, options) {
        return image;
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
        process
    };
})();
