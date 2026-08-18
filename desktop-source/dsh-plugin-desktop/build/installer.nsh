; electron-builder NSIS include for DeepSeek Harness Desktop.
;
; The electron-builder built-in "uninstall the old version first" flow copies
; the old uninstaller into $PLUGINSDIR and runs it with _?=$INSTDIR. In that
; mode the old uninstaller has no usable $PLUGINSDIR and its atomic move of the
; install tree fails (deep paths also exceed MAX_PATH), so the installer loops
; five times and dead-ends in an "appCannotBeClosed" retry dialog even when no
; app process is running. The macros below replace that flow:
;
;   customInit            - called right after $INSTDIR is resolved. Kills any
;                           still-running app processes, then takes over the
;                           old install tree itself (RMDir /r with a robocopy
;                           mirror fallback for long paths) and clears the old
;                           uninstall registry entries so electron-builder's
;                           built-in old-version uninstall step is skipped.
;   customCheckAppRunning - replaces the built-in close/retry MessageBox loop
;                           with a bounded, dialog-free wait. After ~10s it
;                           proceeds regardless, so the installer can never
;                           trap the user in a "cannot close the app" dialog.
;   customRemoveFiles     - robust uninstall wipe (robocopy fallback).
;   customUnInstall       - kills app processes before uninstall so file locks
;                           do not abort it.

!macro customInit
  ; Kill still-running instances first (current + legacy exe names). Windows
  ; file locks otherwise make the old-version uninstall fail with "Failed to
  ; uninstall old application files". /F is force, /T takes child processes
  ; (the dsh web node tree) along.
  nsExec::Exec 'taskkill /F /T /IM "DeepSeek Harness Desktop.exe"'
  nsExec::Exec 'taskkill /F /T /IM "DSH Desktop.exe"'

  ; ---- dshTakeoverWipe: never run the OLD uninstaller ----------------------
  ; The old uninstaller deletes files first and directories second; when it
  ; aborts midway (broken $PLUGINSDIR under _?=, deep paths past MAX_PATH) it
  ; leaves skeletons that fail the upgrade with "Failed to uninstall old
  ; application files ... : 2". All app processes were already killed above,
  ; so we remove the old tree ourselves and clear the old uninstall registry
  ; entries - the built-in old-version uninstall step then finds nothing to
  ; run and the new files land on a clean tree.
  StrCpy $5 0
  ${If} ${FileExists} "$INSTDIR\resources\app.asar"
    ${If} ${FileExists} "$INSTDIR\DeepSeek Harness Desktop.exe"
    ${OrIf} ${FileExists} "$INSTDIR\DSH Desktop.exe"
      StrCpy $5 1
    ${EndIf}
  ${EndIf}
  ${If} $5 == 1
    ; never wipe a directory that is not named like our product (custom
    ; install into a shared parent folder must not nuke siblings), and
    ; never a suspiciously short path (drive root, Program Files root).
    ; NOTE: the tail-slice length MUST equal the literal below
    ; ("\DeepSeek Harness Desktop" = 25 chars) - a mismatch silently
    ; disables the takeover and the old uninstaller runs again.
    StrLen $6 "$INSTDIR"
    StrCpy $7 0
    ${If} $6 >= 25
      StrCpy $8 $INSTDIR "" -25
      ${If} $8 == "\DeepSeek Harness Desktop"
        StrCpy $7 1
      ${EndIf}
    ${EndIf}
    ${If} $7 == 1
      ; move the working directory out of the tree we are about to delete
      SetOutPath $TEMP
      ClearErrors
      RMDir /r "$INSTDIR"
      ${If} ${FileExists} "$INSTDIR\resources\app.asar"
        ; long-path leftovers defeat RMDir /r (MAX_PATH): mirror an empty
        ; directory over the tree - robocopy handles >260 char paths natively.
        CreateDirectory "$TEMP\dsh-empty-wipe"
        nsExec::Exec 'robocopy "$TEMP\dsh-empty-wipe" "$INSTDIR" /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1'
        RMDir /r "$INSTDIR"
        RMDir "$TEMP\dsh-empty-wipe"
      ${EndIf}
      ; drop old uninstaller entries so the built-in old-version uninstall
      ; step is skipped entirely (never run the old uninstaller)
      DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
      DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
    ${EndIf}
  ${EndIf}

  ; Drop stale shortcuts from legacy builds. The current shortcut is
  ; recreated by the standard install steps.
  Delete "$DESKTOP\DSH Desktop.lnk"
  Delete "$SMPROGRAMS\DSH Desktop.lnk"
!macroend

; Dialog-free replacement for the built-in CHECK_APP_RUNNING: wait (up to
; ~10s) until no current/legacy app exe is alive, then continue regardless.
; Force-kill was already attempted in customInit; if something survives
; (elevated instance), proceeding still lets the silent path work and never
; traps the user in a retry MessageBox loop.
; nsExec directly starts tasklist (no cmd.exe, no `|`, no findstr); /FI filters
; by exact image name, /FO CSV /NH means a live process's first line starts
; with `"` while "no tasks" output is localized text (or empty) - the first
; character check is language-independent.
!macro customCheckAppRunning
  StrCpy $1 0
  dshWaitLoop:
    IntOp $1 $1 + 1
    ${If} $1 > 20
      DetailPrint "App process did not exit; continuing anyway"
      Goto dshWaitDone
    ${EndIf}

    StrCpy $2 0

    nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq DeepSeek Harness Desktop.exe" /FO CSV /NH'
    Pop $3
    Pop $0
    StrCpy $4 $0 1
    ${If} $4 == '"'
      StrCpy $2 1
    ${EndIf}

    nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq DSH Desktop.exe" /FO CSV /NH'
    Pop $3
    Pop $0
    StrCpy $4 $0 1
    ${If} $4 == '"'
      StrCpy $2 1
    ${EndIf}

    ${If} $2 == 1
      Sleep 500
      Goto dshWaitLoop
    ${EndIf}
  dshWaitDone:
!macroend

; Robust uninstall wipe. Deep node_modules paths past MAX_PATH defeat the
; plain RMDir /r; mirroring an empty directory over the tree first lets
; robocopy handle >260 char paths natively.
!macro customRemoveFiles
  SetOutPath $TEMP
  ClearErrors
  RMDir /r "$INSTDIR"
  ${If} ${FileExists} "$INSTDIR\resources\app.asar"
    CreateDirectory "$TEMP\dsh-empty-wipe"
    nsExec::Exec 'robocopy "$TEMP\dsh-empty-wipe" "$INSTDIR" /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1'
    RMDir /r "$INSTDIR"
    RMDir "$TEMP\dsh-empty-wipe"
  ${EndIf}
!macroend

!macro customUnInstall
  ; ensure no leftover process holds locks on user-data files or the install
  ; tree (silent uninstall may run while the app is still up)
  nsExec::Exec 'taskkill /F /T /IM "DeepSeek Harness Desktop.exe"'
  nsExec::Exec 'taskkill /F /T /IM "DSH Desktop.exe"'
!macroend
