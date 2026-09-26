; Use the class registered by Tauri, including its install scope and cleanup.
!macro NSIS_HOOK_POSTINSTALL
  Push $R0
  ReadRegStr $R0 SHELL_CONTEXT "Software\Classes\.depthproject" ""
  ${If} $R0 != ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\$R0\DefaultIcon" "" '$"$INSTDIR\project.ico$",0'
  ${EndIf}
  Pop $R0
!macroend
