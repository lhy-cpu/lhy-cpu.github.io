const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const script = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'AutoGetMedia.user.js'), 'utf8');
const block = script.split('// --- 媒体属性纯函数 ---')[1].split('// --- 媒体属性纯函数结束 ---')[0];
const { metadataFromHeaders, metadataFromAudioPrefix, formatMediaMetadata } = new Function(block + '\nreturn { metadataFromHeaders, metadataFromAudioPrefix, formatMediaMetadata };')();

function makeWavPrefix() {
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  const put = (offset, value) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  put(0, 'RIFF');
  view.setUint32(4, 36, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, 44100, true);
  view.setUint32(28, 176400, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  put(36, 'data');
  view.setUint32(40, 0, true);
  return bytes;
}

function makeAdtsPrefix() {
  // AAC-LC, 44.1 kHz, stereo, unprotected 7-byte ADTS header, 100-byte frame.
  return Uint8Array.from([0xff, 0xf1, 0x50, 0x80, 0x0c, 0x80, 0x00]);
}

test('reads complete size from Content-Length on a full response', () => {
  const result = metadataFromHeaders('https://example.test/movie.mp4',
    'HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: 1234\r\n', 200);
  assert.equal(result.kind, 'video');
  assert.equal(result.mime, 'video/mp4');
  assert.equal(result.size, 1234);
});

test('does not mistake a partial response Content-Length for the full file size', () => {
  const result = metadataFromHeaders('https://example.test/movie.mp4',
    new Headers({ 'content-type': 'video/mp4', 'content-length': '100' }), 206);
  assert.equal(result.size, undefined);
});

test('prefers Content-Range total size for a 206 response', () => {
  const result = metadataFromHeaders('https://example.test/movie.mp4', {
    'Content-Length': '100',
    'Content-Range': 'bytes 0-99/1000',
    'Content-Type': 'video/mp4'
  }, 206);
  assert.equal(result.size, 1000);
});

test('does not report an HLS manifest length as media size', () => {
  const result = metadataFromHeaders('https://example.test/live.m3u8?token=abc',
    'Content-Type: application/vnd.apple.mpegurl\r\nContent-Length: 8192\r\n', 200);
  assert.equal(result.kind, 'hls');
  assert.equal(result.mime, 'application/vnd.apple.mpegurl');
  assert.equal(result.size, undefined);
});

test('extracts HLS codecs and exact header-derived metadata', () => {
  const result = metadataFromHeaders('https://example.test/stream', {
    'content-type': 'video/mp4; codecs="avc1.640028, mp4a.40.2"',
    'x-video-resolution': '1920x1080',
    'x-duration': '01:02:03.5',
    'x-bitrate': '2400000',
    'x-frame-rate': '30000/1001',
    'audio-samplerate': '48000',
    'audio-channels': '2'
  }, 200);
  assert.equal(result.kind, 'video');
  assert.equal(result.codecs, 'avc1.640028, mp4a.40.2');
  assert.equal(result.width, 1920);
  assert.equal(result.height, 1080);
  assert.equal(result.duration, 3723.5);
  assert.equal(result.bitrate, 2400000);
  assert.ok(Math.abs(result.frameRate - 29.97002997002997) < 1e-10);
  assert.equal(result.sampleRate, 48000);
  assert.equal(result.channels, '2');
  assert.equal(result.estimatedSize, Math.round(3723.5 * 2400000 / 8));
});

test('parses WAV fmt sample rate, channel count, bitrate, and PCM type from bytes', () => {
  assert.deepEqual(metadataFromAudioPrefix(makeWavPrefix()), {
    kind: 'audio', mime: 'audio/wav', channels: '2', sampleRate: 44100,
    bitrate: 1411200, codecs: 'PCM'
  });
});

test('parses AAC sampling rate and channels from an ADTS header', () => {
  assert.deepEqual(metadataFromAudioPrefix(makeAdtsPrefix()), {
    kind: 'audio', mime: 'audio/aac', sampleRate: 44100,
    codecs: 'AAC-LC', channels: '2'
  });
});

test('returns no speculative audio metadata for an unrecognized prefix', () => {
  assert.deepEqual(metadataFromAudioPrefix(Uint8Array.from([1, 2, 3, 4, 5, 6, 7])), {});
  assert.deepEqual(metadataFromAudioPrefix(makeAdtsPrefix().subarray(0, 5)), {});
});

test('does not fabricate missing fields from a media extension', () => {
  const result = metadataFromHeaders('https://example.test/song.mp3', '', 200);
  assert.deepEqual(result, { kind: 'audio' });
});

test('formats exact and estimated metadata, and labels current HLS duration', () => {
  const text = formatMediaMetadata({
    kind: 'hls', mime: 'application/vnd.apple.mpegurl', estimatedSize: 1040000,
    duration: 3661, width: 1920, height: 1080, bitrate: 2400000,
    codecs: 'avc1.640028', frameRate: 29.97, sampleRate: 48000,
    channels: '2', live: true
  });
  for (const fragment of [
    'HLS', '估算大小 1,015.63 KB', '当前清单时长 1:01:01', '1920×1080',
    '码率 2,400,000 bit/s', '编码 avc1.640028', '29.97 fps', '48,000 Hz', '声道 2'
  ]) assert.ok(text.includes(fragment), `missing ${fragment} in: ${text}`);
});

test('formats byte sizes and ordinary durations with the requested units', () => {
  const text = formatMediaMetadata({ kind: 'video', size: 1024, duration: 65 });
  assert.ok(text.includes('大小 1 KB'));
  assert.ok(text.includes('时长 01:05'));
});
