; Extra steps for the NSIS installer (referenced from tauri.conf.json > bundle > windows > nsis).
;
; 1. File association. The installer Tauri generates registers the app for .pdf files AND makes it
;    the default handler for the .pdf class (it overwrites HKCU\Software\Classes\.pdf's default value,
;    keeping a backup in a "<ProgID>_backup" value). We want the app to be offered under "Open with"
;    only: which PDF app is the default is the user's decision, and an installer should not change it.
;    ProgID = the "name" of the file association in tauri.conf.json.
;
; 2. Thumbnails. pdf_reader_thumbnail.dll (built from src-tauri/thumbnail) makes Explorer show the first
;    page of a PDF as its icon. Password-protected files can't be previewed, so they keep the normal icon.
;    The CLSID must match CLSID_PDF_THUMBNAIL in thumbnail/src/com.rs.

!define PDF_THUMB_CLSID "{8E1CF62A-63CC-4A85-B6C5-C00369B72936}"
!define SHELL_THUMB_HANDLER "{E357FCCD-A995-4576-B01F-234630154E96}"

; Explorer's thumbnail host (a COM surrogate, dllhost.exe) keeps the DLL loaded for a while after the
; last thumbnail. End any host that has it so the file can be replaced or deleted. Windows restarts
; the surrogate on demand. Failure is harmless.
!macro PDFREADER_RELEASE_THUMBNAIL_DLL
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "Get-Process dllhost -ErrorAction SilentlyContinue | Where-Object { try { $$_.Modules.FileName -like '*pdf_reader_thumbnail*' } catch { $$false } } | Stop-Process -Force -ErrorAction SilentlyContinue"`
  Pop $R9
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro PDFREADER_RELEASE_THUMBNAIL_DLL
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; --- file association: put the class default back to what it was before the installer touched it.
  ReadRegStr $0 SHCTX "Software\Classes\.pdf" "PDFReader.Document_backup"
  ${If} $0 == ""
    DeleteRegValue SHCTX "Software\Classes\.pdf" ""
  ${Else}
    WriteRegStr SHCTX "Software\Classes\.pdf" "" "$0"
  ${EndIf}
  DeleteRegValue SHCTX "Software\Classes\.pdf" "PDFReader.Document_backup"

  ; Offer the app in "Open with" without claiming the default.
  WriteRegStr SHCTX "Software\Classes\.pdf\OpenWithProgids" "PDFReader.Document" ""

  ; --- thumbnails
  WriteRegStr SHCTX "Software\Classes\CLSID\${PDF_THUMB_CLSID}" "" "PDF Reader Thumbnail Provider"
  WriteRegStr SHCTX "Software\Classes\CLSID\${PDF_THUMB_CLSID}\InprocServer32" "" "$INSTDIR\pdf_reader_thumbnail.dll"
  WriteRegStr SHCTX "Software\Classes\CLSID\${PDF_THUMB_CLSID}\InprocServer32" "ThreadingModel" "Both"
  ; For files whose default app is this one.
  WriteRegStr SHCTX "Software\Classes\PDFReader.Document\ShellEx\${SHELL_THUMB_HANDLER}" "" "${PDF_THUMB_CLSID}"
  ; For every PDF, but only if no other thumbnail handler is registered for the .pdf type: this
  ; covers people whose default app has none of its own, and never replaces anyone else's.
  ReadRegStr $1 HKCR ".pdf\ShellEx\${SHELL_THUMB_HANDLER}" ""
  ${If} $1 == ""
    WriteRegStr SHCTX "Software\Classes\.pdf\ShellEx\${SHELL_THUMB_HANDLER}" "" "${PDF_THUMB_CLSID}"
  ${EndIf}
  ; Tell Explorer that associations changed so it refreshes icons.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; --- file association: the generated uninstaller restores the class default from the
  ; "<ProgID>_backup" value, which we removed above. Record the current default there so that
  ; restore is a no-op instead of overwriting another app's default with an empty string.
  ReadRegStr $0 SHCTX "Software\Classes\.pdf" ""
  WriteRegStr SHCTX "Software\Classes\.pdf" "PDFReader.Document_backup" "$0"

  ; --- thumbnails: unregister first so nothing new loads the DLL, then release it.
  ReadRegStr $1 SHCTX "Software\Classes\.pdf\ShellEx\${SHELL_THUMB_HANDLER}" ""
  ${If} $1 == "${PDF_THUMB_CLSID}"
    DeleteRegKey SHCTX "Software\Classes\.pdf\ShellEx\${SHELL_THUMB_HANDLER}"
    DeleteRegKey /ifempty SHCTX "Software\Classes\.pdf\ShellEx"
  ${EndIf}
  DeleteRegKey SHCTX "Software\Classes\PDFReader.Document\ShellEx"
  DeleteRegKey SHCTX "Software\Classes\CLSID\${PDF_THUMB_CLSID}"
  !insertmacro PDFREADER_RELEASE_THUMBNAIL_DLL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Leave no trace: drop the "Open with" entry and the temporary backup, and if there was no default
  ; value to begin with, don't leave an empty one behind.
  ReadRegStr $0 SHCTX "Software\Classes\.pdf" "PDFReader.Document_backup"
  DeleteRegValue SHCTX "Software\Classes\.pdf" "PDFReader.Document_backup"
  DeleteRegValue SHCTX "Software\Classes\.pdf\OpenWithProgids" "PDFReader.Document"
  ${If} $0 == ""
    DeleteRegValue SHCTX "Software\Classes\.pdf" ""
  ${EndIf}
  ; The DLL may still have been in use a moment ago: make sure it goes (at next start if need be).
  Delete /REBOOTOK "$INSTDIR\pdf_reader_thumbnail.dll"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
