using System.Globalization;

namespace Lotties.CatalogImporter;

/// <summary>A source file on disk and where it came from.</summary>
internal sealed record SourceFile(string Path, string Origin, long Bytes, DateTimeOffset? LastModified);

/// <summary>
/// Resolves a <c>--source</c> value: a local path is used as is; an http(s) URL is downloaded once into the cache
/// directory (reused until <c>--refresh</c>), written to a temporary file first so an interrupted download leaves no
/// partial file.
/// </summary>
internal sealed class SourceFiles(HttpClient http, string cacheDirectory, bool refresh, TextWriter log)
{
    public async Task<SourceFile> ResolveAsync(string source, CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(source, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
        {
            return Local(source);
        }

        var target = Path.Combine(cacheDirectory, Path.GetFileName(uri.LocalPath));
        if (File.Exists(target) && !refresh)
        {
            await log.WriteLineAsync($"Using cached {target} (downloaded {File.GetLastWriteTimeUtc(target).ToString("u", CultureInfo.InvariantCulture)}; --refresh downloads again)");
            return new SourceFile(target, uri.ToString(), new FileInfo(target).Length, null);
        }

        return await DownloadAsync(uri, target, cancellationToken);
    }

    private static SourceFile Local(string path)
    {
        var info = new FileInfo(path);
        return info.Exists ? new SourceFile(info.FullName, info.FullName, info.Length, info.LastWriteTimeUtc) : throw new FileNotFoundException($"Source file not found: {path}");
    }

    private async Task<SourceFile> DownloadAsync(Uri uri, string target, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(cacheDirectory);
        await log.WriteLineAsync($"Downloading {uri} ...");
        using var response = await http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        var partial = target + ".partial";
        await using (var file = File.Create(partial))
        {
            await response.Content.CopyToAsync(file, cancellationToken);
        }

        File.Move(partial, target, overwrite: true);
        var lastModified = response.Content.Headers.LastModified;
        await log.WriteLineAsync($"Saved {target} ({new FileInfo(target).Length:N0} bytes, source last modified {lastModified?.ToString("u", CultureInfo.InvariantCulture) ?? "unknown"})");
        return new SourceFile(target, uri.ToString(), new FileInfo(target).Length, lastModified);
    }
}
