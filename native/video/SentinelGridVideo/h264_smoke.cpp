#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mfapi.h>
#include <cstdio>
#include <cstring>
#include <vector>

struct SGEncodedFrame { unsigned long long sequence, captureMicroseconds, encodeMicroseconds; unsigned long payloadSize, flags; };
struct SGEncoderInfo { char name[256]; unsigned long hardware, forceKeyframeSupported, inputMode; };
struct SGDecodedFrame { unsigned long long sequence, decodeMicroseconds; unsigned long width, height, stride, payloadSize; };
struct SGDecoderStats { unsigned long long submittedAccessUnits, decodedFrames, bytes, failures, processInputNotAccepting, processOutputOK, needMoreInput, streamChanges, discardedOutputFrames; unsigned long width, height; };
typedef HRESULT (WINAPI *CreateEncoder)(unsigned long, unsigned long, unsigned long, unsigned long, void**);
typedef void (WINAPI *Destroy)(void*);
typedef HRESULT (WINAPI *Encode)(void*, const unsigned char*, unsigned long, unsigned long long, unsigned long long, unsigned char*, unsigned long, SGEncodedFrame*);
typedef HRESULT (WINAPI *Force)(void*);
typedef HRESULT (WINAPI *EncoderInfo)(void*, SGEncoderInfo*);
typedef HRESULT (WINAPI *CreateDecoder)(unsigned long, unsigned long, unsigned long, void**);
typedef HRESULT (WINAPI *Decode)(void*, const unsigned char*, unsigned long, unsigned long long, unsigned char*, unsigned long, SGDecodedFrame*);
typedef HRESULT (WINAPI *Drain)(void*, unsigned long long, unsigned char*, unsigned long, SGDecodedFrame*);
typedef HRESULT (WINAPI *DecoderStats)(void*, SGDecoderStats*);

bool ContainsNAL(const unsigned char* data, unsigned long length, unsigned char type) {
    for (unsigned long i = 0; i + 4 < length; ++i) {
        unsigned long at = length;
        if (data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1) at = i + 3;
        else if (data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 0 && data[i + 3] == 1) at = i + 4;
        if (at < length && (data[at] & 0x1f) == type) return true;
    }
    return false;
}

int main() {
    constexpr unsigned long width = 1920, height = 1080, fps = 30, bitrate = 8000000;
    HRESULT startup = MFStartup(MF_VERSION, MFSTARTUP_LITE);
    if (FAILED(startup)) { std::printf("MFSTARTUP=0x%08lx\n", startup); return 1; }
    HMODULE dll = LoadLibraryW(L"SentinelGridVideo.dll");
    if (!dll) { std::printf("DLL_LOAD_FAILED=%lu\n", GetLastError()); MFShutdown(); return 2; }
    auto createEncoder = reinterpret_cast<CreateEncoder>(GetProcAddress(dll, "SGVideo_CreateH264Encoder"));
    auto destroyEncoder = reinterpret_cast<Destroy>(GetProcAddress(dll, "SGVideo_DestroyH264Encoder"));
    auto encode = reinterpret_cast<Encode>(GetProcAddress(dll, "SGVideo_EncodeBGRAToH264"));
    auto force = reinterpret_cast<Force>(GetProcAddress(dll, "SGVideo_ForceH264Keyframe"));
    auto encoderInfo = reinterpret_cast<EncoderInfo>(GetProcAddress(dll, "SGVideo_GetH264EncoderInfo"));
    auto createDecoder = reinterpret_cast<CreateDecoder>(GetProcAddress(dll, "SGVideo_CreateH264Decoder"));
    auto destroyDecoder = reinterpret_cast<Destroy>(GetProcAddress(dll, "SGVideo_DestroyH264Decoder"));
    auto decode = reinterpret_cast<Decode>(GetProcAddress(dll, "SGVideo_DecodeH264ToBGRA"));
    auto drain = reinterpret_cast<Drain>(GetProcAddress(dll, "SGVideo_DrainH264Decoder"));
    auto decoderStats = reinterpret_cast<DecoderStats>(GetProcAddress(dll, "SGVideo_GetH264DecoderStats"));
    if (!createEncoder || !destroyEncoder || !encode || !force || !encoderInfo || !createDecoder || !destroyDecoder || !decode || !drain || !decoderStats) {
        std::printf("DLL_EXPORT_MISSING\n"); FreeLibrary(dll); MFShutdown(); return 3;
    }
    void* encoder = nullptr;
    void* decoder = nullptr;
    HRESULT hr = createEncoder(width, height, fps, bitrate, &encoder);
    if (FAILED(hr)) { std::printf("ENCODER_CREATE=0x%08lx\n", hr); FreeLibrary(dll); MFShutdown(); return 4; }
    hr = createDecoder(width, height, fps, &decoder);
    if (FAILED(hr)) { std::printf("DECODER_CREATE=0x%08lx\n", hr); destroyEncoder(encoder); FreeLibrary(dll); MFShutdown(); return 5; }
    SGEncoderInfo info{};
    encoderInfo(encoder, &info);
    std::printf("ENCODER_NAME=%s\n", info.name);
    std::vector<unsigned char> bgra(static_cast<size_t>(width) * height * 4);
    std::vector<unsigned char> encoded(8 * 1024 * 1024);
    std::vector<unsigned char> decoded(static_cast<size_t>(width) * height * 4);
    unsigned long encodedAUs = 0, deliveredFrames = 0;
    bool recoveryIDR = false;
    HRESULT forced = E_FAIL;
    unsigned long outputWidth = 0, outputHeight = 0;
    for (unsigned long long i = 0; i < 180; ++i) {
        for (size_t pixel = 0; pixel < bgra.size(); pixel += 4) {
            bgra[pixel] = static_cast<unsigned char>(i);
            bgra[pixel + 1] = static_cast<unsigned char>(i * 3);
            bgra[pixel + 2] = static_cast<unsigned char>(i * 7);
            bgra[pixel + 3] = 255;
        }
        SGEncodedFrame au{};
        hr = encode(encoder, bgra.data(), width * 4, i, i * 33333, encoded.data(), static_cast<unsigned long>(encoded.size()), &au);
        if (FAILED(hr)) { std::printf("ENCODE_FAILED=0x%08lx\n", hr); break; }
        if (i == 60) forced = force(encoder);
        if (hr != S_OK || !au.payloadSize) continue;
        ++encodedAUs;
        if (i > 60 && ContainsNAL(encoded.data(), au.payloadSize, 5)) recoveryIDR = true;
        SGDecodedFrame frame{};
        hr = decode(decoder, encoded.data(), au.payloadSize, au.sequence, decoded.data(), static_cast<unsigned long>(decoded.size()), &frame);
        if (FAILED(hr)) { std::printf("DECODE_FAILED=0x%08lx\n", hr); break; }
        if (hr == S_OK) { ++deliveredFrames; outputWidth = frame.width; outputHeight = frame.height; }
    }
    for (unsigned long long sequence = 180; sequence < 240; ++sequence) {
        SGDecodedFrame frame{};
        hr = drain(decoder, sequence, decoded.data(), static_cast<unsigned long>(decoded.size()), &frame);
        if (FAILED(hr)) { std::printf("DRAIN_FAILED=0x%08lx\n", hr); break; }
        if (hr != S_OK) break;
        ++deliveredFrames;
        outputWidth = frame.width;
        outputHeight = frame.height;
    }
    SGDecoderStats stats{};
    decoderStats(decoder, &stats);
    std::printf("ENCODED_AUS=%lu\nDECODED_FRAMES=%llu\nDELIVERED_FRAMES=%lu\nPROCESS_OUTPUT_OK=%llu\nNOT_ACCEPTING_COUNT=%llu\nNEED_MORE_INPUT=%llu\nSTREAM_CHANGE_COUNT=%llu\nDISCARDED_OUTPUT_FRAMES=%llu\nOUTPUT_WIDTH=%lu\nOUTPUT_HEIGHT=%lu\nFORCE_KEYFRAME_CALL_OK=%s\nRECOVERY_IDR_FOUND=%s\n", encodedAUs, stats.decodedFrames, deliveredFrames, stats.processOutputOK, stats.processInputNotAccepting, stats.needMoreInput, stats.streamChanges, stats.discardedOutputFrames, outputWidth, outputHeight, SUCCEEDED(forced) ? "true" : "false", recoveryIDR ? "true" : "false");
    destroyDecoder(decoder);
    destroyEncoder(encoder);
    FreeLibrary(dll);
    MFShutdown();
    return encodedAUs && stats.decodedFrames && stats.processOutputOK && !stats.discardedOutputFrames && outputWidth == width && outputHeight == height && SUCCEEDED(forced) && recoveryIDR ? 0 : 6;
}
