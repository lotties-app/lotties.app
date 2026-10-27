using Lotties.Api.Assistants.Mcp;
using Lotties.Application.Assistants;

namespace Lotties.Api.Assistants;

/// <summary>
/// <c>GET</c>/<c>PUT /me/assistant-settings</c> as the web reads it: the stored settings plus what the server offers, additively:
/// <see cref="McpEnabled"/> and, when it is on, <see cref="McpUrl"/>, the MCP server URL to paste into an AI assistant (the
/// same canonical URL the protected resource metadata names), and <see cref="SayBabyName"/> (false by default: answers carry no baby name) and <see cref="SayMedicineNames"/> (false by default: answers carry no medicine name).
/// </summary>
public sealed record AssistantSettingsView(Guid? DefaultBabyId, DateTimeOffset? UpdatedAt, bool McpEnabled, string? McpUrl, bool SayBabyName = false, bool SayMedicineNames = false)
{
    public static AssistantSettingsView Of(AssistantSettingsResponse settings, HttpRequest request, McpOptions mcp)
    {
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(mcp);
        return new AssistantSettingsView(settings.DefaultBabyId, settings.UpdatedAt, mcp.Enabled, mcp.Enabled ? McpResource.UrlOf(request, mcp) : null, settings.SayBabyName, settings.SayMedicineNames);
    }
}
