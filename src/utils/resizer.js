// Generic drag-to-resize helper shared by the table/detail splitter and the
// request/response splitter inside the detail panel. Resizes `targetEl` by
// setting its flex-basis in pixels while the sibling(s) fill the rest via
// flex: 1; direction controls whether the splitter drags along X or Y.
export function makeResizer({ splitterEl, targetEl, containerEl, direction = 'horizontal', min = 120, max = Infinity, invert = false }) {
  let startPos = 0;
  let startSize = 0;
  let dragging = false;

  const getPos = (event) => direction === 'horizontal' ? event.clientX : event.clientY;

  const onPointerMove = (event) => {
    if (!dragging) return;
    const delta = getPos(event) - startPos;
    const signedDelta = invert ? -delta : delta;
    const containerSize = direction === 'horizontal' ? containerEl.clientWidth : containerEl.clientHeight;
    const clamped = Math.min(Math.max(startSize + signedDelta, min), Math.min(max, containerSize - min));
    targetEl.style.flex = `0 0 ${clamped}px`;
  };

  const stopDragging = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove(direction === 'horizontal' ? 'resizing-horizontal' : 'resizing-vertical');
    window.removeEventListener('mousemove', onPointerMove);
    window.removeEventListener('mouseup', stopDragging);
  };

  splitterEl.addEventListener('mousedown', (event) => {
    dragging = true;
    startPos = getPos(event);
    startSize = direction === 'horizontal' ? targetEl.getBoundingClientRect().width : targetEl.getBoundingClientRect().height;
    document.body.classList.add(direction === 'horizontal' ? 'resizing-horizontal' : 'resizing-vertical');
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', stopDragging);
    event.preventDefault();
  });
}
