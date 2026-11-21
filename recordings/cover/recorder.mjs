import { rawDirectory } from './capture-config.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { resolve } from 'node:path';

const root = resolve(rawDirectory);
const segments = new Map();
export async function addPointer(page) {
  await page.evaluate(() => {
    if (document.getElementById('demo-pointer')) return;
    const pointer = document.createElement('div');
    pointer.id = 'demo-pointer';
    pointer.style.cssText =
      'position:fixed;z-index:2147483647;pointer-events:none;display:none;width:18px;height:18px;border:2px solid #a6c7ff;border-radius:50%;background:#151d2acc;box-shadow:0 1px 5px #000a;transform:translate(-50%,-50%);box-sizing:border-box;';
    document.body.append(pointer);
    window.addEventListener(
      'pointermove',
      (event) => {
        pointer.style.display = 'block';
        pointer.style.left = event.clientX + 'px';
        pointer.style.top = event.clientY + 'px';
        if (!event.buttons) pointer.style.background = '#151d2acc';
      },
      true,
    );
    window.addEventListener(
      'dragover',
      (event) => {
        pointer.style.display = 'block';
        pointer.style.left = event.clientX + 'px';
        pointer.style.top = event.clientY + 'px';
      },
      true,
    );
    window.addEventListener(
      'dragend',
      () => {
        pointer.style.background = '#151d2acc';
        pointer.style.boxShadow = '0 1px 5px #000a';
      },
      true,
    );
    window.addEventListener(
      'pointerdown',
      () => {
        pointer.style.background = '#478cf6';
        pointer.style.boxShadow = '0 0 0 5px #5498f451';
      },
      true,
    );
    window.addEventListener(
      'pointerup',
      () => {
        pointer.style.background = '#151d2acc';
        pointer.style.boxShadow = '0 1px 5px #000a';
      },
      true,
    );
  });
}

export async function region(page, target, opts = {}) {
  const box = await target.boundingBox();
  if (!box) throw Error('Recording target is missing');
  const viewport = await page.evaluate(() => [innerWidth, innerHeight]);
  const width = opts.width ?? 630;
  const height = opts.height ?? 330;
  return {
    x: Math.min(viewport[0] - width, Math.max(0, Math.floor(box.x - (opts.left ?? 16)))),
    y: Math.min(viewport[1] - height, Math.max(0, Math.floor(box.y - (opts.top ?? 20)))),
    width,
    height,
  };
}

export async function record(id, page, area, action, { lead = 450, tail = 1150 } = {}) {
  await addPointer(page);
  const index = (segments.get(id) || 0) + 1;
  const directory = resolve(root, id + '-' + index);
  await mkdir(directory, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const initial = await page.screenshot({ scale: 'device', timeout: 4000 });
  const frames = [{ data: initial.toString('base64'), time: 0 }];
  const cues = [];
  const origin = performance.now();
  const elapsed = () => (performance.now() - origin) / 1000;
  cdp.on('Page.screencastFrame', (frame) => {
    const capturedAt = elapsed();
    if (capturedAt > 0.2) frames.push({ data: frame.data, time: capturedAt });
    cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
  });
  let duration;
  try {
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    await wait(lead);
    await action((text) => {
      cues.push({ text, time: elapsed() });
    });
    await wait(tail);
    const final = await page.screenshot({ scale: 'device', timeout: 4000 });
    frames.push({ data: final.toString('base64'), time: elapsed() });
    await wait(100);
    duration = elapsed();
  } finally {
    await cdp.send('Page.stopScreencast').catch(() => {});
    await cdp.detach();
  }
  if (!frames.length) throw Error('No recorded frames for ' + id);
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const metadata = { area, viewport, duration, cues, frames: [] };
  for (const [index, frame] of frames.entries()) {
    const file = index + '.png';
    await writeFile(resolve(directory, file), Buffer.from(frame.data, 'base64'));
    metadata.frames.push({ file, time: frame.time });
  }
  await writeFile(resolve(directory, 'scene.json'), JSON.stringify(metadata, null, 2));
  segments.set(id, index);
  console.log('Recorded', id, 'scene', index, frames.length + ' frames', duration.toFixed(1) + 's');
}

export async function finish(id) {
  if (!segments.get(id)) throw Error('No video recorded for ' + id);
}
