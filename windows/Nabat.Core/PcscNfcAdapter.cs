using System.Runtime.InteropServices;
namespace Nabat.Core;
// ACR122U-compatible transparent APDUs. Restricts writes to writable NFC Forum Type 2 memory.
public sealed class PcscNfcAdapter(string reader) : INfcAdapter
{
    [StructLayout(LayoutKind.Sequential)] private struct IoRequest { public uint Protocol; public uint Size; }
    [DllImport("winscard.dll")] private static extern int SCardEstablishContext(uint scope, IntPtr a, IntPtr b, out IntPtr context);
    [DllImport("winscard.dll")] private static extern int SCardReleaseContext(IntPtr context);
    [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardListReaders(IntPtr context, string? groups, char[]? readers, ref uint count);
    [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardConnect(IntPtr context, string reader, uint share, uint protocols, out IntPtr card, out uint activeProtocol);
    [DllImport("winscard.dll")] private static extern int SCardDisconnect(IntPtr card, uint disposition);
    [DllImport("winscard.dll")] private static extern int SCardBeginTransaction(IntPtr card);
    [DllImport("winscard.dll")] private static extern int SCardEndTransaction(IntPtr card, uint disposition);
    [DllImport("winscard.dll")] private static extern int SCardTransmit(IntPtr card, ref IoRequest pci, byte[] send, uint sendLength, IntPtr receivePci, byte[] receive, ref uint receiveLength);
    public static List<string> Readers()
    {
        if (!OperatingSystem.IsWindows()) return [];
        Check(SCardEstablishContext(2, IntPtr.Zero, IntPtr.Zero, out var context), "Smart Card service");
        try { uint count = 0; var result = SCardListReaders(context, null, null, ref count); if (unchecked((uint)result) == 0x8010002E) return []; Check(result, "List readers"); var data = new char[count]; Check(SCardListReaders(context, null, data, ref count), "Read reader names"); return new string(data).Split('\0', StringSplitOptions.RemoveEmptyEntries).ToList(); }
        finally { SCardReleaseContext(context); }
    }
    private static void Check(int code, string action) { if (code != 0) throw new IOException($"{action} failed (PC/SC 0x{unchecked((uint)code):X8})."); }
    private T WithCard<T>(Func<IntPtr, uint, T> action)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        if (!reader.Contains("ACR122", StringComparison.OrdinalIgnoreCase)) throw new NotSupportedException("This adapter supports the ACR122 transparent APDU command set. Other readers need their own adapter.");
        Check(SCardEstablishContext(2, IntPtr.Zero, IntPtr.Zero, out var context), "Connect PC/SC");
        IntPtr card = IntPtr.Zero; bool transaction = false;
        try { Check(SCardConnect(context, reader, 2, 3, out card, out var protocol), "Connect tag"); Check(SCardBeginTransaction(card), "Lock tag transaction"); transaction = true; return action(card, protocol); }
        finally { if (transaction) SCardEndTransaction(card, 0); if (card != IntPtr.Zero) SCardDisconnect(card, 0); SCardReleaseContext(context); }
    }
    private static byte[] Send(IntPtr card, uint protocol, byte[] command)
    {
        var receive = new byte[2048]; uint length = (uint)receive.Length; var pci = new IoRequest { Protocol = protocol, Size = 8 };
        Check(SCardTransmit(card, ref pci, command, (uint)command.Length, IntPtr.Zero, receive, ref length), "Transmit NFC command");
        if (length < 2 || receive[length - 2] != 0x90 || receive[length - 1] != 0) throw new IOException($"Tag rejected the NFC command (SW {(length >= 2 ? Convert.ToHexString(receive.AsSpan((int)length - 2, 2)) : "missing")}).");
        return receive[..((int)length - 2)];
    }
    public Task<string> UidAsync() => Task.Run(() => WithCard((card, protocol) => Convert.ToHexString(Send(card, protocol, [0xFF, 0xCA, 0, 0, 0]))));
    private static byte[] ReadMemory(IntPtr card, uint protocol)
    {
        var cc = Send(card, protocol, [0xFF, 0xB0, 0, 3, 0x10]);
        if (cc.Length < 4 || cc[0] != 0xE1 || (cc[1] >> 4) != 1 || cc[2] == 0) throw new NotSupportedException("Expected an NFC Forum Type 2 tag with a valid capability container.");
        var capacity = cc[2] * 8; if (capacity > 1008) throw new NotSupportedException("Tag capacity is outside this adapter's supported bounds.");
        var bytes = new List<byte>(); for (var page = 4; bytes.Count < capacity; page += 4) bytes.AddRange(Send(card, protocol, [0xFF, 0xB0, 0, (byte)page, 0x10])); return bytes.Take(capacity).ToArray();
    }
    private static byte[] Extract(byte[] memory)
    {
        for (var offset = 0; offset < memory.Length;) { var type = memory[offset++]; if (type == 0) continue; if (type == 0xFE) break; if (offset >= memory.Length) break; var length = (int)memory[offset++]; if (length == 0xFF) { if (offset + 1 >= memory.Length) throw new InvalidDataException("Invalid extended TLV."); length = (memory[offset++] << 8) | memory[offset++]; } if (offset + length > memory.Length) throw new InvalidDataException("NDEF length exceeds tag capacity."); if (type == 3) return memory.AsSpan(offset, length).ToArray(); offset += length; }
        throw new InvalidDataException("No NDEF URI record on this tag.");
    }
    public Task<byte[]> ReadAsync(CancellationToken ct = default) => Task.Run(() => { ct.ThrowIfCancellationRequested(); return WithCard((card, protocol) => Extract(ReadMemory(card, protocol))); }, ct);
    public Task WriteAsync(byte[] ndef, CancellationToken ct = default) => Task.Run(() =>
    {
        ct.ThrowIfCancellationRequested(); var url = new Uri(NdefUri.Decode(ndef));
        if (url.Scheme != "https" || url.IsLoopback || !System.Text.RegularExpressions.Regex.IsMatch(url.AbsolutePath, @"^/p/[A-Za-z0-9_-]{24,64}$")) throw new ArgumentException("Physical tags require a reachable HTTPS NABAT identity resolver.");
        WithCard((card, protocol) =>
        {
            var uid = Send(card, protocol, [0xFF, 0xCA, 0, 0, 0]); var cc = Send(card, protocol, [0xFF, 0xB0, 0, 3, 0x10]);
            if (cc.Length < 4 || cc[0] != 0xE1 || (cc[1] >> 4) != 1 || (cc[3] & 15) != 0) throw new NotSupportedException("The tag is not an unlocked NFC Forum Type 2 tag.");
            var capacity = cc[2] * 8; byte[] tlv = ndef.Length < 255 ? [3, (byte)ndef.Length, .. ndef, 0xFE] : [3, 0xFF, (byte)(ndef.Length >> 8), (byte)ndef.Length, .. ndef, 0xFE];
            if (tlv.Length > capacity) throw new InvalidOperationException("Resolver URL exceeds tag capacity.");
            var padded = new byte[(tlv.Length + 3) / 4 * 4]; tlv.CopyTo(padded, 0);
            void WritePage(int page, byte[] bytes) { ct.ThrowIfCancellationRequested(); Send(card, protocol, [0xFF, 0xD6, 0, (byte)page, 4, .. bytes]); }
            WritePage(4, [3, 0, 0xFE, 0]); for (var offset = 4; offset < padded.Length; offset += 4) WritePage(4 + offset / 4, padded.AsSpan(offset, 4).ToArray()); WritePage(4, padded[..4]);
            if (!uid.SequenceEqual(Send(card, protocol, [0xFF, 0xCA, 0, 0, 0])) || !Extract(ReadMemory(card, protocol)).SequenceEqual(ndef)) throw new IOException("NFC read-back verification failed. Review this physical tag before deployment.");
            return true;
        });
    }, ct);
}
