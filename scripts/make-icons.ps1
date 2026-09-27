<#
  Regenerates the site icons from a single source image.

    npm run icons            regenerate by hand
    npm run build            regenerates automatically (prebuild hook)

  Writes public/apple-touch-icon.png (180), public/logo192.png and
  public/logo512.png.

  A favicon.ico placed by hand in the project root is the master copy: every run
  restores it into public/ and it is never regenerated from the source image.

  A build must never be broken by an icon problem, so every failure path exits
  0 and leaves the existing icons in place.
#>
param(
  [string]$Source = "src/mariot-icon.webp",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Complete([string]$Message) {
  Write-Host $Message
  exit 0
}

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root $Source
$faviconPath = Join-Path $root "public/favicon.ico"

# A favicon you placed by hand in the project root outranks the generated one,
# so restore it before anything else happens.
$masterIcon = Join-Path $root "favicon.ico"
$masterIconInUse = Test-Path -LiteralPath $masterIcon
if ($masterIconInUse) {
  Copy-Item -LiteralPath $masterIcon -Destination $faviconPath -Force
}

if (-not (Test-Path -LiteralPath $sourcePath)) {
  Complete "[icons] No source image at $Source - keeping the current icons."
}

# An icon you placed by hand must never be silently replaced, so this only
# rebuilds when the source image is newer than the files already in public/.
# public/favicon.ico is absent from this list because it comes from the root
# file above, and its fresh timestamp would otherwise hide a changed source.
$outputs = @(
  "public/apple-touch-icon.png",
  "public/logo192.png",
  "public/logo512.png"
) | ForEach-Object { Join-Path $root $_ }

$newestOutput = $null
foreach ($output in $outputs) {
  if (Test-Path -LiteralPath $output) {
    $stamp = (Get-Item -LiteralPath $output).LastWriteTime
    if (-not $newestOutput -or $stamp -gt $newestOutput) { $newestOutput = $stamp }
  }
}

$sourceStamp = (Get-Item -LiteralPath $sourcePath).LastWriteTime

if (-not $Force -and $newestOutput -and $sourceStamp -le $newestOutput) {
  Complete "[icons] $Source is not newer than the icons in public/ - leaving them untouched. Rebuild them anyway with: npm run icons -- -Force"
}

try {
  Add-Type -AssemblyName PresentationCore
  $decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create((New-Object System.Uri($sourcePath)), "None", "OnLoad")
  $converted = New-Object System.Windows.Media.Imaging.FormatConvertedBitmap($decoder.Frames[0], ([System.Windows.Media.PixelFormats]::Bgra32), $null, 0)
} catch {
  Complete "[icons] Could not read $Source - keeping the current icons."
}

$width = $converted.PixelWidth
$height = $converted.PixelHeight
$stride = $width * 4
$pixels = New-Object byte[] ($stride * $height)
$converted.CopyPixels($pixels, $stride, 0)

$hasAlpha = $false
for ($i = 3; $i -lt $pixels.Length; $i += 4) {
  if ($pixels[$i] -ne 255) { $hasAlpha = $true; break }
}

$corners = @(
  0,
  (($width - 1) * 4),
  (($height - 1) * $stride),
  ((($height - 1) * $stride) + (($width - 1) * 4))
)
$cornersBlack = $true
foreach ($corner in $corners) {
  if ($pixels[$corner] -ge 45 -or $pixels[$corner + 1] -ge 45 -or $pixels[$corner + 2] -ge 45) {
    $cornersBlack = $false
  }
}

if (-not $hasAlpha -and $cornersBlack) {
  $low = 24.0
  $high = 56.0
  for ($i = 0; $i -lt $pixels.Length; $i += 4) {
    $luminance = 0.299 * $pixels[$i + 2] + 0.587 * $pixels[$i + 1] + 0.114 * $pixels[$i]
    if ($luminance -le $low) {
      $pixels[$i + 3] = 0
    } elseif ($luminance -lt $high) {
      $pixels[$i + 3] = [byte][math]::Round(255 * ($luminance - $low) / ($high - $low))
    } else {
      $pixels[$i + 3] = 255
    }
  }
  $note = "removed its black background"
} elseif ($hasAlpha) {
  $note = "kept its transparency"
} else {
  $note = "kept as-is"
}

$bitmap = New-Object System.Windows.Media.Imaging.WriteableBitmap($width, $height, 96, 96, ([System.Windows.Media.PixelFormats]::Bgra32), $null)
$bitmap.WritePixels((New-Object System.Windows.Int32Rect(0, 0, $width, $height)), $pixels, $stride, 0)
$bitmap.Freeze()

function Get-Rendered($source, [int]$size) {
  $visual = New-Object System.Windows.Media.DrawingVisual
  [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($visual, [System.Windows.Media.BitmapScalingMode]::HighQuality)
  $context = $visual.RenderOpen()
  $context.DrawImage($source, (New-Object System.Windows.Rect(0, 0, $size, $size)))
  $context.Close()
  $target = New-Object System.Windows.Media.Imaging.RenderTargetBitmap($size, $size, 96, 96, ([System.Windows.Media.PixelFormats]::Pbgra32))
  $target.Render($visual)
  return $target
}

function Get-PngBytes($bitmap) {
  $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
  $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
  $stream = New-Object System.IO.MemoryStream
  $encoder.Save($stream)
  return ,$stream.ToArray()
}

if (-not $masterIconInUse) {
  $icoSizes = @(16, 32, 48)
  $payloads = New-Object 'System.Collections.Generic.List[byte[]]'
  foreach ($size in $icoSizes) {
    [byte[]]$png = Get-PngBytes (Get-Rendered $bitmap $size)
    $payloads.Add($png)
  }

  $stream = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter($stream)
  $writer.Write([uint16]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]$payloads.Count)
  $offset = 6 + 16 * $payloads.Count
  for ($i = 0; $i -lt $payloads.Count; $i++) {
    $dimension = if ($icoSizes[$i] -ge 256) { 0 } else { $icoSizes[$i] }
    $writer.Write([byte]$dimension)
    $writer.Write([byte]$dimension)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$payloads[$i].Length)
    $writer.Write([uint32]$offset)
    $offset += $payloads[$i].Length
  }
  foreach ($payload in $payloads) { $writer.Write($payload, 0, $payload.Length) }
  $writer.Flush()
  [System.IO.File]::WriteAllBytes($faviconPath, $stream.ToArray())
}

$targets = @(
  @{ Size = 180; Name = "apple-touch-icon.png" },
  @{ Size = 192; Name = "logo192.png" },
  @{ Size = 512; Name = "logo512.png" }
)
foreach ($target in $targets) {
  $file = Join-Path (Join-Path $root "public") $target.Name
  [System.IO.File]::WriteAllBytes($file, (Get-PngBytes (Get-Rendered $bitmap $target.Size)))
}

$advice = if ($width -lt 512) { " A source of 512px or more would look sharper." } else { "" }
$faviconNote = if ($masterIconInUse) { " Your root favicon.ico was restored." } else { " favicon.ico was regenerated." }
Complete "[icons] Regenerated the PNG icons from $Source (${width}x${height}), $note.$faviconNote$advice"
