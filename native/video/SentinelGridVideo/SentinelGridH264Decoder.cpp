#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mftransform.h>
#include <mferror.h>
#include <wrl/client.h>
#include <cstdio>
#include <cstring>
#include <memory>
#include <new>
#include <string>

#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "ole32.lib")

using Microsoft::WRL::ComPtr;

extern "C" {
struct SGDecodedFrame { UINT64 sequence, decodeMicroseconds; UINT32 width, height, stride, payloadSize; };
struct SGDecoderStats { UINT64 submittedAccessUnits, decodedFrames, bytes, failures; UINT32 width, height; };
struct SGDecoderInfo { char name[256]; UINT32 hardware, outputMode; };
__declspec(dllexport) HRESULT WINAPI SGVideo_CreateH264Decoder(UINT32, UINT32, UINT32, void**);
__declspec(dllexport) void WINAPI SGVideo_DestroyH264Decoder(void*);
__declspec(dllexport) HRESULT WINAPI SGVideo_DecodeH264ToBGRA(void*, const BYTE*, UINT32, UINT64, BYTE*, UINT32, SGDecodedFrame*);
__declspec(dllexport) HRESULT WINAPI SGVideo_GetH264DecoderStats(void*, SGDecoderStats*);
__declspec(dllexport) HRESULT WINAPI SGVideo_GetH264DecoderInfo(void*, SGDecoderInfo*);
__declspec(dllexport) HRESULT WINAPI SGVideo_GetH264DecoderLastError(void*);
__declspec(dllexport) HRESULT WINAPI SGVideo_GetH264DecoderLastErrorStage(void*, char*, UINT32);
__declspec(dllexport) UINT64 WINAPI SGVideo_GetH264DecoderStreamChangeCount(void*);
}

namespace {
class MFPlatform {
public:
    MFPlatform() : hr_(MFStartup(MF_VERSION, MFSTARTUP_LITE)) {}
    ~MFPlatform() { if (SUCCEEDED(hr_)) MFShutdown(); }
    HRESULT hr() const { return hr_; }
private:
    HRESULT hr_;
};

void ReleaseActivates(IMFActivate** values, UINT32 count) {
    for (UINT32 i = 0; values && i < count; ++i) values[i]->Release();
    CoTaskMemFree(values);
}

void LogHR(const char* stage, HRESULT hr) {
    std::fprintf(stderr, "VIEWER_H264_DECODE_FAILED stage=%s hr=0x%08lx\n", stage, static_cast<unsigned long>(hr));
}

const char* FormatName(REFGUID format) {
    return format == MFVideoFormat_NV12 ? "NV12" : "unknown";
}

BYTE Clip(int value) {
    return static_cast<BYTE>(value < 0 ? 0 : value > 255 ? 255 : value);
}

void NV12ToBGRA(const BYTE* source, UINT32 width, UINT32 storageHeight, UINT32 displayHeight, LONG stride, BYTE* target) {
    const size_t pitch = static_cast<size_t>(stride < 0 ? -static_cast<int64_t>(stride) : stride);
    const BYTE* y = stride >= 0 ? source : source + (static_cast<size_t>(storageHeight) - 1) * pitch;
    const BYTE* uvBase = source + pitch * storageHeight;
    const BYTE* uv = stride >= 0 ? uvBase : uvBase + (static_cast<size_t>(storageHeight / 2) - 1) * pitch;
    for (UINT32 row = 0; row < displayHeight; ++row) {
        const BYTE* yRow = y + static_cast<ptrdiff_t>(row) * stride;
        const BYTE* uvRow = uv + static_cast<ptrdiff_t>(row / 2) * stride;
        for (UINT32 col = 0; col < width; ++col) {
            int yy = static_cast<int>(yRow[col]) - 16;
            size_t uvIndex = col & ~1u;
            int uu = static_cast<int>(uvRow[uvIndex]) - 128;
            int vv = static_cast<int>(uvRow[uvIndex + 1]) - 128;
            int c = yy < 0 ? 0 : 298 * yy;
            size_t at = (static_cast<size_t>(row) * width + col) * 4;
            target[at] = Clip((c + 516 * uu + 128) >> 8);
            target[at + 1] = Clip((c - 100 * uu - 208 * vv + 128) >> 8);
            target[at + 2] = Clip((c + 409 * vv + 128) >> 8);
            target[at + 3] = 255;
        }
    }
}

class H264Decoder final {
public:
    HRESULT Create(UINT32 width, UINT32 height, UINT32 fps) {
        if (!width || !height || !fps || width % 2 || height % 2) return SetError("create", E_INVALIDARG);
        width_ = width;
        height_ = height;
        storageHeight_ = height;
        fps_ = fps;
        platform_ = std::make_unique<MFPlatform>();
        if (!platform_ || FAILED(platform_->hr())) return SetError("mf_startup", platform_ ? platform_->hr() : E_OUTOFMEMORY);
        MFT_REGISTER_TYPE_INFO input{MFMediaType_Video, MFVideoFormat_H264};
        IMFActivate** activates = nullptr;
        UINT32 count = 0;
        HRESULT hr = MFTEnumEx(MFT_CATEGORY_VIDEO_DECODER, MFT_ENUM_FLAG_ALL | MFT_ENUM_FLAG_SORTANDFILTER, &input, nullptr, &activates, &count);
        if (FAILED(hr)) return SetError("enumerate", hr);
        for (int pass = 0; pass < 2 && !transform_; ++pass) {
            for (UINT32 i = 0; i < count && !transform_; ++i) {
                WCHAR* friendly = nullptr;
                UINT32 chars = 0;
                activates[i]->GetAllocatedString(MFT_FRIENDLY_NAME_Attribute, &friendly, &chars);
                char candidate[256]{};
                if (friendly) WideCharToMultiByte(CP_UTF8, 0, friendly, -1, candidate, sizeof(candidate), nullptr, nullptr);
                else strcpy_s(candidate, "Media Foundation H.264 decoder");
                UINT32 hardwareAttribute = 0;
                activates[i]->GetUINT32(MFT_ENUM_HARDWARE_URL_Attribute, &hardwareAttribute);
                bool hardware = hardwareAttribute != 0;
                if ((pass == 0 && !hardware) || (pass == 1 && hardware)) {
                    if (friendly) CoTaskMemFree(friendly);
                    continue;
                }
                ComPtr<IMFTransform> candidateTransform;
                hr = activates[i]->ActivateObject(IID_PPV_ARGS(&candidateTransform));
                if (SUCCEEDED(hr)) hr = SetInputType(candidateTransform.Get());
                if (SUCCEEDED(hr)) hr = SelectOutputType(candidateTransform.Get(), false);
                if (SUCCEEDED(hr)) hr = candidateTransform->GetOutputStreamInfo(0, &outputStreamInfo_);
                if (SUCCEEDED(hr)) hr = candidateTransform->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
                if (SUCCEEDED(hr)) hr = candidateTransform->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
                if (SUCCEEDED(hr)) hr = candidateTransform->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
                if (SUCCEEDED(hr)) {
                    transform_ = candidateTransform;
                    hardware_ = hardware;
                    strcpy_s(name_, candidate);
                } else {
                    lastCandidateError_ = hr;
                }
                if (friendly) CoTaskMemFree(friendly);
            }
        }
        ReleaseActivates(activates, count);
        if (!transform_) return SetError("create", lastCandidateError_ == S_OK ? MF_E_TOPO_CODEC_NOT_FOUND : lastCandidateError_);
        stats_.width = width_;
        stats_.height = height_;
        std::fprintf(stderr, "VIEWER_DECODER backend=media_foundation hardware=%s name=\"%s\"\nVIEWER_DECODER_OUTPUT mode=cpu_fallback reason=nv12_to_bgra\n", hardware_ ? "true" : "false", name_);
        return SetError("none", S_OK);
    }

    HRESULT Decode(const BYTE* annexB, UINT32 bytes, UINT64 sequence, BYTE* output, UINT32 outputBytes, SGDecodedFrame* frame) {
        if (!annexB || !bytes || !output || !frame) return SetError("validate", E_INVALIDARG);
        auto started = GetTickCount64();
        ComPtr<IMFMediaBuffer> inputBuffer;
        HRESULT hr = MFCreateMemoryBuffer(bytes, &inputBuffer);
        if (FAILED(hr)) return Fail("create_input_buffer", hr);
        BYTE* input = nullptr;
        hr = inputBuffer->Lock(&input, nullptr, nullptr);
        if (FAILED(hr)) return Fail("lock_input", hr);
        std::memcpy(input, annexB, bytes);
        inputBuffer->Unlock();
        hr = inputBuffer->SetCurrentLength(bytes);
        if (FAILED(hr)) return Fail("set_input_length", hr);
        ComPtr<IMFSample> inputSample;
        hr = MFCreateSample(&inputSample);
        if (FAILED(hr)) return Fail("create_input_sample", hr);
        hr = inputSample->AddBuffer(inputBuffer.Get());
        if (FAILED(hr)) return Fail("add_input_buffer", hr);
        inputSample->SetSampleTime(static_cast<LONGLONG>(sequence) * 10000000 / fps_);
        inputSample->SetSampleDuration(10000000 / fps_);
        hr = SubmitInput(inputSample.Get());
        if (FAILED(hr)) return Fail("process_input", hr);
        stats_.submittedAccessUnits++;
        stats_.bytes += bytes;

        for (UINT32 attempt = 0; attempt < 3; ++attempt) {
            MFT_OUTPUT_DATA_BUFFER data{};
            ComPtr<IMFSample> providedSample;
            if (!(outputStreamInfo_.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES)) {
                hr = CreateOutputSample(&providedSample);
                if (FAILED(hr)) return Fail("create_output_sample", hr);
                data.pSample = providedSample.Get();
            }
            DWORD status = 0;
            hr = transform_->ProcessOutput(0, 1, &data, &status);
            ComPtr<IMFCollection> events;
            events.Attach(data.pEvents);
            if (hr == MF_E_TRANSFORM_NEED_MORE_INPUT) return SetError("need_more_input", S_FALSE);
            if (hr == MF_E_TRANSFORM_STREAM_CHANGE) {
                ++streamChanges_;
                std::fprintf(stderr, "VIEWER_H264_STREAM_CHANGE\n");
                hr = SelectOutputType(transform_.Get(), true);
                if (FAILED(hr)) return Fail("set_output_type", hr);
                hr = transform_->GetOutputStreamInfo(0, &outputStreamInfo_);
                if (FAILED(hr)) return Fail("get_output_stream_info", hr);
                continue;
            }
            if (FAILED(hr)) return Fail("process_output", hr);
            ComPtr<IMFSample> actual;
            if (data.pSample == providedSample.Get()) actual = providedSample;
            else actual.Attach(data.pSample);
            if (!actual) return Fail("process_output_sample", E_UNEXPECTED);
            return ConvertOutput(actual.Get(), sequence, started, output, outputBytes, frame);
        }
        return Fail("process_output_stream_change_retry", MF_E_TRANSFORM_STREAM_CHANGE);
    }

    HRESULT Stats(SGDecoderStats* result) const { if (!result) return E_POINTER; *result = stats_; return S_OK; }
    HRESULT Info(SGDecoderInfo* result) const {
        if (!result) return E_POINTER;
        std::memset(result, 0, sizeof(*result));
        strcpy_s(result->name, name_);
        result->hardware = hardware_;
        result->outputMode = 2;
        return S_OK;
    }
    HRESULT LastError() const { return lastError_; }
    HRESULT LastErrorStage(char* output, UINT32 outputChars) const {
        if (!output || !outputChars) return E_INVALIDARG;
        strcpy_s(output, outputChars, lastErrorStage_);
        return S_OK;
    }
    UINT64 StreamChangeCount() const { return streamChanges_; }

private:
    HRESULT SubmitInput(IMFSample* sample) { for (;;) { HRESULT hr = transform_->ProcessInput(0, sample, 0); if (hr != MF_E_NOTACCEPTING) return hr; MFT_OUTPUT_DATA_BUFFER data{}; ComPtr<IMFSample> discard; if (!(outputStreamInfo_.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES)) { hr = CreateOutputSample(&discard); if (FAILED(hr)) return hr; data.pSample = discard.Get(); } DWORD status = 0; hr = transform_->ProcessOutput(0, 1, &data, &status); ComPtr<IMFCollection> events; events.Attach(data.pEvents); if (data.pSample && data.pSample != discard.Get()) data.pSample->Release(); if (hr == MF_E_TRANSFORM_STREAM_CHANGE) { ++streamChanges_; std::fprintf(stderr, "VIEWER_H264_STREAM_CHANGE\n"); hr = SelectOutputType(transform_.Get(), true); if (FAILED(hr)) return hr; hr = transform_->GetOutputStreamInfo(0, &outputStreamInfo_); if (FAILED(hr)) return hr; continue; } if (FAILED(hr) && hr != MF_E_TRANSFORM_NEED_MORE_INPUT) return hr; } }

    HRESULT SetInputType(IMFTransform* transform) {
        ComPtr<IMFMediaType> type;
        HRESULT hr = MFCreateMediaType(&type);
        if (FAILED(hr)) return hr;
        if (FAILED(hr = type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video))) return hr;
        if (FAILED(hr = type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264))) return hr;
        if (FAILED(hr = MFSetAttributeSize(type.Get(), MF_MT_FRAME_SIZE, width_, height_))) return hr;
        if (FAILED(hr = MFSetAttributeRatio(type.Get(), MF_MT_FRAME_RATE, fps_, 1))) return hr;
        if (FAILED(hr = MFSetAttributeRatio(type.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1))) return hr;
        if (FAILED(hr = type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive))) return hr;
        return transform->SetInputType(0, type.Get(), 0);
    }

    HRESULT SelectOutputType(IMFTransform* transform, bool streamChange) {
        ComPtr<IMFMediaType> selected;
        for (DWORD index = 0;; ++index) {
            ComPtr<IMFMediaType> candidate;
            HRESULT hr = transform->GetOutputAvailableType(0, index, &candidate);
            if (hr == MF_E_NO_MORE_TYPES) break;
            if (FAILED(hr)) return hr;
            GUID subtype{};
            if (SUCCEEDED(candidate->GetGUID(MF_MT_SUBTYPE, &subtype)) && subtype == MFVideoFormat_NV12) {
                selected = candidate;
                break;
            }
        }
        if (!selected) return MF_E_INVALIDMEDIATYPE;
        HRESULT hr = transform->SetOutputType(0, selected.Get(), 0);
        if (FAILED(hr)) return hr;
        GUID subtype{};
        selected->GetGUID(MF_MT_SUBTYPE, &subtype);
        UINT32 width = width_, height = height_, storageHeight = height_, interlace = 0;
        LONG stride = 0;
        UINT32 selectedWidth = 0, selectedHeight = 0;
        if (SUCCEEDED(MFGetAttributeSize(selected.Get(), MF_MT_FRAME_SIZE, &selectedWidth, &selectedHeight)) && selectedWidth && selectedHeight) {
            width = selectedWidth;
            storageHeight = selectedHeight;
            if (selectedHeight <= height_) storageHeight = selectedHeight;
            if (selectedHeight <= height_) height = selectedHeight;
        }
        if (FAILED(selected->GetUINT32(MF_MT_INTERLACE_MODE, &interlace))) interlace = MFVideoInterlace_Unknown;
        if (FAILED(selected->GetUINT32(MF_MT_DEFAULT_STRIDE, reinterpret_cast<UINT32*>(&stride)))) stride = 0;
        if (!stride) {
            LONG computed = 0;
            if (SUCCEEDED(MFGetStrideForBitmapInfoHeader(subtype.Data1, width, &computed))) stride = computed;
        }
        if (!stride) stride = static_cast<LONG>(width);
        if (static_cast<UINT64>(stride < 0 ? -static_cast<int64_t>(stride) : stride) < width) return MF_E_INVALIDMEDIATYPE;
        width_ = width;
        height_ = height;
        storageHeight_ = storageHeight;
        outputStride_ = stride;
        stats_.width = width_;
        stats_.height = height_;
        std::fprintf(stderr, "VIEWER_H264_OUTPUT_TYPE format=%s width=%lu height=%lu stride=%ld interlace=%lu%s\n", FormatName(subtype), static_cast<unsigned long>(width_), static_cast<unsigned long>(height_), static_cast<long>(outputStride_), static_cast<unsigned long>(interlace), streamChange ? " stream_change=true" : "");
        return S_OK;
    }

    HRESULT CreateOutputSample(ComPtr<IMFSample>* sample) const {
        if (!sample) return E_POINTER;
        size_t pitch = static_cast<size_t>(outputStride_ < 0 ? -static_cast<int64_t>(outputStride_) : outputStride_);
        size_t minimum = pitch * storageHeight_ + pitch * (storageHeight_ / 2);
        size_t bytes = outputStreamInfo_.cbSize > minimum ? outputStreamInfo_.cbSize : minimum;
        if (bytes > MAXDWORD) return MF_E_BUFFERTOOSMALL;
        ComPtr<IMFMediaBuffer> buffer;
        HRESULT hr = MFCreateMemoryBuffer(static_cast<DWORD>(bytes), &buffer);
        if (FAILED(hr)) return hr;
        hr = MFCreateSample(sample->GetAddressOf());
        if (FAILED(hr)) return hr;
        return (*sample)->AddBuffer(buffer.Get());
    }

    HRESULT ConvertOutput(IMFSample* sample, UINT64 sequence, UINT64 started, BYTE* output, UINT32 outputBytes, SGDecodedFrame* frame) {
        if (static_cast<UINT64>(width_) * height_ * 4 > outputBytes) return Fail("output_bgra_buffer", HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER));
        ComPtr<IMFMediaBuffer> contiguous;
        HRESULT hr = sample->ConvertToContiguousBuffer(&contiguous);
        if (FAILED(hr)) return Fail("contiguous_output", hr);
        DWORD length = 0;
        hr = contiguous->GetCurrentLength(&length);
        if (FAILED(hr)) return Fail("output_length", hr);
        size_t pitch = static_cast<size_t>(outputStride_ < 0 ? -static_cast<int64_t>(outputStride_) : outputStride_);
        size_t minimum = pitch * storageHeight_ + pitch * (storageHeight_ / 2);
        if (length < minimum) return Fail("output_length", MF_E_BUFFERTOOSMALL);
        BYTE* pixels = nullptr;
        hr = contiguous->Lock(&pixels, nullptr, nullptr);
        if (FAILED(hr)) return Fail("lock_output", hr);
        NV12ToBGRA(pixels, width_, storageHeight_, height_, outputStride_, output);
        contiguous->Unlock();
        *frame = {sequence, GetTickCount64() - started, width_, height_, width_ * 4, width_ * height_ * 4};
        stats_.decodedFrames++;
        return SetError("none", S_OK);
    }

    HRESULT SetError(const char* stage, HRESULT hr) {
        lastError_ = hr;
        strcpy_s(lastErrorStage_, stage);
        return hr;
    }
    HRESULT Fail(const char* stage, HRESULT hr) {
        LogHR(stage, hr);
        stats_.failures++;
        return SetError(stage, hr);
    }

    std::unique_ptr<MFPlatform> platform_;
    ComPtr<IMFTransform> transform_;
    UINT32 width_{}, height_{}, storageHeight_{}, fps_{};
    LONG outputStride_{};
    MFT_OUTPUT_STREAM_INFO outputStreamInfo_{};
    bool hardware_{};
    char name_[256]{};
    char lastErrorStage_[64]{"none"};
    SGDecoderStats stats_{};
    UINT64 streamChanges_{};
    HRESULT lastError_ = S_OK, lastCandidateError_ = S_OK;
};
}

HRESULT WINAPI SGVideo_CreateH264Decoder(UINT32 w, UINT32 h, UINT32 fps, void** output) { if (!output) return E_POINTER; *output = nullptr; auto* decoder = new(std::nothrow) H264Decoder(); if (!decoder) return E_OUTOFMEMORY; HRESULT hr = decoder->Create(w, h, fps); if (FAILED(hr)) { delete decoder; return hr; } *output = decoder; return S_OK; }
void WINAPI SGVideo_DestroyH264Decoder(void* h) { delete static_cast<H264Decoder*>(h); }
HRESULT WINAPI SGVideo_DecodeH264ToBGRA(void* h, const BYTE* p, UINT32 bytes, UINT64 sequence, BYTE* output, UINT32 outputBytes, SGDecodedFrame* frame) { return h ? static_cast<H264Decoder*>(h)->Decode(p, bytes, sequence, output, outputBytes, frame) : E_POINTER; }
HRESULT WINAPI SGVideo_GetH264DecoderStats(void* h, SGDecoderStats* stats) { return h ? static_cast<H264Decoder*>(h)->Stats(stats) : E_POINTER; }
HRESULT WINAPI SGVideo_GetH264DecoderInfo(void* h, SGDecoderInfo* info) { return h ? static_cast<H264Decoder*>(h)->Info(info) : E_POINTER; }
HRESULT WINAPI SGVideo_GetH264DecoderLastError(void* h) { return h ? static_cast<H264Decoder*>(h)->LastError() : E_POINTER; }
HRESULT WINAPI SGVideo_GetH264DecoderLastErrorStage(void* h, char* stage, UINT32 chars) { return h ? static_cast<H264Decoder*>(h)->LastErrorStage(stage, chars) : E_POINTER; }
UINT64 WINAPI SGVideo_GetH264DecoderStreamChangeCount(void* h) { return h ? static_cast<H264Decoder*>(h)->StreamChangeCount() : 0; }
