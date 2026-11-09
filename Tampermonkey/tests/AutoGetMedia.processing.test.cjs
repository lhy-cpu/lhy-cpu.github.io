const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const script = fs.readFileSync(process.argv[2] || path.join(__dirname,'..','AutoGetMedia.user.js'),'utf8');
const block = script.split('// --- 媒体处理命令 ---')[1].split('// --- 媒体处理命令结束 ---')[0];
const {buildMediaCommand}=new Function(block+'\nreturn {buildMediaCommand};')();

const defaults = {
  format: 'mp4',
  videoMode: 'copy',
  audioMode: 'copy',
  videoCodec: 'libx264',
  audioCodec: 'aac',
};

test('single auto input maps optional video and audio and keeps both in copy mode', () => {
  const result = buildMediaCommand([{ name: 'clip.mp4', role: 'auto' }], defaults);
  assert.deepEqual(result.args.slice(result.args.indexOf('-map'), result.args.indexOf('-c:v')),
    ['-map', '0:v:0?', '-map', '0:a:0?']);
  assert.ok(result.args.includes('copy'));
  assert.deepEqual(result.args.slice(-3), ['-f', 'mp4', 'media.mp4']);
  assert.equal(result.mime, 'video/mp4');
});

test('real user URL never appears in generated args', () => {
  const secretUrl = 'https://example.test/private/path/name.mp4?token=do-not-leak';
  const result = buildMediaCommand([{ name: secretUrl, role: 'auto' }], defaults);
  assert.ok(!result.args.some((arg) => arg.includes('example.test') || arg.includes('do-not-leak')));
  assert.ok(result.args.includes('input0'));
});

test('two explicitly assigned inputs map only the requested tracks', () => {
  const result = buildMediaCommand([
    { name: 'video.mov', role: 'video' },
    { name: 'music.wav', role: 'audio' },
  ], defaults);
  const maps = result.args.slice(result.args.indexOf('-map'), result.args.indexOf('-c:v'));
  assert.deepEqual(maps, ['-map', '0:v:0', '-map', '1:a:0']);
});

test('video role does not also map embedded source audio', () => {
  const result = buildMediaCommand([{ name: 'video-with-audio.mp4', role: 'video' }], defaults);
  assert.ok(result.args.includes('0:v:0'));
  assert.ok(!result.args.some((arg) => /:a:0/.test(arg)));
  assert.ok(!result.args.includes('-c:a'));
});

test('audio-only output maps audio and explicitly disables video', () => {
  const result = buildMediaCommand([{ name: 'clip.mkv', role: 'auto' }], { ...defaults, format: 'm4a' });
  assert.ok(result.args.includes('0:a:0?'));
  assert.ok(result.args.includes('-vn'));
  assert.ok(!result.args.includes('-c:v'));
  assert.deepEqual(result.args.slice(-3), ['-f', 'ipod', 'media.m4a']);
  assert.equal(result.mime, 'audio/mp4');
});

test('audio-only format omits video from a mixed input plan', () => {
  const result = buildMediaCommand([
    { name: 'picture.mp4', role: 'video' },
    { name: 'voice.wav', role: 'audio' },
  ], { ...defaults, format: 'mp3', audioMode: 'encode', audioCodec: 'libmp3lame' });
  assert.deepEqual(result.args.slice(result.args.indexOf('-map'), result.args.indexOf('-vn')),
    ['-map', '1:a:0']);
  assert.ok(!result.args.some((arg) => /:v:0/.test(arg)));
  assert.ok(result.args.includes('-b:a') && result.args.includes('192k'));
});

test('H.264 encode uses the requested common quality settings', () => {
  const result = buildMediaCommand([{ name: 'clip.mkv', role: 'video' }], {
    ...defaults, videoMode: 'encode', videoCodec: 'libx264',
  });
  for (const option of ['-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p']) {
    assert.ok(result.args.includes(option));
  }
});

test('VP9 encode uses CRF mode with zero target bitrate', () => {
  const result = buildMediaCommand([{ name: 'clip.mkv', role: 'video' }], {
    ...defaults, format: 'webm', videoMode: 'encode', videoCodec: 'libvpx-vp9',
  });
  assert.deepEqual(result.args.slice(result.args.indexOf('-c:v'), result.args.indexOf('-threads')),
    ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0']);
});

test('AAC encode uses the requested audio bitrate', () => {
  const result = buildMediaCommand([{ name: 'audio.wav', role: 'audio' }], {
    ...defaults, audioMode: 'encode', audioCodec: 'aac',
  });
  assert.deepEqual(result.args.slice(result.args.indexOf('-c:a')), ['-c:a', 'aac', '-b:a', '192k', '-threads', '1', '-movflags', '+faststart', '-f', 'mp4', 'media.mp4']);
});

test('original on a multi-input mix falls back to MP4', () => {
  const result = buildMediaCommand([
    { name: 'movie.mkv', role: 'video' },
    { name: 'track.mp3', role: 'audio' },
  ], { ...defaults, format: 'original' });
  assert.equal(result.outputName, 'media.mp4');
  assert.equal(result.mime, 'video/mp4');
  assert.ok(result.args.includes('+faststart'));
});

test('original on one supported input preserves its extension', () => {
  const result = buildMediaCommand([{ name: 'https://host.test/a/music.flac?x=1', role: 'auto' }], {
    ...defaults, format: 'original', audioMode: 'copy',
  });
  assert.equal(result.outputName, 'media.flac');
  assert.equal(result.mime, 'audio/flac');
  assert.ok(result.args.includes('-f') && result.args.includes('flac'));
});

test('original on a single unsupported extension falls back to MP4', () => {
  const result = buildMediaCommand([{ name: 'clip.avi', role: 'auto' }], { ...defaults, format: 'original' });
  assert.equal(result.outputName, 'media.mp4');
});

test('container specific muxers are selected for TS and AAC elementary stream', () => {
  const ts = buildMediaCommand([{ name: 'a.mp4', role: 'video' }], { ...defaults, format: 'ts' });
  const aac = buildMediaCommand([{ name: 'a.wav', role: 'audio' }], { ...defaults, format: 'aac' });
  assert.ok(ts.args.includes('mpegts'));
  assert.ok(aac.args.includes('adts'));
});

test('MP4 and MOV outputs enable faststart', () => {
  for (const format of ['mp4', 'mov']) {
    const result = buildMediaCommand([{ name: 'clip.mp4', role: 'auto' }], { ...defaults, format });
    assert.ok(result.args.includes('-movflags'));
    assert.ok(result.args.includes('+faststart'));
  }
});

test('unsafe output paths are reduced to a safe basename', () => {
  const result = buildMediaCommand([{ name: 'clip.mp4', role: 'auto' }], defaults, '../../unsafe name?.mp4');
  assert.equal(result.outputName, 'unsafe_name.mp4');
});

test('unknown format, mode, and encoder are rejected', () => {
  assert.throws(() => buildMediaCommand([{ role: 'auto' }], { ...defaults, format: 'avi' }), /unknown format/);
  assert.throws(() => buildMediaCommand([{ role: 'auto' }], { ...defaults, videoMode: 'transcode' }), /unknown videoMode/);
  assert.throws(() => buildMediaCommand([{ role: 'auto' }], { ...defaults, audioCodec: 'opus' }), /unknown audio encoder/);
});

test('explicitly incompatible encoder and container pairs are rejected', () => {
  assert.throws(() => buildMediaCommand([{ role: 'video' }], {
    ...defaults, format: 'webm', videoMode: 'encode', videoCodec: 'libx264',
  }), /incompatible/);
  assert.throws(() => buildMediaCommand([{ role: 'audio' }], {
    ...defaults, format: 'mp3', audioMode: 'encode', audioCodec: 'aac',
  }), /incompatible/);
});

test('copy mode is never silently changed to an encoder', () => {
  const result = buildMediaCommand([{ role: 'auto' }], {
    ...defaults, format: 'webm', audioMode: 'copy', videoMode: 'copy',
  });
  assert.ok(result.args.includes('-c:v') && result.args.includes('copy'));
  assert.ok(result.args.includes('-c:a') && result.args.includes('copy'));
  assert.ok(!result.args.includes('libvpx-vp9'));
});
