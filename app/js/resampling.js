// Image resampling algorithms used to scale the cropped input image to the target resolution.
// All functions operate on RGBA Uint8ClampedArray pixel data (as returned by getImageData)
// and return a new RGBA Uint8ClampedArray with full opacity.

// ---------------------------------------------------------------------------
// Separable convolution filters
// ---------------------------------------------------------------------------

function sincFunction(x) {
    if (x === 0) {
        return 1;
    }
    x *= Math.PI;
    return Math.sin(x) / x;
}

// Mitchell-Netravali family of cubic filters, parameterised by B and C
function cubicBCFilter(B, C) {
    return (x) => {
        x = Math.abs(x);
        if (x < 1) {
            return ((12 - 9 * B - 6 * C) * x * x * x + (-18 + 12 * B + 6 * C) * x * x + (6 - 2 * B)) / 6;
        } else if (x < 2) {
            return (
                ((-B - 6 * C) * x * x * x + (6 * B + 30 * C) * x * x + (-12 * B - 48 * C) * x + (8 * B + 24 * C)) / 6
            );
        }
        return 0;
    };
}

// Keys cubic convolution with free parameter a
function keysCubicFilter(a) {
    return (x) => {
        x = Math.abs(x);
        if (x < 1) {
            return (a + 2) * x * x * x - (a + 3) * x * x + 1;
        } else if (x < 2) {
            return a * x * x * x - 5 * a * x * x + 8 * a * x - 4 * a;
        }
        return 0;
    };
}

function besselI0(x) {
    let sum = 1;
    let term = 1;
    const halfX = x / 2;
    for (let k = 1; k < 32; k++) {
        term *= (halfX / k) * (halfX / k);
        sum += term;
        if (term < sum * 1e-12) {
            break;
        }
    }
    return sum;
}

// Windowed sinc filter, where window maps x in [0, 1] (normalized distance) to a weight
function windowedSincFilter(support, window) {
    return (x) => {
        x = Math.abs(x);
        if (x >= support) {
            return 0;
        }
        return sincFunction(x) * window(x / support);
    };
}

const SINC_WINDOWS = {
    lanczos: (t) => sincFunction(t),
    hann: (t) => 0.5 + 0.5 * Math.cos(Math.PI * t),
    hamming: (t) => 0.54 + 0.46 * Math.cos(Math.PI * t),
    blackman: (t) => 0.42 + 0.5 * Math.cos(Math.PI * t) + 0.08 * Math.cos(2 * Math.PI * t),
    welch: (t) => 1 - t * t,
    cosine: (t) => Math.cos((Math.PI * t) / 2),
    bartlett: (t) => 1 - t,
    bohman: (t) => (1 - t) * Math.cos(Math.PI * t) + Math.sin(Math.PI * t) / Math.PI,
    kaiser: (t) => besselI0(6.5 * Math.sqrt(Math.max(0, 1 - t * t))) / besselI0(6.5),
    parzen: (t) => (t < 0.5 ? 1 - 6 * t * t + 6 * t * t * t : 2 * Math.pow(1 - t, 3)),
};

const RESAMPLING_FILTERS = {
    box: {
        support: 0.5,
        fn: (x) => (x >= -0.5 && x < 0.5 ? 1 : 0),
    },
    triangle: {
        support: 1,
        fn: (x) => {
            x = Math.abs(x);
            return x < 1 ? 1 - x : 0;
        },
    },
    hermite: {
        support: 1,
        fn: (x) => {
            x = Math.abs(x);
            return x < 1 ? (2 * x - 3) * x * x + 1 : 0;
        },
    },
    cosineInterp: {
        support: 1,
        fn: (x) => {
            x = Math.abs(x);
            return x < 1 ? 0.5 + 0.5 * Math.cos(Math.PI * x) : 0;
        },
    },
    quadratic: {
        support: 1.5,
        fn: (x) => {
            x = Math.abs(x);
            if (x < 0.5) {
                return 0.75 - x * x;
            } else if (x < 1.5) {
                return 0.5 * (x - 1.5) * (x - 1.5);
            }
            return 0;
        },
    },
    catmullRom: { support: 2, fn: keysCubicFilter(-0.5) },
    keysSharp: { support: 2, fn: keysCubicFilter(-0.75) },
    mitchell: { support: 2, fn: cubicBCFilter(1 / 3, 1 / 3) },
    bSpline: { support: 2, fn: cubicBCFilter(1, 0) },
    robidoux: { support: 2, fn: cubicBCFilter(0.3782157550939987, 0.31089212245300067) },
    robidouxSharp: { support: 2, fn: cubicBCFilter(0.2620145123990142, 0.3689927438004929) },
    spline16: {
        support: 2,
        fn: (x) => {
            x = Math.abs(x);
            if (x < 1) {
                return ((x - 9 / 5) * x - 1 / 5) * x + 1;
            } else if (x < 2) {
                x -= 1;
                return (((-1 / 3) * x + 4 / 5) * x - 7 / 15) * x;
            }
            return 0;
        },
    },
    spline36: {
        support: 3,
        fn: (x) => {
            x = Math.abs(x);
            if (x < 1) {
                return (((13 / 11) * x - 453 / 209) * x - 3 / 209) * x + 1;
            } else if (x < 2) {
                x -= 1;
                return (((-6 / 11) * x + 270 / 209) * x - 156 / 209) * x;
            } else if (x < 3) {
                x -= 2;
                return (((1 / 11) * x - 45 / 209) * x + 26 / 209) * x;
            }
            return 0;
        },
    },
    gaussian: {
        support: 2,
        fn: (x) => Math.exp(-2 * x * x) * Math.sqrt(2 / Math.PI),
    },
    lanczos2: { support: 2, fn: windowedSincFilter(2, SINC_WINDOWS.lanczos) },
    lanczos3: { support: 3, fn: windowedSincFilter(3, SINC_WINDOWS.lanczos) },
    lanczos4: { support: 4, fn: windowedSincFilter(4, SINC_WINDOWS.lanczos) },
    lanczos5: { support: 5, fn: windowedSincFilter(5, SINC_WINDOWS.lanczos) },
    hann: { support: 3, fn: windowedSincFilter(3, SINC_WINDOWS.hann) },
    hamming: { support: 3, fn: windowedSincFilter(3, SINC_WINDOWS.hamming) },
    blackman: { support: 3, fn: windowedSincFilter(3, SINC_WINDOWS.blackman) },
    welch: { support: 3, fn: windowedSincFilter(3, SINC_WINDOWS.welch) },
    cosine: { support: 3, fn: windowedSincFilter(3, SINC_WINDOWS.cosine) },
    bartlett: { support: 3, fn: windowedSincFilter(3, SINC_WINDOWS.bartlett) },
    bohman: { support: 3, fn: windowedSincFilter(3, SINC_WINDOWS.bohman) },
    kaiser: { support: 3, fn: windowedSincFilter(3, SINC_WINDOWS.kaiser) },
    parzen: { support: 3, fn: windowedSincFilter(3, SINC_WINDOWS.parzen) },
};

// sRGB <-> linear light lookup tables, for gamma correct resampling
const SRGB_TO_LINEAR_TABLE = new Float32Array(256);
for (let i = 0; i < 256; i++) {
    const c = i / 255;
    SRGB_TO_LINEAR_TABLE[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSRGB(value) {
    if (value <= 0) {
        return 0;
    } else if (value >= 1) {
        return 255;
    }
    const c = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
    return Math.round(c * 255);
}

// Precompute the contributing source pixels and normalized weights for each output coordinate.
// When downscaling, the filter is stretched by the scale factor so that it acts as a low pass filter.
function computeResamplingWeights(inputSize, outputSize, filter) {
    const scale = inputSize / outputSize;
    const filterScale = Math.max(1, scale);
    const support = filter.support * filterScale;
    const starts = new Int32Array(outputSize);
    const counts = new Int32Array(outputSize);
    const weightsPerOutput = [];

    for (let i = 0; i < outputSize; i++) {
        const center = (i + 0.5) * scale;
        const start = Math.max(0, Math.floor(center - support));
        const end = Math.min(inputSize, Math.ceil(center + support));
        const weights = [];
        let total = 0;
        for (let j = start; j < end; j++) {
            const weight = filter.fn((j + 0.5 - center) / filterScale);
            weights.push(weight);
            total += weight;
        }
        if (total === 0) {
            // can happen with a box filter when upscaling; fall back to nearest pixel
            const nearest = Math.min(inputSize - 1, Math.max(0, Math.floor(center)));
            starts[i] = nearest;
            counts[i] = 1;
            weightsPerOutput.push(new Float64Array([1]));
            continue;
        }
        starts[i] = start;
        counts[i] = weights.length;
        weightsPerOutput.push(new Float64Array(weights.map((weight) => weight / total)));
    }
    return { starts, counts, weightsPerOutput };
}

function resizeImagePixelsWithFilter(inputPixels, inputWidth, outputWidth, outputHeight, filter, linearLight) {
    const inputHeight = Math.round(inputPixels.length / 4 / inputWidth);

    // Convert input into a float buffer of 3 channels
    const source = new Float32Array(inputWidth * inputHeight * 3);
    for (let i = 0, j = 0; i < inputPixels.length; i += 4, j += 3) {
        for (let c = 0; c < 3; c++) {
            source[j + c] = linearLight ? SRGB_TO_LINEAR_TABLE[inputPixels[i + c]] : inputPixels[i + c];
        }
    }

    // Horizontal pass
    const horizontal = computeResamplingWeights(inputWidth, outputWidth, filter);
    const intermediate = new Float32Array(outputWidth * inputHeight * 3);
    for (let y = 0; y < inputHeight; y++) {
        const rowOffset = y * inputWidth;
        for (let x = 0; x < outputWidth; x++) {
            const start = horizontal.starts[x];
            const count = horizontal.counts[x];
            const weights = horizontal.weightsPerOutput[x];
            let r = 0;
            let g = 0;
            let b = 0;
            for (let k = 0; k < count; k++) {
                const index = (rowOffset + start + k) * 3;
                const weight = weights[k];
                r += source[index] * weight;
                g += source[index + 1] * weight;
                b += source[index + 2] * weight;
            }
            const outIndex = (y * outputWidth + x) * 3;
            intermediate[outIndex] = r;
            intermediate[outIndex + 1] = g;
            intermediate[outIndex + 2] = b;
        }
    }

    // Vertical pass
    const vertical = computeResamplingWeights(inputHeight, outputHeight, filter);
    const result = new Uint8ClampedArray(outputWidth * outputHeight * 4);
    for (let y = 0; y < outputHeight; y++) {
        const start = vertical.starts[y];
        const count = vertical.counts[y];
        const weights = vertical.weightsPerOutput[y];
        for (let x = 0; x < outputWidth; x++) {
            let r = 0;
            let g = 0;
            let b = 0;
            for (let k = 0; k < count; k++) {
                const index = ((start + k) * outputWidth + x) * 3;
                const weight = weights[k];
                r += intermediate[index] * weight;
                g += intermediate[index + 1] * weight;
                b += intermediate[index + 2] * weight;
            }
            const outIndex = (y * outputWidth + x) * 4;
            if (linearLight) {
                result[outIndex] = linearToSRGB(r);
                result[outIndex + 1] = linearToSRGB(g);
                result[outIndex + 2] = linearToSRGB(b);
            } else {
                result[outIndex] = Math.round(r);
                result[outIndex + 1] = Math.round(g);
                result[outIndex + 2] = Math.round(b);
            }
            result[outIndex + 3] = 255;
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Point sampling
// ---------------------------------------------------------------------------

// Samples a single source pixel per output pixel. offset is the relative position (0 to 1)
// inside the source region covered by each output pixel (0.5 = center)
function resizeImagePixelsWithPointSampling(inputPixels, inputWidth, outputWidth, outputHeight, offsetX, offsetY) {
    const inputHeight = Math.round(inputPixels.length / 4 / inputWidth);
    const result = new Uint8ClampedArray(outputWidth * outputHeight * 4);
    for (let y = 0; y < outputHeight; y++) {
        const sourceY = Math.min(inputHeight - 1, Math.floor(((y + offsetY) * inputHeight) / outputHeight));
        for (let x = 0; x < outputWidth; x++) {
            const sourceX = Math.min(inputWidth - 1, Math.floor(((x + offsetX) * inputWidth) / outputWidth));
            const inIndex = (sourceY * inputWidth + sourceX) * 4;
            const outIndex = (y * outputWidth + x) * 4;
            result[outIndex] = inputPixels[inIndex];
            result[outIndex + 1] = inputPixels[inIndex + 1];
            result[outIndex + 2] = inputPixels[inIndex + 2];
            result[outIndex + 3] = 255;
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Additional pooling kernels, for use with resizeImagePixelsWithAdaptivePooling
// Each kernel takes a list of [r, g, b] pixels and returns a single [r, g, b] pixel
// ---------------------------------------------------------------------------

function pixelLuminance(pixel) {
    return 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2];
}

function channelMedian(values) {
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    return values.length % 2 === 1 ? values[mid] : Math.round((values[mid - 1] + values[mid]) / 2);
}

function medianPoolingKernel(inputPixels) {
    return [0, 1, 2].map((channel) => channelMedian(inputPixels.map((pixel) => pixel[channel])));
}

function modePoolingKernel(inputPixels) {
    // most common exact color in the region; ties are broken by first occurence
    const counts = new Map();
    let best = inputPixels[0];
    let bestCount = 0;
    inputPixels.forEach((pixel) => {
        const key = (pixel[0] << 16) | (pixel[1] << 8) | pixel[2];
        const count = (counts.get(key) || 0) + 1;
        counts.set(key, count);
        if (count > bestCount) {
            bestCount = count;
            best = pixel;
        }
    });
    return [best[0], best[1], best[2]];
}

function quantizedModePoolingKernel(inputPixels) {
    // most common color bucket (5 bits per channel), returning the average of that bucket
    // this is more robust than exact mode for photos with noise
    const buckets = new Map();
    let bestKey = null;
    let bestCount = 0;
    inputPixels.forEach((pixel) => {
        const key = ((pixel[0] >> 3) << 10) | ((pixel[1] >> 3) << 5) | (pixel[2] >> 3);
        let bucket = buckets.get(key);
        if (!bucket) {
            bucket = [0, 0, 0, 0];
            buckets.set(key, bucket);
        }
        bucket[0] += pixel[0];
        bucket[1] += pixel[1];
        bucket[2] += pixel[2];
        bucket[3]++;
        if (bucket[3] > bestCount) {
            bestCount = bucket[3];
            bestKey = key;
        }
    });
    const bucket = buckets.get(bestKey);
    return [0, 1, 2].map((channel) => Math.round(bucket[channel] / bucket[3]));
}

function midrangePoolingKernel(inputPixels) {
    const max = maxPoolingKernel(inputPixels);
    const min = minPoolingKernel(inputPixels);
    return [0, 1, 2].map((channel) => Math.round((max[channel] + min[channel]) / 2));
}

function geometricMeanPoolingKernel(inputPixels) {
    const logSum = [0, 0, 0];
    inputPixels.forEach((pixel) => {
        for (let c = 0; c < 3; c++) {
            logSum[c] += Math.log(pixel[c] + 1);
        }
    });
    return logSum.map((sum) => Math.round(Math.exp(sum / inputPixels.length) - 1));
}

function harmonicMeanPoolingKernel(inputPixels) {
    const inverseSum = [0, 0, 0];
    inputPixels.forEach((pixel) => {
        for (let c = 0; c < 3; c++) {
            inverseSum[c] += 1 / (pixel[c] + 1);
        }
    });
    return inverseSum.map((sum) => Math.round(inputPixels.length / sum - 1));
}

function rootMeanSquarePoolingKernel(inputPixels) {
    const squareSum = [0, 0, 0];
    inputPixels.forEach((pixel) => {
        for (let c = 0; c < 3; c++) {
            squareSum[c] += pixel[c] * pixel[c];
        }
    });
    return squareSum.map((sum) => Math.round(Math.sqrt(sum / inputPixels.length)));
}

function linearLightAvgPoolingKernel(inputPixels) {
    const sum = [0, 0, 0];
    inputPixels.forEach((pixel) => {
        for (let c = 0; c < 3; c++) {
            sum[c] += SRGB_TO_LINEAR_TABLE[pixel[c]];
        }
    });
    return sum.map((channel) => linearToSRGB(channel / inputPixels.length));
}

function trimmedMeanPoolingKernel(inputPixels) {
    // mean of each channel, ignoring the top and bottom 25% of values
    return [0, 1, 2].map((channel) => {
        const values = inputPixels.map((pixel) => pixel[channel]).sort((a, b) => a - b);
        const trim = Math.floor(values.length / 4);
        const kept = values.length - 2 * trim > 0 ? values.slice(trim, values.length - trim) : values;
        return Math.round(kept.reduce((a, b) => a + b, 0) / kept.length);
    });
}

function sortedByLuminance(inputPixels) {
    return inputPixels
        .map((pixel) => [pixelLuminance(pixel), pixel])
        .sort((a, b) => a[0] - b[0])
        .map((entry) => entry[1]);
}

function luminanceMedianPoolingKernel(inputPixels) {
    // picks an actual pixel from the region, the one with median brightness
    const sorted = sortedByLuminance(inputPixels);
    const pixel = sorted[Math.floor(sorted.length / 2)];
    return [pixel[0], pixel[1], pixel[2]];
}

function darkestPixelPoolingKernel(inputPixels) {
    let best = inputPixels[0];
    let bestLuminance = Infinity;
    inputPixels.forEach((pixel) => {
        const luminance = pixelLuminance(pixel);
        if (luminance < bestLuminance) {
            bestLuminance = luminance;
            best = pixel;
        }
    });
    return [best[0], best[1], best[2]];
}

function brightestPixelPoolingKernel(inputPixels) {
    let best = inputPixels[0];
    let bestLuminance = -Infinity;
    inputPixels.forEach((pixel) => {
        const luminance = pixelLuminance(pixel);
        if (luminance > bestLuminance) {
            bestLuminance = luminance;
            best = pixel;
        }
    });
    return [best[0], best[1], best[2]];
}

function mostSaturatedPixelPoolingKernel(inputPixels) {
    let best = inputPixels[0];
    let bestSaturation = -Infinity;
    inputPixels.forEach((pixel) => {
        const max = Math.max(pixel[0], pixel[1], pixel[2]);
        const min = Math.min(pixel[0], pixel[1], pixel[2]);
        const saturation = max === 0 ? 0 : (max - min) / max;
        if (saturation > bestSaturation) {
            bestSaturation = saturation;
            best = pixel;
        }
    });
    return [best[0], best[1], best[2]];
}

function medoidPoolingKernel(inputPixels) {
    // picks the actual pixel from the region closest to the average color
    const avg = avgPoolingKernel(inputPixels);
    let best = inputPixels[0];
    let bestDistance = Infinity;
    inputPixels.forEach((pixel) => {
        const distance =
            (pixel[0] - avg[0]) * (pixel[0] - avg[0]) +
            (pixel[1] - avg[1]) * (pixel[1] - avg[1]) +
            (pixel[2] - avg[2]) * (pixel[2] - avg[2]);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = pixel;
        }
    });
    return [best[0], best[1], best[2]];
}

function contrastPoolingKernel(inputPixels) {
    // picks whichever of the darkest and brightest pixels is further from the average,
    // preserving fine details such as outlines and highlights
    const avgLuminance = pixelLuminance(avgPoolingKernel(inputPixels));
    const darkest = darkestPixelPoolingKernel(inputPixels);
    const brightest = brightestPixelPoolingKernel(inputPixels);
    return avgLuminance - pixelLuminance(darkest) > pixelLuminance(brightest) - avgLuminance ? darkest : brightest;
}

// ---------------------------------------------------------------------------
// Pixel art upscalers
// These enlarge the image by an integer factor while preserving hard edges.
// They are applied repeatedly until the image is at least as large as the target,
// then the result is scaled to the exact target size.
// ---------------------------------------------------------------------------

function pixelArtUpscaleHelper(inputPixels, inputWidth, factor, computeBlock) {
    const inputHeight = Math.round(inputPixels.length / 4 / inputWidth);
    const outputWidth = inputWidth * factor;
    const result = new Uint8ClampedArray(outputWidth * inputHeight * factor * 4);
    // Packed 24 bit colors for fast equality checks
    const packed = new Int32Array(inputWidth * inputHeight);
    for (let i = 0; i < packed.length; i++) {
        packed[i] = (inputPixels[4 * i] << 16) | (inputPixels[4 * i + 1] << 8) | inputPixels[4 * i + 2];
    }
    const get = (x, y) => {
        x = Math.min(inputWidth - 1, Math.max(0, x));
        y = Math.min(inputHeight - 1, Math.max(0, y));
        return packed[y * inputWidth + x];
    };
    for (let y = 0; y < inputHeight; y++) {
        for (let x = 0; x < inputWidth; x++) {
            const block = computeBlock(get, x, y);
            for (let by = 0; by < factor; by++) {
                for (let bx = 0; bx < factor; bx++) {
                    const color = block[by * factor + bx];
                    const outIndex = ((y * factor + by) * outputWidth + x * factor + bx) * 4;
                    result[outIndex] = (color >> 16) & 255;
                    result[outIndex + 1] = (color >> 8) & 255;
                    result[outIndex + 2] = color & 255;
                    result[outIndex + 3] = 255;
                }
            }
        }
    }
    return { pixels: result, width: outputWidth };
}

// EPX / Scale2x / AdvMAME2x
function scale2xUpscale(inputPixels, inputWidth) {
    return pixelArtUpscaleHelper(inputPixels, inputWidth, 2, (get, x, y) => {
        const p = get(x, y);
        const a = get(x, y - 1);
        const b = get(x + 1, y);
        const c = get(x - 1, y);
        const d = get(x, y + 1);
        if (c !== b && a !== d) {
            return [c === a ? c : p, a === b ? b : p, d === c ? c : p, b === d ? d : p];
        }
        return [p, p, p, p];
    });
}

// Scale3x / AdvMAME3x
function scale3xUpscale(inputPixels, inputWidth) {
    return pixelArtUpscaleHelper(inputPixels, inputWidth, 3, (get, x, y) => {
        const a = get(x - 1, y - 1);
        const b = get(x, y - 1);
        const c = get(x + 1, y - 1);
        const d = get(x - 1, y);
        const e = get(x, y);
        const f = get(x + 1, y);
        const g = get(x - 1, y + 1);
        const h = get(x, y + 1);
        const i = get(x + 1, y + 1);
        if (b !== h && d !== f) {
            return [
                d === b ? d : e,
                (d === b && e !== c) || (b === f && e !== a) ? b : e,
                b === f ? f : e,
                (d === b && e !== g) || (d === h && e !== a) ? d : e,
                e,
                (b === f && e !== i) || (h === f && e !== c) ? f : e,
                d === h ? d : e,
                (d === h && e !== i) || (h === f && e !== g) ? h : e,
                h === f ? f : e,
            ];
        }
        return [e, e, e, e, e, e, e, e, e];
    });
}

// Eagle
function eagleUpscale(inputPixels, inputWidth) {
    return pixelArtUpscaleHelper(inputPixels, inputWidth, 2, (get, x, y) => {
        const s = get(x - 1, y - 1);
        const t = get(x, y - 1);
        const u = get(x + 1, y - 1);
        const v = get(x - 1, y);
        const c = get(x, y);
        const w = get(x + 1, y);
        const xx = get(x - 1, y + 1);
        const yy = get(x, y + 1);
        const z = get(x + 1, y + 1);
        return [
            v === s && s === t ? s : c,
            t === u && u === w ? u : c,
            v === xx && xx === yy ? xx : c,
            w === z && z === yy ? z : c,
        ];
    });
}

function resizeImagePixelsWithPixelArtUpscaler(inputPixels, inputWidth, outputWidth, outputHeight, upscaler) {
    let pixels = inputPixels;
    let width = inputWidth;
    let height = Math.round(inputPixels.length / 4 / inputWidth);
    // Cap the intermediate size to avoid running out of memory on large inputs
    const maxIntermediatePixels = 4096 * 4096;
    while ((width < outputWidth || height < outputHeight) && width * height * 9 <= maxIntermediatePixels) {
        const upscaled = upscaler(pixels, width);
        pixels = upscaled.pixels;
        height = (height * upscaled.width) / width;
        width = upscaled.width;
    }
    if (width === outputWidth && height === outputHeight) {
        return pixels;
    }
    // nearest neighbor keeps the hard edges and exact colors produced by the upscaler
    return resizeImagePixelsWithPointSampling(pixels, width, outputWidth, outputHeight, 0.5, 0.5);
}

// ---------------------------------------------------------------------------
// Registry of all available algorithms, used to build the UI dropdown
// ---------------------------------------------------------------------------

// Each entry has a name, a value, a group, and one of:
//   - canvasSmoothing: rescale using the browser's canvas drawImage
//   - filter (+ optional linearLight): separable convolution filter from RESAMPLING_FILTERS
//   - poolingKernel: function applied to each source region with adaptive pooling
//   - pointOffset: [x, y] relative sampling point in each source region
//   - upscaler: pixel art upscaler function
const INTERPOLATION_ALGORITHM_GROUPS = [
    {
        name: "Browser",
        algorithms: [
            { name: "Browser Default", value: "default", canvasSmoothing: null },
            { name: "Browser Smooth (Low Quality)", value: "browserLow", canvasSmoothing: "low" },
            { name: "Browser Smooth (Medium Quality)", value: "browserMedium", canvasSmoothing: "medium" },
            { name: "Browser Smooth (High Quality)", value: "browserHigh", canvasSmoothing: "high" },
        ],
    },
    {
        name: "Point Sampling",
        algorithms: [
            { name: "Nearest Neighbor (Center)", value: "nearestCenter", pointOffset: [0.5, 0.5] },
            { name: "Nearest Neighbor (Top Left)", value: "nearestTopLeft", pointOffset: [0, 0] },
            { name: "Nearest Neighbor (Bottom Right)", value: "nearestBottomRight", pointOffset: [0.999, 0.999] },
        ],
    },
    {
        name: "Linear & Cubic",
        algorithms: [
            { name: "Box / Area", value: "box", filter: "box" },
            { name: "Bilinear", value: "bilinear", filter: "triangle" },
            { name: "Hermite", value: "hermite", filter: "hermite" },
            { name: "Cosine", value: "cosineInterp", filter: "cosineInterp" },
            { name: "Quadratic", value: "quadratic", filter: "quadratic" },
            { name: "Bicubic (Catmull-Rom)", value: "catmullRom", filter: "catmullRom" },
            { name: "Bicubic (Sharp, a = -0.75)", value: "keysSharp", filter: "keysSharp" },
            { name: "Mitchell-Netravali", value: "mitchell", filter: "mitchell" },
            { name: "Cubic B-Spline", value: "bSpline", filter: "bSpline" },
            { name: "Robidoux", value: "robidoux", filter: "robidoux" },
            { name: "Robidoux Sharp", value: "robidouxSharp", filter: "robidouxSharp" },
            { name: "Spline16", value: "spline16", filter: "spline16" },
            { name: "Spline36", value: "spline36", filter: "spline36" },
            { name: "Gaussian", value: "gaussian", filter: "gaussian" },
        ],
    },
    {
        name: "Windowed Sinc",
        algorithms: [
            { name: "Lanczos2", value: "lanczos2", filter: "lanczos2" },
            { name: "Lanczos3", value: "lanczos3", filter: "lanczos3" },
            { name: "Lanczos4", value: "lanczos4", filter: "lanczos4" },
            { name: "Lanczos5", value: "lanczos5", filter: "lanczos5" },
            { name: "Hann", value: "hann", filter: "hann" },
            { name: "Hamming", value: "hamming", filter: "hamming" },
            { name: "Blackman", value: "blackman", filter: "blackman" },
            { name: "Kaiser", value: "kaiser", filter: "kaiser" },
            { name: "Welch", value: "welch", filter: "welch" },
            { name: "Cosine Windowed", value: "cosine", filter: "cosine" },
            { name: "Bartlett", value: "bartlett", filter: "bartlett" },
            { name: "Bohman", value: "bohman", filter: "bohman" },
            { name: "Parzen", value: "parzen", filter: "parzen" },
        ],
    },
    {
        name: "Gamma Correct (Linear Light)",
        algorithms: [
            { name: "Box / Area (Linear Light)", value: "boxLinear", filter: "box", linearLight: true },
            { name: "Bilinear (Linear Light)", value: "bilinearLinear", filter: "triangle", linearLight: true },
            { name: "Catmull-Rom (Linear Light)", value: "catmullRomLinear", filter: "catmullRom", linearLight: true },
            { name: "Mitchell (Linear Light)", value: "mitchellLinear", filter: "mitchell", linearLight: true },
            { name: "Lanczos3 (Linear Light)", value: "lanczos3Linear", filter: "lanczos3", linearLight: true },
        ],
    },
    {
        name: "Pooling",
        algorithms: [
            { name: "Average Pooling", value: "avgPooling", poolingKernel: avgPoolingKernel },
            { name: "Dual Min Max Pooling", value: "dualMinMaxPooling", poolingKernel: dualMinMaxPoolingKernel },
            { name: "Min Pooling", value: "minPooling", poolingKernel: minPoolingKernel },
            { name: "Max Pooling", value: "maxPooling", poolingKernel: maxPoolingKernel },
            { name: "Median Pooling", value: "medianPooling", poolingKernel: medianPoolingKernel },
            { name: "Mode Pooling (Most Common Color)", value: "modePooling", poolingKernel: modePoolingKernel },
            {
                name: "Quantized Mode Pooling",
                value: "quantizedModePooling",
                poolingKernel: quantizedModePoolingKernel,
            },
            { name: "Midrange Pooling", value: "midrangePooling", poolingKernel: midrangePoolingKernel },
            { name: "Trimmed Mean Pooling", value: "trimmedMeanPooling", poolingKernel: trimmedMeanPoolingKernel },
            {
                name: "Geometric Mean Pooling",
                value: "geometricMeanPooling",
                poolingKernel: geometricMeanPoolingKernel,
            },
            {
                name: "Harmonic Mean Pooling",
                value: "harmonicMeanPooling",
                poolingKernel: harmonicMeanPoolingKernel,
            },
            {
                name: "Root Mean Square Pooling",
                value: "rootMeanSquarePooling",
                poolingKernel: rootMeanSquarePoolingKernel,
            },
            {
                name: "Linear Light Average Pooling",
                value: "linearLightAvgPooling",
                poolingKernel: linearLightAvgPoolingKernel,
            },
        ],
    },
    {
        name: "Representative Pixel Pooling",
        algorithms: [
            { name: "Medoid (Closest to Average)", value: "medoidPooling", poolingKernel: medoidPoolingKernel },
            {
                name: "Median Brightness Pixel",
                value: "luminanceMedianPooling",
                poolingKernel: luminanceMedianPoolingKernel,
            },
            { name: "Darkest Pixel", value: "darkestPixelPooling", poolingKernel: darkestPixelPoolingKernel },
            { name: "Brightest Pixel", value: "brightestPixelPooling", poolingKernel: brightestPixelPoolingKernel },
            {
                name: "Most Saturated Pixel",
                value: "mostSaturatedPixelPooling",
                poolingKernel: mostSaturatedPixelPoolingKernel,
            },
            { name: "Contrast Preserving Pixel", value: "contrastPooling", poolingKernel: contrastPoolingKernel },
        ],
    },
    {
        name: "Pixel Art Upscalers",
        algorithms: [
            { name: "Scale2x / EPX", value: "scale2x", upscaler: scale2xUpscale },
            { name: "Scale3x", value: "scale3x", upscaler: scale3xUpscale },
            { name: "Eagle", value: "eagle", upscaler: eagleUpscale },
        ],
    },
];

const INTERPOLATION_ALGORITHMS = [];
INTERPOLATION_ALGORITHM_GROUPS.forEach((group) => {
    group.algorithms.forEach((algorithm) => {
        INTERPOLATION_ALGORITHMS.push(algorithm);
    });
});

function getInterpolationAlgorithm(value) {
    return INTERPOLATION_ALGORITHMS.find((algorithm) => algorithm.value === value) || INTERPOLATION_ALGORITHMS[0];
}

// Resizes raw cropped RGBA pixels (not used for canvasSmoothing algorithms, which are handled by the cropper)
function resizeImagePixelsWithAlgorithm(inputPixels, inputWidth, outputWidth, outputHeight, algorithm) {
    if (algorithm.filter) {
        return resizeImagePixelsWithFilter(
            inputPixels,
            inputWidth,
            outputWidth,
            outputHeight,
            RESAMPLING_FILTERS[algorithm.filter],
            !!algorithm.linearLight
        );
    } else if (algorithm.pointOffset) {
        return resizeImagePixelsWithPointSampling(
            inputPixels,
            inputWidth,
            outputWidth,
            outputHeight,
            algorithm.pointOffset[0],
            algorithm.pointOffset[1]
        );
    } else if (algorithm.upscaler) {
        return resizeImagePixelsWithPixelArtUpscaler(
            inputPixels,
            inputWidth,
            outputWidth,
            outputHeight,
            algorithm.upscaler
        );
    }
    return resizeImagePixelsWithAdaptivePooling(
        inputPixels,
        inputWidth,
        outputWidth,
        outputHeight,
        algorithm.poolingKernel
    );
}
