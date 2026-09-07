# Model discovers a hidden tool and turns it on.
#   bash scripts/vhs-record.sh docs/demo-query.tape

Output assets/demo-query.mp4
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
Type `clear && bash scripts/vhs-demo.sh query`
Enter
Wait+Screen /0.0%/
Sleep 800ms
Show

Set TypingSpeed 40ms
Type `You only have discovery tools on. A user wants a list of files in src/. Use query_tools to find a listing tool, then manage_tools to activate it, then list src/. Do not ask questions.`
Sleep 400ms
Escape
Sleep 200ms
Enter

Wait+Screen /query_tools/
Sleep 1200ms
Wait+Screen /Activated:/
Sleep 1200ms
Wait+Screen /baseline.ts/
Sleep 2500ms
