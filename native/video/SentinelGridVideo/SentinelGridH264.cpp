#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mftransform.h>
#include <mferror.h>
#include <codecapi.h>
#include <icodecapi.h>
#include <wrl/client.h>
#include <chrono>
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
struct SGEncodedFrame { UINT64 sequence, captureMicroseconds, encodeMicroseconds; UINT32 payloadSize, flags; };
struct SGEncoderStats { UINT64 encodedFrames, keyframes, forcedKeyframes, bytes, failures; UINT32 width, height, bitrate, fps; };
struct SGEncoderInfo { char name[256]; UINT32 hardware, forceKeyframeSupported, inputMode; };
__declspec(dllexport) HRESULT WINAPI SGVideo_CreateH264Encoder(UINT32, UINT32, UINT32, UINT32, void**);
__declspec(dllexport) void WINAPI SGVideo_DestroyH264Encoder(void*);
__declspec(dllexport) HRESULT WINAPI SGVideo_EncodeBGRAToH264(void*, const BYTE*, UINT32, UINT64, UINT64, BYTE*, UINT32, SGEncodedFrame*);
__declspec(dllexport) HRESULT WINAPI SGVideo_ForceH264Keyframe(void*);
__declspec(dllexport) HRESULT WINAPI SGVideo_GetH264EncoderStats(void*, SGEncoderStats*);
__declspec(dllexport) HRESULT WINAPI SGVideo_GetH264EncoderLastError(void*);
__declspec(dllexport) HRESULT WINAPI SGVideo_GetH264EncoderInfo(void*, SGEncoderInfo*);
}
namespace {
constexpr UINT32 SG_H264_KEYFRAME = 1, SG_H264_CONFIG = 2, SG_ENCODER_INPUT_CPU_BGRA_TO_NV12 = 2;
class MFPlatform { public: MFPlatform() : hr_(MFStartup(MF_VERSION, MFSTARTUP_LITE)) {} ~MFPlatform() { if (SUCCEEDED(hr_)) MFShutdown(); } HRESULT hr() const { return hr_; } private: HRESULT hr_; };
void ReleaseActivates(IMFActivate** values, UINT32 count) { for (UINT32 i = 0; values && i < count; ++i) values[i]->Release(); CoTaskMemFree(values); }
void LogHR(const char* operation, HRESULT hr) { std::fprintf(stderr, "H264_MFT operation=%s HRESULT=%08lx\n", operation, static_cast<unsigned long>(hr)); }
void LogType(const char* direction, DWORD index, IMFMediaType* type) {
 GUID major{}, subtype{}; UINT32 w = 0, h = 0, n = 0, d = 0, profile = 0, level = 0, interlace = 0;
 type->GetGUID(MF_MT_MAJOR_TYPE, &major); type->GetGUID(MF_MT_SUBTYPE, &subtype); MFGetAttributeSize(type, MF_MT_FRAME_SIZE, &w, &h); MFGetAttributeRatio(type, MF_MT_FRAME_RATE, &n, &d); type->GetUINT32(MF_MT_MPEG2_PROFILE, &profile); type->GetUINT32(MF_MT_MPEG2_LEVEL, &level); type->GetUINT32(MF_MT_INTERLACE_MODE, &interlace);
 LPOLESTR majorText = nullptr, subtypeText = nullptr; StringFromCLSID(major, &majorText); StringFromCLSID(subtype, &subtypeText);
 std::fprintf(stderr, "H264_MFT_%s_TYPE index=%lu major=%ls subtype=%ls size=%lux%lu rate=%lu/%lu profile=%lu level=%lu interlace=%lu\n", direction, static_cast<unsigned long>(index), majorText ? majorText : L"?", subtypeText ? subtypeText : L"?", static_cast<unsigned long>(w), static_cast<unsigned long>(h), static_cast<unsigned long>(n), static_cast<unsigned long>(d), static_cast<unsigned long>(profile), static_cast<unsigned long>(level), static_cast<unsigned long>(interlace));
 CoTaskMemFree(majorText); CoTaskMemFree(subtypeText);
}
bool TypeHasSubtype(IMFMediaType* type, REFGUID expected) { GUID subtype{}; return SUCCEEDED(type->GetGUID(MF_MT_SUBTYPE, &subtype)) && subtype == expected; }
HRESULT SetRuntimeVideoAttributes(IMFMediaType* type, UINT32 width, UINT32 height, UINT32 fps, UINT32 bitrate, bool output) {
 HRESULT hr = type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video); if (FAILED(hr)) return hr;
 hr = type->SetGUID(MF_MT_SUBTYPE, output ? MFVideoFormat_H264 : MFVideoFormat_NV12); if (FAILED(hr)) return hr;
 hr = MFSetAttributeSize(type, MF_MT_FRAME_SIZE, width, height); if (FAILED(hr)) return hr;
 hr = MFSetAttributeRatio(type, MF_MT_FRAME_RATE, fps, 1); if (FAILED(hr)) return hr;
 hr = MFSetAttributeRatio(type, MF_MT_PIXEL_ASPECT_RATIO, 1, 1); if (FAILED(hr)) return hr;
 hr = type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive); if (FAILED(hr)) return hr;
 return output ? type->SetUINT32(MF_MT_AVG_BITRATE, bitrate) : S_OK;
}
class H264Encoder final {
public:
 HRESULT Create(UINT32 width, UINT32 height, UINT32 fps, UINT32 bitrate) {
  if (!width || !height || !fps || !bitrate || width % 2 || height % 2) return SetError(E_INVALIDARG);
  width_ = width; height_ = height; fps_ = fps; bitrate_ = bitrate;
  platform_ = std::make_unique<MFPlatform>(); if (!platform_) return SetError(E_OUTOFMEMORY); if (FAILED(platform_->hr())) return SetError(platform_->hr());
  IMFActivate** activates = nullptr; UINT32 count = 0;
  MFT_REGISTER_TYPE_INFO requested{MFMediaType_Video, MFVideoFormat_H264};
  HRESULT hr = MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_ALL | MFT_ENUM_FLAG_SORTANDFILTER, nullptr, &requested, &activates, &count);
  if (FAILED(hr)) { LogHR("MFTEnumEx", hr); return SetError(hr); }
  const char* preference = std::getenv("SG_VIDEO_H264_PREFERENCE");
  for (int pass = 0; pass < 2 && !transform_; ++pass) {
   for (UINT32 i = 0; i < count && !transform_; ++i) {
    WCHAR* friendly = nullptr; UINT32 chars = 0; activates[i]->GetAllocatedString(MFT_FRIENDLY_NAME_Attribute, &friendly, &chars);
    char candidateName[256]{}; if (friendly) WideCharToMultiByte(CP_UTF8, 0, friendly, -1, candidateName, sizeof(candidateName), nullptr, nullptr); else strcpy_s(candidateName, "Media Foundation video encoder");
    UINT32 hardwareAttribute = 0; activates[i]->GetUINT32(MFT_ENUM_HARDWARE_URL_Attribute, &hardwareAttribute); bool hardware = hardwareAttribute != 0 || std::strstr(candidateName, "NVIDIA") != nullptr;
    if (friendly) CoTaskMemFree(friendly);
    if ((preference && std::strcmp(preference, "hardware") == 0 && !hardware) || (preference && std::strcmp(preference, "software") == 0 && hardware) || (pass == 0 && !hardware) || (pass == 1 && hardware)) continue;
    HRESULT candidate = ConfigureCandidate(activates[i], candidateName, hardware);
    if (FAILED(candidate)) LogHR("candidate_configuration", candidate);
   }
  }
  ReleaseActivates(activates, count);
  if (!transform_) return SetError(lastCandidateError_ == S_OK ? MF_E_TOPO_CODEC_NOT_FOUND : lastCandidateError_);
  transform_.As(&codecApi_);
  if (codecApi_) {
   VARIANT lowLatency; VariantInit(&lowLatency); lowLatency.vt = VT_BOOL; lowLatency.boolVal = VARIANT_TRUE;
   (void)codecApi_->SetValue(&CODECAPI_AVLowLatencyMode, &lowLatency);
   (void)codecApi_->SetValue(&CODECAPI_AVEncCommonRealTime, &lowLatency);
   VariantClear(&lowLatency);
  }
  forceKeyframeSupported_ = codecApi_ && SUCCEEDED(codecApi_->IsSupported(&CODECAPI_AVEncVideoForceKeyFrame));
  std::fprintf(stderr, "ENCODER_CANDIDATE name=%s hardware=%u async=%u activation_ok=1 output_type_ok=1 input_type_ok=1 codecapi_ok=%u begin_streaming_ok=1\n", name_, hardware_, async_, forceKeyframeSupported_ ? 1 : 0);
  stats_.width = width; stats_.height = height; stats_.fps = fps; stats_.bitrate = bitrate; return SetError(S_OK);
 }
 HRESULT Encode(const BYTE* bgra, UINT32 stride, UINT64 sequence, UINT64 capture, BYTE* output, UINT32 outputBytes, SGEncodedFrame* frame) {
  if (!bgra || !output || !frame || stride < width_ * 4) return SetError(E_INVALIDARG);
  auto started = std::chrono::steady_clock::now(); std::vector<BYTE> nv12(static_cast<size_t>(width_) * height_ * 3 / 2); ToNV12(bgra, stride, nv12.data());
  ComPtr<IMFMediaBuffer> buffer; HRESULT hr = MFCreateMemoryBuffer(static_cast<DWORD>(nv12.size()), &buffer); if (FAILED(hr)) return Fail("MFCreateMemoryBuffer", hr);
  BYTE* pixels = nullptr; hr = buffer->Lock(&pixels, nullptr, nullptr); if (FAILED(hr)) return Fail("LockInput", hr); std::memcpy(pixels, nv12.data(), nv12.size()); buffer->Unlock(); buffer->SetCurrentLength(static_cast<DWORD>(nv12.size()));
  ComPtr<IMFSample> sample; hr = MFCreateSample(&sample); if (FAILED(hr)) return Fail("MFCreateSample", hr); sample->AddBuffer(buffer.Get()); sample->SetSampleTime(static_cast<LONGLONG>(sequence) * 10000000 / fps_); sample->SetSampleDuration(10000000 / fps_);
  hr = transform_->ProcessInput(0, sample.Get(), 0); if (FAILED(hr)) return Fail("ProcessInput", hr);
  return Drain(sequence, capture, output, outputBytes, frame, started);
 }
 HRESULT Force() { if (!forceKeyframeSupported_ || !codecApi_) return SetError(MF_E_ATTRIBUTENOTFOUND); VARIANT value; VariantInit(&value); value.vt = VT_UI4; value.ulVal = 1; HRESULT hr = codecApi_->SetValue(&CODECAPI_AVEncVideoForceKeyFrame, &value); VariantClear(&value); if (SUCCEEDED(hr)) stats_.forcedKeyframes++; else LogHR("CodecAPI.SetValue(ForceKeyFrame)", hr); return SetError(hr); }
 HRESULT Stats(SGEncoderStats* result) const { if (!result) return E_POINTER; *result = stats_; return S_OK; }
 HRESULT Info(SGEncoderInfo* result) const { if (!result) return E_POINTER; std::memset(result, 0, sizeof(*result)); strcpy_s(result->name, name_); result->hardware = hardware_; result->forceKeyframeSupported = forceKeyframeSupported_; result->inputMode = SG_ENCODER_INPUT_CPU_BGRA_TO_NV12; return S_OK; }
 HRESULT LastError() const { return lastError_; }
private:
 HRESULT ConfigureCandidate(IMFActivate* activate, const char* candidateName, bool hardware) {
  std::fprintf(stderr, "ENCODER_CANDIDATE name=%s hardware=%u", candidateName, hardware ? 1 : 0);
  ComPtr<IMFTransform> candidate; HRESULT hr = activate->ActivateObject(IID_PPV_ARGS(&candidate)); if (FAILED(hr)) { std::fprintf(stderr, " activation_ok=0\n"); LogHR("ActivateObject", hr); lastCandidateError_ = hr; return hr; }
  ComPtr<IMFAttributes> attributes; candidate.As(&attributes); UINT32 async = 0; if (attributes) { attributes->GetUINT32(MF_TRANSFORM_ASYNC, &async); (void)attributes->SetUINT32(MF_LOW_LATENCY, TRUE); } std::fprintf(stderr, " async=%u activation_ok=1", async ? 1 : 0);
  if (async && attributes) { hr = attributes->SetUINT32(MF_TRANSFORM_ASYNC_UNLOCK, TRUE); if (FAILED(hr)) { std::fprintf(stderr, " output_type_ok=0\n"); LogHR("Set MF_TRANSFORM_ASYNC_UNLOCK", hr); lastCandidateError_ = hr; return hr; } }
  hr = SetAdvertisedType(candidate.Get(), true); if (FAILED(hr)) { std::fprintf(stderr, " output_type_ok=0\n"); LogHR("SetOutputType", hr); lastCandidateError_ = hr; candidate->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0); return hr; }
  std::fprintf(stderr, " output_type_ok=1");
  hr = SetAdvertisedType(candidate.Get(), false); if (FAILED(hr)) { std::fprintf(stderr, " input_type_ok=0\n"); LogHR("SetInputType", hr); lastCandidateError_ = hr; candidate->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0); return hr; }
  std::fprintf(stderr, " input_type_ok=1");
  hr = candidate->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0); if (FAILED(hr)) LogHR("ProcessMessage(flush)", hr);   hr = candidate->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);   if (FAILED(hr)) { std::fprintf(stderr, " codecapi_ok=0 begin_streaming_ok=0\n"); LogHR("ProcessMessage(begin streaming)", hr); lastCandidateError_ = hr; return hr; }   hr = candidate->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);   if (FAILED(hr)) { std::fprintf(stderr, " codecapi_ok=0 begin_streaming_ok=0\n"); LogHR("ProcessMessage(start of stream)", hr); lastCandidateError_ = hr; return hr; }
  if (FAILED(hr)) { std::fprintf(stderr, " codecapi_ok=0 begin_streaming_ok=0\n"); LogHR("ProcessMessage(begin streaming)", hr); lastCandidateError_ = hr; return hr; }
  MFT_OUTPUT_STREAM_INFO stream{}; hr = candidate->GetOutputStreamInfo(0, &stream); if (FAILED(hr)) { std::fprintf(stderr, " codecapi_ok=0 begin_streaming_ok=0\n"); LogHR("GetOutputStreamInfo", hr); lastCandidateError_ = hr; return hr; }
  std::fprintf(stderr, " codecapi_ok=1 begin_streaming_ok=1\n");
  transform_ = candidate; outputBufferBytes_ = stream.cbSize ? stream.cbSize : width_ * height_ * 2; outputProvidesSamples_ = (stream.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES) != 0; hardware_ = hardware; async_ = async != 0; strcpy_s(name_, candidateName); return S_OK;
 }
 HRESULT SetAdvertisedType(IMFTransform* transform, bool output) {
  HRESULT last = MF_E_INVALIDMEDIATYPE;
  for (DWORD index = 0;; ++index) {
   ComPtr<IMFMediaType> advertised; HRESULT hr = output ? transform->GetOutputAvailableType(0, index, &advertised) : transform->GetInputAvailableType(0, index, &advertised);
   if (hr == MF_E_NO_MORE_TYPES) break; if (FAILED(hr)) { LogHR(output ? "GetOutputAvailableType" : "GetInputAvailableType", hr); return hr; }
   LogType(output ? "OUTPUT" : "INPUT", index, advertised.Get());
   if (!TypeHasSubtype(advertised.Get(), output ? MFVideoFormat_H264 : MFVideoFormat_NV12)) continue;
   ComPtr<IMFMediaType> configured; hr = MFCreateMediaType(&configured); if (FAILED(hr)) return hr; hr = advertised->CopyAllItems(configured.Get()); if (FAILED(hr)) return hr;
   hr = SetRuntimeVideoAttributes(configured.Get(), width_, height_, fps_, bitrate_, output); if (FAILED(hr)) return hr;
   hr = output ? transform->SetOutputType(0, configured.Get(), 0) : transform->SetInputType(0, configured.Get(), 0);
   if (SUCCEEDED(hr)) return S_OK; last = hr; LogHR(output ? "SetOutputType(candidate type)" : "SetInputType(candidate type)", hr);
  }
  ComPtr<IMFMediaType> configured; HRESULT hr = MFCreateMediaType(&configured); if (FAILED(hr)) return hr;
  hr = SetRuntimeVideoAttributes(configured.Get(), width_, height_, fps_, bitrate_, output); if (FAILED(hr)) return hr;
  hr = output ? transform->SetOutputType(0, configured.Get(), 0) : transform->SetInputType(0, configured.Get(), 0);
  if (FAILED(hr)) LogHR(output ? "SetOutputType(generic type)" : "SetInputType(generic type)", hr);
  return hr;
 }
 HRESULT Drain(UINT64 sequence, UINT64 capture, BYTE* output, UINT32 outputBytes, SGEncodedFrame* frame, std::chrono::steady_clock::time_point started) {
  ComPtr<IMFSample> allocated; if (!outputProvidesSamples_) { HRESULT hr = MFCreateMemoryBuffer(outputBufferBytes_, &buffer_); if (FAILED(hr)) return Fail("MFCreateMemoryBuffer(output)", hr); hr = MFCreateSample(&allocated); if (FAILED(hr)) return Fail("MFCreateSample(output)", hr); allocated->AddBuffer(buffer_.Get()); }
  MFT_OUTPUT_DATA_BUFFER data{}; data.pSample = allocated.Get(); DWORD status = 0; HRESULT hr = transform_->ProcessOutput(0, 1, &data, &status); if (hr == MF_E_TRANSFORM_NEED_MORE_INPUT) return SetError(S_FALSE); if (hr == MF_E_TRANSFORM_STREAM_CHANGE) { LogHR("ProcessOutput(stream change)", hr); return Fail("ProcessOutput(stream change)", RefreshOutputType()); } if (FAILED(hr)) return Fail("ProcessOutput", hr);
  ComPtr<IMFSample> actual; if (data.pSample == allocated.Get()) actual = allocated; else actual.Attach(data.pSample); ComPtr<IMFMediaBuffer> contiguous; hr = actual->ConvertToContiguousBuffer(&contiguous); if (FAILED(hr)) return Fail("ConvertToContiguousBuffer", hr);
  DWORD bytes = 0; hr = contiguous->GetCurrentLength(&bytes); if (FAILED(hr)) return Fail("GetCurrentLength", hr); BYTE* source = nullptr; hr = contiguous->Lock(&source, nullptr, nullptr); if (FAILED(hr)) return Fail("LockOutput", hr); std::vector<BYTE> annexB; NormalizeAnnexB(source, bytes, annexB); contiguous->Unlock(); if (annexB.empty() || annexB.size() > outputBytes) return SetError(HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER));
  std::memcpy(output, annexB.data(), annexB.size()); UINT32 flags = H264Flags(output, static_cast<DWORD>(annexB.size())); UINT32 clean = 0; actual->GetUINT32(MFSampleExtension_CleanPoint, &clean); if (clean) flags |= SG_H264_KEYFRAME; *frame = {sequence, capture, static_cast<UINT64>(std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - started).count()), static_cast<UINT32>(annexB.size()), flags}; if (flags & SG_H264_KEYFRAME) stats_.keyframes++; stats_.encodedFrames++; stats_.bytes += annexB.size(); return SetError(S_OK);
 }
 HRESULT RefreshOutputType() { ComPtr<IMFMediaType> type; HRESULT hr = transform_->GetOutputAvailableType(0, 0, &type); if (SUCCEEDED(hr)) hr = transform_->SetOutputType(0, type.Get(), 0); return hr; }
 static void NormalizeAnnexB(const BYTE* source, DWORD bytes, std::vector<BYTE>& output) { if (bytes < 4) return; if (source[0] == 0 && source[1] == 0 && (source[2] == 1 || (source[2] == 0 && source[3] == 1))) { output.assign(source, source + bytes); return; } for (DWORD offset = 0; offset + 4 <= bytes;) { DWORD length = (DWORD(source[offset]) << 24) | (DWORD(source[offset + 1]) << 16) | (DWORD(source[offset + 2]) << 8) | source[offset + 3]; offset += 4; if (!length || length > bytes - offset) { output.clear(); return; } output.insert(output.end(), {0, 0, 0, 1}); output.insert(output.end(), source + offset, source + offset + length); offset += length; } }
 static UINT32 H264Flags(const BYTE* data, DWORD length) { bool sps = false, pps = false, idr = false; for (DWORD i = 0; i + 4 < length; ++i) { DWORD at = length; if (!data[i] && !data[i + 1] && data[i + 2] == 1) at = i + 3; else if (!data[i] && !data[i + 1] && !data[i + 2] && data[i + 3] == 1) at = i + 4; if (at < length) { BYTE type = data[at] & 0x1f; sps |= type == 7; pps |= type == 8; idr |= type == 5; } } return (idr ? SG_H264_KEYFRAME : 0) | (sps && pps ? SG_H264_CONFIG : 0); }
 void ToNV12(const BYTE* source, UINT32 stride, BYTE* destination) { BYTE* y = destination; BYTE* uv = destination + width_ * height_; for (UINT32 row = 0; row < height_; ++row) for (UINT32 col = 0; col < width_; ++col) { BYTE b = source[row * stride + col * 4], g = source[row * stride + col * 4 + 1], r = source[row * stride + col * 4 + 2]; y[row * width_ + col] = static_cast<BYTE>((77 * r + 150 * g + 29 * b) >> 8); if (!(row & 1) && !(col & 1)) { uv[(row / 2) * width_ + col] = static_cast<BYTE>(128 + ((-43 * r - 85 * g + 128 * b) >> 8)); uv[(row / 2) * width_ + col + 1] = static_cast<BYTE>(128 + ((128 * r - 107 * g - 21 * b) >> 8)); } } }
 HRESULT SetError(HRESULT hr) { lastError_ = hr; return hr; } HRESULT Fail(const char* operation, HRESULT hr) { LogHR(operation, hr); stats_.failures++; return SetError(hr); }
 std::unique_ptr<MFPlatform> platform_; ComPtr<IMFTransform> transform_; ComPtr<ICodecAPI> codecApi_; ComPtr<IMFMediaBuffer> buffer_; UINT32 width_{}, height_{}, fps_{}, bitrate_{}, outputBufferBytes_{}; bool hardware_{}, async_{}, outputProvidesSamples_{}, forceKeyframeSupported_{}; char name_[256]{}; SGEncoderStats stats_{}; HRESULT lastError_ = S_OK, lastCandidateError_ = S_OK;
};
}
HRESULT WINAPI SGVideo_CreateH264Encoder(UINT32 w, UINT32 h, UINT32 fps, UINT32 bitrate, void** output) { if (!output) return E_POINTER; *output = nullptr; auto* encoder = new(std::nothrow) H264Encoder(); if (!encoder) return E_OUTOFMEMORY; HRESULT hr = encoder->Create(w, h, fps, bitrate); if (FAILED(hr)) { delete encoder; return hr; } *output = encoder; return S_OK; }
void WINAPI SGVideo_DestroyH264Encoder(void* h) { delete static_cast<H264Encoder*>(h); }
HRESULT WINAPI SGVideo_EncodeBGRAToH264(void* h, const BYTE* p, UINT32 stride, UINT64 sequence, UINT64 capture, BYTE* output, UINT32 bytes, SGEncodedFrame* frame) { return h ? static_cast<H264Encoder*>(h)->Encode(p, stride, sequence, capture, output, bytes, frame) : E_POINTER; }
HRESULT WINAPI SGVideo_ForceH264Keyframe(void* h) { return h ? static_cast<H264Encoder*>(h)->Force() : E_POINTER; }
HRESULT WINAPI SGVideo_GetH264EncoderStats(void* h, SGEncoderStats* stats) { return h ? static_cast<H264Encoder*>(h)->Stats(stats) : E_POINTER; }
HRESULT WINAPI SGVideo_GetH264EncoderLastError(void* h) { return h ? static_cast<H264Encoder*>(h)->LastError() : E_POINTER; }
HRESULT WINAPI SGVideo_GetH264EncoderInfo(void* h, SGEncoderInfo* info) { return h ? static_cast<H264Encoder*>(h)->Info(info) : E_POINTER; }
