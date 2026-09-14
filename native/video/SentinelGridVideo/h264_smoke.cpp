#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mftransform.h>
#include <mferror.h>
#include <cstdio>
#include <cstring>
#include <vector>

struct SGEncodedFrame { unsigned long long sequence, captureMicroseconds, encodeMicroseconds; unsigned long payloadSize, flags; };
struct SGEncoderInfo { char name[256]; unsigned long hardware, forceKeyframeSupported, inputMode; };
typedef HRESULT (WINAPI *Create)(unsigned long, unsigned long, unsigned long, unsigned long, void**);
typedef void (WINAPI *Destroy)(void*);
typedef HRESULT (WINAPI *Encode)(void*, const unsigned char*, unsigned long, unsigned long long, unsigned long long, unsigned char*, unsigned long, SGEncodedFrame*);
typedef HRESULT (WINAPI *Force)(void*);
typedef HRESULT (WINAPI *Info)(void*, SGEncoderInfo*);

void Release(IMFActivate** values, UINT32 count) { for (UINT32 i = 0; values && i < count; ++i) values[i]->Release(); CoTaskMemFree(values); }
void Enumerate(const char* label, DWORD flags, const MFT_REGISTER_TYPE_INFO* output) {
 IMFActivate** values = nullptr; UINT32 count = 0; HRESULT hr = MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, flags, nullptr, output, &values, &count);
 std::printf("ENUM_%s_COUNT=%u HR=%08lx\n", label, count, hr);
 for (UINT32 i = 0; i < count; ++i) { WCHAR* name = nullptr; UINT32 chars = 0; GUID clsid{}; values[i]->GetAllocatedString(MFT_FRIENDLY_NAME_Attribute, &name, &chars); values[i]->GetGUID(MFT_TRANSFORM_CLSID_Attribute, &clsid); LPOLESTR text = nullptr; StringFromCLSID(clsid, &text); std::wprintf(L"ENUM_%S_NAME=%s CLSID=%s\n", label, name ? name : L"(unnamed)", text ? text : L"(unknown)"); CoTaskMemFree(name); CoTaskMemFree(text); }
 Release(values, count);
}
bool ContainsNAL(const unsigned char* data, unsigned long length, unsigned char type) { for (unsigned long i = 0; i + 4 < length; ++i) { unsigned long at = length; if (data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1) at = i + 3; else if (data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 0 && data[i + 3] == 1) at = i + 4; if (at < length && (data[at] & 0x1f) == type) return true; } return false; }
int main(int argc, char** argv) {
 if (argc == 2 && (!std::strcmp(argv[1], "hardware") || !std::strcmp(argv[1], "software"))) _putenv_s("SG_VIDEO_H264_PREFERENCE", argv[1]);
 HRESULT startup = MFStartup(MF_VERSION, MFSTARTUP_LITE); std::printf("MFSTARTUP=%08lx\n", startup); if (FAILED(startup)) return 1;
 MFT_REGISTER_TYPE_INFO h264{MFMediaType_Video, MFVideoFormat_H264};
 Enumerate("HW_UNFILTERED", MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER, nullptr);
 Enumerate("SYNC_UNFILTERED", MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_LOCALMFT | MFT_ENUM_FLAG_SORTANDFILTER, nullptr);
 Enumerate("ASYNC_UNFILTERED", MFT_ENUM_FLAG_ASYNCMFT | MFT_ENUM_FLAG_LOCALMFT | MFT_ENUM_FLAG_SORTANDFILTER, nullptr);
 Enumerate("ALL_H264_OUTPUT", MFT_ENUM_FLAG_ALL | MFT_ENUM_FLAG_SORTANDFILTER, &h264);
 HMODULE dll = LoadLibraryW(L"SentinelGridVideo.dll"); if (!dll) { std::printf("DLL_LOAD_FAILED=%lu\n", GetLastError()); MFShutdown(); return 2; }
 auto create = (Create)GetProcAddress(dll, "SGVideo_CreateH264Encoder"); auto destroy = (Destroy)GetProcAddress(dll, "SGVideo_DestroyH264Encoder"); auto encode = (Encode)GetProcAddress(dll, "SGVideo_EncodeBGRAToH264"); auto force = (Force)GetProcAddress(dll, "SGVideo_ForceH264Keyframe"); auto info = (Info)GetProcAddress(dll, "SGVideo_GetH264EncoderInfo");
 if (!create || !destroy || !encode || !force || !info) { std::printf("DLL_EXPORT_MISSING\n"); FreeLibrary(dll); MFShutdown(); return 3; }
 void* encoder = nullptr; HRESULT hr = create(1920, 1080, 30, 8000000, &encoder); if (FAILED(hr)) { std::printf("CREATE=%08lx\n", hr); FreeLibrary(dll); MFShutdown(); return 4; }
 SGEncoderInfo encoderInfo{}; info(encoder, &encoderInfo); std::printf("ENCODER_NAME=%s\nHARDWARE=%lu\nASYNC=false\nINPUT_FORMAT=NV12\nOUTPUT_FORMAT=H264\nWIDTH=1920\nHEIGHT=1080\nFPS=30\nBITRATE=8000000\nFORCE_KEYFRAME_SUPPORTED=%s\n", encoderInfo.name, encoderInfo.hardware, encoderInfo.forceKeyframeSupported ? "true" : "false");
 std::vector<unsigned char> bgra(1920 * 1080 * 4), output(8 * 1024 * 1024); unsigned long aus = 0; unsigned long long totalBytes = 0; bool sps = false, pps = false, idr = false, nonIdr = false, recovery = false; HRESULT forced = E_FAIL;
 for (unsigned long long i = 0; i < 180; ++i) { for (size_t p = 0; p < bgra.size(); p += 4) { bgra[p] = static_cast<unsigned char>(i); bgra[p + 1] = static_cast<unsigned char>(i * 3); bgra[p + 2] = static_cast<unsigned char>(i * 7); bgra[p + 3] = 255; } SGEncodedFrame frame{}; hr = encode(encoder, bgra.data(), 1920 * 4, i, i * 33333, output.data(), static_cast<unsigned long>(output.size()), &frame); if (hr == S_OK && frame.payloadSize) { ++aus; totalBytes += frame.payloadSize; bool frameIDR = ContainsNAL(output.data(), frame.payloadSize, 5); sps |= ContainsNAL(output.data(), frame.payloadSize, 7); pps |= ContainsNAL(output.data(), frame.payloadSize, 8); idr |= frameIDR; nonIdr |= !frameIDR; if (i == 60) forced = force(encoder); if (i > 60 && frameIDR) recovery = true; } else if (FAILED(hr)) { std::printf("ENCODE=%08lx\n", hr); break; } }
 std::printf("AUS_PRODUCED=%lu\nTOTAL_ENCODED_BYTES=%llu\nSPS_FOUND=%s\nPPS_FOUND=%s\nIDR_FOUND=%s\nNON_IDR_FOUND=%s\nFORCE_KEYFRAME_CALL_OK=%s\nRECOVERY_IDR_FOUND=%s\n", aus, totalBytes, sps ? "true" : "false", pps ? "true" : "false", idr ? "true" : "false", nonIdr ? "true" : "false", SUCCEEDED(forced) ? "true" : "false", recovery ? "true" : "false");
 destroy(encoder); FreeLibrary(dll); MFShutdown(); return aus && totalBytes && sps && pps && idr && SUCCEEDED(forced) && recovery ? 0 : 5;
}
