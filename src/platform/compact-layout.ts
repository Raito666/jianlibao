// Wide phones still need the compact UI when held in landscape. Desktop and
// taller tablet viewports retain their existing layout without UA sniffing.
export const COMPACT_LAYOUT_QUERY = '(max-width:760px), (max-width:1000px) and (max-height:500px) and (hover:none) and (pointer:coarse)';
export function isCompactViewport() {
  return window.matchMedia(COMPACT_LAYOUT_QUERY).matches;
}
