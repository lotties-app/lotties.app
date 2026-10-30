using Microsoft.Extensions.Options;

namespace Lotties.Api.Board.Mcp;

/// <summary>
/// The board's MCP endpoint (section <c>Board:Mcp</c>, env e.g. <c>Board__Mcp__Enabled</c>; docs/design/36-project-board.md
/// section 9): off by default. <c>POST /api/v1/board/mcp</c> answers 404 unless both <c>Board:Enabled</c> and
/// <see cref="Enabled"/> are true. It needs no secret and no OAuth setting of its own: callers present a board API key or a
/// Keycloak access token with a board realm role, exactly as on the board's REST routes.
/// </summary>
public sealed class BoardMcpOptions
{
    public bool Enabled { get; set; }

    /// <summary>
    /// Browser origins allowed to call the endpoint (list or one comma-separated value). A request with any other
    /// <c>Origin</c> is 403 (DNS rebinding protection, MCP Streamable HTTP); requests without <c>Origin</c> (Claude Code and
    /// other server-side or CLI clients) are not affected. Empty (the default) allows no browser origin.
    /// </summary>
    public List<string> AllowedOrigins { get; set; } = [];

    /// <summary>Whether <paramref name="origin"/> is one of <see cref="AllowedOrigins"/> (ignoring case and a trailing slash).</summary>
    public bool AllowsOrigin(string origin) =>
        AllowedOrigins.Any(allowed => string.Equals(allowed.Trim().TrimEnd('/'), origin.Trim().TrimEnd('/'), StringComparison.OrdinalIgnoreCase));
}

/// <summary>Fails startup when <c>Board:Mcp:AllowedOrigins</c> has a value that is not an absolute http(s) origin.</summary>
internal sealed class BoardMcpOptionsValidator : IValidateOptions<BoardOptions>
{
    public ValidateOptionsResult Validate(string? name, BoardOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var failures = options.Mcp.AllowedOrigins
            .Where(origin => !IsOrigin(origin))
            .Select(origin => $"Board:Mcp:AllowedOrigins has a value that is not an absolute http(s) origin: '{origin}'.")
            .ToArray();
        return failures.Length == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }

    private static bool IsOrigin(string origin) =>
        Uri.TryCreate(origin.Trim(), UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp);
}

/// <summary>Adds a comma-separated <c>Board:Mcp:AllowedOrigins</c> value (one env variable) to the bound list.</summary>
internal sealed class BoardMcpAllowedOriginsFromText(IConfiguration configuration) : IPostConfigureOptions<BoardOptions>
{
    public void PostConfigure(string? name, BoardOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var text = configuration.GetSection(BoardOptions.SectionName).GetSection(nameof(BoardOptions.Mcp))[nameof(BoardMcpOptions.AllowedOrigins)];
        var fromText = (text ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        options.Mcp.AllowedOrigins = options.Mcp.AllowedOrigins
            .Select(origin => origin.Trim())
            .Concat(fromText)
            .Where(origin => origin.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }
}
