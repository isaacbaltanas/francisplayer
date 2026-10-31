const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

export const zoomFromPinch = (currentZoom: number, deltaY: number, minimum = .5, maximum = 4) => (
  clamp(currentZoom * Math.exp(-deltaY * .01), minimum, maximum)
);

export const anchoredScrollLeft = (contentRatio: number, pointerOffset: number, scrollWidth: number, clientWidth: number) => (
  clamp(contentRatio * scrollWidth - pointerOffset, 0, Math.max(0, scrollWidth - clientWidth))
);
