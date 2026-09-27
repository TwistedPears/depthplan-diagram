; Use the classes registered by Tauri, including their install scope and cleanup.
!macro NSIS_HOOK_POSTINSTALL
  Push $R0
  ReadRegStr $R0 SHELL_CONTEXT "Software\Classes\.depthplan" ""
  ${If} $R0 != ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\$R0\shell\open\command" "" '"$INSTDIR\depthplan.exe" "%1"'
  ${EndIf}
  ReadRegStr $R0 SHELL_CONTEXT "Software\Classes\.depthproject" ""
  ${If} $R0 != ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\$R0\shell\open\command" "" '"$INSTDIR\depthplan.exe" "%1"'
    WriteRegStr SHELL_CONTEXT "Software\Classes\$R0\DefaultIcon" "" '"$INSTDIR\project.ico",0'
  ${EndIf}
  Pop $R0
!macroend
