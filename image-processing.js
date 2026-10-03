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
    // Пока шаги не реализованы и возвращают изображение без изменений.

    function applyBackground(image, options) {
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
