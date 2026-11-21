import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { paddingColor, rawDirectory, renderDirectory, theme } from './capture-config.mjs';

const output = resolve(renderDirectory);
const cutFrames = JSON.parse(readFileSync(new URL('./cut-frames.json', import.meta.url), 'utf8'));
const options = process.argv.slice(2);
const useOriginal = options.includes('--original');
const originalScenes = useOriginal
  ? JSON.parse(readFileSync(new URL('./original-' + theme + '.json', import.meta.url), 'utf8'))
  : [];
const originalSources = new Map(originalScenes.map(({ id, source }) => [id, source]));
const fps = 24;
const width = 1280;
const height = 720;
const pictureHeight = height;
const ratio = width / pictureHeight;
mkdirSync(output, { recursive: true });

const listViews = [
  ['today', 'Today shows what is scheduled or due'],
  ['inbox', 'Inbox holds tasks to sort later'],
  ['upcoming', 'Upcoming shows tasks for future dates'],
  ['anytime', 'Anytime shows tasks you can do now'],
  ['waiting', 'Waiting For tracks delegated tasks'],
  ['someday', 'Someday holds ideas for later'],
  ['logbook', 'Logbook keeps completed and canceled tasks'],
  ['trash', 'Trash holds tasks you can restore'],
  ['repeating', 'Use Show Repeating to review repeat rules'],
];
const chapters = [
  [
    'Create a task in a note',
    [['create-1', [], { focus: 1040, wide: 1100, x: 645, y: 260, zoomFrom: 0, zoomUntil: 3 }]],
  ],
  ['Start dates and deadlines', [['dates-1', [], { full: true }]]],
  ['Reorder tasks in a note', [['drag-1', [], { full: true }]]],
  [
    'Finish, cancel, or reschedule',
    [
      ['finish-1', [], { focus: 995, x: 534, y: 282 }],
      ['reschedule-1', [], { full: true }],
    ],
  ],
  [
    'Tasks and notes in one workspace',
    [
      [
        'intro-1',
        [
          [0, ''],
          [0.55, 'Open task lists and notes from the sidebar'],
          [4.18, ''],
        ],
        { duration: 5, zoom: [1.42, 0, 0.25] },
      ],
    ],
  ],
  [
    'Task lists',
    listViews.map(([id, text]) => ['list-' + id, [[0, text]], { still: true, duration: 3 }]),
  ],
  [
    'Global capture',
    [
      ['global-capture-1', [], { duration: 3.75, zoom: [1.65, 0.72, 0.07] }],
      [
        'capture-inbox-1',
        [
          [0, 'Press your shortcut from another app'],
          [1.85, ''],
        ],
        { full: true },
      ],
    ],
  ],
  [
    'Add a calendar',
    [
      ['calendar-1', [], { full: true }, 0.7],
      ['calendar-2', [[0, 'Paste an ICS subscription URL']], { full: true }],
      ['calendar-3', [], { full: true }, 0.7],
    ],
  ],
  [
    'Convert and export Markdown tasks',
    [
      ['convert-selection-1', 'recorded', { full: true }],
      ['convert-note-1', [], { full: true }],
      ['export-note-1', 'recorded', { full: true }],
    ],
  ],
];

function run(exe, args) {
  const result = spawnSync(exe, args, { encoding: 'utf8' });
  if (result.status !== 0) throw Error(result.stderr || result.error?.message || 'Render failed');
  return result.stdout;
}
const ffmpeg = (args) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const concat = (path) => "file '" + path.replaceAll("'", "'\\''") + "'";
const even = (value) => Math.floor(value / 2) * 2;
const clamp = (min, value, max) => Math.max(min, Math.min(value, max));
function time(seconds) {
  const millis = Math.round(seconds * 1000);
  return (
    [Math.floor(millis / 3600000), Math.floor(millis / 60000) % 60, Math.floor(millis / 1000) % 60]
      .map((v) => String(v).padStart(2, '0'))
      .join(':') +
    '.' +
    String(millis % 1000).padStart(3, '0')
  );
}

function frameSet(id, camera) {
  const dir = useOriginal
    ? resolve('artifacts/screencast', originalSources.get(id))
    : resolve(rawDirectory, id);
  if (camera.still)
    return { dir, frames: [{ file: 'still.png', time: 0 }], duration: camera.duration, cues: [] };
  return { ...JSON.parse(readFileSync(join(dir, 'scene.json'))), dir };
}

async function renderCaptions(page, captions) {
  const uniqueWords = [...new Set(captions)];
  const images = await page.evaluate((words) => {
    const font = '600 38px "Helvetica Neue", Arial, sans-serif';
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    return words.map((text) => {
      context.font = font;
      canvas.width = Math.ceil(context.measureText(text).width) + 48;
      canvas.height = 62;
      if (canvas.width > 960) throw Error('Caption is too wide: ' + text);

      context.beginPath();
      context.roundRect(1, 1, canvas.width - 2, canvas.height - 2, 22);
      context.fillStyle = 'rgba(15, 20, 26, 0.94)';
      context.fill();
      context.lineWidth = 1.5;
      context.strokeStyle = 'rgba(238, 240, 242, 0.27)';
      context.stroke();

      context.font = font;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = '#f5f6f8';
      context.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
      return canvas.toDataURL('image/png').split(',')[1];
    });
  }, uniqueWords);
  return new Map(
    uniqueWords.map((words, index) => {
      const path = join(output, 'caption-' + index + '.png');
      writeFileSync(path, Buffer.from(images[index], 'base64'));
      return [words, path];
    }),
  );
}

function countFrames(movie) {
  const probe = run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=nb_frames',
    '-of',
    'json',
    movie,
  ]);
  return Number(JSON.parse(probe).streams[0].nb_frames);
}

function encode(input, filter, cues, captions, frames, out) {
  const captionInputs = cues.flatMap(([, , words]) => ['-i', captions.get(words)]);
  const graph = ['[0:v]' + filter.join(',') + '[picture0]'];
  for (const [index, [start, end]] of cues.entries()) {
    const overlay = `overlay=x=(main_w-overlay_w)/2:y=main_h-overlay_h-48:enable='gte(t,${start})*lt(t,${end})'`;
    graph.push(`[picture${index}][${index + 1}:v]${overlay}[picture${index + 1}]`);
  }
  ffmpeg([
    ...input,
    ...captionInputs,
    '-filter_complex_threads',
    '2',
    '-filter_complex',
    graph.join(';'),
    '-map',
    '[picture' + cues.length + ']',
    '-frames:v',
    String(frames),
    '-an',
    '-threads',
    '3',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '19',
    '-pix_fmt',
    'yuv420p',
    '-color_range',
    'tv',
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    out,
  ]);
  const count = countFrames(out);
  if (count !== frames)
    throw Error('Unexpected frame count for ' + out + ': ' + count + '/' + frames);
}

function fit(w, h) {
  return (
    'scale=' +
    w +
    ':' +
    h +
    ':force_original_aspect_ratio=decrease:force_divisible_by=2,pad=' +
    w +
    ':' +
    h +
    ':(ow-iw)/2:(oh-ih)/2:color=' +
    paddingColor
  );
}

function shotHints(hints, scene) {
  if (hints !== 'recorded') return hints;
  return [[0, ''], ...scene.cues.map(({ time, text }) => [time, text])];
}

function renderShot([id, hints, camera, hold = 0.48], captions) {
  const scene = frameSet(id, camera);
  const lead = camera.duration ? 0 : 0.22;
  const frames = cutFrames[id];
  const length = frames / fps;
  if (!camera.duration) {
    const speed = (length - lead - hold) / scene.duration;
    scene.duration *= speed;
    for (const frame of scene.frames) frame.time *= speed;
    for (const cue of scene.cues) cue.time *= speed;
  }
  const out = join(output, id + '.mp4');
  let input;
  const dimensions = scene.frames.map((frame) => {
    const png = readFileSync(join(scene.dir, frame.file));
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
  });
  const rawWidth = Math.max(...dimensions.map(([w]) => w));
  const rawHeight = Math.max(...dimensions.map(([, h]) => h));
  if (camera.still) {
    input = ['-framerate', '24', '-i', join(scene.dir, scene.frames[0].file)];
  } else {
    const paths = scene.frames.map((frame, i) => {
      const path = join(scene.dir, frame.file);
      if (dimensions[i][0] === rawWidth && dimensions[i][1] === rawHeight) return path;
      const normalized = join(output, id + '-normalized-' + i + '.png');
      ffmpeg([
        '-i',
        path,
        '-vf',
        'scale=' + rawWidth + ':' + rawHeight,
        '-frames:v',
        '1',
        normalized,
      ]);
      return normalized;
    });
    const manifest = join(output, id + '.ffconcat');
    const lines = ['ffconcat version 1.0'];
    for (const [i, frame] of scene.frames.entries()) {
      const end = scene.frames[i + 1]?.time ?? scene.duration;
      const start = i === 0 ? 0 : frame.time;
      lines.push(concat(paths[i]), 'duration ' + Math.max(0.008, end - start).toFixed(4));
    }
    lines.push(concat(paths.at(-1)));
    writeFileSync(manifest, lines.join('\n') + '\n');
    input = ['-f', 'concat', '-safe', '0', '-i', manifest];
  }

  hints = shotHints(hints, scene);
  const cues = hints
    .map(([start, text], i) => [
      i === 0 ? 0 : start + lead,
      hints[i + 1] ? Math.min(length, hints[i + 1][0] + lead) : length,
      text,
    ])
    .filter(([, , text]) => text);
  const filter = [
    'fps=24',
    'tpad=start_mode=clone:start_duration=' +
      lead +
      ':stop_mode=clone:stop_duration=' +
      (length + 0.8),
  ];
  const factor = rawWidth / (scene.viewport?.width ?? rawWidth);
  if (camera.zoom) {
    const [magnification, anchorX, anchorY] = camera.zoom;
    const phase = 'min(clip((on-4)/18,0,1),clip((' + (frames - 1) + '-on)/14,0,1))';
    const ease = '(' + phase + '*' + phase + '*(3-2*' + phase + '))';
    filter.push(
      fit(width * 2, pictureHeight * 2),
      "zoompan=z='1+" +
        (magnification - 1) +
        '*' +
        ease +
        "':x='" +
        anchorX +
        "*(iw-iw/zoom)':y='" +
        anchorY +
        "*(ih-ih/zoom)':d=1:s=" +
        width +
        'x' +
        pictureHeight +
        ':fps=' +
        fps,
    );
  } else if (camera.full || camera.still) {
    filter.push(fit(width, pictureHeight));
  } else if (camera.crop) {
    filter.push(
      'crop=' + camera.crop.map((v) => even(v * factor)).join(':'),
      fit(width, pictureHeight),
    );
  } else {
    const tight = Math.min(rawWidth / factor, (rawHeight / factor) * ratio, camera.focus);
    const wide = Math.min(rawWidth / factor, (rawHeight / factor) * ratio, camera.wide ?? tight);
    const cw = even(wide * factor),
      ch = even(cw / ratio);
    const wideX = camera.wide ? rawWidth / 2 : camera.x * factor;
    const x = even(clamp(0, wideX - cw / 2, rawWidth - cw));
    const y = even(clamp(0, camera.y * factor - ch / 2, rawHeight - ch));
    const zoom = cw / (tight * factor);
    const targetX = clamp(0, camera.x * factor - x - cw / zoom / 2, cw - cw / zoom);
    const targetY = clamp(0, camera.y * factor - y - ch / zoom / 2, ch - ch / zoom);
    filter.push('crop=' + [cw, ch, x, y].join(':'));
    if (zoom > 1.01) {
      const start = Math.max(0, Math.round((scene.cues[camera.zoomFrom].time + lead - 0.65) * fps));
      const end = Math.round((scene.cues[camera.zoomUntil].time + lead + 0.25) * fps);
      const phase = 'min(clip((on-' + start + ')/24,0,1),clip((' + end + '-on)/18,0,1))';
      const ease = '(' + phase + '*' + phase + '*(3-2*' + phase + '))';
      filter.push(
        "zoompan=z='1+(" +
          (zoom - 1).toFixed(5) +
          ')*' +
          ease +
          "':x='" +
          targetX.toFixed(2) +
          '*' +
          ease +
          "':y='" +
          targetY.toFixed(2) +
          '*' +
          ease +
          "':d=1:s=" +
          width +
          'x' +
          pictureHeight +
          ':fps=' +
          fps,
      );
    } else filter.push('scale=' + width + ':' + pictureHeight);
  }
  filter.push('setsar=1');
  encode(input, filter, cues, captions, frames, out);
  console.log(id, length.toFixed(2) + 's');
  return { out, length };
}

const files = [];
const chapterCues = [];
const { webkit } = await import(process.env.THINGSMD_RECORDING_PLAYWRIGHT ?? 'playwright-core');
const browser = await webkit.launch({ executablePath: process.env.THINGSMD_RECORDING_WEBKIT });
let captions;
try {
  const page = await browser.newPage();
  const lines = chapters.flatMap(([, scenes]) =>
    scenes.flatMap(([id, hints, camera]) =>
      shotHints(hints, frameSet(id, camera))
        .map(([, text]) => text)
        .filter(Boolean),
    ),
  );
  captions = await renderCaptions(page, lines);
} finally {
  await browser.close();
}
let position = 0;
const rerender = new Set(options.filter((option) => option !== '--original'));
for (const [title, scenes] of chapters) {
  const start = position;
  for (const shot of scenes) {
    const shotFile = [output].map((dir) => join(dir, shot[0] + '.mp4')).find(existsSync);
    const result =
      rerender.size && !rerender.has(shot[0])
        ? { out: shotFile, length: countFrames(shotFile) / fps }
        : renderShot(shot, captions);
    position += result.length;
    files.push(result.out);
  }
  chapterCues.push({ start, end: position, title });
}
const listPath = join(output, 'cover.ffconcat');
writeFileSync(listPath, files.map((file) => concat(file)).join('\n') + '\n');
const movie = join(output, 'cover-screencast.mp4');
ffmpeg([
  '-f',
  'concat',
  '-safe',
  '0',
  '-i',
  listPath,
  '-c:v',
  'copy',
  '-movflags',
  '+faststart',
  movie,
]);
ffmpeg(['-i', movie, '-frames:v', '1', '-q:v', '3', join(output, 'cover-screencast.jpg')]);
const duration = Number(
  run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', movie]),
);
chapterCues.at(-1).end = duration;
const subtitles = chapterCues.map(
  ({ start, end, title }) => time(start) + ' --> ' + time(end) + '\n' + title,
);
writeFileSync(join(output, 'cover-chapters.vtt'), 'WEBVTT\n\n' + subtitles.join('\n\n') + '\n\n');
console.log('Cover duration:', duration.toFixed(2) + 's');
