# Draws the app icon (a page with a highlighted line) to app-icon.png at 1024x1024.
# Then run:  npx tauri icon app-icon.png   to produce every size in src-tauri/icons.
# Usage:     powershell -NoProfile -File scripts/make-icon.ps1
Add-Type -AssemblyName System.Drawing

$size = 1024
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)

function RoundedRect($x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# Background tile: deep red gradient.
$tile = RoundedRect 32 32 960 960 210
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.Point]::new(0, 0)), ([System.Drawing.Point]::new(0, $size)), ([System.Drawing.Color]::FromArgb(255, 226, 64, 58)), ([System.Drawing.Color]::FromArgb(255, 168, 28, 36))
$g.FillPath($bg, $tile)

# Page with a folded top-right corner.
$fold = 170
$left = 256; $top = 168; $w = 512; $h = 688
$page = New-Object System.Drawing.Drawing2D.GraphicsPath
$page.AddLine($left, $top + 40, $left, $top + $h - 40)
$page.AddArc($left, $top + $h - 80, 80, 80, 180, -90)
$page.AddLine($left + 40, $top + $h, $left + $w - 40, $top + $h)
$page.AddArc($left + $w - 80, $top + $h - 80, 80, 80, 90, -90)
$page.AddLine($left + $w, $top + $h - 40, $left + $w, $top + $fold)
$page.AddLine($left + $w, $top + $fold, $left + $w - $fold, $top)
$page.AddLine($left + $w - $fold, $top, $left + 40, $top)
$page.AddArc($left, $top, 80, 80, 270, -90)
$page.CloseFigure()
$shadow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(70, 0, 0, 0))
$g.TranslateTransform(0, 14); $g.FillPath($shadow, $page); $g.ResetTransform()
$g.FillPath([System.Drawing.Brushes]::White, $page)

# The folded corner.
$corner = New-Object System.Drawing.Drawing2D.GraphicsPath
$corner.AddPolygon(@(
  [System.Drawing.Point]::new($left + $w - $fold, $top),
  [System.Drawing.Point]::new($left + $w, $top + $fold),
  [System.Drawing.Point]::new($left + $w - $fold, $top + $fold)))
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 226, 226, 230))), $corner)

# Text lines, with a yellow highlight over the middle one (drawn first so the text stays on top).
$gray = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 120, 124, 134))
$yellow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 214, 51))
$hl = RoundedRect 300 508 424 74 18
$g.FillPath($yellow, $hl)
foreach ($row in @(@(300, 338, 330), @(300, 526, 400), @(300, 640, 300), @(300, 754, 360))) {
  $line = RoundedRect $row[0] $row[1] $row[2] 38 19
  $g.FillPath($gray, $line)
}

$out = Join-Path (Split-Path $PSScriptRoot -Parent) 'app-icon.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "wrote $out"
