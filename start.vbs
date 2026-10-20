Option Explicit
Dim shell, files, folder, result, dataFolder, logName, logFile, attempt, errorNumber
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
dataFolder = files.BuildPath(folder, "data")
If Not files.FolderExists(dataFolder) Then
    On Error Resume Next
    files.CreateFolder dataFolder
    On Error GoTo 0
End If
' Reserve a distinct log before launching cmd: simultaneous cmd processes may
' produce the same initial RANDOM sequence.
For attempt = 1 To 20
    logName = "bootstrap-" & files.GetTempName() & ".log"
    On Error Resume Next
    Err.Clear
    Set logFile = files.CreateTextFile(files.BuildPath(dataFolder, logName), False)
    errorNumber = Err.Number
    On Error GoTo 0
    If errorNumber = 0 Then
        logFile.Close
        Exit For
    End If
Next
If errorNumber <> 0 Then
    MsgBox "Cannot create a startup log. Extract UOOC Study to a writable folder.", vbExclamation, "UOOC Study"
    WScript.Quit 1
End If
shell.Environment("PROCESS")("UOOC_STUDY_HIDDEN") = "1"
shell.Environment("PROCESS")("UOOC_STUDY_BOOT_LOG") = logName
result = shell.Run("""" & folder & "\start.bat"" --gui", 0, True)
If result <> 0 Then
    MsgBox "UOOC Study failed to start. See data\bootstrap-*.log and data\startup*.log, or run start.bat --check in a terminal.", vbExclamation, "UOOC Study"
End If
WScript.Quit result
