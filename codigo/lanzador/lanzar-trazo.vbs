' Arranca el lanzador de TRAZO v4 sin que parpadee la ventana negra de PowerShell.
Dim sh, aqui
Set sh = CreateObject("WScript.Shell")
aqui = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & aqui & "lanzar-trazo.ps1""", 0, False
