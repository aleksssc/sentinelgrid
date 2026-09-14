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
#include <vector>

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
}

namespace {
class MFPlatform { public: MFPlatform() : hr_(MFStartup(MF_VERSION, MFSTARTUP_LITE)) {} ~MFPlatform() { if (SUCCEEDED(hr_)) MFShutdown(); } HRESULT hr() const { return hr_; } private: HRESULT hr_; };
void ReleaseActivates(IMFActivate** values, UINT32 count) { for (UINT32 i = 0; values && i < count; ++i) values[i]->Release(); CoTaskMemFree(values); }
HRESULT SetType(IMFTransform* transform, bool output, UINT32 width, UINT32 height, UINT32 fps) {
 ComPtr<IMFMediaType> type; HRESULT hr = MFCreateMediaType(&type); if (FAILED(hr)) return hr;
 hr = type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video); if (FAILED(hr)) return hr;
 hr = type->SetGUID(MF_MT_SUBTYPE, output ? MFVideoFormat_NV12 : MFVideoFormat_H264); if (FAILED(hr)) return hr;
 hr = MFSetAttributeSize(type.Get(), MF_MT_FRAME_SIZE, width, height); if (FAILED(hr)) return hr;
 hr = MFSetAttributeRatio(type.Get(), MF_MT_FRAME_RATE, fps, 1); if (FAILED(hr)) return hr;
 hr = MFSetAttributeRatio(type.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1); if (FAILED(hr)) return hr;
 hr = type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive); if (FAILED(hr)) return hr;
 return output ? transform->SetOutputType(0, type.Get(), 0) : transform->SetInputType(0, type.Get(), 0);
}
BYTE Clip(int value) { return static_cast<BYTE>(value < 0 ? 0 : value > 255 ? 255 : value); }
void NV12ToBGRA(const BYTE* source, UINT32 width, UINT32 height, BYTE* target) {
 const BYTE* y = source; const BYTE* uv = source + static_cast<size_t>(width) * height;
 for (UINT32 row = 0; row < height; ++row) for (UINT32 col = 0; col < width; ++col) {
  int yy = static_cast<int>(y[static_cast<size_t>(row) * width + col]) - 16;
  size_t uvIndex = static_cast<size_t>(row / 2) * width + (col & ~1u);
  int uu = static_cast<int>(uv[uvIndex]) - 128, vv = static_cast<int>(uv[uvIndex + 1]) - 128;
  int c = yy < 0 ? 0 : 298 * yy; size_t at = (static_cast<size_t>(row) * width + col) * 4;
  target[at] = Clip((c + 516 * uu + 128) >> 8); target[at + 1] = Clip((c - 100 * uu - 208 * vv + 128) >> 8); target[at + 2] = Clip((c + 409 * vv + 128) >> 8); target[at + 3] = 0;
 }
}
class H264Decoder final {
public:
 HRESULT Create(UINT32 width, UINT32 height, UINT32 fps) {
  if (!width || !height || !fps || width % 2 || height % 2) return SetError(E_INVALIDARG);
  width_ = width; height_ = height; fps_ = fps; platform_ = std::make_unique<MFPlatform>(); if (!platform_ || FAILED(platform_->hr())) return SetError(platform_ ? platform_->hr() : E_OUTOFMEMORY);
  MFT_REGISTER_TYPE_INFO input{MFMediaType_Video, MFVideoFormat_H264}; IMFActivate** activates = nullptr; UINT32 count = 0;
  HRESULT hr = MFTEnumEx(MFT_CATEGORY_VIDEO_DECODER, MFT_ENUM_FLAG_ALL | MFT_ENUM_FLAG_SORTANDFILTER, &input, nullptr, &activates, &count); if (FAILED(hr)) return SetError(hr);
  for (int pass = 0; pass < 2 && !transform_; ++pass) for (UINT32 i = 0; i < count && !transform_; ++i) {
   WCHAR* friendly = nullptr; UINT32 chars = 0; activates[i]->GetAllocatedString(MFT_FRIENDLY_NAME_Attribute, &friendly, &chars); char candidate[256]{}; if (friendly) WideCharToMultiByte(CP_UTF8, 0, friendly, -1, candidate, sizeof(candidate), nullptr, nullptr); else strcpy_s(candidate, "Media Foundation H.264 decoder");
   UINT32 hardwareAttribute = 0; activates[i]->GetUINT32(MFT_ENUM_HARDWARE_URL_Attribute, &hardwareAttribute); bool hardware = hardwareAttribute != 0;
   if ((pass == 0 && !hardware) || (pass == 1 && hardware)) { if (friendly) CoTaskMemFree(friendly); continue; }
   ComPtr<IMFTransform> transform; hr = activates[i]->ActivateObject(IID_PPV_ARGS(&transform)); if (SUCCEEDED(hr)) hr = SetType(transform.Get(), false, width, height, fps); if (SUCCEEDED(hr)) hr = SetType(transform.Get(), true, width, height, fps);
   if (SUCCEEDED(hr)) { transform->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0); transform->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0); transform->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0); transform_ = transform; hardware_ = hardware; strcpy_s(name_, candidate); }
   else lastCandidateError_ = hr; if (friendly) CoTaskMemFree(friendly);
  }
  ReleaseActivates(activates, count); if (!transform_) return SetError(lastCandidateError_ == S_OK ? MF_E_TOPO_CODEC_NOT_FOUND : lastCandidateError_);
  stats_.width = width; stats_.height = height; std::fprintf(stderr, "VIEWER_DECODER backend=media_foundation hardware=%s name=\"%s\"\nVIEWER_DECODER_OUTPUT mode=cpu_fallback reason=nv12_to_bgra\n", hardware_ ? "true" : "false", name_); return SetError(S_OK);
 }
 HRESULT Decode(const BYTE* annexB, UINT32 bytes, UINT64 sequence, BYTE* output, UINT32 outputBytes, SGDecodedFrame* frame) {
  if (!annexB || !bytes || !output || !frame || outputBytes < static_cast<UINT64>(width_) * height_ * 4) return SetError(E_INVALIDARG);
  auto started = GetTickCount64(); ComPtr<IMFMediaBuffer> inputBuffer; HRESULT hr = MFCreateMemoryBuffer(bytes, &inputBuffer); if (FAILED(hr)) return Fail(hr); BYTE* input = nullptr; hr = inputBuffer->Lock(&input, nullptr, nullptr); if (FAILED(hr)) return Fail(hr); std::memcpy(input, annexB, bytes); inputBuffer->Unlock(); inputBuffer->SetCurrentLength(bytes);
  ComPtr<IMFSample> inputSample; hr = MFCreateSample(&inputSample); if (FAILED(hr)) return Fail(hr); inputSample->AddBuffer(inputBuffer.Get()); inputSample->SetSampleTime(static_cast<LONGLONG>(sequence) * 10000000 / fps_); inputSample->SetSampleDuration(10000000 / fps_);
  hr = transform_->ProcessInput(0, inputSample.Get(), 0); if (FAILED(hr)) return Fail(hr); stats_.submittedAccessUnits++; stats_.bytes += bytes;
  ComPtr<IMFMediaBuffer> outputBuffer; hr = MFCreateMemoryBuffer(width_ * height_ * 3 / 2, &outputBuffer); if (FAILED(hr)) return Fail(hr); ComPtr<IMFSample> outputSample; hr = MFCreateSample(&outputSample); if (FAILED(hr)) return Fail(hr); outputSample->AddBuffer(outputBuffer.Get()); MFT_OUTPUT_DATA_BUFFER data{}; data.pSample = outputSample.Get(); DWORD status = 0; hr = transform_->ProcessOutput(0, 1, &data, &status); if (hr == MF_E_TRANSFORM_NEED_MORE_INPUT) return SetError(S_FALSE); if (hr == MF_E_TRANSFORM_STREAM_CHANGE) return SetError(hr); if (FAILED(hr)) return Fail(hr);
  ComPtr<IMFSample> actual; if (data.pSample == outputSample.Get()) actual = outputSample; else actual.Attach(data.pSample); ComPtr<IMFMediaBuffer> contiguous; hr = actual->ConvertToContiguousBuffer(&contiguous); if (FAILED(hr)) return Fail(hr); DWORD length = 0; hr = contiguous->GetCurrentLength(&length); if (FAILED(hr) || length < width_ * height_ * 3 / 2) return Fail(FAILED(hr) ? hr : MF_E_BUFFERTOOSMALL); BYTE* pixels = nullptr; hr = contiguous->Lock(&pixels, nullptr, nullptr); if (FAILED(hr)) return Fail(hr); NV12ToBGRA(pixels, width_, height_, output); contiguous->Unlock(); *frame = {sequence, GetTickCount64() - started, width_, height_, width_ * 4, width_ * height_ * 4}; stats_.decodedFrames++; return SetError(S_OK);
 }
 HRESULT Stats(SGDecoderStats* result) const { if (!result) return E_POINTER; *result = stats_; return S_OK; }
 HRESULT Info(SGDecoderInfo* result) const { if (!result) return E_POINTER; std::memset(result, 0, sizeof(*result)); strcpy_s(result->name, name_); result->hardware = hardware_; result->outputMode = 2; return S_OK; }
 HRESULT LastError() const { return lastError_; }
private:
 HRESULT SetError(HRESULT hr) { lastError_ = hr; return hr; } HRESULT Fail(HRESULT hr) { stats_.failures++; return SetError(hr); }
 std::unique_ptr<MFPlatform> platform_; ComPtr<IMFTransform> transform_; UINT32 width_{}, height_{}, fps_{}; bool hardware_{}; char name_[256]{}; SGDecoderStats stats_{}; HRESULT lastError_ = S_OK, lastCandidateError_ = S_OK;
};
}
HRESULT WINAPI SGVideo_CreateH264Decoder(UINT32 w, UINT32 h, UINT32 fps, void** output) { if (!output) return E_POINTER; *output = nullptr; auto* decoder = new(std::nothrow) H264Decoder(); if (!decoder) return E_OUTOFMEMORY; HRESULT hr = decoder->Create(w, h, fps); if (FAILED(hr)) { delete decoder; return hr; } *output = decoder; return S_OK; }
void WINAPI SGVideo_DestroyH264Decoder(void* h) { delete static_cast<H264Decoder*>(h); }
HRESULT WINAPI SGVideo_DecodeH264ToBGRA(void* h, const BYTE* p, UINT32 bytes, UINT64 sequence, BYTE* output, UINT32 outputBytes, SGDecodedFrame* frame) { return h ? static_cast<H264Decoder*>(h)->Decode(p, bytes, sequence, output, outputBytes, frame) : E_POINTER; }
HRESULT WINAPI SGVideo_GetH264DecoderStats(void* h, SGDecoderStats* stats) { return h ? static_cast<H264Decoder*>(h)->Stats(stats) : E_POINTER; }
HRESULT WINAPI SGVideo_GetH264DecoderInfo(void* h, SGDecoderInfo* info) { return h ? static_cast<H264Decoder*>(h)->Info(info) : E_POINTER; }
HRESULT WINAPI SGVideo_GetH264DecoderLastError(void* h) { return h ? static_cast<H264Decoder*>(h)->LastError() : E_POINTER; }
