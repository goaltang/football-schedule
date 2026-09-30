import { useState } from 'react';

function smallLogo(url: string) {
  const match = /^https?:\/\/a\.espncdn\.com(\/.+)$/.exec(url);
  return match ? `https://a.espncdn.com/combiner/i?img=${match[1]}&w=64&h=64` : url;
}
function ImageFallback({ sources, size, className }: { sources: string[]; size: number; className: string }) {
  const [index, setIndex] = useState(0);
  if (index >= sources.length) return <span className={`${className} ghost`} style={{ width: size, height: size }} />;
  return <img className={className} src={sources[index]} width={size} height={size} alt=""
    decoding="async" loading="lazy" onError={() => setIndex((value) => value + 1)} />;
}
export function Logo({ id, url = '', size = 28, crest = false }: { id?: string; url?: string; size?: number; crest?: boolean }) {
  const sources = [...new Set([id ? `logos/${crest ? 'lg-' : ''}${id}.png` : '', smallLogo(url), url].filter(Boolean))];
  return <ImageFallback key={sources.join('|')} sources={sources} size={size} className={crest ? 'crest' : 'logo'} />;
}
