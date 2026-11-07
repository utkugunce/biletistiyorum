import ctypes
import os
import time
from pathlib import Path

def open_folder_on_user_desktop(target_dir: Path):
    """
    Kullanıcının gerçek masaüstünde (WinSta0\\default) hedef klasörü açar,
    içindeki ilk PDF biletini seçer ve pencereyi en öne (Foreground) getirir.
    """
    target_str = str(target_dir.resolve())
    folder_name = target_dir.name

    pdf_files = []
    if target_dir.exists() and target_dir.is_dir():
        try:
            pdf_files = sorted([f for f in os.listdir(target_str) if f.lower().endswith(".pdf")])
        except Exception:
            pass

    if pdf_files:
        first_pdf = os.path.join(target_str, pdf_files[0])
        cmd = f'explorer.exe /select,"{first_pdf}"'
    else:
        cmd = f'explorer.exe "{target_str}"'

    try:
        u32 = ctypes.windll.user32
        k32 = ctypes.windll.kernel32

        class STARTUPINFOW(ctypes.Structure):
            _fields_ = [
                ('cb', ctypes.c_ulong),
                ('lpReserved', ctypes.c_wchar_p),
                ('lpDesktop', ctypes.c_wchar_p),
                ('lpTitle', ctypes.c_wchar_p),
                ('dwX', ctypes.c_ulong),
                ('dwY', ctypes.c_ulong),
                ('dwXSize', ctypes.c_ulong),
                ('dwYSize', ctypes.c_ulong),
                ('dwXCountChars', ctypes.c_ulong),
                ('dwYCountChars', ctypes.c_ulong),
                ('dwFillAttribute', ctypes.c_ulong),
                ('dwFlags', ctypes.c_ulong),
                ('wShowWindow', ctypes.c_ushort),
                ('cbReserved2', ctypes.c_ushort),
                ('lpReserved2', ctypes.c_void_p),
                ('hStdInput', ctypes.c_void_p),
                ('hStdOutput', ctypes.c_void_p),
                ('hStdError', ctypes.c_void_p),
            ]

        class PROCESS_INFORMATION(ctypes.Structure):
            _fields_ = [
                ('hProcess', ctypes.c_void_p),
                ('hThread', ctypes.c_void_p),
                ('dwProcessId', ctypes.c_ulong),
                ('dwThreadId', ctypes.c_ulong),
            ]

        si = STARTUPINFOW()
        si.cb = ctypes.sizeof(STARTUPINFOW)
        si.lpDesktop = "WinSta0\\default"
        si.dwFlags = 1  # STARTF_USESHOWWINDOW
        si.wShowWindow = 1  # SW_SHOWNORMAL

        pi = PROCESS_INFORMATION()
        k32.CreateProcessW(
            None,
            cmd,
            None,
            None,
            False,
            0,
            None,
            None,
            ctypes.byref(si),
            ctypes.byref(pi),
        )

        # Pencere açıldıktan sonra WinSta0\default masaüstüne bağlanıp pencereyi en öne getir
        h_default = u32.OpenDesktopW("default", 0, False, 0x10000000)
        if h_default:
            u32.SetThreadDesktop(h_default)

            WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
            for _ in range(8):
                time.sleep(0.18)
                found_hwnd = []

                def enum_cb(hwnd, lparam):
                    if u32.IsWindowVisible(hwnd):
                        length = u32.GetWindowTextLengthW(hwnd)
                        if length > 0:
                            buf = ctypes.create_unicode_buffer(length + 1)
                            u32.GetWindowTextW(hwnd, buf, length + 1)
                            title = buf.value
                            if folder_name.lower() in title.lower():
                                found_hwnd.append(hwnd)
                    return True

                u32.EnumDesktopWindows(h_default, WNDENUMPROC(enum_cb), 0)
                if found_hwnd:
                    target_hwnd = found_hwnd[0]
                    fg_hwnd = u32.GetForegroundWindow()
                    fg_tid = u32.GetWindowThreadProcessId(fg_hwnd, None)
                    cur_tid = k32.GetCurrentThreadId()
                    if fg_tid and cur_tid != fg_tid:
                        u32.AttachThreadInput(cur_tid, fg_tid, True)
                    u32.ShowWindow(target_hwnd, 9)  # SW_RESTORE
                    u32.BringWindowToTop(target_hwnd)
                    u32.SetForegroundWindow(target_hwnd)
                    if fg_tid and cur_tid != fg_tid:
                        u32.AttachThreadInput(cur_tid, fg_tid, False)
                    break
    except Exception as e:
        print("open_folder_on_user_desktop error:", e)
