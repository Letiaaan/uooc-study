Option Explicit
Dim shell, files, folder, result
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
shell.Environment("PROCESS")("UOOC_STUDY_HIDDEN") = "1"
result = shell.Run("""" & folder & "\start.bat"" --gui", 0, True)
If result <> 0 Then
    MsgBox "UOOC Study failed to start. See data\bootstrap.log and data\startup.log, or run start.bat --check in a terminal.", vbExclamation, "UOOC Study"
End If
WScript.Quit result
