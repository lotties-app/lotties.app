using Lotties.Api.Board.Mcp;

namespace Lotties.Api.Board;

/// <summary>The project board (section <c>Board</c>, env <c>Board__Enabled</c>); off by default: every route answers 404.</summary>
public sealed class BoardOptions
{
    public const string SectionName = "Board";

    public bool Enabled { get; set; }

    /// <summary>The board's MCP endpoint (<c>Board__Mcp__Enabled</c>, off by default): served only when the board is on too.</summary>
    public BoardMcpOptions Mcp { get; set; } = new();
}
