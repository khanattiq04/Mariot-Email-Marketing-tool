<#
  Renders the social icons used by the email footer.

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-social-icons.ps1

  Writes public/icons/<network>.png: 96x96 on a transparent background, painted in
  each network's own brand colours. The footer shows them at 32px, so the 3x
  source stays sharp on retina screens. The outlines are the Simple Icons glyph
  paths (CC0, https://simpleicons.org), filled in brand colours rather than flat
  black so the icons look like the real marks.

  The PNGs are committed under public/icons/ and are served from whichever host
  serves the app, so the in-app preview and the delivered email load the same
  images. Re-run this only when a network is added or a brand colour changes, then
  bump the ?v= in the three email templates so mail clients and CDNs drop the
  copies they have cached.

  An icon problem must never be fatal, so every failure path exits 0 and leaves
  the icons already in public/ untouched.
#>
param(
  [string]$OutDir = "public/icons",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root $OutDir

# Rendered size in pixels. The email shows the icons at 32px, so 96 keeps them
# crisp on 3x screens.
$size = 96

# Each glyph is drawn on the 24x24 grid Simple Icons uses, leaving a small
# margin so no glyph touches the edge of the PNG.
$inset = 0.05

# The TikTok mark is the note glyph repeated in its three brand colours.
$tiktokOffsets = @(
  @{ Color = "#25F4EE"; X = -2.2; Y = -2.2 }
  @{ Color = "#FE2C55"; X = 2.2; Y = 2.2 }
  @{ Color = "#000000"; X = 0; Y = 0 }
)

# Name = output file, Fill or Gradient = how the glyph is painted, Path = the
# Simple Icons outline of that network.
$brands = @(
  @{
    Name     = "facebook"
    Fill     = "#1877F2"
    Path     = 'M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 
                 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 
                 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 
                 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 
                 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z '
  }
  @{
    Name     = "instagram"
    Gradient = @("#FEDA75", "#FA7E1E", "#D62976", "#962FBF", "#4F5BD5")
    Path     = 'M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 
                 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 
                 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 
                 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 
                 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 
                 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 
                 2.1228-1.3881.665-.6682 1.0745-1.3378 
                 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 
                 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 
                 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 
                 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 
                 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 
                 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 
                 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 
                 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 
                 2.2294-.216.5604-.4763.96-.8954 
                 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 
                 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 
                 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 
                 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 
                 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077 '
  }
  @{
    Name     = "x"
    Fill     = "#000000"
    Path     = 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 
                 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z '
  }
  @{
    Name     = "youtube"
    Fill     = "#FF0000"
    Path     = 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 
                 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 
                 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 
                 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 
                 3.568z '
  }
  @{
    Name     = "tiktok"
    Fill     = "#000000"
    Path     = 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 
                 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 
                 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 
                 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 
                 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 
                 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 
                 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 
                 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z '
  }
  @{
    Name     = "linkedin"
    Fill     = "#0A66C2"
    Path     = 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 
                 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 
                 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 
                 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 
                 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 
                 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z '
  }
  @{
    Name     = "pinterest"
    Fill     = "#E60023"
    Path     = 'M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 
                 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 
                 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 
                 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 
                 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 
                 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 
                 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 
                 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 
                 0-2.354-.629-2.758-1.379l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 
                 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.39 18.592.026 11.985.026L12.017 0z '
  }
)

function Complete([string]$Message) {
  Write-Host $Message
  exit 0
}

try {
  Add-Type -AssemblyName PresentationCore
} catch {
  Complete "[social-icons] WPF imaging is unavailable on this machine - keeping the current icons."
}

if (-not (Test-Path -LiteralPath $target)) {
  try {
    New-Item -ItemType Directory -Force -Path $target | Out-Null
  } catch {
    Complete "[social-icons] Could not create $OutDir - keeping the current icons."
  }
}

function Get-Brush($brand) {
  if ($brand.Gradient) {
    # Painted across the glyph in its own 24x24 coordinates, so the stop
    # positions do not depend on the rendered size.
    $brush = New-Object System.Windows.Media.LinearGradientBrush
    $brush.MappingMode = [System.Windows.Media.BrushMappingMode]::Absolute
    $brush.StartPoint = New-Object System.Windows.Point(1.5, 23.5)
    $brush.EndPoint = New-Object System.Windows.Point(22.5, 1.5)
    for ($i = 0; $i -lt $brand.Gradient.Count; $i++) {
      $offset = $i / ($brand.Gradient.Count - 1)
      $stop = New-Object System.Windows.Media.GradientStop(([System.Windows.Media.ColorConverter]::ConvertFromString($brand.Gradient[$i])), $offset)
      $brush.GradientStops.Add($stop)
    }
    return $brush
  }

  $color = [System.Windows.Media.ColorConverter]::ConvertFromString($brand.Fill)
  return New-Object System.Windows.Media.SolidColorBrush($color)
}

function Get-PngBytes($bitmap) {
  $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
  $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
  $stream = New-Object System.IO.MemoryStream
  $encoder.Save($stream)
  return ,$stream.ToArray()
}

$scale = ($size * (1 - 2 * $inset)) / 24.0
$margin = ($size - 24 * $scale) / 2

function Get-Transform([double]$dx, [double]$dy) {
  $group = New-Object System.Windows.Media.TransformGroup
  $group.Children.Add((New-Object System.Windows.Media.ScaleTransform($scale, $scale)))
  $group.Children.Add((New-Object System.Windows.Media.TranslateTransform(($margin + $dx), ($margin + $dy))))
  return $group
}

$rendered = 0
foreach ($brand in $brands) {
  $file = Join-Path $target ($brand.Name + ".png")
  try {
    $geometry = [System.Windows.Media.Geometry]::Parse($brand.Path)
    $visual = New-Object System.Windows.Media.DrawingVisual
    $context = $visual.RenderOpen()

    if ($brand.Name -eq "tiktok") {
      foreach ($layer in $tiktokOffsets) {
        $offset = New-Object System.Windows.Media.SolidColorBrush(([System.Windows.Media.ColorConverter]::ConvertFromString($layer.Color)))
        $context.PushTransform((Get-Transform $layer.X $layer.Y))
        $context.DrawGeometry($offset, $null, $geometry)
        $context.Pop()
      }
    } else {
      $context.PushTransform((Get-Transform 0 0))
      $context.DrawGeometry((Get-Brush $brand), $null, $geometry)
      $context.Pop()
    }

    $context.Close()

    $bitmap = New-Object System.Windows.Media.Imaging.RenderTargetBitmap($size, $size, 96, 96, ([System.Windows.Media.PixelFormats]::Pbgra32))
    $bitmap.Render($visual)
    [System.IO.File]::WriteAllBytes($file, (Get-PngBytes $bitmap))
    $rendered++
  } catch {
    Write-Warning "[social-icons] Could not render $($brand.Name): $($_.Exception.Message)"
  }
}

Complete "[social-icons] Rendered $rendered of $($brands.Count) icons into $OutDir."
