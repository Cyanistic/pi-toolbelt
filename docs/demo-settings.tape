# Settings: global/project scopes, baseline modes, search backend.
#   bash scripts/vhs-record.sh docs/demo-settings.tape

Output assets/demo-settings.mp4
Set FontSize 15
Set Width 1100
Set Height 640
Set Padding 18
Set Framerate 30
Set TypingSpeed 1ms
Set Shell bash
Set WindowBar Colorful
Set Theme "Catppuccin Mocha"
Set WaitTimeout 20s

Hide
Type `clear && bash scripts/vhs-demo.sh settings`
Enter
Wait+Screen /0.0%/
Sleep 800ms
Show

Set TypingSpeed 45ms
Type `/toolbelt settings`
Sleep 700ms
Escape
Sleep 250ms
Enter
Wait+Screen /Toolbelt Settings/
Sleep 1800ms
Enter
Wait+Screen /Baseline/
Sleep 1400ms
Down
Sleep 600ms
Down
Sleep 600ms
Down
Sleep 900ms
Escape
Sleep 800ms
Down
Sleep 500ms
Enter
Wait+Screen /Search backend/
Sleep 1400ms
Down
Sleep 700ms
Down
Sleep 1000ms
Escape
Sleep 800ms
Tab
Sleep 1600ms
Tab
Sleep 1200ms
Escape
Sleep 1000ms
