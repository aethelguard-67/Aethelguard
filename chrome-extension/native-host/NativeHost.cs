using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

internal static class NativeHost
{
    private const int MaxMessageBytes = 1024 * 1024;
    private static readonly Guid DownloadsFolderId = new Guid("374DE290-123F-4565-9164-39C4925E467B");
    private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHGetKnownFolderPath(
        ref Guid folderId,
        uint flags,
        IntPtr token,
        out IntPtr path);

    public static int Main()
    {
        Stream input = Console.OpenStandardInput();
        Stream output = Console.OpenStandardOutput();

        while (true)
        {
            byte[] header = ReadExact(input, 4, true);
            if (header == null) return 0;

            int length = BitConverter.ToInt32(header, 0);
            if (length <= 0 || length > MaxMessageBytes) return 1;

            byte[] payload = ReadExact(input, length, false);
            if (payload == null) return 1;

            Dictionary<string, object> response;
            try
            {
                var request = Serializer.Deserialize<Dictionary<string, object>>(
                    Encoding.UTF8.GetString(payload));
                response = Handle(request);
            }
            catch (Exception error)
            {
                response = Failure(error.Message);
            }

            byte[] responseBytes = Encoding.UTF8.GetBytes(Serializer.Serialize(response));
            output.Write(BitConverter.GetBytes(responseBytes.Length), 0, 4);
            output.Write(responseBytes, 0, responseBytes.Length);
            output.Flush();
        }
    }

    private static Dictionary<string, object> Handle(Dictionary<string, object> request)
    {
        if (request == null) return Failure("Invalid native host request.");
        string operation = GetString(request, "operation");
        string path = GetString(request, "path");

        if (operation == "hash")
        {
            string downloads = GetDownloadsPath();
            string safePath = ValidateDownloadPath(path, downloads);
            var result = new Dictionary<string, object>
            {
                { "ok", true },
                { "sha256", HashFile(safePath) },
                { "fileName", Path.GetFileName(safePath) },
                { "size", new FileInfo(safePath).Length }
            };
            return result;
        }

        if (operation == "quarantine")
        {
            string expectedHash = GetString(request, "sha256").ToLowerInvariant();
            if (!IsSha256(expectedHash)) return Failure("The expected file hash is invalid.");
            return Quarantine(path, expectedHash);
        }

        return Failure("Unsupported native host operation.");
    }

    private static string GetDownloadsPath()
    {
        IntPtr pathPointer;
        Guid folderId = DownloadsFolderId;
        int result = SHGetKnownFolderPath(ref folderId, 0, IntPtr.Zero, out pathPointer);
        if (result != 0) Marshal.ThrowExceptionForHR(result);

        try
        {
            return Path.GetFullPath(Marshal.PtrToStringUni(pathPointer));
        }
        finally
        {
            Marshal.FreeCoTaskMem(pathPointer);
        }
    }

    private static string ValidateDownloadPath(string path, string downloads)
    {
        if (String.IsNullOrWhiteSpace(path)) throw new InvalidOperationException("The download path is missing.");

        string fullPath = Path.GetFullPath(path);
        string root = downloads.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        string prefix = root + Path.DirectorySeparatorChar;
        if (!fullPath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("For safety, only files inside your Downloads folder can be scanned.");
        }
        if (!File.Exists(fullPath)) throw new FileNotFoundException("The completed download could not be found.");

        string currentPath = Path.GetDirectoryName(fullPath);
        while (!String.Equals(currentPath, root, StringComparison.OrdinalIgnoreCase))
        {
            var directory = new DirectoryInfo(currentPath);
            if (!directory.Exists || (directory.Attributes & FileAttributes.ReparsePoint) != 0)
            {
                throw new InvalidOperationException("The download uses a missing or linked folder and was not scanned.");
            }
            currentPath = directory.Parent == null ? null : directory.Parent.FullName;
            if (currentPath == null)
            {
                throw new InvalidOperationException("The download is outside your Downloads folder.");
            }
        }

        FileAttributes attributes = File.GetAttributes(fullPath);
        if ((attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0)
        {
            throw new InvalidOperationException("Folders and linked files are not scanned.");
        }
        return fullPath;
    }

    private static string HashFile(string path)
    {
        using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (var sha256 = SHA256.Create())
        {
            return ToHex(sha256.ComputeHash(stream));
        }
    }

    private static Dictionary<string, object> Quarantine(string path, string expectedHash)
    {
        string downloads = GetDownloadsPath();
        string source = ValidateDownloadPath(path, downloads);
        string staging = Path.Combine(
            Path.GetDirectoryName(source),
            ".aethelguard-" + Guid.NewGuid().ToString("N") + ".tmp");
        string quarantineDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Aethelguard",
            "Quarantine");
        string temporaryCopy = null;
        bool staged = false;
        bool finalCopyCreated = false;
        string finalPath = null;

        try
        {
            if (!String.Equals(HashFile(source), expectedHash, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("The downloaded file changed after scanning; it was not quarantined.");
            }

            File.Move(source, staging);
            staged = true;
            if (!String.Equals(HashFile(staging), expectedHash, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("The download changed during quarantine; it was not removed.");
            }

            Directory.CreateDirectory(quarantineDirectory);
            temporaryCopy = Path.Combine(quarantineDirectory, Guid.NewGuid().ToString("N") + ".tmp");
            using (var input = new FileStream(staging, FileMode.Open, FileAccess.Read, FileShare.None))
            using (var output = new FileStream(temporaryCopy, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                input.CopyTo(output);
            }

            if (!String.Equals(HashFile(temporaryCopy), expectedHash, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("The quarantine copy did not match the scanned file.");
            }

            string name = Path.GetFileName(source) + "." + Guid.NewGuid().ToString("N") + ".aethelguard-quarantined";
            finalPath = Path.Combine(quarantineDirectory, name);
            File.Move(temporaryCopy, finalPath);
            temporaryCopy = null;
            finalCopyCreated = true;
            File.Delete(staging);
            staged = false;

            return new Dictionary<string, object>
            {
                { "ok", true },
                { "quarantined", true },
                { "quarantinedName", name },
                { "originalRemoved", true }
            };
        }
        catch
        {
            if (temporaryCopy != null && File.Exists(temporaryCopy)) File.Delete(temporaryCopy);

            if (staged && File.Exists(staging))
            {
                if (!File.Exists(source))
                {
                    File.Move(staging, source);
                }
                else
                {
                    throw new IOException(
                        finalCopyCreated
                            ? "A quarantine copy was created, but the original download could not be removed or restored."
                            : "Quarantine failed and the original download could not be restored.");
                }
            }

            if (finalCopyCreated)
            {
                return new Dictionary<string, object>
                {
                    { "ok", true },
                    { "quarantined", true },
                    { "quarantinedName", Path.GetFileName(finalPath) },
                    { "originalRemoved", false },
                    { "warning", "A quarantine copy was created, but the original download remains in Downloads." }
                };
            }
            throw;
        }
    }

    private static byte[] ReadExact(Stream stream, int count, bool allowCleanEnd)
    {
        byte[] buffer = new byte[count];
        int offset = 0;
        while (offset < count)
        {
            int read = stream.Read(buffer, offset, count - offset);
            if (read == 0)
            {
                if (allowCleanEnd && offset == 0) return null;
                return null;
            }
            offset += read;
        }
        return buffer;
    }

    private static string GetString(Dictionary<string, object> request, string key)
    {
        object value;
        return request.TryGetValue(key, out value) ? value as string : null;
    }

    private static bool IsSha256(string value)
    {
        if (value == null || value.Length != 64) return false;
        foreach (char character in value)
        {
            if (!((character >= '0' && character <= '9') ||
                  (character >= 'a' && character <= 'f') ||
                  (character >= 'A' && character <= 'F'))) return false;
        }
        return true;
    }

    private static string ToHex(byte[] bytes)
    {
        var builder = new StringBuilder(bytes.Length * 2);
        foreach (byte value in bytes) builder.Append(value.ToString("x2"));
        return builder.ToString();
    }

    private static Dictionary<string, object> Failure(string message)
    {
        return new Dictionary<string, object> { { "ok", false }, { "error", message } };
    }
}
