# Copia o player (fonte unica) para os assets do APK antes de gerar o build.
$src = Join-Path $PSScriptRoot "public\player.html"
$dst = Join-Path $PSScriptRoot "android\app\src\main\assets\web\player.html"
Copy-Item $src $dst -Force
Write-Output "player.html copiado para os assets do APK."
Write-Output "Agora gere o APK:  cd android; .\gradlew.bat assembleDebug"
