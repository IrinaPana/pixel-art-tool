'use strict';

const ImageProcessing = (function () {
    function cloneImageData(imageData) {
        return new ImageData(
            new Uint8ClampedArray(imageData.data),
            imageData.width,
            imageData.height
        );
    }

    // Единая точка обработки. Оригинал никогда не изменяется.
    // Порядок шагов (фиксированный):
    //   Remove background → Rotate / Flip → Resize → Crop
    // Stage 1: шагов ещё нет, результат — точная копия оригинала.
    function process(original, settings) {
        const image = cloneImageData(original);
        return image;
    }

    return {
        cloneImageData,
        process
    };
})();
