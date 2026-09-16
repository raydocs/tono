// Liquid orb hero. UI only; no runtime impact.
//
// stitchable shader driven by QuietField via colorEffect. Ports the approved
// web-prototype warp + lighting: domain-warped swirl ridges perturb the sphere
// normal, lit by a key light (tight + broad specular) and a fill light, with a
// fresnel rim and bottom depth. `alignment` gates ridge energy so Ready stays
// calm; `time` freezes with the QuietField clock on pause / Reduce Motion.
#include <metal_stdlib>
using namespace metal;

float orbHash(float2 p) {
    return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

float orbNoise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(orbHash(i), orbHash(i + float2(1.0, 0.0)), f.x),
               mix(orbHash(i + float2(0.0, 1.0)), orbHash(i + float2(1.0, 1.0)), f.x), f.y);
}

float orbFbm(float2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * orbNoise(p);
        p *= 2.03;
        a *= 0.5;
    }
    return v;
}

float orbWarp(float2 p, float t) {
    float2 w = float2(orbFbm(p + float2(t * 0.10, -t * 0.07)),
                      orbFbm(p + float2(4.7, 1.3) + float2(-t * 0.08, t * 0.11)));
    return orbFbm(p + 1.7 * w + float2(0.0, t * 0.05));
}

[[ stitchable ]] half4 liquidOrb(float2 position, half4 color, float time, float alignment, float2 size) {
    float2 uv = (position - size * 0.5) / size.y;
    float2 c = float2(0.0, 0.015);
    float R = 0.46;
    float d = length(uv - c);
    float px = 1.5 / size.y;
    float alpha = 1.0 - smoothstep(R - px, R + px, d);
    if (alpha < 0.004) {
        return half4(0.0);
    }
    float2 q = (uv - c) / R;
    float rr = length(q);
    float z = sqrt(max(0.0, 1.0 - rr * rr));
    float3 N = normalize(float3(q, z));
    float2 p = q * 2.3 + 3.1;
    float m = orbWarp(p, time);
    float mx = orbWarp(p + float2(0.09, 0.0), time);
    float my = orbWarp(p + float2(0.0, 0.09), time);
    float ridge = pow(1.0 - abs(sin(m * 6.0 + dot(q, float2(1.4, -0.6)) * 1.2)), 8.0);
    N.xy += float2(mx - m, my - m) * 3.2;
    N = normalize(N);
    float3 L1 = normalize(float3(-0.45, 0.75, 0.62));
    float3 L2 = normalize(float3(0.65, -0.25, 0.45));
    float3 V = float3(0.0, 0.0, 1.0);
    float dif = max(dot(N, L1), 0.0);
    float3 base = mix(float3(0.11, 0.17, 0.66), float3(0.38, 0.58, 1.0), 0.5 + 0.5 * N.y);
    float3 col = base * (0.32 + 0.85 * dif);
    col += float3(0.65, 0.78, 1.0) * pow(max(dot(N, normalize(L2 + V)), 0.0), 14.0) * 0.5;
    col += float3(1.0) * pow(max(dot(N, normalize(L1 + V)), 0.0), 120.0) * 1.6;
    col += float3(1.0) * pow(max(dot(N, normalize(L1 + V)), 0.0), 8.0) * 0.28;
    col += float3(0.92, 0.96, 1.0) * ridge * (0.18 + 0.82 * dif) * 0.9;
    float fr = pow(1.0 - max(N.z, 0.0), 2.5);
    col += float3(0.55, 0.66, 1.0) * fr * 0.85;
    col *= mix(0.72, 1.06, smoothstep(-1.0, 0.7, N.y));
    col = mix(col * 0.85, col, 0.35 + 0.65 * alignment);
    return half4(half3(col), half(alpha * color.a));
}
