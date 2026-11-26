"""Deterministic, synthetic QA files. No external images, personal data or dependencies."""
from __future__ import annotations

import argparse
import binascii
import hashlib
import json
import math
from pathlib import Path
import struct
import wave
import zlib


def png_bytes(width, height, pixel):
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', binascii.crc32(kind + payload) & 0xFFFFFFFF)
    rows = b''.join(b'\x00' + bytes(channel for x in range(width) for channel in pixel(x, y)) for y in range(height))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')


def read_png(path):
    """Read 8-bit, non-interlaced RGB/RGBA PNG exports; verify CRC and all row filters."""
    raw = Path(path).read_bytes()
    if raw[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Not a PNG')
    cursor, compressed, header = 8, bytearray(), None
    ended = False
    while cursor + 12 <= len(raw):
        size = struct.unpack_from('>I', raw, cursor)[0]
        kind = raw[cursor + 4:cursor + 8]
        payload = raw[cursor + 8:cursor + 8 + size]
        if len(payload) != size or cursor + size + 12 > len(raw):
            raise ValueError('Truncated PNG chunk')
        crc = struct.unpack_from('>I', raw, cursor + size + 8)[0]
        if (binascii.crc32(kind + payload) & 0xFFFFFFFF) != crc:
            raise ValueError('PNG CRC mismatch')
        if kind == b'IHDR':
            header = struct.unpack('>IIBBBBB', payload)
        elif kind == b'IDAT':
            compressed.extend(payload)
        elif kind == b'IEND':
            ended = True
            break
        cursor += size + 12
    if not ended or header is None:
        raise ValueError('Incomplete PNG')
    width, height, depth, color, comp, filt, interlace = header
    if not (0 < width <= 8192 and 0 < height <= 8192 and width * height <= 20000000):
        raise ValueError('Unexpected PNG dimensions')
    if depth != 8 or color not in (2, 6) or any((comp, filt, interlace)):
        raise ValueError('Expected non-interlaced 8-bit RGB/RGBA PNG')
    channels = 4 if color == 6 else 3
    stride = width * channels
    data = zlib.decompress(compressed)
    if len(data) != (stride + 1) * height:
        raise ValueError('Unexpected PNG data length')
    output, previous = [], bytearray(stride)
    for y in range(height):
        start = y * (stride + 1)
        mode, scan = data[start], bytearray(data[start + 1:start + stride + 1])
        if mode not in range(5):
            raise ValueError('Unknown PNG filter')
        for i in range(stride):
            left = scan[i - channels] if i >= channels else 0
            above = previous[i]
            upper_left = previous[i - channels] if i >= channels else 0
            if mode == 1:
                predictor = left
            elif mode == 2:
                predictor = above
            elif mode == 3:
                predictor = (left + above) // 2
            elif mode == 4:
                estimate = left + above - upper_left
                distances = [abs(estimate - left), abs(estimate - above), abs(estimate - upper_left)]
                predictor = [left, above, upper_left][distances.index(min(distances))]
            else:
                predictor = 0
            scan[i] = (scan[i] + predictor) & 255
        output.append(bytes(scan))
        previous = scan

    def pixel(x, y):
        if not 0 <= x < width or not 0 <= y < height:
            raise ValueError('Pixel outside image')
        part = tuple(output[y][x * channels:(x + 1) * channels])
        return part if channels == 4 else part + (255,)

    return {'width': width, 'height': height, 'pixel': pixel, 'bytes': len(raw)}


def generate(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    palette = [(255, 32, 48, 255), (32, 180, 96, 255), (32, 96, 220, 255), (240, 196, 32, 255)]
    images = {
        'color-grid.png': (640, 480, lambda x, y: palette[(y >= 240) * 2 + (x >= 320)]),
        'alpha-grid.png': (320, 240, lambda x, y: (255, 0, 0, 0) if x < 80 else (0, 128, 255, 128) if x < 160 else palette[1]),
        'sprite-red.png': (32, 24, lambda x, y: palette[0]),
        'sprite-blue.png': (16, 32, lambda x, y: palette[2]),
    }
    manifest = {'schemaVersion': 1, 'synthetic': True, 'images': {}, 'audio': {}}
    for name, (width, height, pixel) in images.items():
        path = directory / name
        path.write_bytes(png_bytes(width, height, pixel))
        manifest['images'][name] = {'width': width, 'height': height, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    audio = directory / 'tone-silence.wav'
    sample_rate = 16000
    values = [round(16000 * math.sin(2 * math.pi * 220 * i / sample_rate)) if 4000 <= i < 12000 else 0 for i in range(sample_rate)]
    with wave.open(str(audio), 'wb') as out:
        out.setparams((1, 2, sample_rate, 0, 'NONE', 'not compressed'))
        out.writeframes(struct.pack('<' + 'h' * len(values), *values))
    manifest['audio']['tone-silence.wav'] = {'channels': 1, 'sampleRate': sample_rate, 'durationSeconds': 1, 'frequencyHz': 220, 'silenceSeconds': [[0, .25], [.75, 1]], 'sha256': hashlib.sha256(audio.read_bytes()).hexdigest()}
    (directory / 'invalid-image.png').write_bytes(b'Digital Labs synthetic malformed image\n')
    (directory / 'invalid-audio.wav').write_bytes(b'Digital Labs synthetic malformed audio\n')
    (directory / 'fixture-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    arguments = parser.parse_args()
    print(json.dumps(generate(arguments.directory), ensure_ascii=False, indent=2))
