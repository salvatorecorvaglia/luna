import { type RefObject, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

export const PREVIEW_LINE_HEIGHT = 20;
const OVERSCAN = 10;
interface GutterLayout {
  height: number;
  lines: { number: number; top: number }[];
}

/** Sparse checkpoints bound memory even for previews containing millions of empty lines. */
export function buildPreviewLineIndex(content: string) {
  const stride = 128;
  const checkpoints = [0];
  let count = 1;
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) !== 10) continue;
    count++;
    if ((count - 1) % stride === 0) checkpoints.push(index + 1);
  }
  const cache = new Map<number, number>();
  return {
    count,
    offsetAt(line: number): number {
      const cached = cache.get(line);
      if (cached !== undefined) return cached;
      const block = Math.floor(line / stride);
      let offset = checkpoints[block]!;
      for (let current = block * stride; current < line; current++)
        offset = content.indexOf('\n', offset) + 1;
      cache.set(line, offset);
      if (cache.size > 1024) cache.delete(cache.keys().next().value!);
      return offset;
    },
  };
}

/** Measure logical line starts with one hidden text node, rather than a DOM node per line. */
export function usePreviewGutter(
  content: string,
  wrap: boolean,
  textarea: RefObject<HTMLTextAreaElement | null>,
) {
  const lineIndex = useMemo(() => buildPreviewLineIndex(content), [content]);
  const [layout, setLayout] = useState<GutterLayout>({ height: PREVIEW_LINE_HEIGHT, lines: [] });
  const measureRef = useRef(() => {});
  const sync = useCallback(() => measureRef.current(), []);
  useLayoutEffect(() => {
    const editor = textarea.current;
    if (!editor) return;
    let disposed = false;
    const mirror = wrap ? document.createElement('div') : null;
    if (mirror) {
      mirror.setAttribute('aria-hidden', 'true');
      mirror.dataset.previewMirror = '';
      document.body.appendChild(mirror);
    }
    const configure = () => {
      if (!mirror) return;
      const style = getComputedStyle(editor);
      Object.assign(mirror.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        visibility: 'hidden',
        pointerEvents: 'none',
        boxSizing: 'border-box',
        width: `${editor.clientWidth}px`,
        padding: style.padding,
        font: style.font,
        lineHeight: `${PREVIEW_LINE_HEIGHT}px`,
        letterSpacing: style.letterSpacing,
        wordSpacing: style.wordSpacing,
        tabSize: style.tabSize,
        direction: style.direction,
        whiteSpace: 'pre-wrap',
        wordBreak: style.wordBreak,
        overflowWrap: style.overflowWrap,
      });
      // The marker makes a trailing empty logical line measurable.
      mirror.textContent = `${content}\u200b`;
    };
    const measure = () => {
      if (disposed) return;
      const scrollTop = editor.scrollTop;
      const viewportHeight = editor.clientHeight || 400;
      const padding = parseFloat(getComputedStyle(editor).paddingTop) || 0;
      const range = mirror ? document.createRange() : null;
      const origin = mirror?.getBoundingClientRect().top ?? 0;
      const lineTop = (index: number): number => {
        const text = mirror?.firstChild;
        if (!range || !text || typeof range.getBoundingClientRect !== 'function')
          return index * PREVIEW_LINE_HEIGHT;
        const start = lineIndex.offsetAt(index);
        range.setStart(text, start);
        range.setEnd(text, start + 1);
        return Math.max(0, range.getBoundingClientRect().top - origin - padding);
      };
      let low = 0;
      let high = lineIndex.count;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (lineTop(middle) <= scrollTop) low = middle + 1;
        else high = middle;
      }
      const first = Math.max(0, low - 1 - OVERSCAN);
      const lines: GutterLayout['lines'] = [];
      const maxRows = Math.ceil(viewportHeight / PREVIEW_LINE_HEIGHT) + OVERSCAN * 2 + 2;
      for (let index = first; index < lineIndex.count && lines.length < maxRows; index++) {
        const top = lineTop(index);
        if (top > scrollTop + viewportHeight + OVERSCAN * PREVIEW_LINE_HEIGHT) break;
        lines.push({ number: index + 1, top });
      }
      const height = mirror
        ? Math.max(
            PREVIEW_LINE_HEIGHT,
            mirror.scrollHeight -
              padding -
              (parseFloat(getComputedStyle(editor).paddingBottom) || 0),
          )
        : lineIndex.count * PREVIEW_LINE_HEIGHT;
      setLayout((previous) =>
        previous.height === height &&
        previous.lines.length === lines.length &&
        previous.lines.every(
          (line, index) => line.number === lines[index]!.number && line.top === lines[index]!.top,
        )
          ? previous
          : { height, lines },
      );
    };
    const resize = () => {
      configure();
      measure();
    };
    measureRef.current = measure;
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(editor);
    void document.fonts?.ready.then(() => {
      if (!disposed) resize();
    });
    return () => {
      disposed = true;
      observer.disconnect();
      mirror?.remove();
      measureRef.current = () => {};
    };
  }, [content, lineIndex, wrap, textarea]);
  return { ...layout, lineCount: lineIndex.count, sync };
}
