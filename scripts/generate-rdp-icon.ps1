[CmdletBinding()]
param([string]$Source, [string]$Output)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $Source) { $Source = Join-Path $root 'public\logos\sentinelgrid-mark.png' }
if (-not $Output) { $Output = Join-Path $root 'agent\cmd\sentinelgrid-rdp\sentinelgrid-mark.ico' }
Add-Type -AssemblyName System.Drawing
if (-not (Test-Path -LiteralPath $Source)) { throw "SentinelGrid mark is missing: $Source" }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Output) | Out-Null
$sourceImage = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $Source))
try {
    $sizes = @(16, 20, 24, 32, 48, 64, 128, 256)
    $entries = [System.Collections.Generic.List[byte[]]]::new()
    foreach ($size in $sizes) {
        $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $scale = [Math]::Min($size / $sourceImage.Width, $size / $sourceImage.Height)
                $width = [int][Math]::Round($sourceImage.Width * $scale); $height = [int][Math]::Round($sourceImage.Height * $scale)
                $graphics.DrawImage($sourceImage, [System.Drawing.Rectangle]::new([int](($size - $width) / 2), [int](($size - $height) / 2), $width, $height))
            } finally { $graphics.Dispose() }
            $stream = [System.IO.MemoryStream]::new()
            try { $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png); $entries.Add($stream.ToArray()) } finally { $stream.Dispose() }
        } finally { $bitmap.Dispose() }
    }
    $stream = [System.IO.File]::Open($Output, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    try {
        $writer = [System.IO.BinaryWriter]::new($stream)
        try {
            $writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]$sizes.Count); $offset = 6 + 16 * $sizes.Count
            for ($i = 0; $i -lt $sizes.Count; $i++) {
                $size = $sizes[$i]; $bytes = $entries[$i]
                $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size })); $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size })); $writer.Write([byte]0); $writer.Write([byte]0)
                $writer.Write([UInt16]1); $writer.Write([UInt16]32); $writer.Write([UInt32]$bytes.Length); $writer.Write([UInt32]$offset); $offset += $bytes.Length
            }
            foreach ($entry in $entries) { $writer.Write($entry) }
        } finally { $writer.Dispose() }
    } finally { $stream.Dispose() }
} finally { $sourceImage.Dispose() }
