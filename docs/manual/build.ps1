# Builds docs/manual/user-manual.pdf with XeLaTeX.
#
# XeLaTeX rather than pdfLaTeX because the document loads Noto Sans from
# fonts/ by file name; pdfLaTeX cannot read a TrueType file directly.
#
# Run twice: the first pass writes the .toc file, the second typesets the
# contents page from it. The same goes for the page count in the footer.

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$xelatex = (Get-Command xelatex -ErrorAction SilentlyContinue).Source
if (-not $xelatex) {
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\MiKTeX\miktex\bin\x64\xelatex.exe",
        "$env:ProgramFiles\MiKTeX\miktex\bin\x64\xelatex.exe"
    )
    $xelatex = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $xelatex) { throw "xelatex was not found. Install MiKTeX or TeX Live first." }

foreach ($pass in 1..2) {
    Write-Host "pass $pass of 2"
    & $xelatex -interaction=nonstopmode -halt-on-error user-manual.tex | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "xelatex failed on pass $pass - see user-manual.log" }
}

# The intermediates are noise; the PDF is the product.
Remove-Item -ErrorAction SilentlyContinue user-manual.aux, user-manual.log, user-manual.out, user-manual.toc

Copy-Item user-manual.pdf ..\USER_MANUAL.pdf -Force
Write-Host "built user-manual.pdf and copied it to docs\USER_MANUAL.pdf"
