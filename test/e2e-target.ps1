# A focused text box for test/e2e.mjs on Windows to type into.
#
# Mirrors the box's contents into $OutFile on every change, and touches
# $ReadyFile once the window has been shown and focused.
param(
  [Parameter(Mandatory = $true)][string]$OutFile,
  [Parameter(Mandatory = $true)][string]$ReadyFile
)

Add-Type -AssemblyName System.Windows.Forms

$form = New-Object System.Windows.Forms.Form
$form.Text = "Type Deck e2e target"
$form.Width = 800
$form.Height = 600
$form.TopMost = $true
$form.StartPosition = "CenterScreen"

$box = New-Object System.Windows.Forms.TextBox
$box.Multiline = $true
$box.AcceptsReturn = $true
$box.Dock = "Fill"
$form.Controls.Add($box)

$box.Add_TextChanged({
  [System.IO.File]::WriteAllText($OutFile, $box.Text, [System.Text.Encoding]::UTF8)
})

$form.Add_Shown({
  $form.Activate()
  $box.Focus() | Out-Null
  [System.IO.File]::WriteAllText($ReadyFile, "ready")
})

[System.Windows.Forms.Application]::Run($form)
