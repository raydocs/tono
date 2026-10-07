#!/usr/bin/env python3
"""Inspect retained first-source native PNGs; never modify them.

Requires Pillow for diagnostic contact sheets. Means/differences use every source
pixel, not a hand-picked region. Sky/water split is the spec's 55% window horizon.
Exit 2 means evidence does not meet MAC-POLISH-SPEC §4 (2026-10-07 erratum).
"""
import argparse
import json
import math
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageStat


def luminance(image):
    lut = [((x / 255) / 12.92 if x / 255 <= 0.04045 else ((x / 255 + 0.055) / 1.055) ** 2.4) for x in range(256)]
    histogram = image.convert('RGB').histogram()
    count = image.width * image.height
    return sum(weight * sum(histogram[channel * 256 + x] * lut[x] for x in range(256)) / count
               for channel, weight in enumerate((0.2126, 0.7152, 0.0722)))


def transition_metrics(values, direction, night_reference=None):
    deltas = [b - a for a, b in zip(values, values[1:])]
    plateau = maximum = 1
    for delta in deltas:
        plateau = plateau + 1 if abs(delta) < 1e-12 else 1
        maximum = max(maximum, plateau)
    result = dict(meanLinearLuminance=values, adjacentDeltas=deltas, direction=direction,
                  strictlyMonotonicNoTolerance=all(direction * d >= 0 for d in deltas),
                  longestEqualPlateauFrames=maximum)
    if direction > 0:
        accepted = result['strictlyMonotonicNoTolerance'] and maximum <= 2
    else:
        tolerance = 1 / 255
        drop = values[0] - values[-1]
        largest = max(0, max(-d for d in deltas))
        reference_delta = None if night_reference is None else abs(values[-1] - night_reference)
        result.update(plannedSpanMilliseconds=6000, nonIncreaseTolerance=tolerance,
                      nonIncreasingWithinTolerance=all(d <= tolerance for d in deltas),
                      plateauAllowedByDesign=True, firstToLastDrop=drop,
                      largestSingleFrameDrop=largest, largestDropFraction=largest / drop if drop > 0 else None,
                      maximumDropFraction=0.25, nightReferenceLuminance=night_reference,
                      lastFrameNightDelta=reference_delta)
        accepted = (result['nonIncreasingWithinTolerance'] and drop > 0 and largest <= 0.25 * drop
                    and reference_delta is not None and reference_delta <= tolerance)
    result['acceptance'] = 'PASS' if accepted else 'FAIL'
    return result


def series(files, direction, night_reference=None):
    values = [luminance(Image.open(path)) for path in files]
    return dict(files=[p.name for p in files], **transition_metrics(values, direction, night_reference))


def contact_sheet(files, out, columns=4, width=460):
    # Labelled resized derivatives only. All unmodified original frames remain alongside.
    tiles = []
    for path in files:
        source = Image.open(path).convert('RGB')
        source.thumbnail((width, math.ceil(width * source.height / source.width)))
        tiles.append((path.name, source))
    cell_height = max(im.height for _, im in tiles) + 34
    sheet = Image.new('RGB', (columns * width, math.ceil(len(tiles) / columns) * cell_height), '#101018')
    draw = ImageDraw.Draw(sheet)
    for index, (name, im) in enumerate(tiles):
        x, y = index % columns * width, index // columns * cell_height
        draw.text((x + 6, y + 6), name, fill='white')
        sheet.paste(im, (x, y + 30))
    sheet.save(out)


def differences(a, b):
    difference = ImageChops.difference(a.convert('RGB'), b.convert('RGB'))
    return dict(rgbMeanAbsoluteDifference=ImageStat.Stat(difference).mean,
                changedPixels=sum(pixel != (0, 0, 0) for pixel in difference.getdata()),
                totalPixels=difference.width * difference.height)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report = {'source': 'first native PNG bytes, unmodified', 'metric': 'full-frame linear sRGB Rec.709 luminance',
              'specErratum': '2026-10-07', 'skyDecorationChangesAllowed': True, 'transitions': {}, 'water': {}}
    accepted = True
    for name, direction in [('rise', 1), ('arrival', 1), ('set', -1)]:
        files = [args.input / f'polish-a-{name}-{index:02d}.png' for index in range(16)]
        if not all(p.exists() for p in files):
            report['transitions'][name] = {'acceptance': 'MISSING FRAMES'}
            accepted = False
            continue
        reference = args.input / 'polish-a-set-night-reference.png'
        night = luminance(Image.open(reference)) if name == 'set' and reference.exists() else None
        result = series(files, direction, night)
        accepted &= result['acceptance'] == 'PASS'
        report['transitions'][name] = result
        contact_sheet(files, args.output / f'{name}-16-native-frames.png')
    for name in ['idle', 'connected']:
        files = [args.input / f'polish-a-water-{name}-{index}.png' for index in range(2)]
        if not all(p.exists() for p in files):
            report['water'][name] = {'acceptance': 'MISSING PAIR'}
            accepted = False
            continue
        a, b = [Image.open(p).convert('RGB') for p in files]
        if a.size != b.size:
            raise ValueError('water frames have different sizes')
        horizon = round(a.height * 0.55)
        water = differences(a.crop((0, horizon, a.width, a.height)), b.crop((0, horizon, b.width, b.height)))
        sky = differences(a.crop((0, 0, a.width, horizon)), b.crop((0, 0, b.width, horizon)))
        report['water'][name] = dict(water=water, sky=sky, acceptance='PASS' if water['changedPixels'] else 'FAIL')
        accepted &= water['changedPixels'] > 0
        contact_sheet(files, args.output / f'{name}-water-native-pair.png', columns=2)
    windows = sorted(p for p in args.input.glob('polish-a-*.png') if p.name.startswith(('polish-a-en-', 'polish-a-zh-')))
    for offset in range(0, len(windows), 12):
        contact_sheet(windows[offset:offset + 12], args.output / f'whole-window-{offset // 12 + 1:02d}.png', columns=3, width=640)
    (args.output / 'metrics.json').write_text(json.dumps(report, indent=2) + '\n')
    for name, data in report['transitions'].items():
        print(name, data.get('acceptance'), data.get('meanLinearLuminance', []))
        if name == 'set':
            print('set criteria', json.dumps({k: data.get(k) for k in (
                'nonIncreasingWithinTolerance', 'largestDropFraction', 'lastFrameNightDelta', 'nonIncreaseTolerance')}))
    for name, data in report['water'].items():
        print('water', name, json.dumps(data))
    print('CPU budget is NOT inferred from pixels; inspect polish-a-motion-receipt.txt and its host architecture/power mode.')
    return 0 if accepted else 2


if __name__ == '__main__':
    raise SystemExit(main())
