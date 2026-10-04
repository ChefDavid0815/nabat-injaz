using System.Runtime.InteropServices;
namespace Nabat.Windows;

public sealed class TrayService : IDisposable
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct IconData { public uint Size; public IntPtr Window; public uint Id, Flags, Callback; public IntPtr Icon; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Tip; public uint State, StateMask; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Info; public uint Timeout; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string Title; public uint InfoFlags; public Guid Guid; public IntPtr BalloonIcon; }
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    private delegate IntPtr Subclass(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam, UIntPtr id, IntPtr data);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern bool Shell_NotifyIcon(uint command, ref IconData data);
    [DllImport("comctl32.dll")] private static extern bool SetWindowSubclass(IntPtr hwnd, Subclass callback, UIntPtr id, IntPtr data);
    [DllImport("comctl32.dll")] private static extern bool RemoveWindowSubclass(IntPtr hwnd, Subclass callback, UIntPtr id);
    [DllImport("comctl32.dll")] private static extern IntPtr DefSubclassProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr LoadImage(IntPtr instance, string file, uint type, int x, int y, uint flags);
    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr icon);
    [DllImport("user32.dll")] private static extern IntPtr CreatePopupMenu();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool AppendMenu(IntPtr menu, uint flags, UIntPtr id, string text);
    [DllImport("user32.dll")] private static extern int TrackPopupMenu(IntPtr menu, uint flags, int x, int y, int reserved, IntPtr owner, IntPtr rectangle);
    [DllImport("user32.dll")] private static extern bool DestroyMenu(IntPtr menu);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
    private readonly IntPtr _window, _icon; private readonly Subclass _callback; private IconData _data; private readonly Action<string> _action;
    public bool Enabled { get; private set; }
    public int Critical { get; set; }
    public int Tasks { get; set; }
    public string Sync { get; set; } = "Synced";
    public TrayService(IntPtr window, string icon, Action<string> action) { _window = window; _action = action; _icon = LoadImage(IntPtr.Zero, icon, 1, 32, 32, 0x10); _callback = WindowProc; SetWindowSubclass(window, _callback, (UIntPtr)42, IntPtr.Zero); _data = new() { Size = (uint)Marshal.SizeOf<IconData>(), Window = window, Id = 42, Flags = 7, Callback = 0x8033, Icon = _icon, Tip = "NABAT Operations", Info = "", Title = "" }; }
    public void SetEnabled(bool enabled) { if (enabled == Enabled) return; if (enabled) { if (!Shell_NotifyIcon(0, ref _data)) throw new InvalidOperationException("Windows could not create the tray icon."); } else Shell_NotifyIcon(2, ref _data); Enabled = enabled; }
    public void Update() { if (!Enabled) return; _data.Tip = $"NABAT · {Critical} critical · {Tasks} tasks · {Sync}"; Shell_NotifyIcon(1, ref _data); }
    private IntPtr WindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam, UIntPtr id, IntPtr data) { if (message == 0x8033) { var notification = (int)lParam & 65535; if (notification is 0x202 or 0x400) _action("open"); if (notification is 0x205 or 0x7B) { var menu = CreatePopupMenu(); try { AppendMenu(menu, 0, (UIntPtr)1, "Open NABAT"); AppendMenu(menu, 0, (UIntPtr)2, $"Critical plants: {Critical}"); AppendMenu(menu, 0, (UIntPtr)3, $"Today's tasks: {Tasks}"); AppendMenu(menu, 0, (UIntPtr)4, "Quick add plant"); AppendMenu(menu, 0, (UIntPtr)5, "Sync: " + Sync); AppendMenu(menu, 0, (UIntPtr)6, "Quit"); GetCursorPos(out var point); SetForegroundWindow(_window); var command = TrackPopupMenu(menu, 0x100 | 2, point.X, point.Y, 0, _window, IntPtr.Zero); if (command > 0) _action(new[] { "", "open", "critical", "today", "add", "sync", "quit" }[command]); } finally { DestroyMenu(menu); } } return IntPtr.Zero; } return DefSubclassProc(hwnd, message, wParam, lParam); }
    public void Dispose() { if (Enabled) Shell_NotifyIcon(2, ref _data); RemoveWindowSubclass(_window, _callback, (UIntPtr)42); if (_icon != IntPtr.Zero) DestroyIcon(_icon); }
}
