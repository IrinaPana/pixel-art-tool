# Pixel Art Image Tool

## Goal

Локальный минималистичный инструмент для обработки pixel-art изображений.

Приоритеты:
- простой код;
- минимум зависимостей;
- точная работа с пикселями;
- современный лаконичный UI;
- запуск напрямую через `index.html`.

## Stack

Использовать только:
- HTML;
- CSS;
- Vanilla JavaScript;
- Canvas API / ImageData.

Структура:

```text
index.html
styles.css
app.js
image-processing.js
```

Приложение должно работать локально через `file://`.

Не использовать ES modules (`import/export`, `type="module"`).

## Architecture

Обработка недеструктивная.

Исходное изображение хранится неизменным. UI хранит только настройки обработки.

При изменении любой настройки результат полностью пересчитывается из оригинала:

```text
Original
→ Remove background
→ Rotate / Flip
→ Resize
→ Crop
→ Preview / Export
```

`Reset` сбрасывает настройки и возвращает исходное состояние.

Логику обработки изображений держать в `image-processing.js`, UI и состояние — в `app.js`.

Не переписывать работающую архитектуру при добавлении функций. Менять только необходимую часть.

## Image loading

Поддержать PNG и JPEG.

Предпочтительно загружать через `createImageBitmap` с:

```javascript
{ colorSpaceConversion: 'none' }
```

Предусмотреть fallback, если этот способ недоступен.

Поддержать:
- file picker;
- drag & drop.

## Background removal

Выбор цвета:
- color picker;
- пипетка по изображению;
- tolerance.

Режимы:
- `All matching pixels` — удалить все подходящие по цвету пиксели;
- `Connected background` — удалить подходящий фон, связанный с краями изображения.

Пипетка выбирает только цвет. `Connected background` начинает flood fill от всех краёв изображения.

Удаление означает установку `alpha = 0`.

## Transform

Поддержать:
- rotate 90° left;
- rotate 90° right;
- flip horizontal;
- flip vertical.

Использовать точные операции над пикселями/ImageData. Не применять интерполяцию.

Корректно менять width/height после поворота на 90°/270°.

## Resize

Режимы:
- `Nearest` — основной режим для pixel-art;
- `Area` — сглаженное уменьшение.

Пользователь задаёт итоговый размер в пикселях.

По умолчанию сохранять aspect ratio.

`Area` должен корректно учитывать alpha, чтобы прозрачные пиксели не создавали цветную кайму.

## Crop

Режимы:

### Content
Обрезать до bounding box непрозрачного содержимого.

### Content + margin
Bounding box содержимого + заданный margin в пикселях.

Margin относится к итоговому изображению после resize.

Если margin выходит за исходные границы, расширять canvas прозрачными пикселями.

### Fixed size
Задать итоговые `width × height`.

Поддержать 9 anchors:

```text
↖ ↑ ↗
← • →
↙ ↓ ↘
```

Если содержимое не помещается в заданный размер, показать предупреждение. Не обрезать его молча.

Для определения содержимого учитывать alpha threshold, в том числе полупрозрачные края после `Area`.

## Preview

- шахматный фон для прозрачности;
- zoom: 100%, 200%, 400%, 800%;
- preview без визуального сглаживания;
- изменения настроек сразу отражаются в preview.

Экспортировать результат в PNG с прозрачностью.

## UI

Один экран: большой preview + компактная панель настроек.

Группы контролов:
- Background;
- Transform;
- Resize;
- Crop.

Основные действия:
- Open;
- Export PNG;
- Reset.

Дизайн минималистичный и современный. Не добавлять декоративные элементы, которые не помогают работе с изображением.

## Design system

Визуальная система задана в `styles.css`, секции «Design system — tokens / components / layouts». Стиль neutral utility UI: светлый нейтральный интерфейс, один accent, тонкие границы, без теней.

- **Tokens** (`:root`): цвета `--color-*`, типографика `--font-*`, spacing `--space-1…5` (4/8/12/16/24), размеры (`--control-height` 32, `--control-height-small` 28, `--toolbar-height` 48, `--bottom-bar-height` 36, `--sidebar-width` 296, `--label-width` 72), радиусы `--radius-sm/md/lg` (4/6/8), состояния (`--focus-ring`, `--focus-ring-inset`, `--selected-ring-inset`, `--transition-fast`, `--disabled-opacity`).
- **Components**: `.button` (`--primary` — только Export PNG, `--secondary`, `--ghost`), `.icon-button` (`--small`), `.anchor-cell` (ячейка `.anchor-picker`), `.icon` (sprite в `index.html`: `<svg class="icon"><use href="#icon-…"></use></svg>`), `.input` (`--number`, `--narrow`), `.select`, `.range`, `.color-control` (`.color-swatch`, `.color-value`), `.section-toggle` (switch On/Off этапа pipeline: native checkbox `role="switch"`, вкл — `:checked`), `.tooltip` (атрибут `data-tooltip`, только для icon-only controls), `.inline-message` (`--warning`, `--error`), `.help-text`, `.section-heading`, `.divider`.
- **Layouts**: `.app`, `.app-toolbar`, `.app-workspace`, `.app-preview` (`-scroll`, `-stage`, `-canvas`, `-empty`), `.app-sidebar`, `.sidebar-section`, `.section-header` (у всех секций; справа — опциональный `.section-toggle`), `.control-fieldset`, `.control-row` (`--top`), `.control-group`, `.slider-row`, `.value-row`, `.button-row`, `.anchor-picker`, `.app-bottom-bar`, `.zoom-control`.
- **States.** Интерактивные состояния controls (hover, active, invalid, focus, selected, disabled) задаются только в блоке «States» секции components, в этом порядке.
  - selected — `aria-pressed="true"`: accent-soft фон, accent рамка и текст. У `.anchor-cell` нет рамки (сетку рисует контейнер), поэтому рамка рисуется внутрь — `--selected-ring-inset`.
  - focus — только `:focus-visible`: accent-рамка + `--focus-ring`. У `.section-toggle` и `.app-preview-empty-action` для этого есть прозрачная рамка. Исключения: `.anchor-cell` — `--focus-ring-inset` (ячейки обрезаются контейнером); `.range` — кольцо на thumb.
  - disabled — атрибут `disabled`. Для всех controls: `--disabled-opacity`, `pointer-events: none`, `cursor: default`. Только controls с рамкой и фоном (`.button--primary`, `.button--secondary`, `.icon-button`, `.input`, `.select`, `.color-control`) дополнительно получают нейтральные рамку и фон и muted text. `.button--ghost` — только muted text. `.section-toggle`, `.range` — только opacity (фон у них — track). `.anchor-picker` гасится целиком через `:has(.anchor-cell:disabled)`, вместе с линиями сетки.
  - Не относятся к States и намеренно лежат вне этого блока: `.section-toggle:checked` (значение control, а не состояние взаимодействия) — в компоненте; `.control-fieldset:disabled` (muted подписи группы) — в layouts. Скрытые блоки — атрибут `hidden`, не `opacity`/`visibility`.
- Accent используется только для primary action, focus и selected state.
- При программной смене значения `.range` или `.color-control` вызывать `syncRangeFill(input)` / `syncColorControl(input)` из `app.js`.

Новые элементы интерфейса собирать из этих tokens и компонентов. Новый локальный стиль допустим только для элемента с действительно уникальной функцией. Не вводить новые цвета, радиусы, высоты controls и отступы вне шкалы.

## Development rules

Разрабатывать поэтапно.

При реализации нового этапа:
- продолжать существующий проект;
- сохранять текущую архитектуру;
- не переписывать работающий код без необходимости;
- реализовывать только запрошенный функционал;
- не добавлять зависимости без явной необходимости;
- выбирать простейшее решение, полностью выполняющее требование.

Не добавлять функциональность «на будущее».

## Out of scope

Не добавлять без явного запроса:
- unit-тесты и test framework;
- TypeScript;
- React, Vue и другие frontend frameworks;
- npm, Vite и другие build tools;
- backend;
- Python;
- Electron / Tauri;
- ES modules;
- Undo / Redo;
- историю операций;
- batch processing;
- произвольные углы поворота;
- Bicubic / Lanczos и другие resize-алгоритмы;
- сложное управление цветовыми профилями.

Проект должен оставаться небольшой локальной утилитой, а не превращаться в полноценный графический редактор.