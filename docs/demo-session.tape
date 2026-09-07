# User changes the live tool set; the model sees the new list.
#   bash scripts/vhs-record.sh docs/demo-session.tape

Output assets/demo-session.mp4
Set FontSize 15
Set Width 1200
Set Height 720
Set Padding 16
Set Framerate 30
Set TypingSpeed 1ms
Set Shell bash
Set WindowBar Colorful
Set Theme "Catppuccin Mocha"
Set WaitTimeout 180s

Hide
Type `clear && bash scripts/vhs-demo.sh session`
Enter
Wait+Screen /0.0%/
Sleep 800ms
Show

Set TypingSpeed 40ms
Type `List every tool you can call right now. Names only, one per line. Then write END_LIST. Do not call any tools.`
Sleep 400ms
Escape
Sleep 200ms
Enter
Wait+Screen /END_LIST/
Sleep 1800ms

Type `/toolbelt tools`
Sleep 700ms
Escape
Sleep 250ms
Enter
Wait+Screen /Toolbelt Tools/
Sleep 1000ms
Type "bash"
Sleep 800ms
Space
Sleep 900ms
Enter
Wait+Screen /Snapshot persisted/
Sleep 1200ms
Escape
Sleep 800ms

Type `List every tool you can call right now. Names only, one per line. Then write END_AFTER. Do not call any tools.`
Sleep 400ms
Escape
Sleep 200ms
Enter
Wait+Screen /END_AFTER/
Sleep 2500ms
