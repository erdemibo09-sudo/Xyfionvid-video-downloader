Add-Type -AssemblyName System.Drawing

function New-XyfionBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $pad = [Math]::Max(1.0, $size * 0.04)
    $w = $size - ($pad * 2)
    $radius = $w * 0.24

    # Rounded rectangle path
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc($pad, $pad, $d, $d, 180, 90)
    $path.AddArc($pad + $w - $d, $pad, $d, $d, 270, 90)
    $path.AddArc($pad + $w - $d, $pad + $w - $d, $d, $d, 0, 90)
    $path.AddArc($pad, $pad + $w - $d, $d, $d, 90, 90)
    $path.CloseFigure()

    $rect = New-Object System.Drawing.RectangleF($pad, $pad, $w, $w)
    $c1 = [System.Drawing.Color]::FromArgb(255, 79, 98, 248)   # Indigo/Blue
    $c2 = [System.Drawing.Color]::FromArgb(255, 139, 92, 246)  # Violet
    $c3 = [System.Drawing.Color]::FromArgb(255, 217, 70, 239)  # Pink/Magenta accent
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c3, 45.0)
    $blend = New-Object System.Drawing.Drawing2D.ColorBlend
    $blend.Colors = @($c1, $c2, $c3)
    $blend.Positions = @(0.0, 0.55, 1.0)
    $brush.InterpolationColors = $blend
    $g.FillPath($brush, $path)

    # Subtle inner border highlight
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(65, 255, 255, 255), [Math]::Max(1.0, $size * 0.02))
    $g.DrawPath($borderPen, $path)

    # Crisp white lightning bolt in center
    $bolt = @(
        [System.Drawing.PointF]::new($size * 0.54, $size * 0.17),
        [System.Drawing.PointF]::new($size * 0.26, $size * 0.54),
        [System.Drawing.PointF]::new($size * 0.48, $size * 0.54),
        [System.Drawing.PointF]::new($size * 0.43, $size * 0.83),
        [System.Drawing.PointF]::new($size * 0.74, $size * 0.44),
        [System.Drawing.PointF]::new($size * 0.52, $size * 0.44)
    )
    $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.FillPolygon($whiteBrush, $bolt)

    $whiteBrush.Dispose()
    $borderPen.Dispose()
    $brush.Dispose()
    $path.Dispose()
    $g.Dispose()
    return $bmp
}

$outIco = Join-Path $PSScriptRoot "XyfionVid.ico"
$outPng = Join-Path $PSScriptRoot "preview_icon.png"

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngStreams = @()

foreach ($sz in $sizes) {
    $bmp = New-XyfionBitmap $sz
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    if ($sz -eq 256) {
        [System.IO.File]::WriteAllBytes($outPng, $ms.ToArray())
    }
    $pngStreams += @{ Size = $sz; Data = $ms.ToArray() }
    $ms.Dispose()
    $bmp.Dispose()
}

# Build PNG-in-ICO container (supported natively on Vista / Win 7 / Win 10 / Win 11)
$outMs = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($outMs)

# ICONDIR: reserved(2)=0, type(2)=1, count(2)
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$pngStreams.Count)

$offset = 6 + (16 * $pngStreams.Count)
foreach ($item in $pngStreams) {
    $wByte = if ($item.Size -ge 256) { [byte]0 } else { [byte]$item.Size }
    $bw.Write($wByte)                  # width
    $bw.Write($wByte)                  # height
    $bw.Write([byte]0)                 # color count
    $bw.Write([byte]0)                 # reserved
    $bw.Write([uint16]1)               # planes
    $bw.Write([uint16]32)              # bpp
    $bw.Write([uint32]$item.Data.Length) # bytes in res
    $bw.Write([uint32]$offset)         # image offset
    $offset += $item.Data.Length
}

foreach ($item in $pngStreams) {
    $bw.Write($item.Data)
}

$bw.Flush()
[System.IO.File]::WriteAllBytes($outIco, $outMs.ToArray())
$bw.Dispose()
$outMs.Dispose()
Write-Host "Icon generated successfully: $outIco"
