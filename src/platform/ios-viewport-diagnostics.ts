/** Geometry only: never reads labels, field values, record data or HTML.
 * DOM hit tests are hints; native compositor pixels still need real screenshots.
 */
export function collectIosViewportDiagnostics() {
  const box = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };
  const nav = document.querySelector<HTMLElement>('.mobile-nav');
  const viewport = window.visualViewport;
  return {
    window: { width: innerWidth, height: innerHeight, scrollX, scrollY },
    viewport: viewport ? { width: viewport.width, height: viewport.height,
      offsetTop: viewport.offsetTop, offsetLeft: viewport.offsetLeft,
      pageTop: viewport.pageTop, pageLeft: viewport.pageLeft, scale: viewport.scale } : null,
    root: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight },
    inputActive: document.documentElement.dataset.iosInputActive === 'true',
    navigation: nav ? {
      box: box(nav),
      style: { position: getComputedStyle(nav).position, bottom: getComputedStyle(nav).bottom,
        transform: getComputedStyle(nav).transform, clipPath: getComputedStyle(nav).clipPath },
      controls: [...nav.querySelectorAll('button')].map((control, index) => {
        const label = control.querySelector('span.truncate');
        const bounds = label?.getBoundingClientRect();
        const points = bounds && bounds.width > 2 && bounds.height > 2 ? [
          [bounds.left + 1, bounds.top + 1], [bounds.right - 1, bounds.top + 1],
          [bounds.left + 1, bounds.bottom - 1], [bounds.right - 1, bounds.bottom - 1],
        ] : [];
        const labelExposed = points.length === 4 && points.every(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return !!hit && control.contains(hit);
        });
        return { index, box: box(control), labelBox: label ? box(label) : null,
          labelExposed };
      }),
    } : null,
  };
}
