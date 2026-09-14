#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <wrl/client.h>

#include <chrono>
#include <memory>

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")

using Microsoft::WRL::ComPtr;

extern "C" {

struct SGVideoFrame {
    UINT32 width;
    UINT32 height;
    UINT32 stride;
    UINT32 reserved;
    UINT64 acquireMicroseconds;
    UINT64 gpuCopyMicroseconds;
    UINT64 mapReadbackMicroseconds;
};

__declspec(dllexport) HRESULT WINAPI SGVideo_Create(void** handle);
__declspec(dllexport) void WINAPI SGVideo_Destroy(void* handle);
__declspec(dllexport) HRESULT WINAPI SGVideo_StartCapture(void* handle);
__declspec(dllexport) HRESULT WINAPI SGVideo_GetDimensions(void* handle, UINT32* width, UINT32* height);
__declspec(dllexport) HRESULT WINAPI SGVideo_AcquireFrame(void* handle, BYTE* destination, UINT32 destinationBytes, UINT32 timeoutMilliseconds, SGVideoFrame* frame);
__declspec(dllexport) HRESULT WINAPI SGVideo_GetLastError(void* handle);

}

namespace {

class VideoCapture final {
public:
    HRESULT Start() {
        ReleaseResources();
        HRESULT hr = CreateDXGIFactory1(IID_PPV_ARGS(&factory_));
        if (FAILED(hr)) return SetError(hr);

        ComPtr<IDXGIAdapter1> selectedAdapter;
        ComPtr<IDXGIOutput> selectedOutput;
        DXGI_OUTPUT_DESC selectedDesc{};
        bool foundOrigin = false;
        for (UINT adapterIndex = 0; ; ++adapterIndex) {
            ComPtr<IDXGIAdapter1> adapter;
            hr = factory_->EnumAdapters1(adapterIndex, &adapter);
            if (hr == DXGI_ERROR_NOT_FOUND) break;
            if (FAILED(hr)) continue;
            for (UINT outputIndex = 0; ; ++outputIndex) {
                ComPtr<IDXGIOutput> output;
                hr = adapter->EnumOutputs(outputIndex, &output);
                if (hr == DXGI_ERROR_NOT_FOUND) break;
                if (FAILED(hr)) continue;
                DXGI_OUTPUT_DESC desc{};
                if (FAILED(output->GetDesc(&desc)) || !desc.AttachedToDesktop) continue;
                const bool containsOrigin = desc.DesktopCoordinates.left <= 0 && desc.DesktopCoordinates.top <= 0 &&
                    desc.DesktopCoordinates.right > 0 && desc.DesktopCoordinates.bottom > 0;
                if (!selectedOutput || (containsOrigin && !foundOrigin)) {
                    selectedAdapter = adapter;
                    selectedOutput = output;
                    selectedDesc = desc;
                    foundOrigin = containsOrigin;
                }
            }
        }
        if (!selectedAdapter || !selectedOutput) return SetError(DXGI_ERROR_NOT_FOUND);

        static constexpr D3D_FEATURE_LEVEL featureLevels[] = {
            D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_10_0,
        };
        hr = D3D11CreateDevice(selectedAdapter.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT, featureLevels, ARRAYSIZE(featureLevels), D3D11_SDK_VERSION,
            &device_, &featureLevel_, &context_);
        if (FAILED(hr)) return SetError(hr);

        hr = selectedOutput.As(&output_);
        if (FAILED(hr)) return SetError(hr);
        hr = output_->DuplicateOutput(device_.Get(), &duplication_);
        if (FAILED(hr)) return SetError(hr);
        if (!duplication_) return SetError(E_UNEXPECTED);

        DXGI_OUTDUPL_DESC duplicationDesc{};
        duplication_->GetDesc(&duplicationDesc);
        return EnsureStaging(duplicationDesc.ModeDesc.Width, duplicationDesc.ModeDesc.Height, duplicationDesc.ModeDesc.Format);
    }

    HRESULT Dimensions(UINT32* width, UINT32* height) const {
        if (!width || !height) return E_POINTER;
        *width = width_;
        *height = height_;
        return width_ && height_ ? S_OK : DXGI_ERROR_INVALID_CALL;
    }

    HRESULT Acquire(BYTE* destination, UINT32 destinationBytes, UINT32 timeoutMilliseconds, SGVideoFrame* frame) {
        if (!destination || !frame) return SetError(E_POINTER);
        if (!duplication_ || !context_ || !staging_) return SetError(DXGI_ERROR_INVALID_CALL);
        const UINT64 required = static_cast<UINT64>(width_) * height_ * 4;
        if (required > destinationBytes) return SetError(HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER));
        *frame = {};

        const auto acquireStarted = std::chrono::steady_clock::now();
        DXGI_OUTDUPL_FRAME_INFO frameInfo{};
        ComPtr<IDXGIResource> resource;
        HRESULT hr = duplication_->AcquireNextFrame(timeoutMilliseconds, &frameInfo, &resource);
        frame->acquireMicroseconds = ElapsedMicroseconds(acquireStarted);
        if (hr == DXGI_ERROR_WAIT_TIMEOUT) return hr;
        if (hr == DXGI_ERROR_ACCESS_LOST) {
            Start();
            return SetError(hr);
        }
        if (FAILED(hr)) return SetError(hr);
        struct FrameRelease { IDXGIOutputDuplication* duplication; ~FrameRelease() { if (duplication) duplication->ReleaseFrame(); } } release{duplication_.Get()};

        ComPtr<ID3D11Texture2D> texture;
        hr = resource.As(&texture);
        if (FAILED(hr)) return SetError(hr);
        D3D11_TEXTURE2D_DESC desc{};
        texture->GetDesc(&desc);
        if (desc.Width != width_ || desc.Height != height_ || desc.Format != format_) {
            hr = EnsureStaging(desc.Width, desc.Height, desc.Format);
            if (FAILED(hr)) return hr;
            const UINT64 changedRequired = static_cast<UINT64>(width_) * height_ * 4;
            if (changedRequired > destinationBytes) return SetError(HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER));
        }

        const auto copyStarted = std::chrono::steady_clock::now();
        context_->CopyResource(staging_.Get(), texture.Get());
        frame->gpuCopyMicroseconds = ElapsedMicroseconds(copyStarted);
        const auto mapStarted = std::chrono::steady_clock::now();
        D3D11_MAPPED_SUBRESOURCE mapped{};
        hr = context_->Map(staging_.Get(), 0, D3D11_MAP_READ, 0, &mapped);
        if (FAILED(hr)) return SetError(hr);
        struct Unmap { ID3D11DeviceContext* context; ID3D11Resource* resource; ~Unmap() { context->Unmap(resource, 0); } } unmap{context_.Get(), staging_.Get()};
        if (!mapped.pData || mapped.RowPitch < width_ * 4) return SetError(E_FAIL);
        for (UINT32 row = 0; row < height_; ++row) {
            memcpy(destination + static_cast<size_t>(row) * width_ * 4,
                static_cast<const BYTE*>(mapped.pData) + static_cast<size_t>(row) * mapped.RowPitch, static_cast<size_t>(width_) * 4);
        }
        frame->mapReadbackMicroseconds = ElapsedMicroseconds(mapStarted);
        frame->width = width_;
        frame->height = height_;
        frame->stride = width_ * 4;
        return SetError(S_OK);
    }

    HRESULT LastError() const { return lastError_; }

private:
    static UINT64 ElapsedMicroseconds(std::chrono::steady_clock::time_point started) {
        return static_cast<UINT64>(std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - started).count());
    }
    HRESULT SetError(HRESULT hr) { lastError_ = hr; return hr; }
    HRESULT EnsureStaging(UINT32 width, UINT32 height, DXGI_FORMAT format) {
        if (!width || !height || format != DXGI_FORMAT_B8G8R8A8_UNORM) return SetError(DXGI_ERROR_UNSUPPORTED);
        if (staging_ && width == width_ && height == height_ && format == format_) return SetError(S_OK);
        staging_.Reset();
        D3D11_TEXTURE2D_DESC desc{};
        desc.Width = width; desc.Height = height; desc.MipLevels = 1; desc.ArraySize = 1; desc.Format = format;
        desc.SampleDesc.Count = 1; desc.Usage = D3D11_USAGE_STAGING; desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
        HRESULT hr = device_->CreateTexture2D(&desc, nullptr, &staging_);
        if (SUCCEEDED(hr)) { width_ = width; height_ = height; format_ = format; }
        return SetError(hr);
    }
    void ReleaseResources() {
        staging_.Reset(); duplication_.Reset(); output_.Reset(); context_.Reset(); device_.Reset(); factory_.Reset();
        width_ = height_ = 0; format_ = DXGI_FORMAT_UNKNOWN;
    }

    ComPtr<IDXGIFactory1> factory_;
    ComPtr<ID3D11Device> device_;
    ComPtr<ID3D11DeviceContext> context_;
    ComPtr<IDXGIOutput1> output_;
    ComPtr<IDXGIOutputDuplication> duplication_;
    ComPtr<ID3D11Texture2D> staging_;
    D3D_FEATURE_LEVEL featureLevel_{};
    DXGI_FORMAT format_ = DXGI_FORMAT_UNKNOWN;
    UINT32 width_ = 0, height_ = 0;
    HRESULT lastError_ = S_OK;
};

} // namespace

HRESULT WINAPI SGVideo_Create(void** handle) {
    if (!handle) return E_POINTER;
    *handle = new (std::nothrow) VideoCapture();
    return *handle ? S_OK : E_OUTOFMEMORY;
}
void WINAPI SGVideo_Destroy(void* handle) { delete static_cast<VideoCapture*>(handle); }
HRESULT WINAPI SGVideo_StartCapture(void* handle) { return handle ? static_cast<VideoCapture*>(handle)->Start() : E_POINTER; }
HRESULT WINAPI SGVideo_GetDimensions(void* handle, UINT32* width, UINT32* height) { return handle ? static_cast<VideoCapture*>(handle)->Dimensions(width, height) : E_POINTER; }
HRESULT WINAPI SGVideo_AcquireFrame(void* handle, BYTE* destination, UINT32 destinationBytes, UINT32 timeoutMilliseconds, SGVideoFrame* frame) { return handle ? static_cast<VideoCapture*>(handle)->Acquire(destination, destinationBytes, timeoutMilliseconds, frame) : E_POINTER; }
HRESULT WINAPI SGVideo_GetLastError(void* handle) { return handle ? static_cast<VideoCapture*>(handle)->LastError() : E_POINTER; }
