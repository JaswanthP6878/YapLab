import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Uploaded decks are kept as object URLs so they survive "Run it again" from the report.
// PDF renders page by page; images become one slide each, in file-name order.
export function deckFromFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return { deck: null };
  const pdf = files.find((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (pdf) return { deck: { kind: 'pdf', name: pdf.name, url: URL.createObjectURL(pdf) } };
  const images = files.filter((f) => f.type.startsWith('image/')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (images.length) {
    return { deck: { kind: 'images', name: images.length === 1 ? images[0].name : `${images.length} slide images`, urls: images.map((f) => URL.createObjectURL(f)) } };
  }
  return { error: 'PowerPoint and Keynote files can\'t be shown in the browser. Export the deck as PDF and upload that.' };
}

const docs = new Map();
const openPdf = (url) => {
  if (!docs.has(url)) docs.set(url, pdfjs.getDocument(url).promise);
  return docs.get(url);
};

export function usePageCount(deck) {
  const [n, setN] = useState(deck?.kind === 'images' ? deck.urls.length : 0);
  useEffect(() => {
    if (deck?.kind !== 'pdf') { setN(deck?.kind === 'images' ? deck.urls.length : 0); return; }
    let off = false;
    openPdf(deck.url).then((d) => !off && setN(d.numPages)).catch(() => !off && setN(0));
    return () => { off = true; };
  }, [deck]);
  return n;
}

// Renders one PDF page fitted inside its container, sharp on high-DPI screens.
export function PdfPage({ url, page }) {
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!size?.w || !size?.h) return;
    let task, off = false;
    openPdf(url).then((doc) => doc.getPage(page + 1)).then((pg) => {
      if (off) return;
      const base = pg.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      const vp = pg.getViewport({ scale: Math.min(size.w / base.width, size.h / base.height) * dpr });
      const c = canvasRef.current;
      c.width = vp.width; c.height = vp.height;
      c.style.width = `${vp.width / dpr}px`; c.style.height = `${vp.height / dpr}px`;
      task = pg.render({ canvasContext: c.getContext('2d'), viewport: vp });
      task.promise.catch(() => {});
    }).catch(() => !off && setFailed(true));
    return () => { off = true; task?.cancel(); };
  }, [url, page, size]);

  return (
    <div className="pdf-page" ref={boxRef}>
      {failed ? <p className="muted">This PDF couldn't be opened.</p> : <canvas ref={canvasRef} />}
    </div>
  );
}
