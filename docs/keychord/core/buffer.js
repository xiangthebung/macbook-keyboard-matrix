// Native OutputAction counts are extended grapheme clusters, never UTF-16 code units.
const segmenter = new Intl.Segmenter('en', {granularity: 'grapheme'});
export const graphemes = text => [...segmenter.segment(String(text))].map(part => part.segment);
export const graphemeCount = text => graphemes(text).length;
const clamp = (n, max) => Math.max(0, Math.min(max, Number.isFinite(n) ? Math.trunc(n) : max));
export function toUTF16Offset(text, offset) {
  return graphemes(text).slice(0, clamp(offset, graphemeCount(text))).join('').length;
}
export function toGraphemeOffset(text, offset, bias = 'left') {
  offset = clamp(offset, String(text).length);
  let count = 0, position = 0;
  for (const cluster of graphemes(text)) {
    if (position + cluster.length > offset) return count + (bias === 'right' && offset > position ? 1 : 0);
    position += cluster.length; count++;
  }
  return count;
}
export function createBuffer(text = '', cursor = graphemeCount(text)) {
  return {text: String(text), cursor: clamp(cursor, graphemeCount(text))};
}
export function applyActions(buffer, actions) {
  let chars = graphemes(buffer.text ?? '');
  let cursor = clamp(buffer.cursor, chars.length);
  for (const action of actions) {
    if (action.type === 'insert') {
      const inserted = graphemes(action.text);
      const prefixUTF16 = chars.slice(0,cursor).join('').length;
      chars.splice(cursor, 0, ...inserted);
      const joined = chars.join('');
      cursor = toGraphemeOffset(joined,prefixUTF16+String(action.text).length,'right');
      chars = graphemes(joined);
      continue;
    }
    if (!Number.isInteger(action.count) || action.count < 0) throw new TypeError('Action count must be a nonnegative grapheme count.');
    const count = action.count;
    switch (action.type) {
      case 'deleteBackward': { const n = Math.min(count, cursor); chars.splice(cursor - n, n); cursor -= n; break; }
      case 'deleteForward': chars.splice(cursor, count); break;
      case 'moveLeft': cursor = Math.max(0, cursor - count); break;
      case 'moveRight': cursor = Math.min(chars.length, cursor + count); break;
      default: throw new TypeError(`Unknown output action: ${action.type}`);
    }
  }
  return {text: chars.join(''), cursor};
}
export function bufferFromTextarea(element) {
  return createBuffer(element.value, toGraphemeOffset(element.value, element.selectionStart));
}
export function applyActionsToTextarea(element, actions) {
  let buffer = bufferFromTextarea(element);
  const selected = element.selectionStart !== element.selectionEnd;
  if (!actions.length) return buffer;
  if (selected && actions.some(action => action.type === 'insert')) {
    const chars = graphemes(element.value), end = toGraphemeOffset(element.value, element.selectionEnd, 'right');
    chars.splice(buffer.cursor, end - buffer.cursor); buffer.text = chars.join('');
  }
  buffer = applyActions(buffer, actions);
  element.value = buffer.text;
  const cursor = toUTF16Offset(buffer.text, buffer.cursor);
  element.setSelectionRange(cursor, cursor);
  return buffer;
}
export function commonPrefix(a, b) {
  const left = Array.isArray(a) ? a : graphemes(a), right = Array.isArray(b) ? b : graphemes(b);
  let i = 0;
  while (i < left.length && i < right.length && left[i].normalize('NFC') === right[i].normalize('NFC')) i++;
  return i;
}
